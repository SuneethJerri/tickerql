import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { MovingAverageSeries } from "../api";
import { MARK, emphasisColors, type ThemeName } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** Close price with moving-average overlays - an EMPHASIS form.
 *
 * The close is the subject; the averages are context derived from it. Giving
 * each MA its own categorical hue would imply four peer series and bury the
 * thing the reader came for. So: price in the accent hue, averages in
 * de-emphasis grays at a thinner stroke.
 */
export function PriceMaChart({ series, theme }: { series: MovingAverageSeries; theme: ThemeName }) {
  const { primary, context } = emphasisColors(theme);
  const windows = [...series.windows].sort((a, b) => a - b);

  const byDate = new Map<string, Record<string, number | string>>();
  for (const point of series.points) {
    const row = byDate.get(point.date) ?? { date: point.date, close: point.close };
    // A partial average is computed from fewer bars than requested; plotting it
    // as if complete would draw a line that means something different at the
    // left edge than it does everywhere else.
    row[`ma${point.window_size}`] = point.is_partial ? Number.NaN : point.avg_close;
    byDate.set(point.date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Explicit month-start ticks. Picking by pixel gap and then truncating the
  // label to YYYY-MM prints the same month twice whenever two chosen ticks fall
  // inside it.
  const monthTicks: string[] = [];
  let lastMonth = "";
  for (const row of rows) {
    const month = String(row.date).slice(0, 7);
    if (month !== lastMonth) {
      monthTicks.push(String(row.date));
      lastMonth = month;
    }
  }

  return (
    <>
      <Legend
        items={[
          { label: `${series.ticker} close`, color: primary },
          ...windows.map((w, i) => ({ label: `${w}-day avg`, color: context[i % context.length]! })),
        ]}
      />
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false} axisLine={{ stroke: "var(--border)" }}
            ticks={monthTicks} interval="preserveStartEnd" minTickGap={40}
            tickFormatter={(d: string) => d.slice(0, 7)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={false} width={54} domain={["auto", "auto"]}
            tickFormatter={(v: number) => Intl.NumberFormat("en", { notation: "compact" }).format(v)}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={String(label)}
                  rows={payload
                    .filter((p) => Number.isFinite(Number(p.value)))
                    .map((p) => ({
                      key: String(p.dataKey),
                      label: p.dataKey === "close" ? "Close" : `${String(p.dataKey).slice(2)}-day avg`,
                      value: Number(p.value).toLocaleString("en", { maximumFractionDigits: 2 }),
                      color: p.color,
                    }))}
                />
              ) : null
            }
          />
          {/* Averages first so the subject line renders above them. */}
          {windows.map((w, i) => (
            <Line
              key={w} type="monotone" dataKey={`ma${w}`} stroke={context[i % context.length]!}
              strokeWidth={MARK.contextLineWidth} dot={false} isAnimationActive={false}
              connectNulls={false} activeDot={false}
            />
          ))}
          <Line
            type="monotone" dataKey="close" stroke={primary} strokeWidth={MARK.lineWidth}
            dot={false} isAnimationActive={false}
            activeDot={{ r: MARK.markerRadius, strokeWidth: MARK.surfaceRing, stroke: "var(--surface-1)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}
