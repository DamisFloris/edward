import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { listVoices, speak } from "../lib/tts.js";

/** Stato reale del collegamento (prova a leggere il termostato) e pulsante per collegarsi con il login. */
function ThermostatLink() {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    fetch("/api/thermostat")
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => setSt(ok ? data : { error: data.error || "Errore sconosciuto" }))
      .catch((e) => setSt({ error: e.message }));
  }, []);

  if (st.loading) return <p className="muted small">Controllo il collegamento…</p>;
  const ok = !st.error && st.connected && st.rooms?.length;
  return (
    <>
      {ok && (
        <p>
          ✔ Collegato a <strong>{st.home}</strong>:{" "}
          {st.rooms.map((r) => `${r.name} ${r.measured ?? "–"}°`).join(", ")}
        </p>
      )}
      {st.error && <p className="error-text small">Il termostato non risponde: {st.error}</p>}
      {!ok && !st.error && <p className="muted small">Non ancora collegato.</p>}
      <p className="muted small">
        Il collegamento con il login apre la pagina di Netatmo. Lì entri con l'account che usi nell'app Home + Control
        e autorizzi Edward. È un'alternativa al token del .env.
      </p>
      <a className={`btn ${ok ? "ghost" : "primary"}`} href="/api/thermostat/auth">
        {ok ? "Ricollega" : "Collega con il login Home + Control"}
      </a>
    </>
  );
}

export default function Settings({ settings, onSaved, health }) {
  const [s, setS] = useState(settings);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [newSource, setNewSource] = useState({ name: "", url: "", category: "" });
  const [saved, setSaved] = useState("");
  const [runs, setRuns] = useState([]);
  const [voices, setVoices] = useState(listVoices());
  const [usage, setUsage] = useState({});

  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    api.briefingRuns().then(setRuns).catch(() => {});
    fetch("/api/usage").then((r) => r.json()).then(setUsage).catch(() => {});
    if ("speechSynthesis" in window) {
      const upd = () => setVoices(listVoices());
      speechSynthesis.addEventListener("voiceschanged", upd);
      return () => speechSynthesis.removeEventListener("voiceschanged", upd);
    }
  }, []);

  if (!s) return <p className="muted">Carico…</p>;

  const save = async (patch) => {
    const next = await api.saveSettings(patch);
    setS(next);
    onSaved(next);
    setSaved("Salvato ✔");
    setTimeout(() => setSaved(""), 2000);
  };

  const search = async (e) => {
    e.preventDefault();
    setResults(await api.geocode(query).catch(() => []));
  };

  const updateSource = (i, patch) =>
    save({ newsSources: s.newsSources.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const updateFocus = (i, patch) => setS({ ...s, newsFocus: s.newsFocus.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const moveFocus = (i, d) => {
    const list = [...s.newsFocus];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save({ newsFocus: list });
  };
  const focusName = (key) => s.newsFocus.find((f) => f.key === key)?.name || key || "—";

  return (
    <div className="settings">
      {saved && <div className="toast">{saved}</div>}

      <section className="card">
        <h2>Su di te</h2>
        <label>
          Come ti chiami?
          <input
            value={s.userName}
            onChange={(e) => setS({ ...s, userName: e.target.value })}
            onBlur={() => save({ userName: s.userName })}
            placeholder="Il tuo nome"
          />
        </label>
      </section>

      <section className="card">
        <h2>Località per il meteo</h2>
        <p>
          Attuale: <strong>{s.location.name}</strong> {s.location.admin ? `(${s.location.admin})` : ""}{" "}
          <span className="muted small">
            {s.location.latitude.toFixed(3)}, {s.location.longitude.toFixed(3)}
          </span>
        </p>
        <form onSubmit={search} className="inline-form">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca città…" />
          <button className="btn">Cerca</button>
        </form>
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button
                className="btn ghost"
                onClick={() => {
                  save({ location: r });
                  setResults([]);
                  setQuery("");
                }}
              >
                {r.name} — {r.admin}, {r.country}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Linea editoriale</h2>
        <p className="muted small">
          Ordine delle sezioni del giornale e quanto approfondire ciascuna. La descrizione guida l'AI nella scelta delle notizie.
        </p>
        <ul className="focus">
          {s.newsFocus.map((f, i) => (
            <li key={f.key}>
              <strong>{f.name}</strong>
              <div className="order">
                <select value={f.depth} onChange={(e) => save({ newsFocus: s.newsFocus.map((x, j) => (j === i ? { ...x, depth: e.target.value } : x)) })}>
                  <option value="normale">Normale</option>
                  <option value="approfondita">Approfondita</option>
                </select>
                <button className="btn ghost" onClick={() => moveFocus(i, -1)} aria-label="Sposta su">↑</button>
                <button className="btn ghost" onClick={() => moveFocus(i, 1)} aria-label="Sposta giù">↓</button>
              </div>
              <textarea rows={2} value={f.hint} onChange={(e) => updateFocus(i, { hint: e.target.value })} onBlur={() => save({ newsFocus: s.newsFocus })} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Fonti delle notizie</h2>
        <p className="muted small">Inserisci l'indirizzo del feed RSS di ogni giornale o sito (di solito /feed o /rss).</p>
        <ul className="sources">
          {s.newsSources.map((src, i) => (
            <li key={i} className={src.enabled === false ? "disabled" : ""}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={src.enabled !== false}
                  onChange={(e) => updateSource(i, { enabled: e.target.checked })}
                />
                <span>
                  <strong>{src.name}</strong>
                  <span className="cat">{focusName(src.category)}</span>
                  <br />
                  <span className="muted small">{src.url}</span>
                </span>
              </label>
              <button className="btn ghost danger" onClick={() => save({ newsSources: s.newsSources.filter((_, j) => j !== i) })}>
                Rimuovi
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            save({ newsSources: [...s.newsSources, { ...newSource, enabled: true }] });
            setNewSource({ name: "", url: "", category: "" });
          }}
        >
          <input required placeholder="Nome (es. Corriere)" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
          <input required type="url" placeholder="https://…/rss" value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} />
          <select required value={newSource.category} onChange={(e) => setNewSource({ ...newSource, category: e.target.value })}>
            <option value="">Sezione…</option>
            {s.newsFocus.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="btn primary">Aggiungi</button>
        </form>
        <label className="narrow">
          Notizie per fonte
          <input
            type="number"
            min={1}
            max={30}
            value={s.newsPerSource}
            onChange={(e) => setS({ ...s, newsPerSource: Number(e.target.value) })}
            onBlur={() => save({ newsPerSource: s.newsPerSource })}
          />
        </label>
      </section>

      <section className="card">
        <h2>Voce</h2>
        <label>
          Voce del browser
          <select value={s.voice.voiceName} onChange={(e) => save({ voice: { ...s.voice, voiceName: e.target.value } })}>
            <option value="">Automatica</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Velocità: {s.voice.rate.toFixed(1)}
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.1}
            value={s.voice.rate}
            onChange={(e) => setS({ ...s, voice: { ...s.voice, rate: Number(e.target.value) } })}
            onMouseUp={() => save({ voice: s.voice })}
            onTouchEnd={() => save({ voice: s.voice })}
          />
        </label>
        <button className="btn ghost" onClick={() => speak("Ciao, sono Edward. Come posso aiutarti?")}>
          Prova la voce
        </button>
        <label>
          Frasi di attivazione aggiuntive (una per riga)
          <textarea
            rows={3}
            value={s.wakePhrases.join("\n")}
            onChange={(e) => setS({ ...s, wakePhrases: e.target.value.split("\n") })}
            onBlur={() => save({ wakePhrases: s.wakePhrases.map((x) => x.trim()).filter(Boolean) })}
          />
        </label>
      </section>

      <section className="card">
        <h2>Termostato</h2>
        {!health?.thermostat?.configured && (
          <p className="muted small">
            Per collegare il termostato BTicino (app Home + Control) crea un'app su dev.netatmo.com e inserisci
            NETATMO_CLIENT_ID e NETATMO_CLIENT_SECRET nel file .env. Istruzioni nel README.
          </p>
        )}
        {health?.thermostat?.configured && <ThermostatLink />}
      </section>

      <section className="card">
        <h2>Ricerche web questo mese</h2>
        <ul className="sysinfo">
          <li>SearXNG (gratis): {usage.search_searxng || 0}</li>
          <li>
            Google tramite Gemini (riserva, 5000 gratis al mese): {usage.search_gemini || 0}
            {!health?.search?.geminiFallback && <span className="muted small"> · non configurato</span>}
          </li>
          <li>Pagine lette: {usage.page_read || 0}</li>
        </ul>
      </section>

      <section className="card">
        <h2>Sistema</h2>
        <ul className="sysinfo">
          <li>AI: {health?.ai ? `attiva (${health.model})` : "non configurata (manca ANTHROPIC_API_KEY)"}</li>
          <li>Giornale automatico: cron “{health?.nightlyCron}” · scritto da {health?.briefingProvider === "deepseek" ? "DeepSeek" : "Claude"}</li>
          <li>Riconoscimento vocale sul server (whisper): {health?.stt ? "sì" : "no"}</li>
          <li>Sintesi vocale sul server (piper): {health?.tts ? "sì" : "no"}</li>
          <li>Riconoscimento vocale del browser: {window.SpeechRecognition || window.webkitSpeechRecognition ? "sì" : "no"}</li>
        </ul>
        <h3>Ultime esecuzioni del job notturno</h3>
        <ul className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <details>
                <summary>
                  <span className={`badge ${r.status}`}>{r.status}</span> {r.started_at} UTC
                </summary>
                <pre>{r.log}</pre>
              </details>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">Nessuna esecuzione ancora.</li>}
        </ul>
      </section>
    </div>
  );
}
