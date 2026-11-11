// Voce lato server (opzionale): STT con whisper.cpp, TTS con Piper.
// Utile quando il browser non supporta la Web Speech API (es. Chromium sul Raspberry Pi).
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config, DATA_DIR } from "../config.js";

const TMP = path.join(DATA_DIR, "tmp");

function run(bin, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exit ${code}: ${err.slice(-500)}`))));
    if (input != null) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Trascrive un file audio (qualsiasi formato supportato da ffmpeg) in testo italiano. */
export async function transcribe(buffer) {
  await fs.mkdir(TMP, { recursive: true });
  const id = crypto.randomUUID();
  const inFile = path.join(TMP, `${id}.in`);
  const wavFile = path.join(TMP, `${id}.wav`);
  try {
    await fs.writeFile(inFile, buffer);
    await run(config.ffmpegBin, ["-y", "-loglevel", "error", "-i", inFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavFile]);
    const threads = String(Math.max(1, Math.min(4, (await import("node:os")).cpus().length)));
    const out = await run(config.whisperBin, ["-m", config.whisperModel, "-l", "it", "-t", threads, "-nt", "-np", "-f", wavFile]);
    return out.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
  } finally {
    await fs.rm(inFile, { force: true });
    await fs.rm(wavFile, { force: true });
  }
}

/** Sintetizza testo in WAV con Piper. */
export async function synthesize(text) {
  await fs.mkdir(TMP, { recursive: true });
  const wavFile = path.join(TMP, `${crypto.randomUUID()}.wav`);
  try {
    await run(config.piperBin, ["--model", config.piperModel, "--output_file", wavFile], { input: text });
    return await fs.readFile(wavFile);
  } finally {
    await fs.rm(wavFile, { force: true });
  }
}
