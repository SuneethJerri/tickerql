import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useTheme } from "./useTheme";
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
  const { mode, toggle } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000 });

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Market Analytics</span>
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
          <span className="muted" style={{ fontSize: 12.5 }}>
            {health.data.price_rows?.toLocaleString("en")} bars · to {health.data.latest_bar}
            {health.data.status === "degraded" && " · stale"}
          </span>
        )}
        <button className="chip" onClick={toggle} aria-label="Toggle colour theme">
          {mode === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <main className="content">
        {tab === "dashboard" && <Dashboard mode={mode} />}
        {tab === "risk" && <RiskPage mode={mode} />}
        {tab === "correlation" && <CorrelationPage mode={mode} />}
        {tab === "ask" && <AskPage />}
      </main>
    </div>
  );
}
