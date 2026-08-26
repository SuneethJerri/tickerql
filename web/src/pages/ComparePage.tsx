import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, fmtPct, type RiskMetric } from "../api";
import { TooltipCard } from "../charts/ChartTooltip";
import { sectorColor, type ChartBase } from "../charts/palette";
import { baselineScale } from "../charts/scale";
import { Card, ErrorNotice, Loading, WindowPicker, METRIC_WINDOWS } from "../components/ui";
import { PinButton } from "../components/PinButton";
import { AskAbout } from "../components/AskAbout";
import { usePins, MAX_PINS } from "../pins";
import { useUrlNumber } from "../urlState";
import { downloadCsv, type CsvCell } from "../csv";

/** Compare the pinned assets on one plane.
 *
 * Rebased to 100 at the start of the window rather than plotted at price: BTC
 * at ~$60,000 and INFY at ₹1,800 on one axis is a chart of one line and a flat
 * one at the bottom. Rebasing asks the only question a comparison answers -
 * which of these grew more from the same starting point.
 *
 * Eight is the cap, and it is not arbitrary: the categorical palette validates
 * eight hues on the ADJACENT pairlist, which is what a set of lines is. Past
 * that `sectorColor`-style fallback would start reusing hues, and two series in
 * the same colour is worse than a series you cannot add.
 *
 * The series come from the sparkline endpoint - one request for all 135 assets,
 * already in cache from the risk table - rather than N calls to /api/prices.
 * Weekly closes are the right resolution for a shape comparison, and the daily
 * detail nobody reads at this size would cost 135x the payload.
 */
export function ComparePage({ mode }: { mode: ChartBase }) {
  const [windowDays, setWindow] = useUrlNumber("window", METRIC_WINDOWS, 365, "replace");
  const pins = usePins();

  const sparks = useQuery({
    queryKey: ["sparklines", windowDays],
    queryFn: () => api.sparklines(windowDays),
  });
  const risk = useQuery({
    queryKey: ["risk-return", windowDays],
    queryFn: () => api.riskReturn(windowDays),
  });

  const chosen = pins.pins;
  const byTicker = new Map<string, RiskMetric>((risk.data ?? []).map((r) => [r.ticker, r]));
  const series = chosen
    .map((t) => (sparks.data ?? []).find((s) => s.ticker === t))
    .filter((s): s is NonNullable<typeof s> => s != null && s.closes.length > 1);

  // One row per period index. The series are already aligned - the query emits
  // one point per ISO week over the same window for every asset - so the index
  // is a shared x without needing dates on the wire.
  const longest = series.reduce((n, s) => Math.max(n, s.closes.length), 0);
  const rows = Array.from({ length: longest }, (_, i) => {
    const row: Record<string, number | null> = { i };
    for (const s of series) {
      const base = s.closes[0];
      const v = s.closes[i];
      // Series can differ in length when an asset listed mid-window. Aligning
      // them to the LAST point instead would compare different periods, so a
      // short series is left null on the left and simply starts later.
      row[s.ticker] = v == null || base == null || base === 0 ? null : (v / base) * 100;
    }
    return row;
  });

  // Only the rebased values - `row.i` is the x index and feeding it to the
  // scale would drag the low end down to zero, which is the defect this fixes.
  const scale = baselineScale(
    rows.flatMap((row) =>
      series.map((s) => row[s.ticker]).filter((v): v is number => v != null),
    ),
  );

  if (!chosen.length) {
    return (
      <>
        <div className="controls">
          <WindowPicker value={windowDays} onChange={setWindow} />
        </div>
        <Card
          title="Compare"
          subtitle="Pin assets to compare them here. Pin from the risk table, an asset's own page, or a sector's assets — up to eight, which is what the validated palette can colour without reusing a hue."
        >
          <p className="muted">Nothing pinned yet.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="controls">
        <WindowPicker value={windowDays} onChange={setWindow} />
        <span className="control muted">
          {chosen.length} of {MAX_PINS} pinned
        </span>
        <button className="table-toggle" onClick={() => pins.clear()}>
          Clear pins
        </button>
      </div>

      <Card
        title="Rebased to 100"
        subtitle="Each series starts at 100 on the first bar of the window, so the lines compare growth rather than price. Indian assets are priced in INR and crypto in USD; rebasing removes the level, not the currency, so a cross-currency pair still carries its exchange-rate move."
        action={
          <AskAbout question={`Compare the performance of ${chosen.join(", ")} over the last ${windowDays} days.`} />
        }
      >
        {sparks.isPending ? (
          <Loading />
        ) : sparks.error ? (
          <ErrorNotice error={sparks.error} />
        ) : (
          <>
            <div className="legend">
              {series.map((s) => (
                <span key={s.ticker} className="legend-item">
                  <span
                    className="legend-key"
                    style={{ background: sectorColor(s.ticker, chosen, mode) ?? "var(--text-muted)" }}
                  />
                  {s.ticker}
                  <PinButton ticker={s.ticker} pins={pins} compact />
                </span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={rows} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" strokeWidth={1} />
                <XAxis dataKey="i" tick={false} axisLine={{ stroke: "var(--border)" }} height={8} />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                  tickLine={false} axisLine={false} width={46}
                  domain={scale.domain} ticks={scale.ticks}
                />
                {/* The start of the window. Without it "up 3%" and "down 3%"
                    are the same picture at this size. */}
                <ReferenceLine y={100} stroke="var(--border-strong)" strokeWidth={1} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipCard
                        title="Rebased to 100"
                        rows={payload.map((p) => ({
                          key: String(p.dataKey),
                          label: String(p.dataKey),
                          value: typeof p.value === "number" ? p.value.toFixed(1) : "—",
                          color: p.color,
                        }))}
                      />
                    ) : null
                  }
                />
                {series.map((s) => (
                  <Line
                    key={s.ticker}
                    type="monotone"
                    dataKey={s.ticker}
                    stroke={sectorColor(s.ticker, chosen, mode) ?? "var(--text-muted)"}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      <Card title="The same assets, as figures" subtitle="Over the selected window.">
        <div className="table-actions">
          <button
            className="table-toggle"
            onClick={() =>
              downloadCsv(
                `tickerql-compare-${new Date().toISOString().slice(0, 10)}`,
                ["Ticker", "Name", "Sector", "Return", "Ann. vol", "Return/risk", "Max drawdown"],
                chosen.map((t) => {
                  const r = byTicker.get(t);
                  return [
                    t, r?.name ?? "", r?.sector ?? "",
                    r?.total_return ?? null, r?.annualized_volatility ?? null,
                    r?.return_per_unit_risk ?? null, r?.max_drawdown ?? null,
                  ] as CsvCell[];
                }),
              )
            }
          >
            Download CSV
          </button>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th className="align-left">Ticker</th>
              <th className="align-left">Sector</th>
              <th>Return</th>
              <th>Ann. vol</th>
              <th>Return/risk</th>
              <th>Max drawdown</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {chosen.map((t) => {
              const r = byTicker.get(t);
              return (
                <tr key={t}>
                  <td className="align-left">{t}</td>
                  <td className="align-left">{r?.sector ?? "—"}</td>
                  <td>{r?.total_return == null ? "—" : fmtPct(r.total_return)}</td>
                  <td>{r?.annualized_volatility == null ? "—" : fmtPct(r.annualized_volatility)}</td>
                  <td>{r?.return_per_unit_risk?.toFixed(2) ?? "—"}</td>
                  <td>{r?.max_drawdown == null ? "—" : fmtPct(r.max_drawdown)}</td>
                  <td><PinButton ticker={t} pins={pins} compact /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
