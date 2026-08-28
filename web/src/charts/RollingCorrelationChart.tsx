import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { MARK, emphasisColors, type ThemeName } from "./palette";
import { TooltipCard } from "./ChartTooltip";
import { correlationScale } from "./scale";
import type { RollingCorrelationPoint } from "../api";

/** One pair's correlation over time, with the uncertainty on each estimate.
 *
 * The heatmap answers "how related are these two?" with a single number per
 * pair, and that number is a mean of something that moves. Two assets can
 * average 0.4 by sitting at 0.4 all year, or by spending one quarter at 0.85
 * and the next at -0.05, and a matrix cell cannot tell those apart.
 *
 * The shaded band is the 95 per cent Fisher z interval on each window. It is
 * the part that decides whether the line moving means anything: a 60-day
 * window on daily returns has an interval roughly half a unit wide, so most of
 * what looks like movement in a short-window series is sampling noise. Drawing
 * the line without it invites exactly the over-reading this view exists to
 * prevent.
 *
 * The y-axis is neither autoscaled nor pinned to the full [-1, 1]; see
 * `correlationScale`. The band is fed to it along with the series, or a wide
 * interval is clipped by the frame and reads as a narrow one.
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

  // Recharts draws a ranged area from a [low, high] tuple, so the pair has to
  // be one field. A window with no interval carries null and leaves a gap
  // rather than collapsing the band to the line.
  const data = points.map((p) => ({
    ...p,
    band: p.ci_low != null && p.ci_high != null ? [p.ci_low, p.ci_high] : null,
  }));

  const { domain, ticks: yTicks } = correlationScale(
    data.flatMap((p) =>
      [p.correlation, p.ci_low, p.ci_high].filter((v): v is number => v != null),
    ),
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
    <>
      <ResponsiveContainer width="100%" height={260}>
        {/* The right margin is wide enough to hold the reference line's tag.
            Inside the plot the tag printed over the series wherever the two
            happened to cross, which is exactly where the reader is looking. */}
        <ComposedChart data={data} margin={{ top: 8, right: 46, bottom: 4, left: 0 }}>
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
          {/* Before the line, so the series reads on top of its own interval. */}
          <Area
            dataKey="band" stroke="none" fill={primary} fillOpacity={0.16}
            connectNulls={false} isAnimationActive={false} activeDot={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as (typeof data)[number];
              if (point.correlation == null) return null;
              return (
                <TooltipCard
                  title={String(label)}
                  rows={[
                    {
                      key: "corr",
                      label: `Trailing ${windowDays} days`,
                      value: point.correlation.toFixed(2),
                      color: primary,
                    },
                    ...(point.ci_low != null && point.ci_high != null
                      ? [{
                          key: "ci",
                          label: "95% interval",
                          value: `${point.ci_low.toFixed(2)} to ${point.ci_high.toFixed(2)}`,
                        }]
                      : []),
                  ]}
                />
              );
            }}
          />
          <Line
            type="monotone" dataKey="correlation"
            stroke={primary} strokeWidth={MARK.lineWidth}
            dot={false} isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="muted chart-note">
        Shaded band is the 95% Fisher z interval on each {windowDays}-day window. It assumes
        normal, independent returns, which daily returns are not, so the real uncertainty is
        wider than this.
      </p>
    </>
  );
}
