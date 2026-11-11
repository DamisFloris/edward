// Cuore dell'interfaccia vocale: ascolto continuo, parola di attivazione, comandi, risposte parlate.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, notifyCalendarChanged } from "../lib/api.js";
import { speak, stopSpeaking, earcon, configureTts } from "../lib/tts.js";
import { buildWakeRegex, matchWake, isConversationEnd } from "../lib/wake.js";
import { webSpeechSupported, createWebSpeechEngine, createServerEngine } from "../lib/engines.js";

// stati: off | idle (attende "Edward per favore") | listening (attende il comando) | thinking | speaking
const FOLLOW_UP_MS = 9000; // dopo una risposta resta in ascolto per un'eventuale domanda successiva
const COMMAND_TIMEOUT_MS = 8000;
const CALENDAR_TOOLS = new Set(["create_event", "update_event", "delete_event"]);

const sessionId = (() => {
  try {
    let id = localStorage.getItem("edward-session");
    if (!id) {
      id = crypto.randomUUID?.() || String(Math.random()).slice(2);
      localStorage.setItem("edward-session", id);
    }
    return id;
  } catch {
    return "default";
  }
})();

export function useEdward({ settings, health }) {
  const [state, setStateRaw] = useState("off");
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const stateRef = useRef("off");
  const engineRef = useRef(null);
  const timerRef = useRef(null);
  const wakeRegex = useMemo(() => buildWakeRegex(settings?.wakePhrases), [settings?.wakePhrases]);
  const wakeRef = useRef(wakeRegex);
  wakeRef.current = wakeRegex;

  const mode = health?.stt && !webSpeechSupported() ? "server" : webSpeechSupported() ? "webspeech" : health?.stt ? "server" : "none";

  useEffect(() => {
    configureTts({ server: health?.tts && !("speechSynthesis" in window && speechSynthesis.getVoices().some((v) => v.lang?.startsWith("it"))), voice: settings?.voice });
  }, [health?.tts, settings?.voice]);

  const setState = (s) => {
    stateRef.current = s;
    setStateRaw(s);
  };

  const addLog = (role, text, extra = {}) =>
    setLog((l) => [...l.slice(-49), { id: Date.now() + Math.random(), role, text, at: new Date(), ...extra }]);

  const armTimeout = (ms) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (stateRef.current === "listening") {
        earcon(520, 120);
        setState("idle");
      }
    }, ms);
  };

  /** Invia un comando a Edward e legge la risposta. */
  const ask = useCallback(async (text, { voice = false } = {}) => {
    clearTimeout(timerRef.current);
    addLog("user", text, { voice });
    const wasListening = Boolean(engineRef.current);
    engineRef.current?.stop(); // niente ascolto mentre pensa/parla (eviterebbe di sentirsi da solo)
    setState("thinking");
    let reply;
    try {
      const res = await api.chat(sessionId, text);
      reply = res.reply;
      addLog("edward", reply, { actions: res.actions, quick: res.quick });
      if (res.actions?.some((a) => CALENDAR_TOOLS.has(a.tool) && a.ok)) notifyCalendarChanged();
    } catch (e) {
      reply = e.message;
      addLog("error", reply);
    }
    setState("speaking");
    await speak(reply);
    if (!wasListening || !engineRef.current) {
      setState(engineRef.current ? "idle" : "off");
      return;
    }
    engineRef.current.start();
    if (voice) {
      setState("listening");
      armTimeout(FOLLOW_UP_MS);
    } else {
      setState("idle");
    }
  }, []);

  const handleFinal = useCallback(
    (raw) => {
      const text = raw.trim();
      if (!text) return;
      const s = stateRef.current;
      if (s === "idle") {
        const rest = matchWake(text, wakeRef.current);
        if (rest === null) return; // non stava parlando con Edward
        if (rest.length > 2) return ask(rest, { voice: true });
        earcon();
        setState("listening");
        armTimeout(COMMAND_TIMEOUT_MS);
      } else if (s === "listening") {
        // anche in modalità conversazione accetta (e ignora) la frase di attivazione ripetuta
        const rest = matchWake(text, wakeRef.current);
        const cmd = rest === null ? text : rest;
        if (!cmd) return armTimeout(COMMAND_TIMEOUT_MS);
        if (isConversationEnd(cmd)) {
          clearTimeout(timerRef.current);
          setState("speaking");
          engineRef.current?.stop();
          speak("Prego, sono qui se ti serve.").then(() => {
            engineRef.current?.start();
            setState(engineRef.current ? "idle" : "off");
          });
          return;
        }
        ask(cmd, { voice: true });
      }
    },
    [ask],
  );

  const start = useCallback(async () => {
    setError("");
    if (engineRef.current) return;
    try {
      const callbacks = {
        onFinal: (t) => handleFinal(t),
        onInterim: setInterim,
        onError: (m) => setError(m),
        onLevel: (v) => setLevel(v),
      };
      if (mode === "webspeech") engineRef.current = createWebSpeechEngine(callbacks);
      else if (mode === "server") engineRef.current = await createServerEngine(callbacks);
      else throw new Error("Questo browser non supporta il riconoscimento vocale e il server non ha whisper configurato.");
      engineRef.current.start();
      speak(""); // "sblocca" l'audio dopo il click dell'utente
      earcon(660);
      setState("idle");
    } catch (e) {
      engineRef.current = null;
      setError(e.message);
    }
  }, [mode, handleFinal]);

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    engineRef.current?.destroy();
    engineRef.current = null;
    stopSpeaking();
    setInterim("");
    setState("off");
  }, []);

  /** Interrompe la lettura in corso. */
  const hush = useCallback(() => stopSpeaking(), []);

  /** Attivazione manuale (come se avessi detto "Edward per favore"). */
  const summon = useCallback(() => {
    if (!engineRef.current) return;
    stopSpeaking();
    earcon();
    setState("listening");
    armTimeout(COMMAND_TIMEOUT_MS);
  }, []);

  const resetConversation = useCallback(async () => {
    await api.resetChat(sessionId);
    setLog([]);
  }, []);

  useEffect(() => () => engineRef.current?.destroy(), []);

  return { state, interim, log, error, level, mode, start, stop, ask, hush, summon, resetConversation, speak };
}
