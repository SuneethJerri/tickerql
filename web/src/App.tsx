import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useTheme } from "./useTheme";
import { ACCENTS, ACCENT_NAMES, THEMES, THEME_NAMES, isThemeName } from "./theme";
import { Dashboard } from "./pages/Dashboard";
import { RiskPage } from "./pages/RiskPage";
import { CorrelationPage } from "./pages/CorrelationPage";
import { AskPage } from "./pages/AskPage";

type Tab = "dashboard" | "risk" | "correlation" | "ask";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "risk", label: "Risk vs return" },
  { id: "correlation", label: "Correlation" },
  { id: "ask", label: "Ask" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { chartBase, accent, choice, setTheme, setAccent } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">tickerql</span>
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {health.data && (
          <span className="muted health">
            {health.data.price_rows?.toLocaleString("en")} bars · to {health.data.latest_bar}
            {health.data.status === "degraded" && " · stale"}
          </span>
        )}

        <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
          {ACCENT_NAMES.map((name) => (
            <button
              key={name}
              className="accent-dot"
              data-hue={name}
              role="radio"
              aria-checked={accent === name}
              aria-label={ACCENTS[name].label}
              title={ACCENTS[name].label}
              onClick={() => setAccent(name)}
            />
          ))}
        </div>

        <label className="theme-picker">
          <span className="visually-hidden">Theme</span>
          {/* "System" is a real option, not the absence of one: useTheme keeps
              the choice as null so the OS preference stays live afterwards. */}
          <select
            value={choice ?? "system"}
            onChange={(e) => setTheme(isThemeName(e.target.value) ? e.target.value : null)}
          >
            <option value="system">System</option>
            {THEME_NAMES.map((name) => (
              <option key={name} value={name}>
                {THEMES[name].label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="content">
        {tab === "dashboard" && <Dashboard mode={chartBase} />}
        {tab === "risk" && <RiskPage mode={chartBase} />}
        {tab === "correlation" && <CorrelationPage mode={chartBase} />}
        {tab === "ask" && <AskPage />}
      </main>
    </div>
  );
}
