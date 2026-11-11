async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data?.error || `Errore ${res.status}`);
  return data;
}

export const api = {
  health: () => request("GET", "/health"),
  // calendario
  events: (from, to) => request("GET", `/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  upcoming: (days = 7) => request("GET", `/events/upcoming?days=${days}`),
  createEvent: (e) => request("POST", "/events", e),
  updateEvent: (id, e) => request("PUT", `/events/${id}`, e),
  deleteEvent: (id) => request("DELETE", `/events/${id}`),
  // giornale e meteo
  briefing: () => request("GET", "/briefing"),
  runBriefing: () => request("POST", "/briefing/run"),
  briefingRuns: () => request("GET", "/briefing/runs"),
  weather: () => request("GET", "/weather"),
  // impostazioni
  settings: () => request("GET", "/settings"),
  saveSettings: (s) => request("PUT", "/settings", s),
  geocode: (q) => request("GET", `/geocode?q=${encodeURIComponent(q)}`),
  // assistente
  chat: (sessionId, text) => request("POST", "/assistant/chat", { sessionId, text }),
  resetChat: (sessionId) => request("POST", "/assistant/reset", { sessionId }),
  stt: (blob) => {
    const fd = new FormData();
    fd.append("audio", blob, "audio.webm");
    return request("POST", "/stt", fd);
  },
  tts: (text) => request("POST", "/tts", { text }),
};

/** Evento globale per avvisare le pagine che il calendario è cambiato (es. dopo un comando vocale). */
export const CALENDAR_CHANGED = "edward:calendar-changed";
export const notifyCalendarChanged = () => window.dispatchEvent(new Event(CALENDAR_CHANGED));
