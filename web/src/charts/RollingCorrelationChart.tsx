import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { MARK, emphasisColors, type ThemeName } from "./palette";
import { TooltipCard } from "./ChartTooltip";
import { correlationScale } from "./scale";
import type { RollingCorrelationPoint } from "../api";

/** One pair's correlation over time.
 *
 * The heatmap answers "how related are these two?" with a single number per
 * pair, and that number is a mean of something that moves. Two assets can
 * average 0.4 by sitting at 0.4 all year, or by spending one quarter at 0.85
 * and the next at -0.05, and a matrix cell cannot tell those apart. Nothing
 * else in the app can show the difference, because every other view of
 * correlation is also a summary.
 *
 * The y-axis is neither autoscaled nor pinned to the full [-1, 1]; see
 * `correlationScale`. Autoscaled, a pair that never leaves 0.38-0.42 fills the
 * panel with noise; pinned, a pair whose correlation tripled draws as a flat
 * line. It is snapped to quarter steps with zero always in view and never less
 * than half the full scale shown.
 *
 * The dashed line is the figure the heatmap shows for the same pair over the
 * same span. The gap between it and the series is what the view is for.
 */
export function RollingCorrelationChart({
  points, spanCorrelation, windowDays, theme,
}: {
  points: RollingCorrelationPoint[];
  spanCorrelation: number | null;
  windowDays: number;
  theme: ThemeName;
}) {
  const { primary, context } = emphasisColors(theme);
  const { domain, ticks: yTicks } = correlationScale(
    points.map((p) => p.correlation).filter((v): v is number => v != null),
  );

  // Months on a short span, quarters on a long one: three years has 36 month
  // boundaries and the axis carries about a dozen labels before they collide.
  const span = points.length
    ? (Date.parse(points[points.length - 1]!.date) - Date.parse(points[0]!.date)) / 86_400_000
    : 0;
  const byQuarter = span > 400;
  const ticks: string[] = [];
  let last = "";
  for (const point of points) {
    const month = Number(point.date.slice(5, 7));
    const bucket = byQuarter
      ? `${point.date.slice(0, 4)}-Q${Math.ceil(month / 3)}`
      : point.date.slice(0, 7);
    if (bucket !== last) {
      ticks.push(point.date);
      last = bucket;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* The right margin is wide enough to hold the reference line's tag.
          Inside the plot the tag printed over the series wherever the two
          happened to cross, which is exactly where the reader is looking. */}
      <LineChart data={points} margin={{ top: 8, right: 46, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          tickLine={false} axisLine={{ stroke: "var(--border)" }}
          ticks={ticks} interval="preserveStartEnd" minTickGap={40}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
          axisLine={false} width={46}
          domain={domain} ticks={yTicks}
          tickFormatter={(v: number) => v.toFixed(2)}
        />
        {/* Zero is the one value on this axis that changes the meaning of the
            series rather than its degree: above it the pair moves together,
            below it they move against each other. */}
        <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
        {spanCorrelation != null && (
          <ReferenceLine
            y={spanCorrelation} stroke={context[0]} strokeDasharray="4 3" strokeWidth={1}
            label={{
              value: spanCorrelation.toFixed(2),
              position: "right",
              fill: "var(--text-muted)", fontSize: 11,
            }}
          />
        )}
        <Tooltip
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipCard
                title={String(label)}
                rows={[{
                  key: "corr",
                  label: `Trailing ${windowDays} days`,
                  value: Number(payload[0]!.value).toFixed(2),
                  color: primary,
                }]}
              />
            ) : null
          }
        />
        <Line
          type="monotone" dataKey="correlation"
          stroke={primary} strokeWidth={MARK.lineWidth}
          dot={false} isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
