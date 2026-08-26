import {
  CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { RiskMetric } from "../api";
import { fmtPct } from "../api";
import { MARK, assetTypeColor, type ChartBase } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** Evenly spaced ticks inside a domain.
 *
 * Recharts, handed an explicit domain, pins both endpoints and rounds only the
 * interior. On a [-120, 230] return domain that produced 230 / 60 / -30 / -120
 * - three gaps of 90 and one of 170, which reads as an axis with a mistake in
 * it rather than as a scale. DrawdownChart already worked around this with
 * explicit ticks; the scatter did not, and its domain moves with the window so
 * the defect appears and disappears with the data.
 *
 * The endpoints are deliberately not forced into the tick list: they are
 * padding, not readings, and labelling them is what forced the uneven gap.
 */
function evenTicks([lo, hi]: [number, number], intervals = 4): number[] {
  const raw = (hi - lo) / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step / 1e6; v += step) {
    // Binary floating point: 0.1 steps accumulate visible dust by the tenth.
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** Risk vs return.
 *
 * Deliberately NOT coloured by sector. A scatter is an all-pairs form: any two
 * points can land side by side, so every pair must clear the separation floors,
 * not just adjacent ones. Five sector hues hard-fail that (magenta vs orange,
 * ΔE 12.9 normal-vision against a floor of 15), and a search of all 56 five-hue
 * subsets of the palette found none that pass in both modes.
 *
 * Hue therefore carries the one split that matters most in this data, equities
 * vs crypto, and identity comes from labels.
 *
 * At 16 assets every point was labelled. At 135 that printed one solid block of
 * overlapping text in the middle of the plot - the labels stopped being
 * identity and became noise. Only the extremes are labelled now: the corners a
 * reader actually asks about. Everything else is hover plus the table.
 */
export function RiskReturnScatter({ data, mode }: { data: RiskMetric[]; mode: ChartBase }) {
  const usable = data.filter(
    (d) => d.annualized_volatility != null && d.annualized_return != null,
  );
  const stocks = usable.filter((d) => d.asset_type === "stock");
  const crypto = usable.filter((d) => d.asset_type === "crypto");

  const toPoint = (d: RiskMetric) => ({
    x: (d.annualized_volatility ?? 0) * 100,
    y: (d.annualized_return ?? 0) * 100,
    ticker: d.ticker,
    label: labelled.has(d.ticker) ? d.ticker : "",
    name: d.name,
    sector: d.sector,
    drawdown: d.max_drawdown,
    ratio: d.return_per_unit_risk,
  });

  // Pad the domains rather than letting Recharts fit tight to the data: a point
  // sitting on the top edge has its label clipped, and a label that will not fit
  // must not be silently cut off.
  const xs = usable.map((d) => (d.annualized_volatility ?? 0) * 100);
  const ys = usable.map((d) => (d.annualized_return ?? 0) * 100);
  // Round out to a multiple of 10 so the axis lands on readable ticks rather
  // than whatever the padded extent happens to be (-73%, 17%, 98%...).
  const pad = (values: number[], fraction: number): [number, number] => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const room = Math.max((hi - lo) * fraction, 4);
    const step = 10;
    return [
      Math.floor((lo - room) / step) * step,
      Math.ceil((hi + room) / step) * step,
    ];
  };
  const xDomain = pad(xs, 0.08);
  // More headroom vertically: labels sit above their marks.
  const yDomain = pad(ys, 0.14);
  const xTicks = evenTicks(xDomain);
  const yTicks = evenTicks(yDomain);

  // The points worth naming: best and worst return per unit of risk, the
  // calmest and the wildest, and the single best and worst return. Six
  // questions, at most six labels, chosen from the data rather than by index
  // so the set moves when the window does.
  const labelled = new Set<string>();
  const extremesOf = (
    key: (d: RiskMetric) => number | null | undefined,
  ) => {
    const ranked = usable
      .filter((d) => key(d) != null && Number.isFinite(key(d) as number))
      .sort((a, b) => (key(b) as number) - (key(a) as number));
    if (ranked[0]) labelled.add(ranked[0].ticker);
    if (ranked.at(-1)) labelled.add(ranked.at(-1)!.ticker);
  };
  extremesOf((d) => d.return_per_unit_risk);
  extremesOf((d) => d.annualized_volatility);
  extremesOf((d) => d.annualized_return);

  return (
    <>
      <Legend
        items={[
          { label: "Equities", color: assetTypeColor("stock", mode), shape: "dot" },
          { label: "Crypto", color: assetTypeColor("crypto", mode), shape: "dot" },
        ]}
      />
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 18, right: 30, bottom: 28, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            type="number" dataKey="x" name="Annualised volatility" domain={xDomain}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={{ stroke: "var(--border)" }} unit="%" ticks={xTicks}
            label={{ value: "Annualised volatility", position: "insideBottom", offset: -16,
                     fontSize: 11.5, fill: "var(--text-secondary)" }}
          />
          <YAxis
            type="number" dataKey="y" name="Annualised return" domain={yDomain}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            // Wide enough for the rotated axis title AND the tick text beside
            // it. At width 52 / offset 12 the two overlapped: the ticks are
            // right-aligned to the axis, so they run back from x=52 to about
            // x=18, while the rotated title sits centred on x=12 and is ~14px
            // wide once turned. "200%" was printed straight through the "A" of
            // "Annualised". Rule of thumb: width > offset + tick text width + a
            // gap, which the 64/6 below clears by 17px.
            axisLine={false} width={64} unit="%" ticks={yTicks}
            label={{ value: "Annualised return", angle: -90, position: "insideLeft",
                     offset: 6, fontSize: 11.5, fill: "var(--text-secondary)" }}
          />
          <ZAxis range={[70, 70]} />
          {/* Break-even: above this line an asset made money, below it lost. */}
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload;
              return (
                <TooltipCard
                  title={`${p.ticker} · ${p.name}`}
                  rows={[
                    { key: "sector", label: "Sector", value: p.sector },
                    { key: "vol", label: "Volatility", value: `${p.x.toFixed(1)}%` },
                    { key: "ret", label: "Return", value: `${p.y.toFixed(1)}%` },
                    { key: "ratio", label: "Return / risk", value: p.ratio?.toFixed(2) ?? "—" },
                    { key: "dd", label: "Max drawdown", value: fmtPct(p.drawdown) },
                  ]}
                />
              );
            }}
          />
          {[
            { rows: stocks, type: "stock" as const },
            { rows: crypto, type: "crypto" as const },
          ].map(({ rows, type }) => (
            <Scatter
              key={type} data={rows.map(toPoint)} fill={assetTypeColor(type, mode)}
              // 2px surface ring keeps overlapping points legible.
              stroke="var(--surface-1)" strokeWidth={MARK.surfaceRing}
              isAnimationActive={false}
            >
              {/* Only the extremes carry a label; the rest have an empty
                  string, which renders nothing. Text wears a text token,
                  never the series hue. */}
              <LabelList
                dataKey="label" position="top" offset={7}
                fontSize={10.5} fontWeight={600} fill="var(--text-primary)"
                // A halo in the surface colour. The labelled points are the
                // extremes, but "calmest" and "worst return per unit of risk"
                // can still land inside the crowded middle, where the bare
                // text was drawn straight over its own mark and its
                // neighbours'. Stroke first, fill over it.
                stroke="var(--surface-1)" strokeWidth={3}
                style={{ paintOrder: "stroke" }}
              />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}
