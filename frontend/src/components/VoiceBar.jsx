import { useEffect, useRef, useState } from "react";

const LABELS = {
  off: "Microfono spento",
  idle: "In attesa di “Edward per favore”",
  listening: "Ti ascolto…",
  thinking: "Ci penso…",
  speaking: "Sto parlando",
};

export default function VoiceBar({ edward }) {
  const { state, interim, log, error, mode, start, stop, ask, hush, summon, resetConversation } = edward;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    if (log.length) setOpen(true);
  }, [log.length]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log, open]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim() || state === "thinking") return;
    ask(text.trim());
    setText("");
  };

  return (
    <div className={`voicebar ${open ? "open" : ""}`}>
      {open && (
        <div className="chat" ref={logRef}>
          {log.length === 0 && (
            <p className="chat-empty">
              Di' <strong>“Edward per favore”</strong> seguito da una richiesta, ad esempio:
              <br />
              “…leggimi il giornale”, “…che tempo fa domani?”, “…aggiungi dentista giovedì alle 17”.
            </p>
          )}
          {log.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="bubble">
                {m.text}
                {m.quick && (
                  <div className="actions">
                    <span className="chip">⚡ risposta istantanea</span>
                  </div>
                )}
                {m.actions?.length > 0 && (
                  <div className="actions">
                    {m.actions.map((a, i) => (
                      <span key={i} className={`chip ${a.ok ? "" : "bad"}`}>
                        {a.tool.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {state === "thinking" && (
            <div className="msg edward">
              <div className="bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bar">
        <button
          className={`orb ${state}`}
          onClick={() => (state === "off" ? start() : state === "speaking" ? hush() : summon())}
          title={state === "off" ? "Attiva il microfono" : state === "speaking" ? "Interrompi" : "Parla ora"}
          aria-label={LABELS[state]}
        >
          <span className="orb-core" />
        </button>

        <div className="bar-main">
          <div className="bar-status">
            <span>{LABELS[state]}</span>
            {mode === "server" && state !== "off" && <span className="tag">whisper</span>}
            {interim && <span className="interim">“{interim}”</span>}
            {error && <span className="error-text">{error}</span>}
          </div>
          <form onSubmit={submit} className="bar-input">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Scrivi a Edward…"
              aria-label="Messaggio per Edward"
            />
            <button type="submit" className="btn" disabled={!text.trim() || state === "thinking"}>
              Invia
            </button>
          </form>
        </div>

        <div className="bar-tools">
          {state !== "off" ? (
            <button className="btn ghost" onClick={stop} title="Spegni microfono">
              Spegni
            </button>
          ) : null}
          <button className="btn ghost" onClick={() => setOpen((o) => !o)} title="Mostra conversazione">
            {open ? "Chiudi" : "Chat"}
          </button>
          {open && log.length > 0 && (
            <button className="btn ghost" onClick={resetConversation} title="Nuova conversazione">
              Nuova
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
