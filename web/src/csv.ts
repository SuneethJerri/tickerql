/** CSV export, one implementation. Four call sites means four subtly different
 *  escapers otherwise, one of which forgets quotes and corrupts every sector
 *  name containing a comma. */

export type CsvCell = string | number | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;

/** Excel and Google Sheets execute a cell that opens with one of these. */
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: CsvCell): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  let text = value;
  // Formula injection. The guard is conditional because a legitimate negative
  // number also starts with '-', and prefixing those would turn every drawdown
  // in the file into text.
  if (FORMULA_START.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: CRLF line endings, quotes doubled inside quoted fields. */
export function toCsv(columns: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [columns.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(
  filename: string,
  columns: readonly string[],
  rows: readonly CsvCell[][],
): void {
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage, which otherwise mangles the em dashes and the ₹ in asset names.
  const blob = new Blob(["﻿", toCsv(columns, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same tick cancels the download in Safari and older Chrome.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
