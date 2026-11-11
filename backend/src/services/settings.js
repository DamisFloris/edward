import { db } from "../db.js";

// Impostazioni di default: modificabili dalla pagina "Impostazioni" del sito o a voce.
export const DEFAULT_SETTINGS = {
  userName: "",
  location: {
    name: "Viareggio",
    latitude: 43.8657,
    longitude: 10.2513,
    country: "Italia",
    admin: "Toscana, Provincia di Lucca",
  },
  // category deve corrispondere a una delle sezioni di newsFocus (key)
  newsSources: [
    // cronaca locale
    { name: "Noi TV", url: "https://www.noitv.it/feed/", category: "locale", enabled: true },
    { name: "Versilia Today", url: "https://www.versiliatoday.it/feed/", category: "locale", enabled: true },
    { name: "Lucca in Diretta", url: "https://www.luccaindiretta.it/feed/", category: "locale", enabled: true },
    { name: "ANSA Toscana", url: "https://www.ansa.it/toscana/notizie/toscana_rss.xml", category: "locale", enabled: true },
    // nazionali
    { name: "ANSA", url: "https://www.ansa.it/sito/ansait_rss.xml", category: "italia", enabled: true },
    { name: "la Repubblica", url: "https://www.repubblica.it/rss/homepage/rss2.0.xml", category: "italia", enabled: true },
    // mercati finanziari
    { name: "Il Sole 24 Ore - Finanza", url: "https://www.ilsole24ore.com/rss/finanza.xml", category: "mercati", enabled: true },
    { name: "ANSA Economia", url: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml", category: "mercati", enabled: true },
    // geopolitica
    { name: "ANSA Mondo", url: "https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml", category: "geopolitica", enabled: true },
    { name: "Il Sole 24 Ore - Mondo", url: "https://www.ilsole24ore.com/rss/mondo.xml", category: "geopolitica", enabled: true },
    { name: "Formiche", url: "https://formiche.net/feed/", category: "geopolitica", enabled: true },
    // tecnologia
    { name: "Il Sole 24 Ore - Tecnologia", url: "https://www.ilsole24ore.com/rss/tecnologia.xml", category: "tecnologia", enabled: true },
    { name: "ANSA Tecnologia", url: "https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml", category: "tecnologia", enabled: true },
    { name: "Wired Italia", url: "https://www.wired.it/feed/rss", category: "tecnologia", enabled: true },
  ],
  // Linea editoriale del giornale: ordine delle sezioni e livello di approfondimento.
  newsFocus: [
    { key: "locale", name: "Cronaca locale", hint: "Viareggio, Versilia, Lucca e Toscana", depth: "normale" },
    { key: "italia", name: "Italia", hint: "le notizie nazionali più importanti della giornata", depth: "normale" },
    {
      key: "mercati",
      name: "Mercati finanziari",
      hint: "borse, tassi BCE/Fed, spread, banche, valute, materie prime, risultati aziendali: cosa è successo, perché e quali conseguenze",
      depth: "approfondita",
    },
    {
      key: "geopolitica",
      name: "Geopolitica",
      hint: "conflitti, diplomazia, rapporti tra potenze, UE, energia: contesto, attori e possibili sviluppi",
      depth: "approfondita",
    },
    {
      key: "tecnologia",
      name: "Tecnologia",
      hint: "intelligenza artificiale, big tech, semiconduttori, cybersecurity, regolamentazione: cosa cambia davvero",
      depth: "approfondita",
    },
  ],
  newsPerSource: 8,
  wakePhrases: ["edward per favore", "edward perfavore", "edoardo per favore"],
  voice: { rate: 1.0, pitch: 1.0, voiceName: "" },
};

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setStmt = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

export function getSettings() {
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    const row = getStmt.get(key);
    out[key] = row ? JSON.parse(row.value) : structuredClone(def);
  }
  return out;
}

export function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    setStmt.run(key, JSON.stringify(value));
  }
  return getSettings();
}
