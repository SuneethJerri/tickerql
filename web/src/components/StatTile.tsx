/** A single headline number.
 *
 * A one-bar bar chart is an anti-pattern: when the data is one value, the
 * number IS the chart.
 */
export function StatTile({
  label, value, delta, deltaDirection,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
}) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {delta && <span className={`delta ${deltaDirection ?? ""}`}>{delta}</span>}
    </div>
  );
}
