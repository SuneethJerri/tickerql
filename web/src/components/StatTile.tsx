/** A single headline number.
 *
 * A one-bar bar chart is an anti-pattern: when the data is one value, the
 * number IS the chart.
 *
 * `boxed` picks which of the two forms it takes. The dashboard's four figures
 * are the page's opening statement, so they run unboxed in a readout strip -
 * label above, figure below, hairline rules between the columns. The asset
 * page's four sit beside a chart in a grid of cards and would look unmoored
 * without their box, so they keep it.
 */
export function StatTile({
  label, value, delta, deltaDirection, boxed = true,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
  boxed?: boolean;
}) {
  return (
    <div className={boxed ? "card stat" : "stat"}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {delta && <span className={`delta ${deltaDirection ?? ""}`}>{delta}</span>}
    </div>
  );
}
