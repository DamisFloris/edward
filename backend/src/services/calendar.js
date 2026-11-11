import { db } from "../db.js";
import { config } from "../config.js";
import { localToUtc, startOfLocalDay, formatItalian } from "./time.js";

function rowToEvent(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || "",
    location: r.location || "",
    start: r.start,
    end: r.end || null,
    allDay: Boolean(r.all_day),
    color: r.color || "",
  };
}

function normalize(input, existing = {}) {
  const allDay = input.allDay ?? existing.allDay ?? false;
  const startRaw = input.start ?? existing.start;
  if (!startRaw) throw new Error("La data di inizio è obbligatoria");
  const title = (input.title ?? existing.title ?? "").trim();
  if (!title) throw new Error("Il titolo è obbligatorio");

  const start = localToUtc(startRaw);
  let end = input.end !== undefined ? input.end : existing.end;
  end = end ? localToUtc(end) : null;
  if (end && end < start) throw new Error("La fine non può essere prima dell'inizio");

  return {
    title,
    description: input.description ?? existing.description ?? "",
    location: input.location ?? existing.location ?? "",
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    all_day: allDay ? 1 : 0,
    color: input.color ?? existing.color ?? "",
  };
}

export function listEvents({ from, to } = {}) {
  const fromIso = from ? localToUtc(from).toISOString() : "0000";
  const toIso = to ? localToUtc(to).toISOString() : "9999";
  // un evento è nel range se inizia prima della fine del range e finisce (o inizia) dopo l'inizio del range
  return db
    .prepare(
      `SELECT * FROM events
       WHERE start < ? AND COALESCE(end, start) >= ?
       ORDER BY start ASC`,
    )
    .all(toIso, fromIso)
    .map(rowToEvent);
}

export function getEvent(id) {
  const r = db.prepare("SELECT * FROM events WHERE id = ?").get(Number(id));
  return r ? rowToEvent(r) : null;
}

export function createEvent(input) {
  const e = normalize(input);
  const res = db
    .prepare(
      `INSERT INTO events (title, description, location, start, end, all_day, color)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.title, e.description, e.location, e.start, e.end, e.all_day, e.color);
  return getEvent(res.lastInsertRowid);
}

export function updateEvent(id, input) {
  const existing = getEvent(id);
  if (!existing) return null;
  const e = normalize(input, existing);
  db.prepare(
    `UPDATE events SET title=?, description=?, location=?, start=?, end=?, all_day=?, color=?,
       updated_at=datetime('now') WHERE id=?`,
  ).run(e.title, e.description, e.location, e.start, e.end, e.all_day, e.color, Number(id));
  return getEvent(id);
}

export function deleteEvent(id) {
  return db.prepare("DELETE FROM events WHERE id = ?").run(Number(id)).changes > 0;
}

export function upcomingEvents(days = 7, limit = 20) {
  const from = new Date().toISOString();
  const to = startOfLocalDay(days + 1).toISOString();
  return listEvents({ from, to }).slice(0, limit);
}

export function todaysEvents() {
  return listEvents({ from: startOfLocalDay(0).toISOString(), to: startOfLocalDay(1).toISOString() });
}

/** Descrizione testuale (per l'AI e per la lettura vocale). */
export function describeEvent(e) {
  const when = e.allDay
    ? formatItalian(e.start, { hour: undefined, minute: undefined }) + " (tutto il giorno)"
    : formatItalian(e.start) + (e.end ? ` - fino alle ${formatItalian(e.end, { weekday: undefined, day: undefined, month: undefined })}` : "");
  return `[id ${e.id}] ${e.title} — ${when}${e.location ? ` @ ${e.location}` : ""}${e.description ? ` (${e.description})` : ""}`;
}

/** "alle 17 e 30" */
export function spokenTime(iso) {
  const [h, m] = new Intl.DateTimeFormat("it-IT", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .split(":")
    .map(Number);
  const hh = h === 1 ? "all'una" : `alle ${h}`;
  return m === 0 ? hh : `${hh} e ${m}`;
}

/** Elenco impegni in forma parlata, es. "Hai 2 impegni oggi: alle 9: Dentista; ..." */
export function spokenAgenda(events, label, { withDay = false } = {}) {
  if (!events.length) return `Non hai impegni ${label}.`;
  const items = events.map((e) => {
    const day = withDay ? formatItalian(e.start, { hour: undefined, minute: undefined }) + " " : "";
    const when = e.allDay ? "tutto il giorno" : spokenTime(e.start);
    return `${day}${when}: ${e.title}${e.location ? `, a ${e.location}` : ""}`;
  });
  const n = events.length;
  return `Hai ${n === 1 ? "un impegno" : `${n} impegni`} ${label}: ${items.join("; ")}.`;
}
