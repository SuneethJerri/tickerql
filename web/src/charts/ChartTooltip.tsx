/** Shared tooltip.
 *
 * Values wear text tokens, never the series colour - identity comes from the
 * key beside the label. Colouring the number itself would drop contrast and
 * make the figure the weakest thing in the row.
 */
export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color?: string;
  shape?: "line" | "dot";
}

export function TooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="tooltip" role="tooltip">
      <div className="tt-title">{title}</div>
      {rows.map((row) => (
        <div className="tt-row" key={row.key}>
          <span className="tt-name">
            {row.color && (
              <span
                className={`legend-key${row.shape === "dot" ? " dot" : ""}`}
                style={{ background: row.color }}
              />
            )}
            {row.label}
          </span>
          <span className="tt-val">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; shape?: "line" | "dot" }[];
}) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span
            className={`legend-key${item.shape === "dot" ? " dot" : ""}`}
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
