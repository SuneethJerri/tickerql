/** A tokeniser for the generated SQL, small enough to read in one sitting.
 *
 * Not a dependency: highlight.js with only its SQL grammar is ~30 kB for one
 * read-only `<pre>`, and Prism wants a plugin to avoid innerHTML. The four
 * classes below are all this page can usefully distinguish, and the guard has
 * already proved the string is a single SELECT before it ever gets here.
 *
 * Returns tokens rather than markup on purpose. The caller builds React
 * elements from them, so — like Markdown.tsx — model output never reaches
 * `dangerouslySetInnerHTML` and cannot inject markup whatever it returns.
 */

export type TokenKind = "kw" | "lit" | "id" | "cm" | "txt";
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

/** Reserved words the agent's SQL can actually contain. Deliberately not the
 *  full Postgres list: a word highlighted as a keyword in one query and as an
 *  identifier in the next is worse than one that is never highlighted. */
const KEYWORDS = new Set([
  "select", "from", "where", "group", "by", "order", "having", "limit", "offset",
  "join", "inner", "left", "right", "full", "outer", "cross", "on", "using",
  "with", "as", "and", "or", "not", "in", "is", "null", "distinct", "all",
  "case", "when", "then", "else", "end", "between", "like", "ilike", "asc",
  "desc", "union", "intersect", "except", "over", "partition", "filter",
  "interval", "cast", "exists", "any", "some", "nulls", "first", "last",
]);

/** Aggregates and the handful of functions the prompt steers the model toward.
 *  These wear the identifier colour rather than the keyword one — they name
 *  something in the schema's vocabulary, not the language's. */
const FUNCTIONS = new Set([
  "avg", "sum", "count", "min", "max", "abs", "round", "coalesce", "stddev",
  "stddev_samp", "stddev_pop", "corr", "rank", "dense_rank", "row_number",
  "percentile_cont", "date_trunc", "extract", "greatest", "least", "nullif",
]);

// One pass, longest-match-first. Order matters: a comment opens with `--`,
// which would otherwise tokenise as two operators, and a quoted string can
// contain any of the other patterns.
const PATTERN = new RegExp(
  [
    "(--[^\\n]*)", // 1 line comment
    "(/\\*[\\s\\S]*?\\*/)", // 2 block comment
    "('(?:[^']|'')*')", // 3 string literal, '' being an escaped quote
    '("(?:[^"]|"")*")', // 4 quoted identifier
    "(\\b\\d+(?:\\.\\d+)?\\b)", // 5 number
    "([A-Za-z_][A-Za-z0-9_$]*)", // 6 word
  ].join("|"),
  "g",
);

export function tokenizeSql(sql: string): Token[] {
  const out: Token[] = [];
  let last = 0;

  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    // Merge runs of the same kind so a long query does not become a long list
    // of one-character spans.
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) out[out.length - 1] = { kind, text: prev.text + text };
    else out.push({ kind, text });
  };

  for (const m of sql.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    push("txt", sql.slice(last, at));
    last = at + m[0].length;

    if (m[1] || m[2]) push("cm", m[0]);
    else if (m[3] || m[5]) push("lit", m[0]);
    else if (m[4]) push("id", m[0]);
    else {
      const word = m[0].toLowerCase();
      if (KEYWORDS.has(word)) push("kw", m[0]);
      else if (FUNCTIONS.has(word)) push("id", m[0]);
      else push("txt", m[0]);
    }
  }
  push("txt", sql.slice(last));
  return out;
}
