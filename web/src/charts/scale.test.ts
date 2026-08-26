/** The two invariants the rebased charts are read against.
 *
 * Whatever the data does, every finite value has to land inside the domain and
 * the 100 baseline has to stay in range - all three charts draw a ReferenceLine
 * there, and a domain fitted to the data alone would drop the one gridline the
 * chart is read against.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineScale } from "./scale.ts";

const CASES: [string, number[]][] = [
  ["a typical rebase", [94.2, 103.1, 118.7]],
  ["everything above the baseline", [104.0, 130.2, 121.5]],
  ["everything below it", [72.4, 88.1, 95.0]],
  ["a dead-flat series", [100, 100, 100]],
  ["a series carrying NaN", [NaN, 99.5, 112.3]],
  ["a 0.04-wide span", [99.98, 100.02]],
  ["an 820-wide span", [40, 860]],
];

for (const [name, values] of CASES) {
  test(`${name}: data inside the domain, baseline in range`, () => {
    const { domain, ticks } = baselineScale(values);
    const [low, high] = domain;
    for (const v of values.filter(Number.isFinite)) {
      assert.ok(v >= low && v <= high, `${v} outside [${low}, ${high}]`);
    }
    assert.ok(low <= 100 && high >= 100, `baseline outside [${low}, ${high}]`);
    assert.ok(low < high, "domain must not collapse");

    // The defect this helper exists to fix was not "the data falls outside the
    // axis" - a zero-anchored axis contains the data perfectly well. It was
    // that the plot was mostly empty. So the real assertion is that the domain
    // stays close to the span the data actually needs, counting the baseline,
    // which is the one extra point the chart is entitled to reserve room for.
    // Snapping outward to a round step costs at most a step at each end; the
    // widest any real case here comes out is 1.56x. A domain anchored at zero
    // for a series running 104-130 comes out at 4.7x.
    const span = Math.max(...values.filter(Number.isFinite), 100)
      - Math.min(...values.filter(Number.isFinite), 100);
    if (span >= 0.5) {
      assert.ok(
        high - low <= span * 2,
        `domain [${low}, ${high}] is ${((high - low) / span).toFixed(1)}x the ${span} the data needs`,
      );
    }

    assert.ok(ticks.length >= 2, "an axis needs ticks");
    assert.equal(ticks[0], low);
    assert.equal(ticks.at(-1), high);
  });
}

test("an empty window still gives a readable axis", () => {
  // A loading frame, or a window with no bars. The axis must not collapse to
  // [0, 0] and the baseline must still land mid-plot.
  const { domain } = baselineScale([]);
  assert.ok(domain[0] < 100 && domain[1] > 100);
});

test("ticks are round numbers, evenly spaced", () => {
  const { ticks } = baselineScale([94.2, 103.1, 118.7]);
  const step = ticks[1]! - ticks[0]!;
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(Math.abs(ticks[i]! - ticks[i - 1]! - step) < 1e-9, "uneven step");
  }
  // 1, 2, 2.5 or 5 times a power of ten - anything else labels the axis with
  // numbers like 93.7 and 100.6.
  const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
  assert.ok([1, 2, 2.5, 5].some((m) => Math.abs(m - mantissa) < 1e-9), `step ${step}`);
});
