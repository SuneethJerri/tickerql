import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, fmtPct, type RiskMetric } from "../api";
import { TooltipCard } from "../charts/ChartTooltip";
import { emphasisColors, type ChartBase } from "../charts/palette";
import { baselineScale } from "../charts/scale";
import { Sparkline } from "../charts/Sparkline";
import { Card, ErrorNotice, Loading, WindowPicker, METRIC_WINDOWS } from "../components/ui";
import { PinButton } from "../components/PinButton";
import { AskAbout } from "../components/AskAbout";
import { usePins } from "../pins";
import { setUrlParams, useUrlNumber, useUrlOptional } from "../urlState";
import { downloadCsv, type CsvCell } from "../csv";

/** One sector, and the assets inside it.
 *
 * The dashboard's small multiples answer "which sectors moved"; the obvious
 * next question is "which assets moved them", and until now the only way to ask
 * it was the correlation heatmap's cell drill-down, which is a strange place to
 * find it. A sector panel is now a link to this.
 *
 * Every figure here comes from queries the rest of the app already makes, under
 * the same keys - sector-index, risk-return, sparklines - so arriving here
 * costs no request that has not already been paid for.
 */
export function SectorPage({ mode }: { mode: ChartBase }) {
  const [windowDays, setWindow] = useUrlNumber("window", METRIC_WINDOWS, 365, "replace");
  const sector = useUrlOptional("sector", 64);
  const pins = usePins();
  const { primary } = emphasisColors(mode);

  const index = useQuery({
    queryKey: ["sector-index", windowDays],
    queryFn: () => api.sectorIndex(windowDays),
  });
  const risk = useQuery({
    queryKey: ["risk-return", windowDays],
    queryFn: () => api.riskReturn(windowDays),
  });
  const sparks = useQuery({
    queryKey: ["sparklines", windowDays],
    queryFn: () => api.sparklines(windowDays),
  });

  const sectors = [...new Set((risk.data ?? []).map((r) => r.sector))].sort();

  if (!sector) {
    return (
      <>
        <div className="controls">
          <WindowPicker value={windowDays} onChange={setWindow} />
        </div>
        <Card title="Sectors" subtitle="Pick a sector to see the assets inside it.">
          {risk.isPending ? (
            <Loading height={120} />
          ) : (
            <div className="sector-list">
              {sectors.map((s) => (
                <button
                  key={s}
                  className="chip"
                  onClick={() => setUrlParams({ tab: "sector", sector: s }, "push")}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </Card>
      </>
    );
  }

  const members: RiskMetric[] = (risk.data ?? [])
    .filter((r) => r.sector === sector)
    .sort((a, b) => (b.return_per_unit_risk ?? -99) - (a.return_per_unit_risk ?? -99));

  const series = (index.data ?? [])
    .filter((p) => p.sector === sector && Number.isFinite(p.indexed_value))
    .map((p) => ({ date: p.date, value: p.indexed_value }));

  // Anchored on 100 and snapped to round ticks. Left to Recharts the axis
  // starts at zero, and an index that runs 96-152 is drawn in the top third.
  const scale = baselineScale(series.map((p) => p.value));

  const spark = new Map((sparks.data ?? []).map((s) => [s.ticker, s.closes]));
  const change = series.length ? series[series.length - 1]!.value - 100 : null;
  // INR sectors are a local-currency series. Saying so once, here, is better
  // than a caveat on every figure - and better than leaving a reader to compare
  // an INR sector with a USD one and not know they did.
  const inr = sector.startsWith("India");

  return (
    <>
      <div className="controls">
        <WindowPicker value={windowDays} onChange={setWindow} />
        <button className="table-toggle" onClick={() => setUrlParams({ sector: null }, "push")}>
          All sectors
        </button>
      </div>

      <Card
        title={sector}
        subtitle={
          `Equal-weighted and indexed to 100 at the start of the window. ` +
          `${members.length} asset${members.length === 1 ? "" : "s"}` +
          (inr ? ", priced in INR — a local-currency series, not comparable with a USD sector." : ".")
        }
        action={
          <AskAbout
            question={`Which assets in the ${sector} sector had the highest volatility over the last ${windowDays} days?`}
          />
        }
      >
        {index.isPending ? (
          <Loading />
        ) : index.error ? (
          <ErrorNotice error={index.error} />
        ) : (
          <>
            {change != null && (
              <p className={`sector-change delta ${change >= 0 ? "up" : "down"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
                <span className="muted">over the window</span>
              </p>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series} margin={{ top: 10, right: 20, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" strokeWidth={1} />
                <XAxis
                  dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                  tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={44}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                  tickLine={false} axisLine={false} width={46}
                  domain={scale.domain} ticks={scale.ticks}
                />
                <ReferenceLine y={100} stroke="var(--border-strong)" strokeWidth={1} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipCard
                        title={String(payload[0]?.payload?.date ?? "")}
                        rows={[{
                          key: sector, label: sector,
                          value: Number(payload[0]?.value).toFixed(1), color: primary,
                        }]}
                      />
                    ) : null
                  }
                />
                <Line
                  type="monotone" dataKey="value" stroke={primary}
                  strokeWidth={1.75} dot={false} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      <Card
        title="The assets behind it"
        subtitle="Ranked by return per unit of risk, best first. Pin one to keep it in view, or open it for its own page."
      >
        <div className="table-actions">
          <button
            className="table-toggle"
            onClick={() =>
              downloadCsv(
                `tickerql-${sector.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
                ["Ticker", "Name", "Return", "Ann. vol", "Return/risk", "Max drawdown"],
                members.map((r) => [
                  r.ticker, r.name, r.total_return, r.annualized_volatility,
                  r.return_per_unit_risk, r.max_drawdown,
                ] as CsvCell[]),
              )
            }
          >
            Download CSV ({members.length} rows)
          </button>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th className="align-left">Ticker</th>
              <th className="align-left">Name</th>
              <th>Shape</th>
              <th>Return</th>
              <th>Ann. vol</th>
              <th>Return/risk</th>
              <th>Max drawdown</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((r) => (
              <tr key={r.ticker}>
                <td className="align-left">
                  <button
                    className="link-quiet"
                    onClick={() => setUrlParams({ tab: "asset", ticker: r.ticker }, "push")}
                  >
                    {r.ticker}
                  </button>
                </td>
                <td className="align-left">{r.name}</td>
                <td>
                  {spark.has(r.ticker)
                    ? <Sparkline closes={spark.get(r.ticker)!} mode={mode} width={84} height={20} />
                    : <span className="muted">—</span>}
                </td>
                <td>{r.total_return == null ? "—" : fmtPct(r.total_return)}</td>
                <td>{r.annualized_volatility == null ? "—" : fmtPct(r.annualized_volatility)}</td>
                <td>{r.return_per_unit_risk?.toFixed(2) ?? "—"}</td>
                <td>{r.max_drawdown == null ? "—" : fmtPct(r.max_drawdown)}</td>
                <td><PinButton ticker={r.ticker} pins={pins} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
