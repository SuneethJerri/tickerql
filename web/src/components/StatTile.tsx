import { Explain } from "./AskAbout";

/** A single headline number.
 *
 * A one-bar bar chart is an anti-pattern: when the data is one value, the
 * number IS the chart.
 *
 * There is no boxed variant. There briefly was one, for the asset page's four
 * figures, on the reasoning that they sit beside a chart and would look
 * unmoored without a border. Once the cards below them became ruled sections
 * that argument disappeared - nothing on the page is boxed, so the tiles were
 * the only boxes left and read as leftovers rather than as a decision.
 */
export function StatTile({
  label, value, delta, deltaDirection, explain,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
  /** A question about how this figure was computed, handed to the agent. */
  explain?: string;
}) {
  return (
    <div className="stat">
      <span className="label">
        {label}
        {explain && <Explain question={explain} of={label} />}
      </span>
      <span className="value">{value}</span>
      {delta && <span className={`delta ${deltaDirection ?? ""}`}>{delta}</span>}
    </div>
  );
}
