import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SectorIndexPoint } from "../api";
import { MARK, SECTOR_ORDER, sectorColor, type Mode } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** Sector comparison, indexed to 100 at the window start.
 *
 * Indexing is what makes one y-axis correct here. Sector levels are not
 * comparable in raw units, and the alternative — a second y-scale — invents a
 * relationship the data does not contain. Five categorical series pass the
 * adjacent-pair gates; the contrast WARN is answered by the direct end-labels
 * plus the table view below the chart.
 */
export function SectorIndexChart({ data, mode }: { data: SectorIndexPoint[]; mode: Mode }) {
  const sectors = SECTOR_ORDER.filter((s) => data.some((d) => d.sector === s));

  // Pivot to one row per date so a single crosshair reads every series.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const point of data) {
    const row = byDate.get(point.date) ?? { date: point.date };
    row[point.sector] = point.indexed_value;
    byDate.set(point.date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Direct-label only the highest and lowest ending series. Labelling all five
  // overprints them (Technology and Financials finish within a few points of
  // each other), and stacking colliding end-labels is worse than not having
  // them. These two carry the story; the legend names all five and the table
  // has the exact figures.
  const finals = sectors
    .map((s) => ({ sector: s, value: Number(rows.at(-1)?.[s] ?? Number.NaN) }))
    .filter((d) => Number.isFinite(d.value))
    .sort((a, b) => b.value - a.value);
  const labelled = new Set([finals[0]?.sector, finals.at(-1)?.sector].filter(Boolean));

  return (
    <>
      <Legend items={sectors.map((s) => ({ label: s, color: sectorColor(s, mode) }))} />
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 84, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={48}
            tickFormatter={(d: string) => d.slice(0, 7)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={false} width={46}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={String(label)}
                  rows={payload
                    .slice()
                    .sort((a, b) => Number(b.value) - Number(a.value))
                    .map((p) => ({
                      key: String(p.dataKey),
                      label: String(p.dataKey),
                      value: Number(p.value).toFixed(1),
                      color: p.color,
                    }))}
                />
              ) : null
            }
          />
          {sectors.map((sector) => (
            <Line
              key={sector} type="monotone" dataKey={sector}
              stroke={sectorColor(sector, mode)} strokeWidth={MARK.lineWidth}
              dot={false} activeDot={{ r: MARK.markerRadius, strokeWidth: MARK.surfaceRing, stroke: "var(--surface-1)" }}
              isAnimationActive={false}
              // Equities have no weekend bar while crypto does, so the pivot
              // leaves holes on 114 of 365 dates. Without this the equity lines
              // render as ~56 disconnected fragments that read as dashes.
              connectNulls
              label={
                labelled.has(sector)
                  ? <EndLabel total={rows.length} color={sectorColor(sector, mode)} text={sector} />
                  : undefined
              }
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

/** Direct label on the final point only — labels work because they are sparing. */
function EndLabel(props: any) {
  const { index, total, x, y, text, color } = props;
  if (index !== total - 1) return null;
  return (
    <text x={x + 8} y={y} dy={4} fontSize={11} fontWeight={550} fill={color}>
      {text}
    </text>
  );
}
