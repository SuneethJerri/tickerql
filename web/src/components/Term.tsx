import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { define } from "../glossary";
import { askAgent } from "./AskAbout";

/** A label that explains itself.
 *
 * Two tiers, because the questions are different. "What is volatility" has one
 * fixed answer and is served from the glossary instantly and for free. "Why is
 * THIS number what it is" needs the data, and only that one goes to the agent,
 * so a reader learning the vocabulary never spends a model call or the rate
 * limit doing it.
 *
 * The panel is portalled to the body and positioned from the button's own
 * rect. Every place a term appears - table headers above all - sits inside a
 * container with `overflow: auto`, which would clip an absolutely positioned
 * child to the scrollport and cut the definition in half.
 */
/** Below this the panel is not worth opening downward; flip instead. */
const MIN_PANEL = 240;
/** Above this a definition is long enough to scroll rather than fill the page. */
const MAX_PANEL = 460;

export function Term({
  name,
  children,
  ask,
}: {
  /** Key into the glossary. An unknown key renders the label alone. */
  name: string;
  children: React.ReactNode;
  /** Question about this particular figure, handed to the agent on request. */
  ask?: string;
}) {
  const definition = define(name);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<
    { left: number; maxHeight: number; top?: number; bottom?: number } | null
  >(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 24);
    // Prefer left-aligned under the button, then pull back inside the viewport.
    // A term in the last column would otherwise open off the right edge.
    const left = Math.min(
      Math.max(12, rect.left - 8),
      window.innerWidth - width - 12,
    );
    // Open into whichever side has room, and cap the panel to the room it got.
    // Both are computed from the button's rect alone: anchoring the flipped
    // panel by `bottom` rather than a derived `top` means neither branch needs
    // the height of a panel that has not been rendered yet.
    const GAP = 8;
    const EDGE = 12;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const flip = below < MIN_PANEL && above > below;
    const room = Math.max(MIN_PANEL, flip ? above : below);
    setAt({
      left,
      maxHeight: Math.min(MAX_PANEL, room),
      ...(flip
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Scroll and resize move the anchor out from under a fixed panel, and
    // recomputing on scroll would fight the reader. Closing is the honest
    // response to the anchor having moved.
    const onMove = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  if (!definition) return <>{children}</>;

  return (
    <>
      <button
        ref={button}
        type="button"
        className="term"
        aria-expanded={open}
        aria-label={`What is ${definition.term}?`}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        <span className="term-mark" aria-hidden="true">?</span>
      </button>

      {open && at && createPortal(
        <div
          ref={panel}
          className="term-panel"
          role="dialog"
          aria-label={definition.term}
          style={{
            left: at.left, top: at.top, bottom: at.bottom, maxHeight: at.maxHeight,
          }}
        >
          <p className="term-title">{definition.term}</p>
          <p className="term-short">{definition.short}</p>
          {definition.scale && (
            <p className="term-line">
              <span className="term-key">Typical values</span>
              {definition.scale}
            </p>
          )}
          <p className="term-line">
            <span className="term-key">How it is computed</span>
            {definition.computed}
          </p>
          {definition.caution && (
            <p className="term-line term-caution">
              <span className="term-key">Worth knowing</span>
              {definition.caution}
            </p>
          )}
          {ask && (
            <button
              type="button"
              className="chip term-ask"
              onClick={() => {
                setOpen(false);
                askAgent(ask);
              }}
            >
              Ask about this figure
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
