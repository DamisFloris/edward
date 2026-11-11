// Ricerca web per Edward:
//   1) SearXNG in locale (gratis, metamotore: Google, Bing, DuckDuckGo, ...)
//   2) riserva: Gemini con "Grounding with Google Search" (5000 ricerche/mese incluse sui modelli Gemini 3+)
// Le pagine vengono scaricate e ripulite direttamente da Edward (nessun costo).
import dns from "node:dns/promises";
import net from "node:net";
import { config } from "../config.js";
import { usage } from "../db.js";

const UA = "Edward/1.0 (personal assistant)";
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // query normalizzata -> { at, value }

const cacheGet = (k) => {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  cache.delete(k);
  return null;
};
const cacheSet = (k, value) => {
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), value });
};

export const geminiConfigured = () => Boolean(config.geminiKey);

async function searxng(query, max) {
  const url = new URL(`${config.searxngUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "it-IT");
  url.searchParams.set("safesearch", "0");
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`SearXNG ha risposto ${res.status}`);
  const json = await res.json();
  const results = (json.results || []).slice(0, max).map((r) => ({
    title: r.title || "",
    url: r.url,
    snippet: (r.content || "").slice(0, 400),
    date: r.publishedDate || undefined,
  }));
  if (!results.length) throw new Error("SearXNG non ha trovato risultati");
  return results;
}

async function gemini(query) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": config.geminiKey,
      "Content-Type": "application/json",
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model: config.geminiModel,
      input: `Cerca sul web e rispondi in italiano in modo fattuale e conciso (massimo 8 frasi), con date e cifre precise: ${query}`,
      tools: [{ type: "google_search" }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const steps = json.steps || [];
  const outputs = steps.filter((s) => s.type === "model_output").flatMap((s) => s.content || []);
  const answer = outputs.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  const sources = [];
  for (const c of outputs)
    for (const a of c.annotations || [])
      if (a.type === "url_citation" && a.url && !sources.some((s) => s.url === a.url))
        sources.push({ title: a.title || "", url: a.url });
  const searches = steps.filter((s) => s.type === "google_search_call").flatMap((s) => s.arguments?.queries || []).length;
  if (!answer) throw new Error("Gemini non ha restituito una risposta");
  return { answer, sources: sources.slice(0, 8), searches: Math.max(1, searches) };
}

/** Cerca sul web. Restituisce testo pronto da passare al modello. */
export async function webSearch(query, { max = 6 } = {}) {
  const key = query.trim().toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  let out;
  try {
    const results = await searxng(query, max);
    usage.inc("search_searxng");
    out =
      `Risultati di ricerca per "${query}":\n` +
      results.map((r, i) => `${i + 1}. ${r.title}${r.date ? ` (${r.date.slice(0, 10)})` : ""}\n   ${r.url}\n   ${r.snippet}`).join("\n");
  } catch (e) {
    if (!geminiConfigured()) throw new Error(`Ricerca non disponibile (${e.message}) e Gemini non è configurato`);
    console.warn(`[websearch] SearXNG non disponibile (${e.message}), uso Gemini`);
    const g = await gemini(query);
    for (let i = 0; i < g.searches; i++) usage.inc("search_gemini");
    out =
      `Risposta sintetica (Google Search via Gemini) per "${query}":\n${g.answer}\n\nFonti:\n` +
      g.sources.map((s, i) => `${i + 1}. ${s.title} ${s.url}`).join("\n");
  }
  cacheSet(key, out);
  return out;
}

// ---- lettura pagine ----

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

/** Impedisce che una pagina web malevola faccia leggere a Edward indirizzi della rete di casa. */
async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Sono ammessi solo indirizzi http/https");
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Indirizzo della rete locale non consentito");
  return url;
}

const ENTITIES = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", laquo: "«", raquo: "»", hellip: "…",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", euro: "€", deg: "°", middot: "·",
  agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È", Eacute: "É",
  Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù", ccedil: "ç", ntilde: "ñ", ouml: "ö", uuml: "ü", auml: "ä", szlig: "ß", copy: "©",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function htmlToText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  let body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  body = decodeEntities(body)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: decodeEntities(title), text: body };
}

export async function readPage(raw, { maxChars = 8000, usageKey = "page_read", raw: rawText = false } = {}) {
  const cached = cacheGet(`page:${raw}`);
  if (cached) return cached;
  let url = await assertPublicUrl(raw);
  let res;
  // segue i redirect a mano per ricontrollare ogni destinazione
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,text/plain" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location"), url).toString());
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`La pagina ha risposto ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!/text\/html|text\/plain|xml/.test(type)) throw new Error(`Formato non supportato (${type})`);
  const html = (await res.text()).slice(0, 2_000_000);
  usage.inc(usageKey);
  const { title, text } = type.includes("html") ? htmlToText(html) : { title: "", text: html };
  if (rawText) return { title, url: String(url), text };
  const out = `Pagina: ${title}\nURL: ${url}\n\n${text.slice(0, maxChars)}${text.length > maxChars ? "\n[...testo troncato...]" : ""}`;
  cacheSet(`page:${raw}`, out);
  return out;
}
