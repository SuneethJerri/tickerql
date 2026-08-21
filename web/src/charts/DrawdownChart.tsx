import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { MARK, emphasisColors, type ChartBase } from "./palette";
import { TooltipCard } from "./ChartTooltip";

export interface DrawdownPoint {
  date: string;
  /** Fraction below the running peak, so always <= 0. */
  drawdown: number;
}

/** How far below its own running peak an asset is, day by day.
 *
 * One series, so no legend - the card title names it. It is deliberately NOT
 * drawn in the critical red: status colours are reserved for state (good,
 * warning, critical) and a drawdown series is a magnitude, not an alert. It
 * wears the same emphasis hue as the price chart above it, which also makes
 * the two read as one asset rather than two subjects.
 *
 * The area hangs from zero downward, which is the whole point of the form: the
 * eye reads depth and duration at once, and duration is the part a max-drawdown
 * number cannot tell you.
 */
export function DrawdownChart({
  points, mode,
}: {
  points: DrawdownPoint[];
  mode: ChartBase;
}) {
  const { primary } = emphasisColors(mode);
  const worst = points.reduce((low, p) => Math.min(low, p.drawdown), 0);

  // Explicit ticks on a round step. Left to recharts the domain divided into
  // quarters and produced 0 / -7 / -11 / -15, which reads as an axis with a
  // mistake in it.
  const depth = Math.max(5, Math.ceil(Math.abs(worst) * 100 / 5) * 5);
  const step = depth <= 20 ? 5 : depth <= 60 ? 10 : 20;
  const ticks: number[] = [];
  for (let value = 0; value >= -depth; value -= step) ticks.push(value / 100);

  const monthTicks: string[] = [];
  let lastMonth = "";
  for (const point of points) {
    const month = point.date.slice(0, 7);
    if (month !== lastMonth) {
      monthTicks.push(point.date);
      lastMonth = month;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          tickLine={false} axisLine={{ stroke: "var(--border)" }}
          ticks={monthTicks} interval="preserveStartEnd" minTickGap={40}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
          axisLine={false} width={46}
          // Pinned to a round depth rather than autoscaled: a shallow
          // drawdown autoscaled to fill the panel looks exactly like a deep one.
          domain={[-depth / 100, 0]} ticks={ticks}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
        <Tooltip
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipCard
                title={String(label)}
                rows={[{
                  key: "dd",
                  label: "Below peak",
                  value: `${(Number(payload[0]!.value) * 100).toFixed(1)}%`,
                  color: primary,
                }]}
              />
            ) : null
          }
        />
        <Area
          type="monotone" dataKey="drawdown"
          stroke={primary} strokeWidth={MARK.lineWidth}
          fill={primary} fillOpacity={MARK.areaOpacity}
          dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
