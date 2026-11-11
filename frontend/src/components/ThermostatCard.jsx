import { useCallback, useEffect, useState } from "react";

async function call(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

const fmt = (v) => (v == null ? "–" : `${String(v).replace(".", ",")}°`);
const time = (iso) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

export default function ThermostatCard() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => call("GET", "/thermostat").then(setSt).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!st?.connected) return null; // finché non è collegato, la scheda non compare

  const room = st.rooms?.[0];
  const set = async (body) => {
    setBusy(true);
    setErr("");
    try {
      await call("POST", "/thermostat", { room: room?.name, ...body });
      setTimeout(load, 1500); // il termostato impiega qualche istante ad aggiornarsi
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const nudge = (d) => set({ mode: "manual", temperature: (room?.setpoint ?? 20) + d, minutes: 180 });

  return (
    <section className="card thermostat">
      <h2>Termostato</h2>
      {room && (
        <>
          <div className="thermo-main">
            <div>
              <div className="temp">{fmt(room.measured)}</div>
              <div className="muted small">in {st.rooms.length > 1 ? room.name : "casa"}</div>
            </div>
            <div className="thermo-set">
              <button className="btn" disabled={busy} onClick={() => nudge(-0.5)} aria-label="Abbassa">
                −
              </button>
              <div>
                <div className="setpoint">{fmt(room.setpoint)}</div>
                <div className="muted small">{room.modeLabel}</div>
              </div>
              <button className="btn" disabled={busy} onClick={() => nudge(0.5)} aria-label="Alza">
                +
              </button>
            </div>
          </div>
          <p className="muted small">
            {room.heating != null && (room.heating ? "🔥 Riscaldamento acceso" : "Riscaldamento spento")}
            {room.until && ` · manuale fino alle ${time(room.until)}`}
          </p>
          {room.mode !== "home" && (
            <button className="btn ghost" disabled={busy} onClick={() => set({ mode: "home" })}>
              ↺ Torna al programma
            </button>
          )}
        </>
      )}
      {err && <p className="error-text small">{err}</p>}
    </section>
  );
}
