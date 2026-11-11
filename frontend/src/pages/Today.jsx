import { useCallback, useEffect, useState } from "react";
import { api, CALENDAR_CHANGED } from "../lib/api.js";
import { speak, stopSpeaking } from "../lib/tts.js";
import ThermostatCard from "../components/ThermostatCard.jsx";

const ICONS = (code) => {
  if (code == null) return "·";
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  return "⛈️";
};

const fmtDay = (d) =>
  new Date(d).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const fmtShort = (d) => new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const todayKey = () => new Date().toLocaleDateString("en-CA");

export default function Today() {
  const [briefing, setBriefing] = useState(undefined);
  const [weather, setWeather] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState("");

  const loadEvents = useCallback(() => api.upcoming(7).then(setUpcoming).catch(() => {}), []);

  useEffect(() => {
    api.briefing().then(setBriefing).catch(() => setBriefing(null));
    api.weather().then(setWeather).catch((e) => setErr(e.message));
    api.health().then((h) => setRunning(h.briefingRunning)).catch(() => {});
    loadEvents();
    window.addEventListener(CALENDAR_CHANGED, loadEvents);
    return () => window.removeEventListener(CALENDAR_CHANGED, loadEvents);
  }, [loadEvents]);

  // mentre il giornale viene generato, controlla periodicamente
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const h = await api.health().catch(() => null);
      if (h && !h.briefingRunning) {
        setRunning(false);
        api.briefing().then(setBriefing);
        api.weather().then(setWeather).catch(() => {});
      }
    }, 3000);
    return () => clearInterval(t);
  }, [running]);

  const regenerate = async () => {
    setRunning(true);
    await api.runBriefing().catch((e) => setErr(e.message));
  };

  const read = async () => {
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    setReading(true);
    await speak(briefing.spokenScript);
    setReading(false);
  };

  const fresh = briefing && briefing.date === todayKey();
  const advice = fresh ? briefing.weather : null;
  const todayEvents = upcoming.filter((e) => new Date(e.start).toLocaleDateString("en-CA") <= todayKey());
  const laterEvents = upcoming.filter((e) => new Date(e.start).toLocaleDateString("en-CA") > todayKey());

  return (
    <div className="today">
      <section className="masthead">
        <div className="masthead-meta">
          <span>{fmtDay(new Date())}</span>
          <span>{weather?.location || briefing?.location || ""}</span>
        </div>
        <h1>Il Giornale di Edward</h1>
        <div className="masthead-actions">
          {briefing?.spokenScript && (
            <button className="btn primary" onClick={read}>
              {reading ? "■ Ferma lettura" : "▶ Leggimi il giornale"}
            </button>
          )}
          <button className="btn ghost" onClick={regenerate} disabled={running}>
            {running ? "Preparo l'edizione…" : "↻ Rigenera ora"}
          </button>
        </div>
        {briefing && !fresh && (
          <p className="notice">Questa è l'edizione del {briefing.date}. La prossima arriverà stanotte.</p>
        )}
        {err && <p className="notice error-text">{err}</p>}
      </section>

      {briefing && (
        <section className="lede">
          <p className="greeting">{briefing.greeting}</p>
          <p>{briefing.overview}</p>
        </section>
      )}

      <div className="grid">
        <section className="card weather">
          <h2>Meteo</h2>
          {!weather && <p className="muted">Carico le previsioni…</p>}
          {weather && (
            <>
              <p className="muted small">
                Min {Math.round(weather.min)}° · Max {Math.round(weather.max)}° · Alba {weather.sunrise} · Tramonto{" "}
                {weather.sunset}
              </p>
              <div className="periods">
                {weather.periods.map((p) => (
                  <div className="period" key={p.key}>
                    <div className="period-head">
                      <span>{p.label}</span>
                      <span className="icon">{ICONS(p.code)}</span>
                    </div>
                    <div className="temp">{Math.round(p.temp)}°</div>
                    <div className="feels">percepiti {Math.round(p.apparent)}°</div>
                    <div className="muted small">
                      {p.condition} · 💧{p.precipProb}% · 💨{Math.round(p.windMax)} km/h
                    </div>
                    <p className="advice">{advice?.[p.key] || p.advice}</p>
                  </div>
                ))}
              </div>
              <p className="advice overall">👔 {advice?.overall || weather.advice}</p>
              {weather.source && <p className="muted small">Fonte: {weather.source}</p>}
            </>
          )}
        </section>

        <div className="side">
        <ThermostatCard />
        <section className="card agenda">
          <h2>Agenda</h2>
          {briefing?.agendaNote && fresh && <p className="muted">{briefing.agendaNote}</p>}
          <h3>Oggi</h3>
          {todayEvents.length === 0 && <p className="muted">Nessun impegno rimasto per oggi.</p>}
          <ul className="events">
            {todayEvents.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
          <h3>Prossimi giorni</h3>
          {laterEvents.length === 0 && <p className="muted">Niente in programma.</p>}
          <ul className="events">
            {laterEvents.map((e) => (
              <EventRow key={e.id} e={e} showDay />
            ))}
          </ul>
          <a className="link" href="#calendario">
            Apri il calendario →
          </a>
        </section>
        </div>
      </div>

      <section className="news">
        {briefing === undefined && <p className="muted">Carico il giornale…</p>}
        {briefing === null && (
          <div className="card empty">
            <h2>Nessuna edizione ancora</h2>
            <p>Il giornale viene preparato ogni notte. Puoi generarlo subito con “Rigenera ora”.</p>
          </div>
        )}
        {briefing?.sections?.map((s) => (
          <article key={s.title} className="section">
            <h2 className="section-title">{s.title}</h2>
            <div className="articles">
              {s.items.map((it, i) => (
                <div className="article" key={i}>
                  <h3>
                    {it.link ? (
                      <a href={it.link} target="_blank" rel="noreferrer">
                        {it.title}
                      </a>
                    ) : (
                      it.title
                    )}
                  </h3>
                  <p>{it.summary}</p>
                  {it.context && <p className="context">{it.context}</p>}
                  <span className="source">
                    {it.source}
                    {it.fullRead && " · 📖 letto per intero"}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
        {briefing?.newsErrors?.length > 0 && (
          <p className="muted small">Fonti non raggiungibili: {briefing.newsErrors.map((e) => e.source).join(", ")}</p>
        )}
      </section>
    </div>
  );
}

function EventRow({ e, showDay }) {
  return (
    <li className="event">
      <span className="when">
        {showDay && <b>{fmtShort(e.start)}</b>} {e.allDay ? "tutto il giorno" : fmtTime(e.start)}
      </span>
      <span className="what">
        {e.title}
        {e.location && <span className="muted small"> · {e.location}</span>}
      </span>
    </li>
  );
}
