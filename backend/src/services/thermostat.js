// Termostato BTicino Smarther2 (app Legrand/BTicino Home + Control, tipo modulo "BNS") tramite API Netatmo Connect.
// Endpoint, permessi e formato dei comandi ricavati da due progetti open source che lo controllano,
// pyatmo (Home Assistant) e smarther2mqtt:
//   OAuth2: /oauth2/authorize, /oauth2/token  - permessi read_smarther write_smarther
//   GET  /api/homesdata                       - case, stanze, moduli
//   GET  /api/homestatus?home_id=...           - temperatura misurata e impostata
//   POST /api/setstate  (JSON)                 - { home: { id, rooms: [{ id, therm_setpoint_mode, ... }] } }
import crypto from "node:crypto";
import { config } from "../config.js";
import { secrets } from "../db.js";

const API = process.env.NETATMO_API_URL || "https://api.netatmo.com";
const SCOPES = "read_smarther write_smarther";
const TOKEN_KEY = "netatmo_tokens";

// Modalità supportate dallo Smarther2. Non esiste un vero "spento": si usa l'antigelo (hg).
export const MODES = {
  manual: "manuale",
  home: "programma",
  max: "boost",
  hg: "antigelo (spento)",
};

export const thermostatConfigured = () => Boolean(config.netatmoClientId && config.netatmoClientSecret);
export const thermostatConnected = () =>
  Boolean(secrets.get(TOKEN_KEY)?.refresh_token || (thermostatConfigured() && config.netatmoRefreshToken));

export function redirectUri(req) {
  const base = config.publicUrl || `${req.protocol}://${req.get("host")}`;
  return `${base}/api/thermostat/callback`;
}

// ---------- OAuth ----------

export function authorizeUrl(req) {
  const state = crypto.randomBytes(16).toString("hex");
  secrets.set("netatmo_oauth_state", { state, redirect: redirectUri(req), at: Date.now() });
  const url = new URL(`${API}/oauth2/authorize`);
  url.searchParams.set("client_id", config.netatmoClientId);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      client_id: config.netatmoClientId,
      client_secret: config.netatmoClientSecret,
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Netatmo: autenticazione fallita (${json.error || res.status})`);
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 10800) * 1000 - 60_000,
  };
  secrets.set(TOKEN_KEY, tokens);
  return tokens;
}

export async function handleCallback({ code, state }) {
  const saved = secrets.get("netatmo_oauth_state");
  secrets.delete("netatmo_oauth_state");
  if (!saved || saved.state !== state || Date.now() - saved.at > 15 * 60_000) throw new Error("Stato OAuth non valido o scaduto");
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: saved.redirect, scope: SCOPES });
  // il login ha la precedenza sul token del .env attuale; un token NUOVO messo nel .env in futuro tornerà a valere
  if (config.netatmoRefreshToken) secrets.set(TOKEN_KEY, { ...tokens, envSeed: config.netatmoRefreshToken });
  secrets.delete("netatmo_home");
}

export function disconnect() {
  secrets.delete(TOKEN_KEY);
  secrets.delete("netatmo_home");
}

async function accessToken() {
  let t = secrets.get(TOKEN_KEY);
  const envToken = config.netatmoRefreshToken;
  // Token del "Token generator" nel .env: lo usiamo al primo avvio, oppure quando ne metti uno nuovo
  // (diverso da quello già usato). Netatmo poi rilascia token nuovi, che salviamo nel database.
  if (envToken && (!t?.refresh_token || (t.envSeed && t.envSeed !== envToken))) t = { refresh_token: envToken, expires_at: 0, envSeed: envToken };
  if (!t?.refresh_token) throw new Error("Termostato non collegato: collegalo dalle Impostazioni");
  if (Date.now() >= t.expires_at) {
    try {
      const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
      if (t.envSeed) secrets.set(TOKEN_KEY, { ...fresh, envSeed: t.envSeed });
      t = fresh;
    } catch (e) {
      if (/invalid_grant/.test(e.message))
        throw new Error(
          "Netatmo ha rifiutato il refresh token (revocato o sostituito). Genera un nuovo token su dev.netatmo.com " +
            "con i permessi read_smarther e write_smarther, mettilo in NETATMO_REFRESH_TOKEN e riavvia Edward.",
        );
      throw e;
    }
  }
  return t.access_token;
}

async function api(method, path, { query, json } = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Netatmo ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// ---------- casa e stanze ----------

/** Trova la casa con il termostato (memorizzata dopo la prima volta). */
async function getHome() {
  const cached = secrets.get("netatmo_home");
  if (cached && Date.now() - cached.at < 24 * 3600e3) return cached;
  const { body } = await api("GET", "/api/homesdata");
  const homes = body?.homes || [];
  const home =
    homes.find((h) => (h.modules || []).some((m) => /^BNS$|NATherm|Smarther/i.test(m.type))) ||
    homes.find((h) => h.type === "therm") ||
    homes[0];
  if (!home) throw new Error("Nessuna casa trovata nell'account Netatmo/Home + Control");
  const info = {
    id: home.id,
    name: home.name,
    rooms: (home.rooms || []).map((r) => ({ id: r.id, name: r.name })),
    modules: (home.modules || []).map((m) => ({ id: m.id, type: m.type, name: m.name, room_id: m.room_id })),
    at: Date.now(),
  };
  secrets.set("netatmo_home", info);
  return info;
}

/** Stato attuale di tutte le stanze. */
export async function getStatus() {
  const home = await getHome();
  const { body } = await api("GET", "/api/homestatus", { query: { home_id: home.id } });
  const rooms = (body?.home?.rooms || []).map((r) => ({
    id: r.id,
    name: home.rooms.find((x) => x.id === r.id)?.name || "Casa",
    measured: r.therm_measured_temperature ?? null,
    setpoint: r.therm_setpoint_temperature ?? null,
    mode: r.therm_setpoint_mode ?? null,
    modeLabel: MODES[r.therm_setpoint_mode] || r.therm_setpoint_mode || "",
    until: r.therm_setpoint_end_time ? new Date(r.therm_setpoint_end_time * 1000).toISOString() : null,
    heating: r.heating_power_request != null ? r.heating_power_request > 0 : null,
  }));
  return { home: home.name, rooms };
}

function pickRoom(home, roomName) {
  if (!home.rooms.length) throw new Error("Nessuna stanza configurata");
  if (!roomName) return home.rooms[0];
  const n = roomName.toLowerCase();
  return home.rooms.find((r) => r.name.toLowerCase().includes(n)) || home.rooms[0];
}

const setRoom = (homeId, payload) => api("POST", "/api/setstate", { json: { home: { id: homeId, rooms: [payload] } } });
const endTime = (minutes) => Math.floor(Date.now() / 1000) + Math.round(minutes * 60);

/**
 * Imposta il termostato.
 *  "manual": temperatura obbligatoria, minutes = durata (default 180), poi torna al programma
 *  "max":    boost (riscaldamento al massimo) per minutes (default 30)
 *  "home":   torna al programma orario
 *  "hg":     antigelo, cioè di fatto spento, finché non si cambia di nuovo
 */
export async function setThermostat({ mode = "manual", temperature, minutes, room } = {}) {
  if (!MODES[mode]) throw new Error(`Modalità non valida: ${mode}`);
  const home = await getHome();
  const r = pickRoom(home, room);
  const payload = { id: r.id, therm_setpoint_mode: mode };

  if (mode === "manual") {
    const t = Number(temperature);
    if (!Number.isFinite(t) || t < 5 || t > 30) throw new Error("Temperatura non valida (5-30 °C)");
    payload.therm_setpoint_temperature = Math.round(t * 2) / 2;
    payload.therm_setpoint_end_time = endTime(minutes || 180);
  } else if (mode === "max") {
    payload.therm_setpoint_end_time = endTime(minutes || 30);
    // Lo Smarther2 non passa direttamente da antigelo a boost: serve un passaggio intermedio in manuale
    // (comportamento osservato dal progetto smarther2mqtt).
    const now = (await getStatus()).rooms.find((x) => x.id === r.id);
    if (now?.mode === "hg") {
      await setRoom(home.id, {
        id: r.id,
        therm_setpoint_mode: "manual",
        therm_setpoint_temperature: 20,
        therm_setpoint_end_time: payload.therm_setpoint_end_time,
      });
    }
  }
  await setRoom(home.id, payload);
  return { room: r.name, ...payload };
}
