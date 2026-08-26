import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useTheme } from "./useTheme";
import { useUrlEnum } from "./urlState";
import { ACCENTS, ACCENT_NAMES, THEMES, THEME_NAMES, isThemeName } from "./theme";
import { Dashboard } from "./pages/Dashboard";
import { RiskPage } from "./pages/RiskPage";
import { CorrelationPage } from "./pages/CorrelationPage";
import { AssetPage } from "./pages/AssetPage";
import { AskPage } from "./pages/AskPage";
import { SectorPage } from "./pages/SectorPage";
import { ComparePage } from "./pages/ComparePage";
import { CommandPalette } from "./components/CommandPalette";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sector", label: "Sectors" },
  { id: "risk", label: "Risk vs return" },
  { id: "correlation", label: "Correlation" },
  { id: "asset", label: "Asset" },
  { id: "compare", label: "Compare" },
  { id: "ask", label: "Ask" },
] as const;

type Tab = (typeof TABS)[number]["id"];

const TAB_IDS = TABS.map((t) => t.id);

export default function App() {
  const [tab, setTab] = useUrlEnum<Tab>("tab", TAB_IDS, "dashboard");
  const { theme, accent, choice, setTheme, setAccent } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd-K on a Mac, Ctrl-K elsewhere. Bound on the document rather than on a
  // container so it works wherever focus happens to be - including inside the
  // Ask textarea, which is where you are most likely to want to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
        {/* The shortcut needs a visible affordance: a keyboard-only feature is
            invisible to everyone who does not already know it exists. */}
        <button
          type="button"
          className="palette-open"
          onClick={() => setPaletteOpen(true)}
          aria-label="Go to an asset, sector or view"
          title="Go to… (Ctrl-K)"
        >
          <span aria-hidden="true">Go to</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>
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
        {tab === "dashboard" && <Dashboard theme={theme} />}
        {tab === "sector" && <SectorPage theme={theme} />}
        {tab === "risk" && <RiskPage theme={theme} />}
        {tab === "correlation" && <CorrelationPage theme={theme} />}
        {tab === "asset" && <AssetPage theme={theme} />}
        {tab === "compare" && <ComparePage theme={theme} />}
        {tab === "ask" && <AskPage />}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
