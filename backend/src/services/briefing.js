// Pipeline notturna: notizie -> meteo -> agenda -> composizione del "giornale" con l'AI.
import { db, secrets } from "../db.js";
import { config } from "../config.js";
import { getSettings } from "./settings.js";
import { fetchAllNews } from "./news.js";
import { getForecast, describeForecast } from "./weather.js";
import { z } from "zod";
import { todaysEvents, upcomingEvents, describeEvent, spokenAgenda } from "./calendar.js";
import { deepseekJson, deepseekConfigured } from "./deepseek.js";
import { localDate, formatItalian } from "./time.js";
import { getClient, commonParams, assertNotRefused, textOf } from "./claude.js";
import { readPage } from "./websearch.js";

const BRIEFING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["greeting", "overview", "sections", "weather", "agendaNote", "spokenScript"],
  properties: {
    greeting: { type: "string", description: "Saluto mattutino breve e personale" },
    overview: { type: "string", description: "2-3 frasi che riassumono le notizie più importanti del giorno" },
    sections: {
      type: "array",
      description: "Sezioni del giornale, nell'ordine della linea editoriale indicata",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "items"],
        properties: {
          title: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["ref", "title", "summary", "context"],
              properties: {
                ref: { type: "integer", description: "Numero della notizia nella lista fornita" },
                title: { type: "string", description: "Titolo riscritto, chiaro e conciso" },
                summary: {
                  type: "string",
                  description: "Riassunto: 1-2 frasi nelle sezioni normali, 3-5 frasi nelle sezioni approfondite",
                },
                context: {
                  type: "string",
                  description:
                    "Solo sezioni approfondite: contesto e perché conta (2-3 frasi). Stringa vuota nelle sezioni normali.",
                },
              },
            },
          },
        },
      },
    },
    weather: {
      type: "object",
      additionalProperties: false,
      required: ["morning", "afternoon", "evening", "overall"],
      properties: {
        morning: { type: "string", description: "Come vestirsi la mattina" },
        afternoon: { type: "string", description: "Come vestirsi il pomeriggio" },
        evening: { type: "string", description: "Come vestirsi la sera" },
        overall: { type: "string", description: "Consiglio complessivo per la giornata" },
      },
    },
    agendaNote: { type: "string", description: "Commento breve sugli impegni di oggi e dei prossimi giorni" },
    spokenScript: {
      type: "string",
      description:
        "Testo da leggere ad alta voce (3-5 minuti): saluto, meteo con temperature reali e percepite e consiglio vestiti, impegni, poi le notizie sezione per sezione, dedicando più spazio alle sezioni approfondite. Niente markdown, niente URL, numeri scritti in modo naturale.",
    },
  },
};

// Validazione dell'output (DeepSeek in JSON mode non garantisce lo schema).
const BriefingZ = z.object({
  greeting: z.string(),
  overview: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      items: z.array(
        z.object({ ref: z.coerce.number().int(), title: z.string(), summary: z.string(), context: z.string().optional().default("") }),
      ),
    }),
  ),
  weather: z.object({ morning: z.string(), afternoon: z.string(), evening: z.string(), overall: z.string() }),
  agendaNote: z.string().optional().default(""),
  spokenScript: z.string(),
});

const AGENDA_MARK = "[[AGENDA]]";

const JSON_EXAMPLE = `{
  "greeting": "Buongiorno!",
  "overview": "…",
  "sections": [
    { "title": "Cronaca locale", "items": [ { "ref": 3, "title": "…", "summary": "…", "context": "" } ] },
    { "title": "Mercati finanziari", "items": [ { "ref": 41, "title": "…", "summary": "…", "context": "…" } ] }
  ],
  "weather": { "morning": "…", "afternoon": "…", "evening": "…", "overall": "…" },
  "spokenScript": "Buongiorno! … ${AGENDA_MARK} … Passiamo alle notizie…"
}`;

const SYSTEM = `Sei Edward, l'assistente personale dell'utente. Ogni mattina prepari il suo "giornale": un'edizione
ordinata e ben scritta delle notizie raccolte dalle sue fonti, il meteo con consigli concreti su come vestirsi
(basati soprattutto sulla temperatura PERCEPITA, oltre a quella reale) e un promemoria degli impegni.
Scrivi in italiano, tono caldo ma asciutto. Segui la linea editoriale che ti viene data: sezioni in quell'ordine,
ogni notizia nella sezione giusta (la categoria della fonte è un indizio, non un vincolo), duplicati tra fonti fusi
in un'unica notizia, notizie irrilevanti o promozionali scartate. Nelle sezioni "approfondite" scegli le notizie più
rilevanti e spiega cosa è successo, perché è successo e quali conseguenze può avere: per il contesto puoi usare
conoscenze generali consolidate, ma i fatti specifici (cifre, dichiarazioni, eventi) devono venire SOLO dalle notizie
fornite. Non inventare nulla. Se una sezione non ha notizie, omettila.`;

const insertRun = db.prepare("INSERT INTO job_runs (started_at, status) VALUES (datetime('now'), 'running')");
const finishRun = db.prepare("UPDATE job_runs SET finished_at = datetime('now'), status = ?, log = ? WHERE id = ?");
const insertBriefing = db.prepare("INSERT INTO briefings (date, data) VALUES (?, ?)");

let running = null;

export function getLatestBriefing() {
  const row = db.prepare("SELECT * FROM briefings ORDER BY id DESC LIMIT 1").get();
  return row ? { id: row.id, ...JSON.parse(row.data) } : null;
}

export function getJobRuns(limit = 10) {
  return db.prepare("SELECT * FROM job_runs ORDER BY id DESC LIMIT ?").all(limit);
}

export function isRunning() {
  return Boolean(running);
}

/** Avvia la pipeline (se ne è già in corso una, restituisce quella). */
export function runNightly() {
  running ??= doRun().finally(() => {
    running = null;
  });
  return running;
}

async function doRun() {
  const runId = insertRun.run().lastInsertRowid;
  const log = [];
  const step = (msg) => {
    const line = `[${new Date().toLocaleTimeString("it-IT", { timeZone: config.timezone })}] ${msg}`;
    log.push(line);
    console.log("[nightly]", msg);
  };

  try {
    const settings = getSettings();
    const date = localDate();

    // 1) Notizie
    step(`Step 1/5 - scarico le notizie da ${settings.newsSources.filter((s) => s.enabled !== false).length} fonti`);
    const { items: news, errors: newsErrors } = await fetchAllNews(
      settings.newsSources,
      settings.newsPerSource,
      settings.newsFocus,
    );
    step(`  ${news.length} notizie raccolte${newsErrors.length ? `, ${newsErrors.length} fonti in errore` : ""}`);
    for (const e of newsErrors) step(`  ! ${e.source}: ${e.error}`);

    // 2) Meteo
    step(`Step 2/5 - meteo per ${settings.location.name}`);
    let weather = null;
    try {
      weather = await getForecast(settings.location, date);
    } catch (e) {
      step(`  ! meteo non disponibile: ${e.message}`);
    }

    // 3) Agenda
    step("Step 3/5 - leggo il calendario");
    const today = todaysEvents();
    const upcoming = upcomingEvents(7).filter((e) => !today.some((t) => t.id === e.id));

    const provider =
      config.briefingProvider === "deepseek" && deepseekConfigured()
        ? "deepseek"
        : config.anthropicConfigured
          ? "anthropic"
          : null;

    // 4) Lettura completa degli articoli più importanti delle sezioni approfondite
    step("Step 4/5 - scelgo e leggo per intero gli articoli da approfondire");
    let fullTexts = new Map();
    if (provider) {
      try {
        fullTexts = await deepRead({ provider, settings, news, step });
      } catch (e) {
        step(`  ! lettura completa saltata: ${e.message}`);
      }
    } else step("  saltato (nessuna AI configurata)");

    // 5) Composizione
    step("Step 5/5 - compongo il giornale");
    let composed;
    if (provider) {
      // un secondo tentativo se il JSON non è valido
      for (let attempt = 1; attempt <= 2 && !composed; attempt++) {
        try {
          composed = await composeWithAI({ provider, settings, date, news, fullTexts, weather, today, upcoming, step });
          step(`  giornale composto con ${provider}`);
        } catch (e) {
          step(`  ! tentativo ${attempt} con ${provider} fallito: ${e.message}`);
        }
      }
      if (!composed) step("  uso la versione semplice");
    }
    composed ??= composeFallback({ settings, news, weather, today, upcoming });

    const briefing = {
      date,
      generatedAt: new Date().toISOString(),
      location: settings.location.name,
      forecast: weather,
      today,
      upcoming,
      newsErrors,
      ...composed,
    };
    insertBriefing.run(date, JSON.stringify(briefing));
    step("Fatto ✔");
    finishRun.run("ok", log.join("\n"), runId);
    return briefing;
  } catch (e) {
    step(`ERRORE: ${e.stack || e.message}`);
    finishRun.run("error", log.join("\n"), runId);
    throw e;
  }
}

/** Chiamata in JSON al fornitore scelto: schema rigido con Claude, JSON mode + esempio con DeepSeek. */
async function aiJson({ provider, system, user, schema, example, effort = config.briefingEffort, step }) {
  if (provider === "deepseek") {
    const { data, usage } = await deepseekJson({
      system: `${system}\n\nRispondi SOLO con un oggetto json con questa struttura:\n${example}`,
      user,
    });
    step?.(`  token: ${usage?.prompt_tokens ?? "?"} in, ${usage?.completion_tokens ?? "?"} out`);
    return data;
  }
  const message = await getClient().beta.messages.create({
    model: config.model,
    max_tokens: 16000,
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
    ...commonParams(),
  });
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("risposta troncata (max_tokens)");
  step?.(`  token: ${message.usage.input_tokens} in, ${message.usage.output_tokens} out`);
  return JSON.parse(textOf(message));
}

// Un testo è "completo" se è chiaramente più lungo dell'anteprima del feed: i paywall restituiscono
// di solito solo titolo e poche righe, mentre i lanci d'agenzia possono essere brevi ma integri.
const isRealArticle = (text, summary = "") => text.length >= 300 && text.length > summary.length * 1.5 + 100;

// Righe di interfaccia che restano nel testo estratto dalle pagine
const JUNK_LINE = /^(loading\.*|condividi|link copiato|prevpagelabel|nextpagelabel|iscriviti|newsletter|da non perdere|leggi anche|brand connect|tutti gli eventi|i prossimi eventi|argomenti|scheda autore|trust project|riproduzione riservata.*|pubblicità|ascolta( l'articolo)?)$/i;
const cleanArticle = (t) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !JUNK_LINE.test(l))
    .join("\n");

/**
 * Sceglie le notizie più importanti delle sezioni approfondite e ne scarica il testo completo.
 * Restituisce Map(indice notizia -> testo).
 */
const PAYWALL_KEY = "deepread_paywall";

async function deepRead({ provider, settings, news, step }) {
  const deepKeys = new Set(settings.newsFocus.filter((f) => f.depth === "approfondita").map((f) => f.key));
  // fonti che negli ultimi giorni hanno sempre fallito la lettura completa (di solito paywall): le saltiamo
  const paywall = secrets.get(PAYWALL_KEY) || {};
  const blocked = (src) => paywall[src]?.fails >= 3 && Date.now() - paywall[src].at < 7 * 864e5;
  const blockedNames = [...new Set(news.filter((n) => deepKeys.has(n.category) && blocked(n.source)).map((n) => n.source))];
  if (blockedNames.length) step(`  salto le fonti a pagamento: ${blockedNames.join(", ")}`);
  const candidates = news.map((n, i) => ({ ...n, i })).filter((n) => deepKeys.has(n.category) && n.link && !blocked(n.source));
  const max = config.briefingDeepReads;
  if (!candidates.length || max <= 0) return new Map();

  // con poche candidate le leggiamo tutte; altrimenti le sceglie l'AI (leggiamo qualche riserva per i paywall)
  let chosen = candidates;
  if (candidates.length > max) {
    const list = candidates
      .map((n) => `${n.i + 1}. [${n.source} · ${n.category}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 200)}` : ""}`)
      .join("\n");
    const data = await aiJson({
      provider,
      effort: "low",
      step,
      system:
        "Sei il caporedattore di un giornale. Scegli le notizie più importanti da approfondire leggendo l'articolo completo: " +
        "rilevanza reale e impatto (non curiosità, gallerie fotografiche, guide all'acquisto o pubblicità), varietà tra le sezioni, " +
        "nessun doppione della stessa notizia, preferenza per le fonti più autorevoli.",
      user: `Sezioni da approfondire: ${[...deepKeys].join(", ")}.\nScegli ${max + 3} notizie in ordine di importanza.\n\n${list}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["refs"],
        properties: { refs: { type: "array", items: { type: "integer" } } },
      },
      example: '{ "refs": [12, 40, 7] }',
    });
    const refs = z.object({ refs: z.array(z.coerce.number().int()) }).parse(data).refs;
    chosen = refs.map((r) => candidates.find((c) => c.i === r - 1)).filter(Boolean);
  }

  const texts = new Map();
  const skipped = [];
  // 4 download alla volta, ci fermiamo appena ne abbiamo abbastanza
  for (let k = 0; k < chosen.length && texts.size < max; k += 4) {
    await Promise.all(
      chosen.slice(k, k + 4).map(async (n) => {
        try {
          let text = n.fullText;
          if (!text || !isRealArticle(text, n.summary)) {
            text = cleanArticle((await readPage(n.link, { maxChars: 8000, usageKey: "page_read_briefing", raw: true })).text).slice(0, 8000);
          }
          if (!isRealArticle(text, n.summary)) throw new Error("niente oltre all'anteprima (articolo brevissimo o a pagamento)");
          if (texts.size < max) texts.set(n.i, text);
          delete paywall[n.source];
        } catch (e) {
          skipped.push(`${n.source}: ${e.message}`);
          if (/anteprima|401|402|403/.test(e.message)) paywall[n.source] = { fails: (paywall[n.source]?.fails || 0) + 1, at: Date.now() };
        }
      }),
    );
  }
  secrets.set(PAYWALL_KEY, paywall);
  step(`  ${texts.size} articoli letti per intero${skipped.length ? `, ${skipped.length} non disponibili` : ""}`);
  for (const s of skipped) step(`    - ${s}`);
  return texts;
}

async function composeWithAI({ provider, settings, date, news, fullTexts = new Map(), weather, today, upcoming, step }) {
  // Con un fornitore esterno all'UE il calendario NON viene inviato: l'agenda la inseriamo noi.
  const shareAgenda = provider === "anthropic";
  const newsList = news
    .map((n, i) => `${i + 1}. [${n.source}${n.category ? ` · ${n.category}` : ""}] ${n.title}${n.summary ? ` — ${n.summary}` : ""}`)
    .join("\n");
  const editorial = settings.newsFocus
    .map((f, i) => `${i + 1}. ${f.name} (categoria "${f.key}", ${f.depth === "approfondita" ? "APPROFONDITA" : "normale"}): ${f.hint}`)
    .join("\n");

  const prompt = `Oggi è ${formatItalian(new Date(), { hour: undefined, minute: undefined, year: "numeric" })}.
${settings.userName ? `L'utente si chiama ${settings.userName}.` : ""}

<meteo>
${weather ? describeForecast(weather) : "Non disponibile."}
</meteo>

${
  shareAgenda
    ? `<impegni_oggi>
${today.length ? today.map(describeEvent).join("\n") : "Nessun impegno."}
</impegni_oggi>

<impegni_prossimi_giorni>
${upcoming.length ? upcoming.map(describeEvent).join("\n") : "Nessun impegno."}
</impegni_prossimi_giorni>
`
    : `<agenda>Non ti viene fornita. Nel testo parlato (spokenScript), subito dopo il meteo, scrivi esattamente il segnaposto ${AGENDA_MARK}: verrà sostituito con gli impegni del giorno. Lascia agendaNote vuoto.</agenda>
`
}
<linea_editoriale>
${editorial}
</linea_editoriale>

<notizie>
${newsList || "Nessuna notizia disponibile."}
</notizie>
${
  fullTexts.size
    ? `
<articoli_completi>
Testo integrale di alcune notizie delle sezioni approfondite: usalo per riassunto e contesto di quelle notizie.
${[...fullTexts.entries()].map(([i, t]) => `<articolo ref="${i + 1}" fonte="${news[i].source}">\n${t}\n</articolo>`).join("\n")}
</articoli_completi>
`
    : ""
}
Componi il giornale del ${date}. Nelle sezioni usa "ref" per indicare il numero della notizia originale.`;

  const raw = await aiJson({ provider, system: SYSTEM, user: prompt, schema: BRIEFING_SCHEMA, example: JSON_EXAMPLE, step });

  const parsed = BriefingZ.safeParse(raw);
  if (!parsed.success) throw new Error(`JSON non valido: ${parsed.error.issues[0]?.message}`);
  const out = parsed.data;

  if (!shareAgenda) {
    const agendaText =
      spokenAgenda(today, "oggi") +
      (upcoming.length ? ` Nei prossimi giorni: ${spokenAgenda(upcoming, "", { withDay: true }).replace(/^Hai .*?: /, "")}` : "");
    out.agendaNote = today.length ? `Oggi hai ${today.length} impegn${today.length === 1 ? "o" : "i"}.` : "Oggi non hai impegni in calendario.";
    out.spokenScript = out.spokenScript.includes(AGENDA_MARK)
      ? out.spokenScript.replace(AGENDA_MARK, agendaText)
      : out.spokenScript.replace(/^(.*?[.!?])\s/, `$1 ${agendaText} `);
  }
  // collega titoli/riassunti alle notizie originali (link e fonte veri, mai inventati)
  out.sections = out.sections
    .map((s) => ({
      title: s.title,
      items: s.items
        .map((it) => {
          const src = news[it.ref - 1];
          return src
            ? {
                title: it.title,
                summary: it.summary,
                context: it.context || "",
                source: src.source,
                link: src.link,
                fullRead: fullTexts.has(it.ref - 1),
              }
            : null;
        })
        .filter(Boolean),
    }))
    .filter((s) => s.items.length);
  out.aiGenerated = true;
  out.provider = provider;
  return out;
}

function composeFallback({ settings, news, weather, today, upcoming }) {
  const names = Object.fromEntries(settings.newsFocus.map((f) => [f.key, f.name]));
  const order = settings.newsFocus.map((f) => f.key);
  const groups = new Map();
  for (const n of news) {
    const key = n.category || n.source;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ title: n.title, summary: n.summary, source: n.source, link: n.link });
  }
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  const sections = [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, items]) => ({ title: names[key] || key, items }));
  const p = Object.fromEntries((weather?.periods || []).map((x) => [x.key, x]));
  const w = {
    morning: p.morning?.advice || "",
    afternoon: p.afternoon?.advice || "",
    evening: p.evening?.advice || "",
    overall: weather?.advice || "Meteo non disponibile.",
  };
  const greeting = `Buongiorno${settings.userName ? ` ${settings.userName}` : ""}!`;
  const agendaNote = today.length
    ? `Oggi hai ${today.length} impegn${today.length === 1 ? "o" : "i"}.`
    : "Oggi non hai impegni in calendario.";

  const spoken = [
    greeting,
    weather
      ? `A ${weather.location} ` +
        weather.periods
          .map((x) => `${x.label.toLowerCase()} ${x.condition}, ${Math.round(x.temp)} gradi, percepiti ${Math.round(x.apparent)}`)
          .join("; ") +
        `. ${weather.advice}`
      : "",
    agendaNote,
    ...today.map((e) => describeEvent(e).replace(/^\[id \d+\] /, "")),
    news.length ? "Ecco i titoli principali." : "",
    ...news.slice(0, 8).map((n) => `${n.source}: ${n.title}.`),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    greeting,
    overview: news.length ? `${news.length} notizie dalle tue fonti.` : "Nessuna notizia disponibile.",
    sections,
    weather: w,
    agendaNote,
    spokenScript: spoken,
    aiGenerated: false,
  };
}
