// Meteo da Open-Meteo (gratuito, senza chiave API).
import { config } from "../config.js";
import { localDate } from "./time.js";

const WMO = {
  0: "sereno", 1: "prevalentemente sereno", 2: "parzialmente nuvoloso", 3: "coperto",
  45: "nebbia", 48: "nebbia con brina",
  51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa",
  56: "pioviggine gelata", 57: "pioviggine gelata intensa",
  61: "pioggia debole", 63: "pioggia", 65: "pioggia forte",
  66: "pioggia gelata", 67: "pioggia gelata forte",
  71: "neve debole", 73: "neve", 75: "neve forte", 77: "granuli di neve",
  80: "rovesci deboli", 81: "rovesci", 82: "rovesci violenti",
  85: "rovesci di neve", 86: "forti rovesci di neve",
  95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine forte",
};

export const PERIODS = [
  { key: "morning", label: "Mattina", from: 7, to: 12 },
  { key: "afternoon", label: "Pomeriggio", from: 13, to: 18 },
  { key: "evening", label: "Sera", from: 19, to: 23 },
];

export async function geocode(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "it");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding fallito (${res.status})`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin: [r.admin1, r.admin2].filter(Boolean).join(", "),
  }));
}

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const mode = (a) => {
  const counts = new Map();
  for (const v of a) counts.set(v, (counts.get(v) || 0) + 1);
  // a parità di frequenza preferisce il codice più "severo"
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0];
};

// Modello nazionale ItaliaMeteo ICON-2I (griglia 2,2 km, ~3 giorni) con ricaduta sul "best match" di Open-Meteo
// per le ore/variabili che ICON-2I non fornisce (es. probabilità di pioggia).
const MODELS = ["italia_meteo_arpae_icon_2i", "best_match"];
export const WEATHER_SOURCE = "ItaliaMeteo ICON-2I (2,2 km) via Open-Meteo";

function pick(block, name, i) {
  for (const m of MODELS) {
    const v = block[`${name}_${m}`]?.[i];
    if (v != null) return v;
  }
  return block[name]?.[i] ?? null;
}

/** Consiglio di abbigliamento basato sulla temperatura percepita (fallback senza AI). */
export function clothingAdvice({ apparentMin, apparentMax, precipProb, windMax }) {
  const t = apparentMin ?? 15;
  let base;
  if (t <= 0) base = "cappotto pesante o piumino, sciarpa, guanti e cappello: si gela";
  else if (t <= 6) base = "cappotto o piumino, maglione e sciarpa";
  else if (t <= 11) base = "giacca pesante o giubbotto con un maglione sotto";
  else if (t <= 16) base = "giacca leggera o felpa sopra una maglia a maniche lunghe";
  else if (t <= 21) base = "maglia a maniche lunghe o una camicia, magari un giacchino leggero";
  else if (t <= 26) base = "t-shirt e pantaloni leggeri";
  else base = "abiti leggerissimi e traspiranti, bevi molta acqua";

  const extras = [];
  if (precipProb >= 50) extras.push("porta l'ombrello");
  else if (precipProb >= 25) extras.push("un ombrello pieghevole in borsa non guasta");
  if (windMax >= 30) extras.push("c'è vento: meglio qualcosa di antivento");
  if (apparentMax != null && apparentMin != null && apparentMax - apparentMin >= 8)
    extras.push("vestiti a strati, l'escursione termica è forte");
  return base + (extras.length ? `; ${extras.join("; ")}` : "") + ".";
}

/** Previsioni per oggi (o per `date`, YYYY-MM-DD) divise in mattina/pomeriggio/sera. */
export async function getForecast(location, date = localDate()) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m",
  );
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,sunrise,sunset");
  url.searchParams.set("timezone", config.timezone);
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("models", MODELS.join(","));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ha risposto ${res.status}`);
  const j = await res.json();
  const h = j.hourly;

  const periods = PERIODS.map((p) => {
    const idx = h.time
      .map((t, i) => [t, i])
      .filter(([t]) => t.startsWith(date) && +t.slice(11, 13) >= p.from && +t.slice(11, 13) <= p.to)
      .map(([, i]) => i);
    if (!idx.length) throw new Error(`Previsioni non disponibili per ${date}`);
    const temps = idx.map((i) => pick(h, "temperature_2m", i));
    const app = idx.map((i) => pick(h, "apparent_temperature", i));
    const prec = idx.map((i) => pick(h, "precipitation_probability", i) ?? 0);
    const wind = idx.map((i) => pick(h, "wind_speed_10m", i) ?? 0);
    const code = mode(idx.map((i) => pick(h, "weather_code", i)));
    const summary = {
      key: p.key,
      label: p.label,
      hours: `${p.from}:00-${p.to}:00`,
      temp: round1(avg(temps)),
      tempMin: round1(Math.min(...temps)),
      tempMax: round1(Math.max(...temps)),
      apparent: round1(avg(app)),
      apparentMin: round1(Math.min(...app)),
      apparentMax: round1(Math.max(...app)),
      precipProb: Math.max(0, ...prec),
      windMax: round1(Math.max(0, ...wind)),
      humidity: round1(avg(idx.map((i) => pick(h, "relative_humidity_2m", i)))),
      code,
      condition: WMO[code] ?? "n/d",
    };
    summary.advice = clothingAdvice(summary);
    return summary;
  });

  const di = j.daily.time.indexOf(date);
  const d = (name) => (di >= 0 ? pick(j.daily, name, di) : null);
  return {
    date,
    location: location.name,
    source: WEATHER_SOURCE,
    min: d("temperature_2m_min"),
    max: d("temperature_2m_max"),
    sunrise: d("sunrise")?.slice(11) ?? null,
    sunset: d("sunset")?.slice(11) ?? null,
    periods,
    advice: clothingAdvice({
      apparentMin: Math.min(...periods.map((p) => p.apparentMin)),
      apparentMax: Math.max(...periods.map((p) => p.apparentMax)),
      precipProb: Math.max(...periods.map((p) => p.precipProb)),
      windMax: Math.max(...periods.map((p) => p.windMax)),
    }),
  };
}

export function describeForecast(f) {
  const lines = f.periods.map(
    (p) =>
      `${p.label}: ${p.condition}, ${p.temp}°C (percepiti ${p.apparent}°C, min ${p.apparentMin} / max ${p.apparentMax}), ` +
      `pioggia ${p.precipProb}%, vento fino a ${p.windMax} km/h`,
  );
  return `Meteo a ${f.location} per ${f.date} (min ${f.min}°C, max ${f.max}°C, alba ${f.sunrise}, tramonto ${f.sunset}):\n${lines.join("\n")}`;
}
