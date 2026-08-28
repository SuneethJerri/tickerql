import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type QueryResponse, type StreamEvent, type Turn } from "../api";
import { formatCell } from "../format";
import { downloadCsv, type CsvCell } from "../csv";
import { Markdown } from "../components/Markdown";
import { tokenizeSql } from "../sqlHighlight";
import { setUrlParams, useUrlOptional } from "../urlState";
import { Card } from "../components/ui";
import { planChart } from "../charts/autoChart";
import { ResultChart } from "../charts/ResultChart";
import type { ThemeName } from "../charts/palette";

const SUGGESTIONS = [
  "Which sector had the highest volatility last year?",
  "What are the five most volatile assets over the last 90 days?",
  "How correlated are Bitcoin and Apple?",
  "Which asset had the worst drawdown in the past year?",
  "Did crypto outperform equities over the last 30 days?",
];

/** Rows rendered in the result table. The API returns up to `max_rows`; showing
 *  every one of a thousand-row result inside a chat turn buries the answer. */
const ROW_DISPLAY_CAP = 50;

interface Exchange {
  id: number;
  question: string;
  /** Present once the answer arrives; null while the turn is still running. */
  result: QueryResponse | null;
  error: string | null;
  events: StreamEvent[];
  elapsedMs: number;
}

export function AskPage({ theme }: { theme: ThemeName }) {
  const [draft, setDraft] = useState("");
  // A question handed over by "Ask about this". Consumed once: copied into the
  // draft and dropped from the URL, so a reload does not re-fill a box the
  // reader has since cleared.
  const handoff = useUrlOptional("q", 400);
  useEffect(() => {
    if (!handoff) return;
    setDraft(handoff);
    setUrlParams({ q: null }, "replace");
  }, [handoff]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [exchanges.length, pending]);

  // Cancel an in-flight request if the page goes away mid-answer.
  useEffect(() => () => abort.current?.abort(), []);

  const submit = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (question.length < 3 || pending) return;

      // Only settled exchanges become memory. A failed turn has no answer to
      // refer back to, and sending the question alone would leave the model
      // looking at an unanswered user turn.
      const history: Turn[] = exchanges
        .filter((e) => e.result)
        .flatMap((e) => [
          { role: "user" as const, content: e.question },
          { role: "assistant" as const, content: e.result!.answer },
        ]);

      const id = Date.now();
      const startedAt = performance.now();
      setDraft("");
      setPending(true);
      setExchanges((prev) => [
        ...prev,
        { id, question, result: null, error: null, events: [], elapsedMs: 0 },
      ]);

      const update = (patch: Partial<Exchange>) =>
        setExchanges((prev) =>
          prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        );

      const controller = new AbortController();
      abort.current = controller;

      try {
        const result = await api.queryStream(
          question,
          history,
          (event) =>
            setExchanges((prev) =>
              prev.map((e) =>
                e.id === id ? { ...e, events: [...e.events, event] } : e,
              ),
            ),
          controller.signal,
        );
        update({ result, elapsedMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        if (controller.signal.aborted) return;
        update({
          error:
            error instanceof ApiError || error instanceof Error
              ? error.message
              : "The request failed.",
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } finally {
        abort.current = null;
        setPending(false);
      }
    },
    [exchanges, pending],
  );

  const unavailable = exchanges.some(
    (e) => e.error?.includes("ANTHROPIC_API_KEY"),
  );

  return (
    <Card
      title="Ask a question"
      subtitle="Your question is turned into SQL and run against a database role that can only read. Every step is reported as it happens, and the SQL is always shown, so the answer can be checked against the query behind it. Follow-ups can refer back to earlier turns."
    >
      {exchanges.length > 0 && (
        <div className="transcript">
          {exchanges.map((exchange) => (
            <ExchangeView key={exchange.id} exchange={exchange} theme={theme} />
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            exchanges.length
              ? "Ask a follow-up…"
              : "e.g. Which sector had the best return per unit of risk?"
          }
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(draft);
            }
          }}
        />
        <button className="btn" type="submit" disabled={pending || draft.trim().length < 3}>
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="suggestions">
        {exchanges.length === 0 ? (
          SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => void submit(s)} disabled={pending}>
              {s}
            </button>
          ))
        ) : (
          <button className="chip" onClick={() => setExchanges([])} disabled={pending}>
            New conversation
          </button>
        )}
      </div>

      {unavailable && (
        <div className="notice ask-notice">
          <strong>Natural-language queries are not configured.</strong>
          <div className="hint muted">Every other view on this dashboard works without it.</div>
        </div>
      )}
    </Card>
  );
}

function ExchangeView({ exchange, theme }: { exchange: Exchange; theme: ThemeName }) {
  const running = !exchange.result && !exchange.error;
  return (
    <div className="exchange">
      <div className="bubble user">{exchange.question}</div>
      <div className="bubble assistant">
        {running ? (
          <Progress events={exchange.events} />
        ) : exchange.error ? (
          <div className="notice error">{exchange.error}</div>
        ) : (
          <Answer result={exchange.result!} events={exchange.events} theme={theme} />
        )}
      </div>
    </div>
  );
}

/** Live progress, driven entirely by events the backend actually emitted.
 *
 * The timer is the one thing computed locally, because a stream that has gone
 * quiet still has to show time passing - that is exactly when a reader wants to
 * know something is happening. Every *step* below corresponds to a real
 * boundary in the agent loop. */
function Progress({ events }: { events: StreamEvent[] }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(
      () => setElapsed(performance.now() - startedAt),
      100,
    );
    return () => window.clearInterval(timer);
  }, []);

  const steps = describe(events);
  const current = steps.length ? steps[steps.length - 1]! : "Connecting…";

  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress-head">
        <span className="pulse" aria-hidden="true" />
        <span className="progress-now">{current}</span>
        <span className="progress-clock">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      {steps.length > 1 && (
        <ol className="progress-steps">
          {steps.slice(0, -1).map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function describe(events: StreamEvent[]): string[] {
  const steps: string[] = [];
  for (const event of events) {
    switch (event.phase) {
      case "thinking":
        steps.push(
          event.of > 1 && event.call > 1
            ? `Thinking again (attempt ${event.call} of ${event.of})`
            : "Reading the question",
        );
        break;
      case "thought":
        steps.push(`Thought for ${(event.ms / 1000).toFixed(1)}s`);
        break;
      case "sql":
        steps.push("Wrote a query");
        break;
      case "guard":
        steps.push(
          event.ok
            ? "Query passed the read-only guard"
            : `Blocked by the guard: ${event.reason ?? "rejected"}`,
        );
        break;
      case "executing":
        steps.push("Running it against the read-only role");
        break;
      case "rows":
        steps.push(
          `${event.row_count} row${event.row_count === 1 ? "" : "s"} in ${event.ms} ms`,
        );
        break;
      case "sql_failed":
        steps.push(`The database rejected it: ${event.message}`);
        break;
      case "retrying":
        steps.push(`Retrying — ${event.reason}`);
        break;
      case "answering":
        steps.push("Writing the answer");
        break;
      default:
        break;
    }
  }
  return steps;
}

function Answer({
  result, events, theme,
}: {
  result: QueryResponse;
  events: StreamEvent[];
  theme: ThemeName;
}) {
  const blocked = result.attempts.filter((a) => !a.accepted);
  const shown = result.rows.slice(0, ROW_DISPLAY_CAP);
  const plan = useMemo(
    () => planChart(result.columns, result.rows),
    [result.columns, result.rows],
  );

  return (
    <div className="answer">
      {/* The prose is the answer; the query, the chart and the table are the
          evidence for it. It is marked as such rather than left as the first
          of five equal-weight blocks. */}
      <div className="answer-lede">
        <Markdown text={result.answer} />
      </div>

      {plan && <ResultChart plan={plan} theme={theme} />}

      {/* Showing that the guard intervened is the point, not an implementation
          detail to hide: it is the visible edge of the security boundary. */}
      {blocked.length > 0 && (
        <div className="notice">
          <strong>
            {blocked.length} generated {blocked.length === 1 ? "query was" : "queries were"} blocked
            before reaching the database.
          </strong>
          <ul>
            {blocked.map((a, i) => (
              <li key={i} className="muted">{a.rejection}</li>
            ))}
          </ul>
        </div>
      )}

      {result.sql && <SqlBlock sql={result.sql} blocked={blocked.length > 0} />}

      {result.columns.length > 0 && (
        <div className="md-table-wrap">
          {/* The export carries every row the API returned, not the 50 shown -
              the display cap exists so the answer is not buried, and silently
              exporting the truncated view would be the wrong kind of helpful. */}
          <button
            className="table-toggle"
            onClick={() =>
              downloadCsv(
                `tickerql-answer-${new Date().toISOString().slice(0, 10)}`,
                result.columns,
                result.rows as CsvCell[][],
              )
            }
          >
            Download CSV ({result.row_count} row{result.row_count === 1 ? "" : "s"})
          </button>
          <div className="table-scroll">
            <table className="data">
            <thead>
              <tr>{result.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="steps">
        <summary>How this was answered</summary>
        <ol className="progress-steps">
          {describe(events).map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </details>

      <p className="muted answer-meta">
        {result.row_count} row{result.row_count === 1 ? "" : "s"}
        {result.row_count > shown.length && ` · ${shown.length} shown`}
        {result.truncated && " · capped by the API"} · {result.model_calls} model call
        {result.model_calls === 1 ? "" : "s"} · {(result.model_ms / 1000).toFixed(1)}s thinking
        of {(result.elapsed_ms / 1000).toFixed(1)}s total
      </p>
    </div>
  );
}

/** The query, always visible.
 *
 * It used to live in a <details>. That framed the one thing this product
 * promises - that an answer can be checked against the query behind it - as an
 * optional disclosure, and an audit trail nobody opens is decoration. The
 * gutter carries the guard's verdict for the same reason: a security boundary
 * that only becomes visible when it fails is invisible exactly when someone
 * wants to be reassured by it.
 */
function SqlBlock({ sql, blocked }: { sql: string; blocked: boolean }) {
  const [copied, setCopied] = useState(false);
  const tokens = tokenizeSql(sql);
  return (
    <div className="sql-artifact">
      <div className="sql-head">
        <span>SQL that produced this answer</span>
        <span className="verdict" data-guard={blocked ? "blocked" : "accepted"}>
          {blocked ? "guard blocked an earlier candidate" : "guard accepted"}
        </span>
        <button
          type="button"
          className="chip copy"
          onClick={() => {
            void navigator.clipboard?.writeText(sql).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Spans, not markup: tokenizeSql returns data and this builds the
          elements, so model output never reaches dangerouslySetInnerHTML. */}
      <pre className="sql-text" data-guard={blocked ? "blocked" : "accepted"}>
        {tokens.map((tok, i) =>
          tok.kind === "txt" ? (
            tok.text
          ) : (
            <span key={i} className={tok.kind}>
              {tok.text}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}
