import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, "..", "..");
export const BACKEND_DIR = path.resolve(here, "..");
export const DATA_DIR = path.join(BACKEND_DIR, "data");
export const FRONTEND_DIST = path.join(ROOT_DIR, "frontend", "dist");

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || "0.0.0.0",
  timezone: env.TZ || "Europe/Rome",
  httpsCert: env.HTTPS_CERT || "",
  httpsKey: env.HTTPS_KEY || "",
  // HTTPS=auto: se mancano HTTPS_CERT/KEY crea da solo un certificato self-signed (in data/certs)
  httpsAuto: env.HTTPS === "auto",
  certHosts: (env.CERT_HOSTS || "raspberrypi.local").split(/[\s,]+/).filter(Boolean),
  nightlyCron: env.NIGHTLY_CRON || "30 5 * * *",

  anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  // Haiku gestisce tutto ciò che riguarda dati personali: voce, calendario, termostato, ricerche.
  model: env.EDWARD_MODEL || "claude-haiku-5-5",
  chatEffort: env.EDWARD_CHAT_EFFORT || "low",
  briefingEffort: env.EDWARD_BRIEFING_EFFORT || "medium",
  fallbacks: (env.EDWARD_FALLBACKS ?? "true") !== "false",

  // Giornale notturno: "deepseek" (economico, riceve solo notizie e meteo) o "anthropic"
  briefingProvider: env.BRIEFING_PROVIDER || (env.DEEPSEEK_API_KEY ? "deepseek" : "anthropic"),
  deepseekKey: env.DEEPSEEK_API_KEY || "",
  deepseekModel: env.DEEPSEEK_MODEL || "deepseek-flash",
  deepseekBaseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekMaxTokens: Number(env.DEEPSEEK_MAX_TOKENS || 16000),
  // il "ragionamento" di DeepSeek consuma molti token e per scrivere il giornale non serve
  deepseekThinking: env.DEEPSEEK_THINKING === "true",
  // Quanti articoli delle sezioni "approfondite" leggere per intero ogni notte
  briefingDeepReads: Number(env.BRIEFING_DEEP_READS || 8),

  // Ricerca web: SearXNG (gratis, sul Raspberry) con Gemini + Google Search come riserva
  searxngUrl: (env.SEARXNG_URL || "http://localhost:8888").replace(/\/$/, ""),
  geminiKey: env.GEMINI_API_KEY || "",
  geminiModel: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  maxSearchesPerQuestion: Number(env.MAX_SEARCHES_PER_QUESTION || 4),

  // Termostato BTicino Smarther with Netatmo (app Home + Control) via API Netatmo Connect
  netatmoClientId: env.NETATMO_CLIENT_ID || "",
  netatmoClientSecret: env.NETATMO_CLIENT_SECRET || "",
  // In alternativa al login: refresh token creato con il "Token generator" di dev.netatmo.com
  netatmoRefreshToken: env.NETATMO_REFRESH_TOKEN || "",
  publicUrl: (env.PUBLIC_URL || "").replace(/\/$/, ""),

  whisperBin: env.WHISPER_CPP_BIN || "",
  whisperModel: env.WHISPER_MODEL || "",
  piperBin: env.PIPER_BIN || "",
  piperModel: env.PIPER_MODEL || "",
  ffmpegBin: env.FFMPEG_BIN || "ffmpeg",
};

export const sttServerAvailable = () => Boolean(config.whisperBin && config.whisperModel);
export const ttsServerAvailable = () => Boolean(config.piperBin && config.piperModel);
