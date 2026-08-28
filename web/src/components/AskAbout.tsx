import { setUrlParams } from "../urlState";

/** Hand a question to the agent without running it. Auto-submitting would
 *  spend a model call, and the rate limit, on a question nobody asked for, and
 *  fill the transcript with queries the reader did not write. */
export function askAgent(question: string) {
  setUrlParams({ tab: "ask", q: question }, "push");
}

/** Hand the current view to the agent. Without a bridge the dashboard and the
 *  text-to-SQL layer are two apps sharing a header. */
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
 * The questions it sends are about the figure's *inputs* - the standard
 * deviation, the peak and the trough, the observation count - because "select
 * the volatility column" restates the number rather than explaining it.
 *
 * `?` rather than a word: eight of these sit in a four-column readout whose
 * labels are already the smallest type on the page.
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
