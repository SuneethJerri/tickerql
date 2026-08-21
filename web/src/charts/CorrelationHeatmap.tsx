import { useState } from "react";
import type { CorrelationMatrix } from "../api";
import { divergingColor, inkOn, type Mode } from "./palette";

/** Correlation heatmap on a diverging scale.
 *
 * Correlation is polar data (-1 .. +1 with a meaningful zero), which is exactly
 * the job diverging colour exists for: two hues that read as opposite, and a
 * NEUTRAL GRAY midpoint so "uncorrelated" reads as nothing rather than as a
 * third category. A sequential ramp here would imply -1 and +1 are opposite
 * ends of one magnitude, which is wrong - they are equally strong, oppositely
 * signed.
 *
 * Built with CSS grid rather than Recharts: a matrix of labelled cells is a
 * table that happens to be coloured, and the grid gives exact 2px surface gaps
 * and real text nodes for screen readers.
 */
export function CorrelationHeatmap({ matrix, mode }: { matrix: CorrelationMatrix; mode: Mode }) {
  const [hover, setHover] = useState<{ a: string; b: string; v: number | null } | null>(null);
  const tickers = matrix.tickers;
  const lookup = new Map(matrix.cells.map((c) => [`${c.ticker_a}|${c.ticker_b}`, c]));

  return (
    <div>
      <div
        className="heatmap"
        style={{ gridTemplateColumns: `44px repeat(${tickers.length}, minmax(26px, 1fr))` }}
      >
        <div />
        {tickers.map((t) => (
          <div className="heat-axis" key={`col-${t}`}>{t}</div>
        ))}
        {tickers.map((rowTicker) => (
          <Row key={rowTicker} rowTicker={rowTicker} tickers={tickers}
               lookup={lookup} mode={mode} onHover={setHover} />
        ))}
      </div>

      <div className="scale-legend" aria-hidden="true">
        <span>−1</span>
        <span
          className="scale-bar"
          style={{
            background: `linear-gradient(90deg, ${divergingColor(-1, mode)}, ${divergingColor(0, mode)}, ${divergingColor(1, mode)})`,
          }}
        />
        <span>+1</span>
        <span style={{ marginLeft: 8 }}>
          {hover
            ? `${hover.a} vs ${hover.b}: ${hover.v?.toFixed(2) ?? "—"}`
            : "Blue = moves oppositely · gray = unrelated · red = moves together"}
        </span>
      </div>
    </div>
  );
}

function Row({
  rowTicker, tickers, lookup, mode, onHover,
}: {
  rowTicker: string;
  tickers: string[];
  lookup: Map<string, { correlation: number | null; observations: number }>;
  mode: Mode;
  onHover: (v: { a: string; b: string; v: number | null } | null) => void;
}) {
  return (
    <>
      <div className="heat-axis row">{rowTicker}</div>
      {tickers.map((colTicker) => {
        const cell = lookup.get(`${rowTicker}|${colTicker}`);
        const value = cell?.correlation ?? null;
        const background = value == null ? "var(--surface-2)" : divergingColor(value, mode);
        return (
          <div
            key={colTicker} className="heat-cell"
            style={{ background, color: value == null ? "var(--text-muted)" : inkOn(background) }}
            title={`${rowTicker} vs ${colTicker}: ${value?.toFixed(3) ?? "no data"} (${cell?.observations ?? 0} shared days)`}
            onMouseEnter={() => onHover({ a: rowTicker, b: colTicker, v: value })}
            onMouseLeave={() => onHover(null)}
          >
            {value == null ? "" : value.toFixed(1).replace(/^0\./, ".").replace(/^-0\./, "-.")}
          </div>
        );
      })}
    </>
  );
}
