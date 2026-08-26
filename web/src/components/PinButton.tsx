import type { Pins } from "../pins";
import { MAX_PINS } from "../pins";

/** Pin control.
 *
 * A toggle, not a menu item: pinning is one bit and the affordance should be
 * one click wherever an asset is named. The label is the action - "Pin" /
 * "Unpin" - rather than a state word like "Pinned", because a control names
 * what it does when you press it, and the pressed state is already carried by
 * aria-pressed and the fill.
 *
 * At the cap it becomes disabled rather than disappearing, and says why. A
 * control that silently stops working reads as a bug.
 */
export function PinButton({
  ticker, pins, compact = false,
}: {
  ticker: string;
  pins: Pins;
  compact?: boolean;
}) {
  const on = pins.isPinned(ticker);
  const blocked = !on && pins.full;
  return (
    <button
      type="button"
      className={`pin${compact ? " compact" : ""}`}
      aria-pressed={on}
      disabled={blocked}
      title={
        blocked
          ? `${MAX_PINS} pinned already — unpin one to add ${ticker}`
          : on
            ? `Unpin ${ticker}`
            : `Pin ${ticker}`
      }
      onClick={(e) => {
        // Rows and sector panels are themselves clickable; pinning from inside
        // one must not also navigate.
        e.stopPropagation();
        pins.toggle(ticker);
      }}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        {/* A bookmark, not a star. Starring means "favourite"; this list is a
            working set you add to and clear, which is what a bookmark is. */}
        <path
          d="M4 2h8v12l-4-3.2L4 14z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && <span>{on ? "Unpin" : "Pin"}</span>}
    </button>
  );
}
