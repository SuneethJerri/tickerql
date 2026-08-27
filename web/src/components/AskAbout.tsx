import { setUrlParams } from "../urlState";

/** Hand a question to the agent, without running it.
 *
 * It does NOT submit. The question is a starting point the reader is expected
 * to edit, and auto-running it would spend a model call - and the rate limit -
 * on a question nobody asked for. It also fills the transcript with queries the
 * reader did not write, which makes the history useless as a record of what
 * they wanted to know.
 */
export function askAgent(question: string) {
  setUrlParams({ tab: "ask", q: question }, "push");
}

/** Hand the current view to the agent.
 *
 * This is the one control that is specific to this product rather than to
 * dashboards in general. Every analytics tool has drill-downs; this one has an
 * auditable text-to-SQL layer sitting one tab away, and without a bridge the
 * two halves are separate apps that happen to share a header. The bridge is
 * cheap: put a real question in the box and switch tabs.
 */
export function AskAbout({ question, label = "Ask about this" }: { question: string; label?: string }) {
  return (
    <button
      type="button"
      className="ask-about"
      title={question}
      onClick={() => askAgent(question)}
    >
      {label}
    </button>
  );
}

/** The same bridge, sized for a single figure.
 *
 * A headline number is the least auditable thing on a dashboard: it arrives
 * with no working shown, and the reader either trusts it or does not. The
 * questions this sends are deliberately about the *inputs* - the standard
 * deviation, the peak and the trough, the count of observations - because
 * "select the volatility column" restates the number rather than explaining it.
 *
 * `?` rather than an "explain" word: eight of these sit in a four-column
 * readout where the labels are already the smallest type on the page, and a
 * second word per column turns a readout into a toolbar.
 */
export function Explain({ question, of }: { question: string; of: string }) {
  return (
    <button
      type="button"
      className="explain"
      title={question}
      aria-label={`Explain how ${of} is computed`}
      onClick={() => askAgent(question)}
    >
      ?
    </button>
  );
}
