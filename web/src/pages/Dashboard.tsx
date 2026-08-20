import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtPct, type SectorPerformance } from "../api";
import { SectorIndexChart } from "../charts/SectorIndexChart";
import { PriceMaChart } from "../charts/PriceMaChart";
import { SECTOR_ORDER, sectorColor, type Mode } from "../charts/palette";
import { StatTile } from "../components/StatTile";
import { TableView } from "../components/TableView";
import { Card, ErrorNotice, Loading, WindowPicker } from "../components/ui";

export function Dashboard({ mode }: { mode: Mode }) {
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

      <div className="grid cols-2">
        <Card
          title="Sector performance"
          subtitle={`Equal-weighted, indexed to 100 at the start of the window. One axis — indexing is what makes the sectors comparable.`}
        >
          {index.isPending ? <Loading /> : index.error ? <ErrorNotice error={index.error} /> : (
            <>
              <SectorIndexChart data={index.data!} mode={mode} />
              <SectorTable rows={perf.data ?? []} mode={mode} />
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

function SectorTable({ rows, mode }: { rows: SectorPerformance[]; mode: Mode }) {
  const ordered = SECTOR_ORDER.map((s) => rows.find((r) => r.sector === s)).filter(
    (r): r is SectorPerformance => Boolean(r),
  );
  return (
    <TableView
      label="sector table"
      columns={["Sector", "Return", "Volatility", "Return / risk", "Days"]}
      rows={ordered.map((r) => [
        <>
          <span className="swatch" style={{ background: sectorColor(r.sector, mode) }} />
          {r.sector}
        </>,
        fmtPct(r.total_return),
        fmtPct(r.annualized_volatility),
        r.return_per_unit_risk?.toFixed(2) ?? "—",
        r.observations,
      ])}
    />
  );
}
