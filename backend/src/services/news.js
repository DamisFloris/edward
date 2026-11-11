// Raccolta notizie dalle fonti RSS/Atom scelte dall'utente.
import Parser from "rss-parser";
import { decodeEntities } from "./websearch.js";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Edward/1.0 (personal news reader)" },
});

const stripHtml = (s = "") =>
  decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// Alcune categorie pubblicano meno spesso: guardiamo un po' più indietro nel tempo.
const MAX_AGE_HOURS = { tecnologia: 72, geopolitica: 48 };

export async function fetchSource(source, { perSource = 8, maxAgeHours } = {}) {
  const feed = await parser.parseURL(source.url);
  const maxAge = maxAgeHours ?? MAX_AGE_HOURS[source.category] ?? 36;
  const cutoff = Date.now() - maxAge * 3600 * 1000;
  return (feed.items || [])
    .map((it) => ({
      source: source.name || feed.title || source.url,
      category: source.category || "",
      title: stripHtml(it.title || ""),
      summary: stripHtml(it.contentSnippet || it.summary || it.content || "").slice(0, 600),
      // alcune fonti (es. Formiche) mettono l'articolo intero nel feed
      fullText: (() => {
        const t = stripHtml(it["content:encoded"] || it.content || "");
        return t.length > 1500 ? t.slice(0, 8000) : "";
      })(),
      link: it.link || "",
      published: it.isoDate || it.pubDate || null,
    }))
    .filter((it) => it.title)
    .filter((it) => !it.published || new Date(it.published).getTime() >= cutoff)
    .slice(0, perSource);
}

/**
 * Scarica tutte le fonti attive in parallelo; gli errori di una fonte non bloccano le altre.
 * Le fonti delle sezioni "approfondite" contribuiscono con più notizie.
 */
export async function fetchAllNews(sources, perSource, focus = []) {
  const deep = new Set(focus.filter((f) => f.depth === "approfondita").map((f) => f.key));
  const active = sources.filter((s) => s.enabled !== false && s.url);
  const results = await Promise.allSettled(
    active.map((s) => fetchSource(s, { perSource: deep.has(s.category) ? Math.ceil(perSource * 1.5) : perSource })),
  );
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push({ source: active[i].name || active[i].url, error: String(r.reason?.message || r.reason) });
  });
  return { items, errors };
}
