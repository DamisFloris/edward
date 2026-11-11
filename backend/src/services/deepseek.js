// Client minimale per l'API di DeepSeek (endpoint compatibile chat/completions).
// Usato SOLO per il giornale notturno: riceve notizie pubbliche e meteo, mai il calendario.
import { config } from "../config.js";

export const deepseekConfigured = () => Boolean(config.deepseekKey);

/**
 * Chiamata in modalità JSON. Restituisce { data, usage }.
 * La documentazione richiede la parola "json" nel prompt e un esempio della struttura attesa.
 */
export async function deepseekJson({ system, user, maxTokens = config.deepseekMaxTokens }) {
  if (!deepseekConfigured()) throw new Error("DEEPSEEK_API_KEY non configurata");
  const res = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      thinking: { type: config.deepseekThinking ? "enabled" : "disabled" },
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("risposta troncata (max_tokens)");
  const text = choice?.message?.content?.trim();
  // con JSON mode, se il modello fallisce il contenuto può essere vuoto
  if (!text) throw new Error("risposta vuota");
  return { data: JSON.parse(text), usage: json.usage };
}
