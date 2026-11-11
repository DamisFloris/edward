// Risposte istantanee senza modello AI per le richieste più frequenti:
// lettura del giornale, meteo (oggi/domani/dopodomani) e agenda.
// Più veloci, gratuite e funzionanti anche senza chiave API.
// Tutto ciò che non è riconosciuto con sicurezza passa al modello AI.
import { getSettings } from "./settings.js";
import { getLatestBriefing } from "./briefing.js";
import { getForecast } from "./weather.js";
import { listEvents, upcomingEvents, spokenAgenda } from "./calendar.js";
import { localDate, startOfLocalDay, formatItalian } from "./time.js";
import { getStatus, thermostatConnected } from "./thermostat.js";

const norm = (t) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Se compaiono questi verbi l'utente vuole modificare qualcosa: serve l'AI.
const ACTION_RE = /\b(alza|abbassa|imposta|accendi|spegni|porta|aggiungi|aggiungere|crea|segna|segnami|metti|inserisci|sposta|spostare|cancella|elimina|rimuovi|modifica|cambia|ricordami|annulla|prenota|cerca|confronta|perche|spiega|riassumi)\b/;
// Un riferimento a un altro luogo ("a Milano", "in montagna") va gestito dall'AI.
const OTHER_PLACE_RE = /\b(a|ad|in|per|su|sulla|sul)\s+(?!casa|oggi|domani|dopodomani|stasera|stamattina|pomeriggio|mattina|sera)[a-z]{3,}/;

const HOME_TEMP_RE = /\b(in casa|a casa|termostato|riscaldamento|caldaia)\b/;
const BRIEFING_RE = /\b(leggi|leggimi|rileggi|rileggimi|dimmi|fammi sentire)\b.*\b(giornale|notizie|rassegna|edizione)\b|^(il )?giornale( di oggi)?$|^(le )?notizie( di oggi)?$/;
const WEATHER_RE = /\b(meteo|tempo fa|che tempo|previsioni|temperatura|gradi|piove|piovera|pioggia|ombrello|freddo|caldo|come mi vesto|come mi devo vestire|cosa mi metto|vestirmi)\b/;
const AGENDA_RE = /\b(agenda|impegni|appuntamenti|in programma|cosa ho|che ho|devo fare|da fare|calendario)\b/;

const dayOffset = (t) => (/\bdopodomani\b/.test(t) ? 2 : /\bdomani\b/.test(t) ? 1 : 0);
const DAY_WORD = ["oggi", "domani", "dopodomani"];

const deg = (v) => `${Math.round(v)} grad${Math.abs(Math.round(v)) === 1 ? "o" : "i"}`;

async function weatherAnswer(t) {
  const off = dayOffset(t);
  const settings = getSettings();
  const date = localDate(new Date(startOfLocalDay(off).getTime() + 12 * 3600e3));
  const f = await getForecast(settings.location, date);
  const parts = f.periods.map(
    (p) =>
      `${p.label.toLowerCase()} ${p.condition}, ${deg(p.temp)}` +
      (Math.round(p.apparent) !== Math.round(p.temp) ? ` ma percepiti ${Math.round(p.apparent)}` : "") +
      (p.precipProb >= 30 ? `, pioggia al ${p.precipProb} per cento` : ""),
  );
  // per oggi preferisce il consiglio scritto dall'AI nel giornale di stanotte, se c'è
  const b = getLatestBriefing();
  const advice = off === 0 && b?.date === localDate() && b.weather?.overall ? b.weather.overall : f.advice;
  const intro = `${DAY_WORD[off].charAt(0).toUpperCase() + DAY_WORD[off].slice(1)} a ${f.location}: `;
  return `${intro}${parts.join("; ")}. Come vestirti: ${advice}`;
}

function agendaAnswer(t) {
  const week = /\b(settimana|prossimi giorni)\b/.test(t);
  let events;
  let label;
  if (week) {
    events = upcomingEvents(7);
    label = "nei prossimi sette giorni";
  } else {
    const off = dayOffset(t);
    const from = off === 0 ? new Date().toISOString() : startOfLocalDay(off).toISOString();
    events = listEvents({ from, to: startOfLocalDay(off + 1).toISOString() });
    label = off === 0 ? "per il resto di oggi" : DAY_WORD[off];
  }
  return spokenAgenda(events, label, { withDay: week });
}

async function thermostatAnswer() {
  const { rooms } = await getStatus();
  return rooms
    .map((r) => {
      const now = r.measured != null ? `In ${rooms.length > 1 ? r.name : "casa"} ci sono ${String(r.measured).replace(".", ",")} gradi` : "Non ho la temperatura attuale";
      const set = r.setpoint != null ? `, il termostato è a ${String(r.setpoint).replace(".", ",")} in modalità ${r.modeLabel}` : "";
      const heat = r.heating == null ? "" : r.heating ? " e il riscaldamento è acceso" : " e il riscaldamento è spento";
      return `${now}${set}${heat}.`;
    })
    .join(" ");
}

function briefingAnswer() {
  const b = getLatestBriefing();
  if (!b) return "Il giornale non è ancora pronto. Chiedimi di rigenerarlo se lo vuoi subito.";
  const stale = b.date !== localDate() ? `Attenzione, questa è l'edizione del ${formatItalian(b.date, { hour: undefined, minute: undefined })}. ` : "";
  return stale + b.spokenScript;
}

/**
 * Prova a rispondere senza AI. Restituisce { reply, intent } oppure null se la richiesta va al modello.
 */
export async function tryQuickAnswer(text) {
  const t = norm(text);
  const words = t.split(" ").length;
  if (words > 12 || ACTION_RE.test(t)) return null;
  // giorni specifici o periodi diversi da oggi/domani/dopodomani/settimana: meglio l'AI
  if (/\b(weekend|fine settimana|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|mese|prossima settimana)\b/.test(t)) return null;
  if (BRIEFING_RE.test(t)) return { intent: "briefing", reply: briefingAnswer() };
  if (HOME_TEMP_RE.test(t)) {
    if (!thermostatConnected()) return null;
    return { intent: "thermostat", reply: await thermostatAnswer() };
  }
  const home = norm(getSettings().location.name);
  if (WEATHER_RE.test(t) && !OTHER_PLACE_RE.test(t.replaceAll(home, "casa"))) {
    if (/\bsettimana\b/.test(t)) return null;
    return { intent: "weather", reply: await weatherAnswer(t) };
  }
  if (AGENDA_RE.test(t)) return { intent: "agenda", reply: agendaAnswer(t) };
  return null;
}
