/** Rendering for a cell in an agent result table.
 *
 * The agent writes the SQL, so the columns are whatever it selected and their
 * units are unknown. That rules out the obvious improvement - formatting
 * anything named `*_return` as a percentage - because a column already
 * multiplied by 100 would be shown as 100x its value, confidently and with no
 * way for the reader to tell. The SQL is printed directly above the table; the
 * table's job is to show what the database returned.
 *
 * What it does fix is a real defect. `maximumFractionDigits: 4` rendered any
 * value below 0.00005 as "0", so a query returning a small but non-zero
 * quantity - a daily log return, a p-value, a weight - showed a column of
 * zeroes that looked like missing data rather than small data. Below that
 * threshold the value switches to exponent form, which is the one notation
 * that cannot round a non-zero number to nothing.
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
