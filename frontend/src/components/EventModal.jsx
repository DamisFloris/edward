import { useEffect, useState } from "react";

const COLORS = ["", "#e8b04b", "#d9654b", "#5b9bd5", "#6cbf84", "#a77dc2"];

const pad = (n) => String(n).padStart(2, "0");
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function initialForm(init) {
  const now = new Date();
  const start = init.start ? new Date(init.start) : new Date(now.setMinutes(0, 0, 0) + 3600_000);
  let end = init.end ? new Date(init.end) : new Date(start.getTime() + 3600_000);
  if (init.allDay && init.end) end = new Date(end.getTime() - 86400_000); // FullCalendar: fine esclusiva
  return {
    title: init.title || "",
    allDay: Boolean(init.allDay),
    date: dateStr(start),
    startTime: init.allDay ? "09:00" : timeStr(start),
    endDate: dateStr(end),
    endTime: init.allDay ? "10:00" : timeStr(end),
    location: init.location || "",
    description: init.description || "",
    color: init.color || "",
  };
}

export default function EventModal({ initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState(() => initialForm(initial));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    let start, end;
    if (f.allDay) {
      start = f.date;
      const endExcl = new Date(`${f.endDate || f.date}T00:00`);
      endExcl.setDate(endExcl.getDate() + 1);
      end = dateStr(endExcl);
    } else {
      start = `${f.date}T${f.startTime}`;
      end = `${f.endDate || f.date}T${f.endTime}`;
    }
    setBusy(true);
    try {
      await onSave({
        id: initial.id,
        title: f.title,
        allDay: f.allDay,
        start,
        end,
        location: f.location,
        description: f.description,
        color: f.color,
      });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal card" onSubmit={submit}>
        <h2>{initial.id ? "Modifica impegno" : "Nuovo impegno"}</h2>
        <label>
          Titolo
          <input autoFocus required value={f.title} onChange={set("title")} placeholder="Es. Dentista" />
        </label>
        <label className="check">
          <input type="checkbox" checked={f.allDay} onChange={set("allDay")} /> Tutto il giorno
        </label>
        <div className="row">
          <label>
            Dal
            <input type="date" required value={f.date} onChange={set("date")} />
          </label>
          {!f.allDay && (
            <label>
              Ore
              <input type="time" required value={f.startTime} onChange={set("startTime")} />
            </label>
          )}
        </div>
        <div className="row">
          <label>
            Al
            <input type="date" value={f.endDate} onChange={set("endDate")} />
          </label>
          {!f.allDay && (
            <label>
              Ore
              <input type="time" value={f.endTime} onChange={set("endTime")} />
            </label>
          )}
        </div>
        <label>
          Luogo
          <input value={f.location} onChange={set("location")} />
        </label>
        <label>
          Note
          <textarea rows={3} value={f.description} onChange={set("description")} />
        </label>
        <div className="colors">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c || "default"}
              className={`swatch ${f.color === c ? "selected" : ""}`}
              style={{ background: c || "var(--accent-2)" }}
              onClick={() => setF((x) => ({ ...x, color: c }))}
              aria-label={c ? `Colore ${c}` : "Colore predefinito"}
            />
          ))}
        </div>
        {err && <p className="error-text">{err}</p>}
        <div className="modal-actions">
          {initial.id && (
            <button
              type="button"
              className="btn danger"
              onClick={() => confirm("Eliminare questo impegno?") && onDelete(initial.id)}
            >
              Elimina
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Salva
          </button>
        </div>
      </form>
    </div>
  );
}
