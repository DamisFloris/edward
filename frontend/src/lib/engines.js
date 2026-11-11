// Motori di ascolto del microfono.
//  - webspeech: Web Speech API del browser (Chrome/Edge desktop e Android). Veloce, ma serve internet.
//  - server: rilevamento della voce nel browser + trascrizione sul Raspberry con whisper.cpp.
import { api } from "./api.js";

export const webSpeechSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

export function createWebSpeechEngine({ onFinal, onInterim, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let active = false;
  let restartTimer = null;

  function spawn() {
    if (!active) return;
    rec = new SR();
    rec.lang = "it-IT";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        active = false;
        onError?.("Permesso microfono negato. Serve https:// oppure localhost.");
      } else if (e.error === "network") {
        onError?.("Il riconoscimento vocale del browser richiede internet.");
      }
    };
    // Chrome interrompe l'ascolto dopo un po' di silenzio: lo riavviamo
    rec.onend = () => {
      if (active) restartTimer = setTimeout(spawn, 300);
    };
    try {
      rec.start();
    } catch {
      restartTimer = setTimeout(spawn, 1000);
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      spawn();
    },
    stop() {
      active = false;
      clearTimeout(restartTimer);
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      onInterim?.("");
    },
    destroy() {
      this.stop();
    },
  };
}

export async function createServerEngine({ onFinal, onInterim, onError, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let active = false;
  let recorder = null;
  let chunks = [];
  let recStart = 0;
  let lastVoice = 0;
  let voicedMs = 0;
  let noise = 0.01;
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";

  function startRec() {
    chunks = [];
    voicedMs = 0;
    recStart = performance.now();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
      const enough = voicedMs > 350;
      recorder = null;
      if (!enough || !active) return;
      onInterim?.("…trascrivo…");
      try {
        const { text } = await api.stt(blob);
        onInterim?.("");
        if (text && active) onFinal(text);
      } catch (e) {
        onInterim?.("");
        onError?.(e.message);
      }
    };
    recorder.start();
  }

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    onLevel?.(rms);
    if (!active) return;
    const now = performance.now();
    const threshold = Math.max(0.015, noise * 3);
    if (rms > threshold) {
      lastVoice = now;
      if (!recorder) startRec();
      else voicedMs += 50;
    } else if (!recorder) {
      noise = noise * 0.95 + rms * 0.05; // stima del rumore di fondo
    }
    if (recorder && (now - lastVoice > 900 || now - recStart > 12000)) recorder.stop();
  }, 50);

  return {
    start() {
      active = true;
      ctx.resume();
    },
    stop() {
      active = false;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },
    destroy() {
      this.stop();
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
