import {
  CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { RiskMetric } from "../api";
import { fmtPct } from "../api";
import { MARK, assetTypeColor, type Mode } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** Risk vs return.
 *
 * Deliberately NOT coloured by sector. A scatter is an all-pairs form: any two
 * points can land side by side, so every pair must clear the separation floors,
 * not just adjacent ones. Five sector hues hard-fail that (magenta vs orange,
 * ΔE 12.9 normal-vision against a floor of 15), and a search of all 56 five-hue
 * subsets of the palette found none that pass in both modes.
 *
 * So identity comes from a direct label on every one of the 16 points - which
 * is stronger than colour anyway - and hue carries the one split that matters
 * most in this data, equities vs crypto. Sector is in the tooltip and the table.
 */
export function RiskReturnScatter({ data, mode }: { data: RiskMetric[]; mode: Mode }) {
  const usable = data.filter(
    (d) => d.annualized_volatility != null && d.annualized_return != null,
  );
  const stocks = usable.filter((d) => d.asset_type === "stock");
  const crypto = usable.filter((d) => d.asset_type === "crypto");

  const toPoint = (d: RiskMetric) => ({
    x: (d.annualized_volatility ?? 0) * 100,
    y: (d.annualized_return ?? 0) * 100,
    ticker: d.ticker,
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
            axisLine={{ stroke: "var(--border)" }} unit="%"
            label={{ value: "Annualised volatility", position: "insideBottom", offset: -16,
                     fontSize: 11.5, fill: "var(--text-secondary)" }}
          />
          <YAxis
            type="number" dataKey="y" name="Annualised return" domain={yDomain}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={false} width={52} unit="%"
            label={{ value: "Annualised return", angle: -90, position: "insideLeft",
                     offset: 12, fontSize: 11.5, fill: "var(--text-secondary)" }}
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
              {/* Every point is labelled: 16 marks is few enough that identity
                  should not depend on hue or on hovering — which is the whole
                  reason this chart does not colour by sector. Text wears a text
                  token, never the series hue. */}
              <LabelList
                dataKey="ticker" position="top" offset={7}
                fontSize={10.5} fontWeight={550} fill="var(--text-secondary)"
              />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}
