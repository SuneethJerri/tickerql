import { Fragment, type ReactNode } from "react";

/** A small markdown renderer for model answers.
 *
 * Written here rather than pulled in: react-markdown plus remark-gfm is ~100 kB
 * for the six constructs the model actually emits - headings, paragraphs,
 * lists, fenced code, tables, and inline bold/italic/code.
 *
 * It builds React elements and never touches dangerouslySetInnerHTML, so model
 * output cannot inject markup whatever it returns.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence, or end of input
      out.push(
        <pre className="md-code" key={key++}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = (["h3", "h4", "h5", "h6"] as const)[level - 1]!;
      out.push(<Tag key={key++}>{inline(heading[2]!)}</Tag>);
      i += 1;
      continue;
    }

    // A table needs its delimiter row; without it these are just paragraphs
    // that happen to contain pipes, which is a real thing a model writes.
    if (line.trim().startsWith("|") && isDelimiter(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(cells(lines[i]!));
        i += 1;
      }
      out.push(
        <div className="md-table-wrap" key={key++}>
          <table className="data">
            <thead>
              <tr>
                {header.map((h, n) => (
                  <th key={n} scope="col">{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, m) => (
                    <td key={m}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]!)) {
        items.push(lines[i]!.match(pattern)![1]!);
        i += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!, lines[i + 1])) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    if (!paragraph.length) {
      // Defensive: isBlockStart matched the very first line of what we thought
      // was a paragraph. Consume it as one so the loop cannot spin forever.
      paragraph.push(lines[i]!);
      i += 1;
    }
    out.push(<p key={key++}>{inline(paragraph.join(" "))}</p>);
  }

  return out;
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,4}\s/.test(line) ||
    /^\s*[-*+]\s/.test(line) ||
    /^\s*\d+[.)]\s/.test(line) ||
    (line.trim().startsWith("|") && isDelimiter(next))
  );
}

function isDelimiter(line: string | undefined): boolean {
  return !!line && /^\s*\|?[\s:-]*\|[\s|:-]*$/.test(line) && line.includes("-");
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/** Inline spans: **bold**, *italic*, `code`. One pass, so the tokens cannot be
 *  nested - which is fine for the output this renders and keeps the regex from
 *  becoming the kind nobody can read. */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0]!;
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
