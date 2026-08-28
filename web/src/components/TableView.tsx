import { useState, type ReactNode } from "react";
import { downloadCsv, type CsvCell } from "../csv";

/** One column, defined once and used twice: `value` is both the exported value
 *  and the default rendering, so the CSV cannot drift from the table. */
export interface Column<T> {
  header: string;
  value: (row: T) => CsvCell;
  /** Richer rendering for the table only - a swatch, a link. Never exported. */
  cell?: (row: T) => ReactNode;
  /** Left-align a text column; numbers stay right-aligned. */
  align?: "left";
}

/** Collapsible table beneath a chart: the fallback for anyone who cannot use
 *  the chart at all, and where the CSV export lives. */
export function TableView<T>({
  columns,
  data,
  label = "table",
  filename,
}: {
  columns: Column<T>[];
  data: readonly T[];
  label?: string;
  /** Base name for the exported file, without the extension. */
  filename: string;
}) {
  const [open, setOpen] = useState(false);

  // The export is offered whether or not the table is expanded: it is the data,
  // not the view of it.
  const exportCsv = () =>
    downloadCsv(
      filename,
      columns.map((c) => c.header),
      data.map((row) => columns.map((c) => c.value(row))),
    );

  return (
    <>
      <div className="table-actions">
        <button className="table-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Show"} {label}
        </button>
        <button className="table-toggle" onClick={exportCsv} disabled={!data.length}>
          Download CSV
        </button>
      </div>
      {open && (
        <div className="md-table-wrap">
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.header}
                    scope="col"
                    className={c.align === "left" ? "align-left" : undefined}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.header} className={c.align === "left" ? "align-left" : undefined}>
                      {c.cell ? c.cell(row) : renderValue(c.value(row))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function renderValue(value: CsvCell): ReactNode {
  if (value == null) return "—";
  return typeof value === "number" ? value.toLocaleString("en") : value;
}
