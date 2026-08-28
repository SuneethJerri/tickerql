import { Explain } from "./AskAbout";

/** A single headline number: when the data is one value, the number is the
 *  chart. Unboxed, because nothing else on the page is boxed. */
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
