import { Fragment, useState } from "react";
import { divergingColor, inkOn, type ThemeName } from "./palette";

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
 *
 * Generic over its labels rather than hardcoding tickers, because the page now
 * shows a sector matrix by default and drills down to tickers. Column headers
 * are set vertically: at 135 tickers the horizontal ones overprinted each other
 * into "CMCSADISGOOGLMETA".
 */
export interface HeatValue {
  correlation: number | null;
  observations: number;
}

export function CorrelationHeatmap({
  labels,
  cellAt,
  theme,
  unit,
  onSelect,
}: {
  labels: string[];
  cellAt: (a: string, b: string) => HeatValue | undefined;
  theme: ThemeName;
  /** What one label names, for the hover readout: "days" or "pairs". */
  unit: string;
  onSelect?: (a: string, b: string) => void;
}) {
  const [hover, setHover] = useState<{ a: string; b: string; v: number | null } | null>(null);
  const wide = labels.some((l) => l.length > 6);

  return (
    <div>
      <div
        // The label column's width is a class, not an inline value. It was
        // briefly an inline custom property, on the theory that a stylesheet
        // cannot override an inline property but can redefine a variable -
        // which is wrong: an inline custom property declaration beats a
        // stylesheet rule on the same element just as any other does, so the
        // narrow-viewport override silently did nothing. A class leaves both
        // widths in CSS where the breakpoint can reach them.
        className={`heatmap${wide ? " wide" : ""}`}
        style={{
          gridTemplateColumns: `var(--heat-label) repeat(${labels.length}, minmax(26px, 1fr))`,
        }}
      >
        <div />
        {labels.map((label) => (
          <div className="heat-axis col" key={`col-${label}`} title={label}>
            <span>{label}</span>
          </div>
        ))}
        {labels.map((rowLabel) => (
          <Row
            key={rowLabel}
            rowLabel={rowLabel}
            labels={labels}
            cellAt={cellAt}
            theme={theme}
            unit={unit}
            onHover={setHover}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="scale-legend">
        {/* The poles are painted from divergingColor, not described in prose.
            The sentence that used to sit here said "Blue = ... red = ..." and
            would have silently lied the moment the scale was rethemed. */}
        {[
          { t: -1, label: "moves oppositely" },
          { t: 0, label: "unrelated" },
          { t: 1, label: "moves together" },
        ].map(({ t, label }) => (
          <span className="scale-key" key={label}>
            <span className="scale-swatch" style={{ background: divergingColor(t, theme) }} />
            {label}
          </span>
        ))}
        <span className="scale-readout">
          {hover ? `${hover.a} vs ${hover.b}: ${hover.v?.toFixed(2) ?? "—"}` : ""}
        </span>
      </div>
    </div>
  );
}

function Row({
  rowLabel, labels, cellAt, theme, unit, onHover, onSelect,
}: {
  rowLabel: string;
  labels: string[];
  cellAt: (a: string, b: string) => HeatValue | undefined;
  theme: ThemeName;
  unit: string;
  onHover: (v: { a: string; b: string; v: number | null } | null) => void;
  onSelect?: (a: string, b: string) => void;
}) {
  return (
    <>
      <div className="heat-axis row" title={rowLabel}>{rowLabel}</div>
      {labels.map((colLabel) => {
        const cell = cellAt(rowLabel, colLabel);
        const value = cell?.correlation ?? null;
        const background = value == null ? "var(--surface-2)" : divergingColor(value, theme);
        const title =
          `${rowLabel} vs ${colLabel}: ${value?.toFixed(3) ?? "no data"} ` +
          `(${cell?.observations ?? 0} ${unit})`;
        const content =
          value == null ? "" : value.toFixed(1).replace(/^0\./, ".").replace(/^-0\./, "-.");

        if (!onSelect) {
          return (
            <div
              key={colLabel} className="heat-cell"
              style={{ background, color: value == null ? "var(--text-muted)" : inkOn(background) }}
              title={title}
              onMouseEnter={() => onHover({ a: rowLabel, b: colLabel, v: value })}
              onMouseLeave={() => onHover(null)}
            >
              {content}
            </div>
          );
        }
        return (
          <button
            key={colLabel} className="heat-cell selectable"
            style={{ background, color: value == null ? "var(--text-muted)" : inkOn(background) }}
            title={`${title} — click to see the assets`}
            onMouseEnter={() => onHover({ a: rowLabel, b: colLabel, v: value })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ a: rowLabel, b: colLabel, v: value })}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(rowLabel, colLabel)}
          >
            {content}
          </button>
        );
      })}
    </>
  );
}


/** The heatmap's own geometry, with nothing in it.
 *
 * A fixed-height block cannot stand in for this. The cells are
 * `aspect-ratio: 1`, so the grid's height is a function of the viewport width
 * and the number of labels - a constant is wrong at every width but one, and
 * the 420px it used to reserve was about a thousand pixels short at 1440,
 * which threw the card below it down the page the moment the matrix landed.
 * Rendering the real grid with empty cells is right at every width.
 *
 * Only the column-header band is approximated: its height comes from vertical
 * text, and this has none.
 *
 * The cells do not shimmer. Three hundred and sixty-one animated gradients is
 * a lot of movement to put on a page that is still loading, and the label
 * ghosts already say the view is waiting.
 */
export function HeatmapSkeleton({ count, wide = false }: { count: number; wide?: boolean }) {
  const slots = Array.from({ length: count }, (_, i) => i);
  return (
    <div
      className={`heatmap${wide ? " wide" : ""}`}
      style={{
        gridTemplateColumns: `var(--heat-label) repeat(${count}, minmax(26px, 1fr))`,
      }}
      role="status"
      aria-label="Loading"
    >
      <div />
      {slots.map((c) => (
        <div className="heat-axis col" key={`ghost-col-${c}`}>
          <span className="skeleton ghost-col" />
        </div>
      ))}
      {slots.map((r) => (
        <Fragment key={`ghost-row-${r}`}>
          <div className="heat-axis row">
            <span className="skeleton ghost-row" />
          </div>
          {slots.map((c) => (
            <div className="heat-cell ghost-cell" key={`ghost-${r}-${c}`} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
