import {
  CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Scatter,
  ComposedChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { Beta, BetaPoint } from "../api";
import { MARK, assetTypeColor, emphasisColors, type ThemeName } from "./palette";
import { Legend, TooltipCard } from "./ChartTooltip";

/** One asset's daily return against its market's, with the fitted line.
 *
 * A beta is a slope, and a slope alone cannot say whether the points it was
 * fitted to form a tight band or a shapeless cloud. Those are very different
 * claims about the same asset - a beta of 1.3 through a tight band means the
 * market moves it, the same 1.3 through a cloud means the fit found almost
 * nothing - and the only honest way to tell them apart is to draw the points.
 *
 * The line is drawn from the reported beta and alpha rather than refitted
 * here, so what is drawn is what the table says.
 *
 * The axes are scaled independently, which was NOT the first attempt. Sharing
 * one symmetric range so that a beta could be read off the picture as an angle
 * sounds right and is unusable in practice: the market series is an average of
 * ninety-odd assets, so its daily range is several times narrower than any
 * single asset's, and equal scales squeeze every cloud into an unreadable blob
 * in the middle of an empty plot.
 *
 * The comparison the shared scale was meant to give comes back as a second
 * line instead. A dashed reference at beta = 1 is what "moves exactly with the
 * market" looks like on THESE axes, and whether the fitted line is steeper or
 * shallower than it is the reading. Both lines are transformed by the same
 * scaling, so that comparison stays true however the axes are stretched.
 */

function niceStep(span: number): number {
  const raw = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

export function BetaScatter({
  fit,
  points,
  theme,
}: {
  fit: Beta;
  points: BetaPoint[];
  theme: ThemeName;
}) {
  const { context } = emphasisColors(theme);
  const markColor = assetTypeColor(fit.asset_type, theme);

  const data = points.map((p) => ({
    x: p.market_return * 100,
    y: p.asset_return * 100,
    date: p.date,
  }));

  // Each axis gets the room its own data needs. Symmetric about zero, because
  // zero is the reading both axes are taken against.
  const axis = (values: number[]) => {
    const extent = Math.max(...values.map(Math.abs), 0.5);
    const step = niceStep(extent * 2);
    const bound = Math.ceil((extent * 1.06) / step) * step;
    const ticks: number[] = [];
    for (let v = -bound; v <= bound + step / 1e6; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return { domain: [-bound, bound] as [number, number], ticks, bound };
  };
  const xAxis = axis(data.map((d) => d.x));
  const yAxis = axis(data.map((d) => d.y));

  // The fitted line, as two endpoints. alpha is annualised for reading, so it
  // is brought back to a daily intercept for drawing.
  const periods = fit.asset_type === "crypto" ? 365 : 252;
  const alphaDaily = (fit.alpha_annualized ?? 0) / periods;
  const beta = fit.beta ?? 0;
  // x is already in per cent, so beta * x stays in per cent; only the
  // intercept has to be scaled into the same unit.
  const line = [-xAxis.bound, xAxis.bound].map((x) => ({
    x,
    fit: alphaDaily * 100 + beta * x,
    // What beta = 1 looks like on these axes: the asset moving exactly as much
    // as its market, every day. Steeper than this line means it amplifies.
    unit: x,
  }));

  return (
    <>
      <Legend
        items={[
          { label: "Trading days", color: markColor, shape: "dot" },
          { label: `Fitted line, beta ${beta.toFixed(2)}`, color: context[0]!, shape: "line" },
          { label: "Moving exactly with the market, beta 1", color: context[1] ?? context[0]!, shape: "line" },
        ]}
      />
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart margin={{ top: 12, right: 24, bottom: 30, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            type="number" dataKey="x" domain={xAxis.domain} ticks={xAxis.ticks} unit="%"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={{ stroke: "var(--border)" }} allowDuplicatedCategory={false}
            label={{
              value: `${fit.market}, daily return`, position: "insideBottom", offset: -18,
              fontSize: 11.5, fill: "var(--text-secondary)",
            }}
          />
          <YAxis
            type="number" dataKey="y" domain={yAxis.domain} ticks={yAxis.ticks} unit="%"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false}
            axisLine={false} width={56}
            label={{
              value: `${fit.ticker}, daily return`, angle: -90, position: "insideLeft",
              offset: 6, fontSize: 11.5, fill: "var(--text-secondary)",
            }}
          />
          <ZAxis range={[42, 42]} />
          <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload;
              if (p.date == null) return null;
              return (
                <TooltipCard
                  title={p.date}
                  rows={[
                    { key: "m", label: fit.market, value: `${p.x.toFixed(2)}%` },
                    { key: "a", label: fit.ticker, value: `${p.y.toFixed(2)}%` },
                  ]}
                />
              );
            }}
          />
          <Scatter
            data={data} fill={markColor} fillOpacity={0.62}
            stroke="var(--surface-1)" strokeWidth={1} isAnimationActive={false}
          />
          {/* Reference first, fit over it: where they nearly coincide, the
              statement being made is about the fitted line. */}
          <Line
            data={line} dataKey="unit" type="linear" dot={false} isAnimationActive={false}
            stroke={context[1] ?? context[0]} strokeWidth={MARK.contextLineWidth}
            strokeDasharray="5 4" legendType="none"
          />
          <Line
            data={line} dataKey="fit" type="linear" dot={false} isAnimationActive={false}
            stroke={context[0]} strokeWidth={MARK.lineWidth} legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
