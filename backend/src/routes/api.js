import { Router } from "express";
import multer from "multer";
import { config, sttServerAvailable, ttsServerAvailable } from "../config.js";
import { listEvents, createEvent, updateEvent, deleteEvent, upcomingEvents } from "../services/calendar.js";
import { getSettings, updateSettings } from "../services/settings.js";
import { getForecast, geocode } from "../services/weather.js";
import { getLatestBriefing, runNightly, isRunning, getJobRuns } from "../services/briefing.js";
import { chat, resetSession } from "../services/assistant.js";
import { friendlyError } from "../services/claude.js";
import { transcribe, synthesize } from "../services/speech.js";
import { usage } from "../db.js";
import { geminiConfigured } from "../services/websearch.js";
import {
  thermostatConfigured,
  thermostatConnected,
  authorizeUrl,
  handleCallback,
  disconnect,
  getStatus,
  setThermostat,
} from "../services/thermostat.js";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 400).json({ error: e.message });
  }
};

// ---- stato ----
api.get("/health", (req, res) => {
  res.json({
    ok: true,
    ai: config.anthropicConfigured,
    model: config.model,
    stt: sttServerAvailable(),
    tts: ttsServerAvailable(),
    nightlyCron: config.nightlyCron,
    briefingProvider: config.briefingProvider,
    search: { searxng: config.searxngUrl, geminiFallback: geminiConfigured() },
    thermostat: { configured: thermostatConfigured(), connected: thermostatConnected() },
    briefingRunning: isRunning(),
  });
});

// ---- calendario ----
api.get("/events", wrap((req, res) => res.json(listEvents({ from: req.query.from, to: req.query.to }))));
api.get("/events/upcoming", wrap((req, res) => res.json(upcomingEvents(Number(req.query.days || 7)))));
api.post("/events", wrap((req, res) => res.status(201).json(createEvent(req.body))));
api.put(
  "/events/:id",
  wrap((req, res) => {
    const e = updateEvent(req.params.id, req.body);
    if (!e) return res.status(404).json({ error: "Evento non trovato" });
    res.json(e);
  }),
);
api.delete(
  "/events/:id",
  wrap((req, res) => {
    if (!deleteEvent(req.params.id)) return res.status(404).json({ error: "Evento non trovato" });
    res.status(204).end();
  }),
);

// ---- impostazioni ----
api.get("/settings", (req, res) => res.json(getSettings()));
api.put("/settings", wrap((req, res) => res.json(updateSettings(req.body || {}))));
api.get("/geocode", wrap(async (req, res) => res.json(await geocode(String(req.query.q || "")))));

// ---- meteo live ----
api.get(
  "/weather",
  wrap(async (req, res) => res.json(await getForecast(getSettings().location, req.query.date || undefined))),
);

// ---- giornale ----
api.get("/briefing", (req, res) => res.json(getLatestBriefing()));
api.get("/briefing/runs", (req, res) => res.json(getJobRuns()));
api.post(
  "/briefing/run",
  wrap(async (req, res) => {
    const already = isRunning();
    const p = runNightly();
    if (req.query.wait === "1") return res.json(await p);
    p.catch(() => {});
    res.status(202).json({ started: !already, running: true });
  }),
);

// ---- assistente ----
api.post("/assistant/chat", async (req, res) => {
  const { sessionId, text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: "Testo mancante" });
  try {
    res.json(await chat(sessionId, text.trim()));
  } catch (e) {
    console.error("[assistant]", e);
    res.status(500).json({ error: friendlyError(e) });
  }
});
api.post("/assistant/reset", (req, res) => {
  resetSession(req.body?.sessionId || "default");
  res.json({ ok: true });
});

// ---- utilizzo del mese (ricerche web, pagine lette) ----
api.get("/usage", (req, res) => res.json(usage.month()));

// ---- termostato ----
api.get(
  "/thermostat",
  wrap(async (req, res) => {
    const base = { configured: thermostatConfigured(), connected: thermostatConnected() };
    if (!base.connected) return res.json(base);
    res.json({ ...base, ...(await getStatus()) });
  }),
);
api.get("/thermostat/auth", (req, res) => {
  if (!thermostatConfigured()) return res.status(400).send("Configura NETATMO_CLIENT_ID e NETATMO_CLIENT_SECRET nel .env");
  res.redirect(authorizeUrl(req));
});
api.get("/thermostat/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await handleCallback({ code: String(req.query.code || ""), state: String(req.query.state || "") });
    res.redirect("/#impostazioni");
  } catch (e) {
    res.status(400).send(`Collegamento del termostato fallito: ${e.message}`);
  }
});
api.post("/thermostat/disconnect", (req, res) => {
  disconnect();
  res.json({ ok: true });
});
api.post("/thermostat", wrap(async (req, res) => res.json(await setThermostat(req.body || {}))));

// ---- voce lato server ----
api.post(
  "/stt",
  upload.single("audio"),
  wrap(async (req, res) => {
    if (!sttServerAvailable()) return res.status(501).json({ error: "STT server non configurato" });
    if (!req.file) return res.status(400).json({ error: "Audio mancante" });
    res.json({ text: await transcribe(req.file.buffer) });
  }),
);
api.post(
  "/tts",
  wrap(async (req, res) => {
    if (!ttsServerAvailable()) return res.status(501).json({ error: "TTS server non configurato" });
    const text = String(req.body?.text || "").slice(0, 5000);
    if (!text) return res.status(400).json({ error: "Testo mancante" });
    res.type("audio/wav").send(await synthesize(text));
  }),
);
