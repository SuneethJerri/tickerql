import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { buildCommands, rankCommands, type Command } from "../commands";
import { setUrlParams } from "../urlState";

/** Jump to any asset, sector or view by typing.
 *
 * Opened with Cmd-K / Ctrl-K, which is the convention, and also from the
 * button in the topbar so the feature is discoverable by people who do not
 * already know the shortcut - a keyboard-only affordance is invisible.
 *
 * The asset list comes from the same `assets` query the dashboard's picker
 * makes, under the same key, so opening this costs no request.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets, enabled: open });
  const commands = useMemo(() => buildCommands(assets.data ?? []), [assets.data]);
  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  // Reopening starts fresh. Leaving the previous query in place means the first
  // keystroke of the next search appends to a word nobody remembers typing.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Where focus was before the dialog took it. Dropping focus on the body
      // when a modal closes strands anyone navigating by keyboard at the top of
      // the document, having lost their place.
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
    } else {
      returnFocusTo.current?.focus?.();
      returnFocusTo.current = null;
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const go = (command: Command) => {
    setUrlParams(command.params, "push");
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = results[active];
      if (chosen) go(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      // The dialog holds exactly one focusable element, so trapping Tab is
      // simply refusing it. Without this, Tab walks out of an open modal and
      // into the page behind it, which is still there and still interactive.
      e.preventDefault();
    }
  };

  return (
    // Clicking the backdrop closes. The dialog stops the propagation so a click
    // inside it - selecting text in the input, say - does not.
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to an asset, a sector or a view…"
          aria-label="Search assets, sectors and views"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((command, i) => (
            <li
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={i === active}
              className={`palette-row${i === active ? " active" : ""}`}
              // mousedown, not click: the input keeps focus and the row fires
              // before the backdrop's own mousedown can close the dialog.
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); go(command); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="palette-label">{command.label}</span>
              {command.detail && <span className="palette-detail">{command.detail}</span>}
              <span className="palette-kind">{command.kind}</span>
            </li>
          ))}
          {!results.length && (
            <li className="palette-row empty">
              {assets.isPending ? "Loading…" : `Nothing matches “${query}”`}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
