/** The planner draws a chart of SQL nobody wrote by hand, so the thing under
 *  test is mostly its refusals: every shape it accepts has to mean what the
 *  chart will claim it means. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planChart } from "./autoChart.ts";

test("a category and a measure become a bar chart", () => {
  const plan = planChart(
    ["sector", "annualized_volatility"],
    [["Energy", 0.31], ["Technology", 0.24], ["Utilities", 0.14]],
  );
  assert.ok(plan);
  assert.equal(plan.kind, "bar");
  assert.equal(plan.labelColumn, "sector");
  assert.deepEqual(plan.labels, ["Energy", "Technology", "Utilities"]);
  assert.equal(plan.series.length, 1);
  assert.deepEqual(plan.series[0]!.values, [0.31, 0.24, 0.14]);
});

test("a date and a measure become a line chart, in date order", () => {
  const plan = planChart(
    ["date", "close"],
    [["2024-03-01", 182.5], ["2024-01-02", 171.2], ["2024-02-01", 178.9]],
  );
  assert.ok(plan);
  assert.equal(plan.kind, "line");
  assert.deepEqual(plan.labels, ["2024-01-02", "2024-02-01", "2024-03-01"]);
  assert.deepEqual(plan.series[0]!.values, [171.2, 178.9, 182.5]);
});

test("a date, a label and one measure pivot into one series per label", () => {
  // Rows arrive grouped by ticker, which is what `ORDER BY ticker, date`
  // gives: the pivot has to put the axis back in date order itself.
  const plan = planChart(
    ["date", "ticker", "indexed_value"],
    [
      ["2024-01-03", "AAPL", 101.4], ["2024-01-02", "AAPL", 100],
      ["2024-01-03", "BTC-USD", 96.2], ["2024-01-02", "BTC-USD", 100],
    ],
  );
  assert.ok(plan);
  assert.equal(plan.kind, "line");
  assert.deepEqual(plan.labels, ["2024-01-02", "2024-01-03"]);
  assert.deepEqual(plan.series.map((s) => s.name), ["AAPL", "BTC-USD"]);
  assert.deepEqual(plan.series[0]!.values, [100, 101.4]);
  assert.deepEqual(plan.series[1]!.values, [100, 96.2]);
});

test("a gap in one pivoted series stays a gap, not a shifted point", () => {
  const plan = planChart(
    ["date", "ticker", "close"],
    [
      ["2024-01-02", "AAPL", 100], ["2024-01-03", "AAPL", 101],
      ["2024-01-03", "BTC-USD", 96],
    ],
  );
  assert.ok(plan);
  const btc = plan.series.find((s) => s.name === "BTC-USD")!;
  assert.deepEqual(btc.values, [null, 96]);
});

test("a measure a hundred times the scale of the first is left off the axis", () => {
  const plan = planChart(
    ["ticker", "close", "volume"],
    [["AAPL", 182.5, 54_300_000], ["MSFT", 411.2, 21_900_000]],
  );
  assert.ok(plan);
  assert.deepEqual(plan.series.map((s) => s.name), ["close"]);
  assert.deepEqual(plan.omitted, ["volume"]);
});

test("measures of a comparable scale share the axis", () => {
  const plan = planChart(
    ["sector", "annualized_return", "annualized_volatility"],
    [["Energy", 0.11, 0.31], ["Utilities", 0.04, 0.14]],
  );
  assert.ok(plan);
  assert.deepEqual(plan.series.map((s) => s.name), [
    "annualized_return", "annualized_volatility",
  ]);
  assert.deepEqual(plan.omitted, []);
});

test("bars past the cap are dropped and counted, never silently", () => {
  const rows = Array.from({ length: 40 }, (_, i) => [`T${i}`, i / 100]);
  const plan = planChart(["ticker", "vol"], rows);
  assert.ok(plan);
  assert.equal(plan.labels.length, 24);
  assert.equal(plan.series[0]!.values.length, 24);
  assert.equal(plan.hiddenRows, 16);
});

const REFUSALS: [string, string[], unknown[][]][] = [
  ["a single row, which is a number and not a shape", ["sector", "vol"], [["Energy", 0.31]]],
  ["one column", ["ticker"], [["AAPL"], ["MSFT"]]],
  ["no measure at all", ["ticker", "sector"], [["AAPL", "Tech"], ["XOM", "Energy"]]],
  [
    "no label column to plot against",
    ["open", "close"],
    [[1, 2], [3, 4]],
  ],
  [
    "repeated categories, which would overlay unrelated rows",
    ["sector", "ticker", "vol", "beta"],
    [["Tech", "AAPL", 0.24, 1.1], ["Tech", "MSFT", 0.21, 0.9]],
  ],
  [
    "a repeated date and category pair, which would hide a dimension",
    ["date", "sector", "vol"],
    [
      ["2024-01-02", "Tech", 0.2], ["2024-01-02", "Tech", 0.3],
      ["2024-01-02", "Energy", 0.4],
    ],
  ],
  [
    "more categories than the palette validates",
    ["date", "ticker", "close"],
    Array.from({ length: 9 }, (_, i) => ["2024-01-02", `T${i}`, i]),
  ],
];

for (const [why, columns, rows] of REFUSALS) {
  test(`no chart for ${why}`, () => {
    assert.equal(planChart(columns, rows), null);
  });
}

test("every plotted series lines up with the labels", () => {
  const plan = planChart(
    ["date", "ticker", "indexed_value"],
    [
      ["2024-01-02", "AAPL", 100], ["2024-01-03", "AAPL", 101],
      ["2024-01-02", "MSFT", 100], ["2024-01-04", "MSFT", 103],
    ],
  );
  assert.ok(plan);
  for (const series of plan.series) {
    assert.equal(
      series.values.length,
      plan.labels.length,
      `${series.name} has ${series.values.length} points for ${plan.labels.length} labels`,
    );
  }
});
