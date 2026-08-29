import {
  Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DistributionBucket } from "../api";
import { MARK, emphasisColors, type ThemeName } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** The histogram of one asset's daily returns, against the normal curve.
 *
 * The reference curve is the whole argument. Bars alone show a hump and invite
 * "that looks like a bell curve", which is the misreading this view exists to
 * correct: the hump is taller and the tails are fatter than a normal
 * distribution of the same width, and only the overlay makes that visible.
 *
 * The curve is drawn as expected DAY COUNTS, not a density, so it is on the
 * same axis as the bars and can be read against them directly. For a bucket a
 * quarter of a standard deviation wide, that is n * 0.25 * phi(z) at the
 * bucket's midpoint - the density times the width times the sample size.
 *
 * The x axis is labelled in per cent, because that is the unit a reader thinks
 * in, while the buckets themselves are in standard deviations so the same
 * curve fits every asset. Both live on each bucket, so the axis and the
 * overlay each get the unit they need.
 */

/** Standard normal density. */
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

const BUCKET_WIDTH_SD = 0.25;

export function DistributionChart({
  buckets,
  observations,
  theme,
}: {
  buckets: DistributionBucket[];
  observations: number;
  theme: ThemeName;
}) {
  const { primary, context } = emphasisColors(theme);

  const data = buckets.map((b) => {
    // Outer buckets are unbounded on one side; their midpoint is taken half a
    // bucket past the finite edge so the curve has somewhere to sit, and the
    // expected count there is near zero either way.
    const zMid =
      b.z_low != null && b.z_high != null
        ? (b.z_low + b.z_high) / 2
        : b.z_low != null
          ? b.z_low + BUCKET_WIDTH_SD / 2
          : (b.z_high ?? 0) - BUCKET_WIDTH_SD / 2;
    const edge = b.return_low ?? b.return_high;
    return {
      bucket: b.bucket,
      days: b.days,
      expected: observations * BUCKET_WIDTH_SD * phi(zMid),
      zMid,
      zLow: b.z_low,
      zHigh: b.z_high,
      returnLow: b.return_low,
      returnHigh: b.return_high,
      // Sort key for the axis; the label itself is drawn from returnLow.
      pct: edge == null ? 0 : edge * 100,
    };
  });

  // Label only the whole standard deviations. Every bucket labelled is 34
  // overlapping numbers; a quarter of a standard deviation is not a reading
  // anyone takes off an axis anyway.
  const ticks = data
    .filter((d) => d.zLow != null && Math.abs(d.zLow % 1) < 1e-9)
    .map((d) => d.bucket);

  return (
    <>
      <Legend
        items={[
          { label: "Days observed", color: primary },
          { label: "Normal curve, same width", color: context[0]!, shape: "line" },
        ]}
      />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 12, right: 20, bottom: 28, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="bucket"
            type="category"
            ticks={ticks}
            tickFormatter={(bucket: number) => {
              const d = data.find((x) => x.bucket === bucket);
              return d?.returnLow == null ? "" : `${(d.returnLow * 100).toFixed(1)}%`;
            }}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            label={{
              value: "Daily return", position: "insideBottom", offset: -16,
              fontSize: 11.5, fill: "var(--text-secondary)",
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false} axisLine={false} width={44} allowDecimals={false}
            label={{
              value: "Days", angle: -90, position: "insideLeft", offset: 6,
              fontSize: 11.5, fill: "var(--text-secondary)",
            }}
          />
          <Tooltip
            cursor={{ fill: "var(--grid)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof data)[number];
              const range =
                p.returnLow == null
                  ? `below ${((p.returnHigh ?? 0) * 100).toFixed(1)}%`
                  : p.returnHigh == null
                    ? `above ${(p.returnLow * 100).toFixed(1)}%`
                    : `${(p.returnLow * 100).toFixed(1)}% to ${(p.returnHigh * 100).toFixed(1)}%`;
              return (
                <TooltipCard
                  title={range}
                  rows={[
                    { key: "days", label: "Days observed", value: `${p.days}` },
                    { key: "exp", label: "Normal predicts", value: p.expected.toFixed(1) },
                    {
                      key: "z", label: "Standard deviations",
                      value: p.zLow == null
                        ? "below −4"
                        : p.zHigh == null
                          ? "above +4"
                          : `${p.zLow.toFixed(2)} to ${p.zHigh.toFixed(2)}`,
                    },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="days" fill={primary} isAnimationActive={false} />
          <Line
            type="monotone" dataKey="expected" dot={false} isAnimationActive={false}
            stroke={context[0]} strokeWidth={MARK.contextLineWidth} strokeDasharray="4 3"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
