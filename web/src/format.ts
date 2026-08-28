/** Rendering for a cell in an agent result table.
 *
 * The agent writes the SQL, so the columns are whatever it selected and their
 * units are unknown. That rules out formatting a `*_return` column as a
 * percentage: a column already multiplied by 100 would be shown as 100x its
 * value with no way for the reader to tell.
 *
 * `maximumFractionDigits: 4` renders anything below 0.00005 as "0", so a small
 * but non-zero quantity showed as a column of zeroes that looked like missing
 * data. Below that threshold the value switches to exponent form, which cannot
 * round a non-zero number to nothing.
 */
export function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value !== "number") return String(value);
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toLocaleString("en");

  const magnitude = Math.abs(value);
  if (magnitude < 0.0001) return value.toExponential(2);
  return value.toLocaleString("en", { maximumFractionDigits: 4 });
}

/** Short form for an axis tick or a tooltip, where width is the constraint.
 *
 * Precision scales with magnitude because the same axis has to serve a column
 * of daily returns and a column of trading volume. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${trim(value / 1e9, 1)}B`;
  if (magnitude >= 1e6) return `${trim(value / 1e6, 1)}M`;
  if (magnitude >= 1e4) return `${trim(value / 1e3, 0)}k`;
  if (magnitude === 0) return "0";
  if (magnitude < 0.001) return value.toExponential(1);
  if (magnitude < 1) return trim(value, 3);
  if (magnitude < 100) return trim(value, 2);
  return value.toLocaleString("en", { maximumFractionDigits: 0 });
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}
