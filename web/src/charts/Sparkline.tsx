import { emphasisColors, type ThemeName } from "./palette";

/** A price shape, inline in a table row.
 *
 * Hand-rolled SVG rather than a Recharts ResponsiveContainer: there is one of
 * these per row, and 135 ResponsiveContainers each running a resize observer
 * makes the table janky to scroll for a mark that is a polyline.
 *
 * Small multiples again, so the colour rule is the same as the sector panels:
 * one hue for every row, because colour is encoding nothing here - the row
 * says which asset it is. A baseline marks the first close, so a shape that
 * ends above where it started is readable as such without an axis.
 */
export function Sparkline({
  closes, theme, width = 96, height = 24,
}: {
  closes: readonly number[];
  theme: ThemeName;
  width?: number;
  height?: number;
}) {
  if (closes.length < 2) return <span className="muted">—</span>;

  const { primary } = emphasisColors(theme);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  // A flat series would divide by zero and, worse, draw a line at the top of
  // the box; span 1 puts it through the middle instead.
  const span = high - low || 1;
  const pad = 2;
  const usable = height - pad * 2;

  const x = (i: number) => (i / (closes.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - low) / span) * usable;

  const path = closes.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join("");
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;

  return (
    <svg
      className="sparkline" width={width} height={height}
      viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${((last / first - 1) * 100).toFixed(0)}% over the window`}
    >
      <line
        x1={0} x2={width} y1={y(first)} y2={y(first)}
        stroke="var(--grid)" strokeWidth={1}
      />
      <path d={path} fill="none" stroke={primary} strokeWidth={1.25}
            strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(closes.length - 1)} cy={y(last)} r={1.75} fill={primary} />
    </svg>
  );
}
