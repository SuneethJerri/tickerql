import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtPct, type SectorPerformance } from "../api";
import { SectorIndexChart } from "../charts/SectorIndexChart";
import { PriceMaChart } from "../charts/PriceMaChart";
import type { ChartBase } from "../charts/palette";
import { StatTile } from "../components/StatTile";
import { TableView } from "../components/TableView";
import { Card, ErrorNotice, Loading, WindowPicker } from "../components/ui";

export function Dashboard({ mode }: { mode: ChartBase }) {
  const [window, setWindow] = useState(365);
  const [ticker, setTicker] = useState("AAPL");

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const perf = useQuery({
    queryKey: ["sector-performance", window],
    queryFn: () => api.sectorPerformance(window),
  });
  const index = useQuery({
    queryKey: ["sector-index", window],
    queryFn: () => api.sectorIndex(window),
  });
  const ma = useQuery({
    queryKey: ["ma", ticker, window],
    queryFn: () => api.movingAverages(ticker, [20, 50, 200], window),
  });

  const ranked = [...(perf.data ?? [])].sort(
    (a, b) => (b.return_per_unit_risk ?? -99) - (a.return_per_unit_risk ?? -99),
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const widest = [...(perf.data ?? [])].sort(
    (a, b) => (b.annualized_volatility ?? 0) - (a.annualized_volatility ?? 0),
  )[0];

  return (
    <>
      <div className="controls">
        <WindowPicker value={window} onChange={setWindow} />
        <span className="control">
          Asset
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {(assets.data ?? []).map((a) => (
              <option key={a.ticker} value={a.ticker}>
                {a.ticker} — {a.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="grid kpi" style={{ marginBottom: 16 }}>
        <StatTile label="Assets tracked" value={String(assets.data?.length ?? "—")} />
        <StatTile
          label="Best risk-adjusted sector"
          value={best?.sector ?? "—"}
          delta={best ? `${best.return_per_unit_risk?.toFixed(2)} return per unit risk` : undefined}
          deltaDirection="up"
        />
        <StatTile
          label="Weakest risk-adjusted sector"
          value={worst?.sector ?? "—"}
          delta={worst ? `${worst.return_per_unit_risk?.toFixed(2)} return per unit risk` : undefined}
          deltaDirection="down"
        />
        <StatTile
          label="Most volatile sector"
          value={widest?.sector ?? "—"}
          delta={widest ? `${fmtPct(widest.annualized_volatility)} annualised` : undefined}
        />
      </div>

      <div className="grid">
        <Card
          title="Sector performance"
          subtitle="Equal-weighted and indexed to 100 at the start of the window, one panel per sector on a shared scale. Indian sectors are priced in INR, so their panels are local-currency returns and are not directly comparable with the USD ones."
        >
          {index.isPending ? <Loading /> : index.error ? <ErrorNotice error={index.error} /> : (
            <>
              <SectorIndexChart data={index.data!} mode={mode} />
              <SectorTable rows={perf.data ?? []} />
            </>
          )}
        </Card>

        <Card
          title={`${ticker} price and moving averages`}
          subtitle="Close price with 20, 50 and 200-day averages. Averages are computed over full history, so the left edge is not a truncated series."
        >
          {ma.isPending ? <Loading /> : ma.error ? <ErrorNotice error={ma.error} /> : (
            <PriceMaChart series={ma.data!} mode={mode} />
          )}
        </Card>
      </div>
    </>
  );
}

function SectorTable({ rows }: { rows: SectorPerformance[] }) {
  // Ranked by return rather than by a fixed sector order. The swatch is gone
  // with it: the panels above all wear one hue, so a coloured dot here would
  // claim a sector-to-colour mapping that no longer exists.
  const ordered = [...rows].sort(
    (a, b) => (b.total_return ?? -Infinity) - (a.total_return ?? -Infinity),
  );
  return (
    <TableView
      label="sector table"
      columns={["Sector", "Assets", "Return", "Volatility", "Return / risk", "Days"]}
      rows={ordered.map((r) => [
        r.sector,
        r.asset_count,
        fmtPct(r.total_return),
        fmtPct(r.annualized_volatility),
        r.return_per_unit_risk?.toFixed(2) ?? "—",
        r.observations,
      ])}
    />
  );
}
