import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "./lib/api.js";
import { useEdward } from "./hooks/useEdward.js";
import Today from "./pages/Today.jsx";
import Settings from "./pages/Settings.jsx";
import VoiceBar from "./components/VoiceBar.jsx";

const CalendarPage = lazy(() => import("./pages/CalendarPage.jsx"));

const TABS = [
  { id: "oggi", label: "Oggi" },
  { id: "calendario", label: "Calendario" },
  { id: "impostazioni", label: "Impostazioni" },
];

const currentTab = () => {
  const h = location.hash.replace("#", "");
  return TABS.some((t) => t.id === h) ? h : "oggi";
};

export default function App() {
  const [tab, setTab] = useState(currentTab);
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);

  const reloadSettings = useCallback(() => api.settings().then(setSettings).catch(() => {}), []);

  useEffect(() => {
    reloadSettings();
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [reloadSettings]);

  const edward = useEdward({ settings, health });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span className="brand-name">Edward</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? "active" : ""}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className={`status-dot ${health?.ok ? (health.ai ? "ok" : "warn") : "err"}`} title={
          health?.ok ? (health.ai ? `AI attiva (${health.model})` : "AI non configurata: manca ANTHROPIC_API_KEY") : "Server non raggiungibile"
        } />
      </header>

      <main className="content">
        {tab === "oggi" && <Today edward={edward} />}
        {tab === "calendario" && (
          <Suspense fallback={<p className="muted">Carico il calendario…</p>}>
            <CalendarPage />
          </Suspense>
        )}
        {tab === "impostazioni" && <Settings settings={settings} onSaved={setSettings} health={health} />}
      </main>

      <VoiceBar edward={edward} />
    </div>
  );
}
