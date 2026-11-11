import { config } from "../config.js";

const TZ = () => config.timezone;

/** Parti di una data nel fuso orario configurato. */
export function zonedParts(date = new Date(), tz = TZ()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** YYYY-MM-DD nel fuso orario locale. */
export function localDate(date = new Date()) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function tzOffsetMs(date, tz = TZ()) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converte un orario "locale" (es. "2026-11-10T15:30" o "2026-11-10") nel fuso configurato in Date UTC.
 * Se la stringa contiene già un offset/Z viene interpretata così com'è.
 */
export function localToUtc(input) {
  if (input instanceof Date) return input;
  const s = String(input).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error(`Data non valida: ${s}`);
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  // due passaggi per gestire correttamente il cambio ora legale
  let ts = guess - tzOffsetMs(new Date(guess));
  ts = guess - tzOffsetMs(new Date(ts));
  return new Date(ts);
}

/** Inizio del giorno locale (in UTC) spostato di `offsetDays`. */
export function startOfLocalDay(offsetDays = 0, from = new Date()) {
  const p = zonedParts(from);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
  return localToUtc(base.toISOString().slice(0, 10));
}

/** Formattazione leggibile in italiano. */
export function formatItalian(date, opts = {}) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: TZ(),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(new Date(date));
}

export function nowDescription() {
  return formatItalian(new Date(), { year: "numeric" }) + ` (fuso orario ${TZ()})`;
}
