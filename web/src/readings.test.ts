/** A reading is prose the reader will trust without checking, so the tests are
 *  about when it declines to speak and whether its claims follow from the data.
 *  A reading that pads on thin data is worse than no reading at all. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assetReading, correlationReading, pearson,
  riskReading, sectorDetailReading, sectorReading,
} from "./readings.ts";
import { GLOSSARY } from "./glossary.ts";
import type { RiskMetric, SectorCorrelationCell, SectorPerformance } from "./api.ts";

// --- pearson ---------------------------------------------------------------

test("pearson matches a hand-computed case", () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [1, 3, 2, 4])! - 0.8) < 1e-12);
});

test("pearson refuses what it cannot compute", () => {
  assert.equal(pearson([1, 2], [3, 4]), null, "two points is not a relationship");
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null, "a constant column has no correlation");
});

// --- sector reading --------------------------------------------------------

const sector = (
  name: string, ret: number, vol: number, ratio: number,
): SectorPerformance => ({
  sector: name, start_date: "2025-01-01", end_date: "2026-01-01",
  observations: 250, asset_count: 5, total_return: ret,
  annualized_return: ret, annualized_volatility: vol, return_per_unit_risk: ratio,
});

test("the sector reading names the spread and the count that finished up", () => {
  const text = sectorReading([
    sector("Energy", 0.5, 0.30, 1.6),
    sector("Health Care", 0.3, 0.15, 2.0),
    sector("Crypto", -0.5, 0.65, -0.8),
  ])!;
  assert.match(text, /2 of 3 sectors finished the window up/);
  assert.match(text, /Energy returned the most at \+50\.0%/);
  assert.match(text, /Crypto the least at −50\.0%/);
});

test("it points out the ranking disagreement only when there is one", () => {
  const disagrees = sectorReading([
    sector("Energy", 0.5, 0.30, 1.6),
    sector("Health Care", 0.3, 0.15, 2.0),
    sector("Crypto", -0.5, 0.65, -0.8),
  ])!;
  assert.match(disagrees, /Ranked by return per unit of risk the leader is Health Care/);

  const agrees = sectorReading([
    sector("Energy", 0.5, 0.10, 5.0),
    sector("Health Care", 0.3, 0.15, 2.0),
    sector("Crypto", -0.5, 0.65, -0.8),
  ])!;
  assert.doesNotMatch(agrees, /Ranked by return per unit of risk/,
    "the same sector leads on both, so there is nothing to point out");
});

test("no sector reading from fewer than three sectors", () => {
  assert.equal(sectorReading([sector("Energy", 0.5, 0.3, 1.6)]), null);
  assert.equal(sectorReading([]), null);
});

// --- risk reading ----------------------------------------------------------

const asset = (
  ticker: string, vol: number, ret: number, type: "stock" | "crypto" = "stock",
): RiskMetric => ({
  ticker, name: ticker, sector: "Test", asset_type: type, observations: 250,
  start_date: "2025-01-01", end_date: "2026-01-01", total_return: ret,
  annualized_return: ret, annualized_volatility: vol, return_per_unit_risk: ret / vol,
  max_drawdown: -0.2, avg_volume: 1e6, volatility_rank: 1,
});

test("the risk reading reports the sign flip only when the sign actually flips", () => {
  // Equities rise with volatility; a crypto block sits high-vol and negative,
  // which is enough to pull the pooled correlation negative.
  const equities = Array.from({ length: 20 }, (_, i) => asset(`E${i}`, 0.1 + i * 0.02, 0.02 + i * 0.02));
  const crypto = Array.from({ length: 10 }, (_, i) => asset(`C${i}`, 0.7 + i * 0.02, -0.4 - i * 0.02, "crypto"));
  const flipped = riskReading([...equities, ...crypto])!;
  assert.match(flipped, /the sign comes from the 10 crypto assets/);

  const equitiesOnly = riskReading(equities)!;
  assert.doesNotMatch(equitiesOnly, /the sign comes from/);
  assert.match(equitiesOnly, /correlation between volatility and return is/);
});

test("no risk reading from a handful of assets", () => {
  assert.equal(riskReading([asset("A", 0.2, 0.1), asset("B", 0.3, 0.2)]), null);

  // Five is enough for pearson to return a number and nowhere near enough to
  // put "across these assets, more volatile ones earned less" in prose. The
  // floor has to be tested above the point where the correlation itself
  // starts returning null, or it is never exercised at all.
  const five = Array.from({ length: 5 }, (_, i) => asset(`A${i}`, 0.1 + i * 0.05, i * 0.03));
  assert.notEqual(pearson(five.map((a) => a.annualized_volatility!),
                          five.map((a) => a.annualized_return!)), null);
  assert.equal(riskReading(five), null, "five assets is not a cross-section");
});

// --- correlation reading ---------------------------------------------------

const cell = (a: string, b: string, r: number): SectorCorrelationCell => ({
  sector_a: a, sector_b: b, correlation: r, pairs: 12,
  top_ticker_a: null, top_ticker_b: null, top_correlation: r,
});

test("the correlation reading ignores the diagonal, which is 1 by construction", () => {
  const text = correlationReading([
    cell("Energy", "Energy", 1),
    cell("Energy", "Utilities", 0.4),
    cell("Energy", "Crypto", 0.1),
    cell("Utilities", "Crypto", 0.05),
  ])!;
  assert.doesNotMatch(text, /1\.00/, "a self-pair must not be reported as the strongest");
  assert.match(text, /Energy and Utilities are the most related at 0\.40/);
});

test("it gives a yardstick rather than a significance claim it cannot source", () => {
  // Each cell is a mean of many pairwise correlations, so the Fisher bound for
  // a single pair does not apply to it. The reading must not imply it does.
  const mild = [cell("A", "B", 0.4), cell("A", "C", 0.2), cell("B", "C", 0.1)];
  const text = correlationReading(mild)!;
  assert.doesNotMatch(text, /cannot be told apart/);
  assert.match(text, /two assets inside a single narrow sector typically reach about 0\.7/);
  assert.match(text, /even the strongest pair here is a mild relationship/);

  const strong = [cell("A", "B", 0.9), cell("A", "C", 0.2), cell("B", "C", 0.1)];
  assert.doesNotMatch(correlationReading(strong)!, /even the strongest pair/);
});

// --- asset and sector detail ----------------------------------------------

test("the asset reading survives a missing peer rank", () => {
  const text = assetReading(asset("NVDA", 0.71, 0.9), 135, null)!;
  assert.match(text, /NVDA returned/);
  assert.doesNotMatch(text, /ranks/);
});

test("no asset reading without the figures it would quote", () => {
  assert.equal(assetReading(undefined, 135), null);
  const missing = { ...asset("X", 0.2, 0.1), annualized_volatility: null };
  assert.equal(assetReading(missing, 135), null);
});

test("the sector detail reading flags a wide spread and stays quiet on a narrow one", () => {
  const wide = sectorDetailReading([
    asset("A", 0.3, 0.8), asset("B", 0.3, 0.1), asset("C", 0.3, -0.3),
  ].map((a) => ({ ...a, sector: "Energy" })), "Energy")!;
  assert.match(wide, /spread inside one sector/);

  const narrow = sectorDetailReading([
    asset("A", 0.3, 0.12), asset("B", 0.3, 0.10), asset("C", 0.3, 0.08),
  ].map((a) => ({ ...a, sector: "Energy" })), "Energy")!;
  assert.doesNotMatch(narrow, /spread inside one sector/);
});

// --- the glossary keys the app actually uses -------------------------------

test("every term= in the source names a glossary entry", () => {
  // A mistyped key renders the bare label with no error and no definition,
  // which is exactly the failure this whole feature exists to prevent.
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        // Both spellings: `term="x"` as a JSX attribute on a StatTile, and
        // `term: "x"` as a property on a TableView column.
        for (const m of readFileSync(path, "utf8").matchAll(/\bterm[:=]\s*"([a-z_]+)"/g)) {
          used.add(m[1]!);
        }
      }
    }
  };
  walk("src");

  assert.ok(used.size >= 7, `expected the pages to use terms, found ${used.size}`);
  for (const key of used) {
    assert.ok(GLOSSARY[key], `term="${key}" has no glossary entry`);
  }
});

test("every glossary entry is complete enough to render", () => {
  for (const [key, d] of Object.entries(GLOSSARY)) {
    assert.ok(d.term && d.short && d.computed, `${key} is missing a required field`);
    assert.ok(!/\bstandard deviation\b/.test(d.short),
      `${key}'s short definition should not need the jargon it is explaining`);
  }
});
