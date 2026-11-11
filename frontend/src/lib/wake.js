// Riconoscimento della frase di attivazione "Edward per favore".

export function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Il riconoscimento vocale italiano spesso storpia "Edward": accettiamo le varianti più comuni.
const BUILTIN = String.raw`\b(?:edward|edwards|edoardo|edvard|eduard|edwar|ed ward)\s*(?:per\s*favore|per\s*piacere)\b`;

export function buildWakeRegex(phrases = []) {
  const custom = phrases
    .map(normalize)
    .filter(Boolean)
    .map((p) => p.split(" ").map(escape).join("\\s*"));
  return new RegExp([BUILTIN, ...custom].join("|"));
}

/**
 * Se il testo contiene la frase di attivazione restituisce ciò che viene DOPO
 * (stringa vuota se non c'è altro), altrimenti null.
 */
export function matchWake(text, regex) {
  const n = normalize(text);
  const m = n.match(regex);
  if (!m) return null;
  // restituiamo la parte successiva dal testo originale (con maiuscole/accenti) se possibile
  const after = n.slice(m.index + m[0].length).trim();
  if (!after) return "";
  const words = after.split(" ").length;
  const original = text.trim().split(/\s+/);
  return original.slice(Math.max(0, original.length - words)).join(" ");
}

const END_RE = /^(grazie( mille| edward)?|basta( cosi)?|stop|niente( altro)?|nient altro|e tutto|a posto( cosi)?|ok grazie|va bene grazie|ciao( edward)?)$/;

export function isConversationEnd(text) {
  return END_RE.test(normalize(text));
}
