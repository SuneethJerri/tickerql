import { Explain } from "./AskAbout";
import { Term } from "./Term";

/** A single headline number: when the data is one value, the number is the
 *  chart. Unboxed, because nothing else on the page is boxed. */
export function StatTile({
  label, value, delta, deltaDirection, explain, term,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
  /** A question about how this figure was computed, handed to the agent. */
  explain?: string;
  /** Glossary key. When present the label carries the definition and offers
   *  `explain` from inside it, so one control does both jobs instead of two
   *  sitting side by side on a label that is already the smallest type here. */
  term?: string;
}) {
  return (
    <div className="stat">
      <span className="label">
        {term
          ? <Term name={term} ask={explain}>{label}</Term>
          : <>{label}{explain && <Explain question={explain} of={label} />}</>}
      </span>
      <span className="value">{value}</span>
      {delta && <span className={`delta ${deltaDirection ?? ""}`}>{delta}</span>}
    </div>
  );
}
