/** Y-axis domains for charts read against a baseline.
 *
 * Recharts' default numeric domain starts at 0, which is right for a bar chart
 * and wrong for anything rebased to 100: a series running 94-118 draws in the
 * top fifth of the plot and every difference between the series is compressed
 * to nothing.
 *
 * Two constraints beyond "don't start at zero":
 *
 * 1. The baseline stays inside the domain. The charts draw a ReferenceLine at
 *    100, and a domain of [104, 130] drops the one gridline they are read
 *    against.
 * 2. The ticks are round. An arbitrary [93.7, 121.4] is labelled 93.7, 100.6,
 *    107.6 - correct and unreadable. The domain is snapped outward to a nice
 *    step and the ticks handed over rather than inferred.
 */

/** A domain and matching ticks for values read against `anchor`. */
export function baselineScale(
  values: Iterable<number>,
  anchor = 100,
  tickCount = 5,
): { domain: [number, number]; ticks: number[] } {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  // No finite data - a loading frame, or a window with no bars. A symmetric
  // window keeps the ReferenceLine mid-plot instead of collapsing to [0, 0].
  if (!Number.isFinite(low)) return { domain: [anchor - 10, anchor + 10], ticks: [] };

  low = Math.min(low, anchor);
  high = Math.max(high, anchor);
  // A dead-flat series - one bar in the window, or a stablecoin - has zero
  // span, and every step derived from it would be zero too.
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }

  const step = niceStep((high - low) / Math.max(1, tickCount - 1));
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  // Accumulating `t += step` drifts on a fractional step (0.1 twelve times is
  // not 1.2), so each tick is computed from the index instead.
  const steps = Math.round((end - start) / step);
  for (let i = 0; i <= steps; i++) ticks.push(round(start + i * step));

  return { domain: [round(start), round(end)], ticks };
}

/** A y-domain for a correlation series.
 *
 * Neither of the two obvious axes works. Pinned to [-1, 1], a pair whose
 * correlation tripled from 0.04 to 0.34 draws as a flat line in a seventh of
 * the panel. Autoscaled, a pair that never leaves 0.38-0.42 fills the panel
 * and reads as violent movement.
 *
 * So: quarter steps, zero always in view because zero is where the pair stops
 * moving together and starts moving apart, and never less than half the full
 * scale. Under that floor a flat pair looks flat and a moving pair moves.
 */
export function correlationScale(
  values: Iterable<number>, minSpan = 1, step = 0.25,
): { domain: [number, number]; ticks: number[] } {
  let low = 0;
  let high = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < low) low = v;
    if (v > high) high = v;
  }

  let lo = Math.max(-1, Math.floor(low / step) * step);
  let hi = Math.min(1, Math.ceil(high / step) * step);

  // Grow a step at a time, alternating sides, so the padding is as even as the
  // clamps allow rather than all landing below the data.
  //
  // Bounded rather than a bare `while`: widening from the narrowest domain to
  // the whole scale takes 2/step steps, so anything past that is a bug, and
  // the bound turns it into a wrong chart instead of a hung tab.
  const maxSteps = Math.ceil(2 / step) + 2;
  for (
    let i = 0;
    i < maxSteps && hi - lo < minSpan - 1e-9 && (lo > -1 || hi < 1);
    i++
  ) {
    if (lo > -1) lo = Math.max(-1, lo - step);
    if (hi - lo >= minSpan - 1e-9) break;
    if (hi < 1) hi = Math.min(1, hi + step);
  }

  const ticks: number[] = [];
  const steps = Math.round((hi - lo) / step);
  for (let i = 0; i <= steps; i++) ticks.push(round(lo + i * step));

  return { domain: [round(lo), round(hi)], ticks };
}

/** The nearest 1/2/2.5/5/10 x 10^k at or above `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const nice =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Trim the binary-float tail so a tick renders as 102.5, not 102.50000000000001. */
function round(v: number): number {
  return Number(v.toFixed(6));
}
