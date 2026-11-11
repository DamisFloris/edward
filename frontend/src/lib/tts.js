// Sintesi vocale: Piper sul server se disponibile, altrimenti quella del browser.
import { api } from "./api.js";

let useServer = false;
let prefs = { rate: 1, pitch: 1, voiceName: "" };
let currentAudio = null;
let cancelled = false;

export function configureTts({ server, voice }) {
  useServer = Boolean(server);
  if (voice) prefs = { ...prefs, ...voice };
}

export function listVoices() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("it"));
}

function pickVoice() {
  const voices = listVoices();
  return voices.find((v) => v.name === prefs.voiceName) || voices.find((v) => /google|natural|neural/i.test(v.name)) || voices[0];
}

/** Divide il testo in frammenti brevi (Chrome tronca le frasi troppo lunghe). */
function chunk(text, max = 220) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function speakBrowser(part) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = "it-IT";
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = prefs.rate;
    u.pitch = prefs.pitch;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

async function speakServer(part) {
  const blob = await api.tts(part);
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve) => {
      currentAudio = new Audio(url);
      currentAudio.playbackRate = prefs.rate;
      currentAudio.onended = currentAudio.onerror = () => resolve();
      currentAudio.play().catch(resolve);
    });
  } finally {
    URL.revokeObjectURL(url);
    currentAudio = null;
  }
}

/** Legge il testo ad alta voce. La promise si risolve a lettura finita (o interrotta). */
export async function speak(text) {
  if (!text) return;
  cancelled = false;
  const parts = chunk(text.replace(/https?:\/\/\S+/g, ""), useServer ? 400 : 220);
  for (const p of parts) {
    if (cancelled) break;
    if (useServer) {
      try {
        await speakServer(p);
        continue;
      } catch {
        useServer = false; // ripiega sul browser
      }
    }
    if ("speechSynthesis" in window) await speakBrowser(p);
  }
}

export function stopSpeaking() {
  cancelled = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended?.();
  }
}

/** Piccolo "bip" per segnalare che Edward è in ascolto. */
export function earcon(freq = 880, ms = 140) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
    o.onended = () => ctx.close();
  } catch {
    /* audio non disponibile */
  }
}
