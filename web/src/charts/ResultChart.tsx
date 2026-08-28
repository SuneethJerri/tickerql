import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { MARK, emphasisColors, sectorColor, type ThemeName } from "./palette";
import { TooltipCard, Legend } from "./ChartTooltip";
import { baselineScale } from "./scale";
import { compactNumber } from "../format";
import type { ChartPlan } from "./autoChart";

/** A chart of whatever the agent's SQL returned.
 *
 * The plan comes from `planChart`, which decides whether the rows can be drawn
 * at all. This only renders it, in the same marks and palette as every other
 * chart in the app, so a generated answer does not look like a different
 * product from the built views.
 */
export function ResultChart({ plan, theme }: { plan: ChartPlan; theme: ThemeName }) {
  const names = plan.series.map((s) => s.name);
  const single = plan.series.length === 1;
  const { primary } = emphasisColors(theme);
  const colorOf = (name: string) =>
    single ? primary : sectorColor(name, names, theme) ?? primary;

  // Recharts reads a dataKey as a path, so "a.b" or a name carrying a space
  // would resolve to nothing. The keys are positional and the names are kept
  // beside them for display.
  const data = plan.labels.map((label, i) => {
    const point: Record<string, string | number | null> = { label };
    plan.series.forEach((series, s) => { point[`s${s}`] = series.values[i] ?? null; });
    return point;
  });

  const values = plan.series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const crossesZero = values.some((v) => v < 0) && values.some((v) => v > 0);
  // Bars are read as area from a baseline, so this one axis does start at
  // zero. The ticks are handed over rather than inferred: left to itself the
  // axis divided [-0.12, 0.09] into fifths and labelled them -0.125, -0.05,
  // 0.025 - an axis with no zero on it, under bars drawn from zero.
  const bars = baselineScale(values, 0);

  const tooltip = (
    <Tooltip
      cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, fill: "var(--surface-2)" }}
      content={({ active, payload, label }) =>
        active && payload?.length ? (
          <TooltipCard
            title={String(label)}
            rows={payload.map((entry, i) => ({
              key: String(entry.dataKey ?? i),
              label: names[Number(String(entry.dataKey).slice(1))] ?? "",
              value: entry.value == null ? "—" : compactNumber(Number(entry.value)),
              color: colorOf(names[Number(String(entry.dataKey).slice(1))] ?? ""),
              shape: plan.kind === "line" ? "line" : "dot",
            }))}
          />
        ) : null
      }
    />
  );

  return (
    <figure className="result-chart">
      {plan.kind === "line" ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false} axisLine={{ stroke: "var(--border)" }}
              ticks={dateTicks(plan.labels)} interval="preserveStartEnd" minTickGap={40}
              tickFormatter={(d: string) => d.slice(0, 7)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
              axisLine={false} width={56}
              domain={["auto", "auto"]}
              tickFormatter={compactNumber}
            />
            {crossesZero && <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />}
            {tooltip}
            {plan.series.map((series, s) => (
              <Line
                key={series.name} type="monotone" dataKey={`s${s}`}
                stroke={colorOf(series.name)} strokeWidth={MARK.lineWidth}
                dot={false} connectNulls={false} isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        // Categories run down the side, not along the bottom: "Information
        // Technology" and "Consumer Discretionary" are unreadable rotated, and
        // a horizontal bar grows with the row count instead of squeezing.
        <ResponsiveContainer width="100%" height={Math.min(720, 34 + plan.labels.length * 26)}>
          <BarChart
            data={data} layout="vertical"
            margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
            barCategoryGap={4}
          >
            <CartesianGrid stroke="var(--grid)" strokeWidth={1} horizontal={false} />
            <XAxis
              type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false} axisLine={{ stroke: "var(--border)" }}
              domain={bars.domain} ticks={bars.ticks} tickFormatter={compactNumber}
            />
            <YAxis
              type="category" dataKey="label" width={labelWidth(plan.labels)}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false} axisLine={{ stroke: "var(--border)" }}
              tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
            />
            {tooltip}
            {plan.series.map((series, s) => (
              <Bar
                key={series.name} dataKey={`s${s}`}
                fill={colorOf(series.name)} isAnimationActive={false}
                radius={[0, 2, 2, 0]}
              />
            ))}
            {/* After the bars, not before: this is the line every bar is
                measured from, and drawn first the bars sit on top of it. */}
            {crossesZero && <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />}
          </BarChart>
        </ResponsiveContainer>
      )}

      {!single && (
        <Legend
          items={plan.series.map((s) => ({
            label: s.name,
            color: colorOf(s.name),
            shape: plan.kind === "line" ? "line" : "dot",
          }))}
        />
      )}

      <figcaption className="muted chart-note">
        {single ? plan.series[0]!.name : `${plan.series.length} series`} by {plan.labelColumn}
        {plan.hiddenRows > 0 && ` · first ${plan.labels.length} of ${plan.labels.length + plan.hiddenRows} rows`}
        {plan.omitted.length > 0 && ` · not shown: ${plan.omitted.join(", ")} (different scale)`}
      </figcaption>
    </figure>
  );
}

/** Ticks on month or quarter boundaries. Three years has 36 month boundaries
 *  and the axis carries about a dozen labels before they collide. */
function dateTicks(labels: string[]): string[] {
  if (labels.length === 0) return [];
  const span = (Date.parse(labels[labels.length - 1]!) - Date.parse(labels[0]!)) / 86_400_000;
  const byQuarter = span > 400;
  const ticks: string[] = [];
  let last = "";
  for (const label of labels) {
    const month = Number(label.slice(5, 7));
    const bucket = byQuarter
      ? `${label.slice(0, 4)}-Q${Math.ceil(month / 3)}`
      : label.slice(0, 7);
    if (bucket !== last) {
      ticks.push(label);
      last = bucket;
    }
  }
  return ticks;
}

function labelWidth(labels: string[]): number {
  const longest = labels.reduce((n, l) => Math.max(n, Math.min(22, l.length)), 0);
  return Math.max(56, Math.min(160, longest * 6.6 + 12));
}
