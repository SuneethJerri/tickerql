import { setUrlParams } from "../urlState";

/** Hand the current view to the agent.
 *
 * This is the one control that is specific to this product rather than to
 * dashboards in general. Every analytics tool has drill-downs; this one has an
 * auditable text-to-SQL layer sitting one tab away, and without a bridge the
 * two halves are separate apps that happen to share a header. The bridge is
 * cheap: put a real question in the box and switch tabs.
 *
 * It does NOT submit. The question is a starting point the reader is expected
 * to edit, and auto-running it would spend a model call - and the rate limit -
 * on a question nobody asked for. It also fills the transcript with queries the
 * reader did not write, which makes the history useless as a record of what
 * they wanted to know.
 */
export function AskAbout({ question, label = "Ask about this" }: { question: string; label?: string }) {
  return (
    <button
      type="button"
      className="ask-about"
      title={question}
      onClick={() => setUrlParams({ tab: "ask", q: question }, "push")}
    >
      {label}
    </button>
  );
}
