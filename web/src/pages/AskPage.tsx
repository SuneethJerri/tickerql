import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api, type QueryResponse } from "../api";
import { Card } from "../components/ui";

const SUGGESTIONS = [
  "Which sector had the highest volatility last year?",
  "What are the five most volatile assets over the last 90 days?",
  "How correlated are Bitcoin and Apple?",
  "Which asset had the worst drawdown in the past year?",
  "Did crypto outperform equities over the last 30 days?",
];

export function AskPage() {
  const [question, setQuestion] = useState("");
  const ask = useMutation<QueryResponse, unknown, string>({
    mutationFn: (q: string) => api.query(q),
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    setQuestion(trimmed);
    ask.mutate(trimmed);
  };

  const unavailable = ask.error instanceof ApiError && ask.error.status === 503;

  return (
    <Card
      title="Ask a question"
      subtitle="Your question is turned into SQL and run against a database role that can only read. The generated SQL is always shown, so the answer can be checked against the query behind it."
    >
      <form
        className="ask-form"
        onSubmit={(e) => { e.preventDefault(); submit(question); }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which sector had the best return per unit of risk?"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question);
          }}
        />
        <button className="btn" type="submit" disabled={ask.isPending || question.trim().length < 3}>
          {ask.isPending ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => submit(s)} disabled={ask.isPending}>
            {s}
          </button>
        ))}
      </div>

      {unavailable && (
        <div className="notice" style={{ marginTop: 16 }}>
          <strong>Natural-language queries are not configured.</strong>
          <div style={{ marginTop: 4 }}>{(ask.error as ApiError).message}</div>
          <div style={{ marginTop: 8 }} className="muted">
            Every other view on this dashboard works without it.
          </div>
        </div>
      )}

      {ask.error != null && !unavailable && (
        <div className="notice error" style={{ marginTop: 16 }}>
          {ask.error instanceof Error ? ask.error.message : "The request failed."}
        </div>
      )}

      {ask.data && <Answer result={ask.data} />}
    </Card>
  );
}

function Answer({ result }: { result: QueryResponse }) {
  const blocked = result.attempts.filter((a) => !a.accepted);
  return (
    <div className="answer">
      <p>{result.answer}</p>

      {/* Showing that the guard intervened is the point, not an implementation
          detail to hide — it is the visible edge of the security boundary. */}
      {blocked.length > 0 && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <strong>{blocked.length} generated {blocked.length === 1 ? "query was" : "queries were"} blocked before reaching the database.</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {blocked.map((a, i) => (
              <li key={i} className="muted">{a.rejection}</li>
            ))}
          </ul>
        </div>
      )}

      {result.sql && (
        <details className="sql" open>
          <summary>SQL that produced this answer</summary>
          <pre className="sql-text">{result.sql}</pre>
        </details>
      )}

      {result.columns.length > 0 && (
        <table className="data">
          <thead>
            <tr>{result.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.slice(0, 50).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell == null ? "—" : typeof cell === "number" ? cell.toLocaleString("en", { maximumFractionDigits: 4 }) : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
        {result.row_count} row{result.row_count === 1 ? "" : "s"}
        {result.truncated && " (capped)"} · {result.model_calls} model call
        {result.model_calls === 1 ? "" : "s"} · {result.elapsed_ms} ms
      </p>
    </div>
  );
}
