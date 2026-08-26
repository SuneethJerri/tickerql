import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtCompact, fmtPct, type PriceBar, type RiskMetric } from "../api";
import { PriceMaChart } from "../charts/PriceMaChart";
import { DrawdownChart, type DrawdownPoint } from "../charts/DrawdownChart";
import type { ChartBase } from "../charts/palette";
import { StatTile } from "../components/StatTile";
import { TableView, type Column } from "../components/TableView";
import { Card, ErrorNotice, Loading, WindowPicker, METRIC_WINDOWS } from "../components/ui";
import { useUrlNumber, useUrlString } from "../urlState";

/** One asset on its own.
 *
 * The dashboard answers "how do the sectors compare"; this answers "what has
 * this thing actually done", which is the question every ranked table leaves
 * you with. It is a real tab rather than a modal so it is linkable: ?tab=asset
 * &ticker=NVDA is the whole address.
 */
export function AssetPage({ mode }: { mode: ChartBase }) {
  // "push" here, unlike on the dashboard: on this page the ticker IS the view,
  // so `back` should return to the asset you were looking at before.
  const [ticker, setTicker] = useUrlString("ticker", "AAPL", "push");
  const [windowDays, setWindow] = useUrlNumber("window", METRIC_WINDOWS, 365, "replace");

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const ma = useQuery({
    queryKey: ["ma", ticker, windowDays],
    queryFn: () => api.movingAverages(ticker, [20, 50, 200], windowDays),
  });
  // Full history, fetched once and sliced client-side. One asset is ~750 bars,
  // so re-requesting it on every window change would cost more than it saves.
  const prices = useQuery({
    queryKey: ["prices", ticker],
    queryFn: () => api.prices(ticker),
  });
  const risk = useQuery({
    queryKey: ["risk-return", windowDays],
    queryFn: () => api.riskReturn(windowDays),
  });

  const asset = (assets.data ?? []).find((a) => a.ticker === ticker);
  const metrics = (risk.data ?? []).find((r) => r.ticker === ticker);

  const drawdown = useMemo(
    () => toDrawdown(prices.data?.bars ?? [], windowDays),
    [prices.data, windowDays],
  );

  // Rank within the sector, not a percentile. Sectors here hold 3 to 13 assets,
  // and a percentile computed from 3 samples reads as more precise than it is;
  // "2nd of 13" is the same information without the false precision.
  const peers = useMemo(() => {
    if (!metrics) return null;
    const sector = (risk.data ?? [])
      .filter((r) => r.sector === metrics.sector && r.return_per_unit_risk != null)
      .sort((a, b) => (b.return_per_unit_risk ?? 0) - (a.return_per_unit_risk ?? 0));
    const rank = sector.findIndex((r) => r.ticker === ticker);
    return rank < 0 ? null : { rank: rank + 1, total: sector.length, sector: metrics.sector };
  }, [risk.data, metrics, ticker]);

  const error = assets.error ?? prices.error ?? risk.error;

  return (
    <>
      <div className="controls">
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
        <WindowPicker value={windowDays} onChange={setWindow} />
        {asset && (
          <span className="control muted">
            {asset.sector} · {asset.currency} · {asset.bar_count.toLocaleString("en")} bars
          </span>
        )}
      </div>

      {error ? <ErrorNotice error={error} /> : (
        <>
          <div className="readout">
            <StatTile
              label="Annualised return"
              value={fmtPct(metrics?.annualized_return)}
              delta={metrics ? `${fmtPct(metrics.total_return)} over the window` : undefined}
              deltaDirection={(metrics?.annualized_return ?? 0) >= 0 ? "up" : "down"}
            />
            <StatTile
              label="Annualised volatility"
              value={fmtPct(metrics?.annualized_volatility)}
              delta={metrics ? `rank ${metrics.volatility_rank} of ${risk.data?.length ?? "—"}` : undefined}
            />
            <StatTile
              label="Return per unit risk"
              value={metrics?.return_per_unit_risk?.toFixed(2) ?? "—"}
              delta={peers ? `${ordinal(peers.rank)} of ${peers.total} in ${peers.sector}` : undefined}
            />
            <StatTile
              label="Max drawdown"
              value={fmtPct(metrics?.max_drawdown)}
              delta={metrics ? `${fmtCompact(metrics.avg_volume)} avg volume` : undefined}
            />
          </div>

          <div className="grid">
            <Card
              title={`${ticker} price and moving averages`}
              subtitle={
                asset
                  // Trailing period stripped: most names already carry one
                  // ("Apple Inc."), and the template added a second.
                  ? `${asset.name.replace(/\.$/, "")} — close price with 20, 50 and 200-day averages, computed over full history so the left edge is not a truncated series.`
                  : "Close price with 20, 50 and 200-day averages."
              }
            >
              {ma.isPending ? <Loading /> : ma.error ? <ErrorNotice error={ma.error} /> : (
                <PriceMaChart series={ma.data!} mode={mode} />
              )}
            </Card>

            <Card
              title="Drawdown from the running peak"
              subtitle="How far below its own high-water mark the asset sat on each day. A single max-drawdown figure gives the depth; this gives the depth and how long it lasted, which is the part that decides whether it was survivable."
            >
              {prices.isPending ? <Loading height={200} /> : (
                <>
                  <DrawdownChart points={drawdown} mode={mode} />
                  <TableView
                    label="drawdown series"
                    filename={`tickerql-${ticker}-drawdown-${windowDays}d`}
                    columns={DRAWDOWN_COLUMNS}
                    data={drawdown}
                  />
                </>
              )}
            </Card>
          </div>

          <Card
            title="Every metric for this asset"
            subtitle="The same figures the risk table carries, for this one asset, exportable on its own."
          >
            <TableView
              label="metric table"
              filename={`tickerql-${ticker}-metrics-${windowDays}d`}
              columns={METRIC_COLUMNS}
              data={metrics ? [metrics] : []}
            />
          </Card>
        </>
      )}
    </>
  );
}

/** Fraction below the running peak, over the trailing window.
 *
 * Uses adj_close where present: raw closes make a split look like a 50%
 * drawdown, and both NVDA and AAPL split inside this window.
 *
 * The peak is seeded from the window's own first bar rather than from all of
 * history, so the series answers "how far below its peak *within this window*"
 * - otherwise a 30-day view of an asset still recovering from a two-year-old
 * high would show a flat line at -40% and tell you nothing about the 30 days.
 */
function toDrawdown(bars: PriceBar[], windowDays: number): DrawdownPoint[] {
  if (!bars.length) return [];
  const last = bars[bars.length - 1]!.date;
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const from = cutoff.toISOString().slice(0, 10);

  const points: DrawdownPoint[] = [];
  let peak = 0;
  for (const bar of bars) {
    if (bar.date < from) continue;
    const price = bar.adj_close ?? bar.close;
    if (!Number.isFinite(price) || price <= 0) continue;
    peak = Math.max(peak, price);
    points.push({ date: bar.date, drawdown: price / peak - 1 });
  }
  return points;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

const DRAWDOWN_COLUMNS: Column<DrawdownPoint>[] = [
  { header: "Date", value: (p) => p.date, align: "left" },
  { header: "Drawdown", value: (p) => p.drawdown, cell: (p) => fmtPct(p.drawdown, 2) },
];

const METRIC_COLUMNS: Column<RiskMetric>[] = [
  { header: "Ticker", value: (r) => r.ticker, align: "left" },
  { header: "Name", value: (r) => r.name, align: "left" },
  { header: "Sector", value: (r) => r.sector, align: "left" },
  { header: "Start", value: (r) => r.start_date, align: "left" },
  { header: "End", value: (r) => r.end_date, align: "left" },
  { header: "Observations", value: (r) => r.observations },
  { header: "Total return", value: (r) => r.total_return, cell: (r) => fmtPct(r.total_return) },
  {
    header: "Annualised return",
    value: (r) => r.annualized_return,
    cell: (r) => fmtPct(r.annualized_return),
  },
  {
    header: "Annualised volatility",
    value: (r) => r.annualized_volatility,
    cell: (r) => fmtPct(r.annualized_volatility),
  },
  {
    header: "Return / risk",
    value: (r) => r.return_per_unit_risk,
    cell: (r) => r.return_per_unit_risk?.toFixed(2) ?? "—",
  },
  { header: "Max drawdown", value: (r) => r.max_drawdown, cell: (r) => fmtPct(r.max_drawdown) },
  { header: "Avg volume", value: (r) => r.avg_volume, cell: (r) => fmtCompact(r.avg_volume) },
];
