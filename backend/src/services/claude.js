import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client = null;

export function getClient() {
  if (!config.anthropicConfigured) {
    throw new Error("ANTHROPIC_API_KEY non configurata: aggiungila al file .env");
  }
  // timeout più corto del default: è un assistente vocale, non vogliamo attese infinite
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}

// Il fallback lato server (forma "default") è disponibile solo su questi modelli.
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

/** Parametri comuni: fallback lato server se il modello rifiuta la richiesta. */
export function commonParams() {
  return config.fallbacks && FALLBACK_MODELS.test(config.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}


export class RefusalError extends Error {}

export function assertNotRefused(message) {
  if (message.stop_reason === "refusal") {
    const cat = message.stop_details?.category;
    throw new RefusalError(`Il modello ha rifiutato la richiesta${cat ? ` (${cat})` : ""}`);
  }
}

export function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Messaggio d'errore leggibile per l'utente (in italiano). */
export function friendlyError(err) {
  if (err instanceof RefusalError) return "Mi dispiace, non posso aiutarti con questa richiesta.";
  if (err instanceof Anthropic.AuthenticationError) return "La chiave API di Anthropic non è valida.";
  if (err instanceof Anthropic.RateLimitError) return "Sono stato sovraccaricato di richieste, riprova tra poco.";
  if (err instanceof Anthropic.APIConnectionError) return "Non riesco a collegarmi a internet in questo momento.";
  if (err instanceof Anthropic.APIError) return `Errore del servizio AI (${err.status}).`;
  return err?.message || "Si è verificato un errore imprevisto.";
}
