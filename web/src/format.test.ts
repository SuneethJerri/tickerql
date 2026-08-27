/** The one thing the agent result table must not do is show a non-zero number
 *  as zero: a column of zeroes reads as missing data, and the reader has no
 *  way to tell it apart from a query that genuinely returned nothing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCell } from "./format.ts";

test("a small non-zero number never renders as zero", () => {
  for (const v of [1e-5, 5e-8, -3.2e-6, 0.00004999, -1e-12]) {
    const out = formatCell(v);
    assert.notEqual(out, "0", `${v} rendered as "0"`);
    assert.notEqual(out, "-0", `${v} rendered as "-0"`);
    assert.ok(Number(out) !== 0, `${v} rendered as ${out}, which parses to zero`);
  }
});

test("an exact zero still renders as zero", () => {
  assert.equal(formatCell(0), "0");
});

test("ordinary magnitudes keep the readable form", () => {
  assert.equal(formatCell(0.7063), "0.7063");
  assert.equal(formatCell(1234567), "1,234,567");
  assert.equal(formatCell(-0.0512), "-0.0512");
});

test("integers are not given a decimal tail", () => {
  assert.equal(formatCell(42), "42");
  assert.equal(formatCell(-7), "-7");
});

test("nulls and text pass through", () => {
  assert.equal(formatCell(null), "—");
  assert.equal(formatCell(undefined), "—");
  assert.equal(formatCell("Energy"), "Energy");
  assert.equal(formatCell("2026-08-27"), "2026-08-27");
});

test("non-finite numbers are named rather than formatted", () => {
  assert.equal(formatCell(Number.NaN), "NaN");
  assert.equal(formatCell(Number.POSITIVE_INFINITY), "Infinity");
});
