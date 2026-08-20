import { useState, type ReactNode } from "react";

/** Collapsible table beneath a chart.
 *
 * Required, not optional: three of the five light-mode categorical slots sit
 * below 3:1 against the surface, and the validator's contrast WARN obliges
 * relief — visible labels or a table view. It is also the honest fallback for
 * anyone who cannot use the chart at all.
 */
export function TableView({
  columns,
  rows,
  label = "table",
}: {
  columns: string[];
  rows: (ReactNode[])[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="table-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} {label}
      </button>
      {open && (
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {(row as ReactNode[]).map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
