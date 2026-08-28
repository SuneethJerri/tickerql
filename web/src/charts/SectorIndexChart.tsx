import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { SectorIndexPoint } from "../api";
import { MARK, emphasisColors, type ThemeName } from "./palette";
import { TooltipCard } from "./ChartTooltip";
import { baselineScale } from "./scale";

/** Sector comparison as small multiples, one panel per sector.
 *
 * Nineteen lines on one axis is not an option: the adjacent-pairlist ceiling is
 * eight hues, and past it sectorColor() returns null rather than reusing one.
 * Small multiples have no colour cap - identity comes from the panel label and
 * comparison from a shared y-domain, so every panel uses the same hue.
 */
export function SectorIndexChart({
  data,
  theme,
  onSelect,
}: {
  data: SectorIndexPoint[];
  theme: ThemeName;
  /** Given, each panel becomes a button that drills into that sector. The
   *  chart stays usable without it - the correlation page renders the same
   *  panels with nothing to drill into. */
  onSelect?: (sector: string) => void;
}) {
  const { primary } = emphasisColors(theme);

  const bySector = new Map<string, { date: string; value: number }[]>();
  for (const point of data) {
    if (!Number.isFinite(point.indexed_value)) continue;
    const series = bySector.get(point.sector) ?? [];
    series.push({ date: point.date, value: point.indexed_value });
    bySector.set(point.sector, series);
  }

  // Each panel is its own series, so the weekend holes that forced connectNulls
  // on the pivoted version do not exist here - a sector never has a gap in its
  // own trading calendar.
  const panels = [...bySector.entries()]
    .map(([sector, series]) => {
      const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
      return { sector, series: sorted, final: sorted.at(-1)?.value ?? 100 };
    })
    .sort((a, b) => b.final - a.final);

  // One y-domain across every panel: per-panel autoscaling draws a 2% sector
  // and a 60% sector with the same amplitude. Snapping outward to a round step
  // also keeps the extremes off the frame - at 84px tall an exact [min, max]
  // clips half the stroke on whichever sector owns the high or the low.
  const { domain } = baselineScale(
    panels.flatMap((panel) => panel.series.map((point) => point.value)),
  );

  if (!panels.length) return null;

  return (
    <div className="small-multiples">
      {panels.map((panel) => {
        const change = panel.final - 100;
        return (
          <figure
            className={`sm-panel${onSelect ? " selectable" : ""}`}
            key={panel.sector}
            // A figure, not a button wrapping everything: the tooltip inside
            // needs pointer events, and nesting interactive content in a button
            // is invalid. The caption carries the control, so keyboard users get
            // one tab stop per sector.
            onClick={onSelect ? () => onSelect(panel.sector) : undefined}
          >
            <figcaption>
              {onSelect ? (
                <button
                  type="button"
                  className="sm-name link-quiet"
                  title={`${panel.sector} — see the assets behind it`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(panel.sector);
                  }}
                >
                  {panel.sector}
                </button>
              ) : (
                <span className="sm-name" title={panel.sector}>
                  {panel.sector}
                </span>
              )}
              <span className={`delta sm-delta ${change >= 0 ? "up" : "down"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
            </figcaption>
            <ResponsiveContainer width="100%" height={84}>
              <LineChart
                data={panel.series}
                margin={{ top: 3, right: 1, bottom: 0, left: 1 }}
              >
                <YAxis hide domain={domain} />
                {/* The start of the window. Without it a panel that is down 3%
                    and one that is up 3% look identical at this size. */}
                <ReferenceLine y={100} stroke="var(--grid)" strokeWidth={1} />
                <Tooltip
                  cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipCard
                        title={String(payload[0]?.payload?.date ?? "")}
                        rows={[
                          {
                            key: panel.sector,
                            label: panel.sector,
                            value: Number(payload[0]?.value).toFixed(1),
                            color: primary,
                          },
                        ]}
                      />
                    ) : null
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={primary}
                  strokeWidth={MARK.contextLineWidth}
                  dot={false}
                  activeDot={{
                    r: 3.5,
                    strokeWidth: MARK.surfaceRing,
                    stroke: "var(--surface-1)",
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </figure>
        );
      })}
    </div>
  );
}


/** The small-multiples grid with nothing in it. The same `.small-multiples`
 *  container and panel markup, so the columns break at the same widths and the
 *  height is right at all of them; a fixed block is right at none of them. */
export function SectorPanelsSkeleton({ count }: { count: number }) {
  return (
    <div className="small-multiples" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <figure className="sm-panel" key={i}>
          <figcaption>
            <span className="skeleton ghost-caption" />
          </figcaption>
          <div className="skeleton" style={{ height: 84 }} />
        </figure>
      ))}
    </div>
  );
}
