/** What the palette does with what you type.
 *
 * The ranking is the whole feature - a list of 161 things filtered badly is
 * worse than the dropdown it replaces - and it is pure, so it is testable
 * without rendering anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands, rankCommands, VIEW_COMMANDS } from "./commands.ts";
import type { Asset } from "./api.ts";

const asset = (ticker: string, name: string, sector: string): Asset => ({
  ticker, name, sector,
  asset_type: "stock", currency: "USD",
  bar_count: 750, first_date: "2023-08-26", last_date: "2026-08-26",
});

const UNIVERSE: Asset[] = [
  asset("AAPL", "Apple Inc.", "Information Technology"),
  asset("NVDA", "NVIDIA Corporation", "Information Technology"),
  asset("COP", "ConocoPhillips", "Energy"),
  asset("CVX", "Chevron Corporation", "Energy"),
  asset("BAC", "Bank of America Corporation", "Financials"),
  asset("INFY.NS", "Infosys Limited", "India: IT"),
];
const ALL = buildCommands(UNIVERSE);

test("an empty box offers the views, not 135 assets in API order", () => {
  const shown = rankCommands(ALL, "");
  assert.ok(shown.length > 0);
  assert.ok(shown.every((c) => c.kind === "view"));
});

test("an exact ticker wins", () => {
  assert.equal(rankCommands(ALL, "NVDA")[0]?.id, "asset:NVDA");
  // Case is not something anyone should have to get right.
  assert.equal(rankCommands(ALL, "nvda")[0]?.id, "asset:NVDA");
});

test("a ticker prefix beats a match buried in a name", () => {
  // "CO" starts COP, and also appears inside "Corporation" three times over.
  assert.equal(rankCommands(ALL, "co")[0]?.id, "asset:COP");
});

test("a word start in the name matches", () => {
  assert.equal(rankCommands(ALL, "apple")[0]?.id, "asset:AAPL");
  assert.equal(rankCommands(ALL, "chevron")[0]?.id, "asset:CVX");
});

test("sectors are reachable by name", () => {
  const top = rankCommands(ALL, "energy")[0];
  assert.equal(top?.kind, "sector");
  assert.deepEqual(top?.params, { tab: "sector", sector: "Energy" });
});

test("no scattered-letter fuzzy matching", () => {
  // The behaviour that makes fuzzy finders feel arbitrary: "aapl" appears as a
  // subsequence of "BAnk of AmericA CorPoration"-style strings constantly.
  // Only real substrings and word starts count here.
  const ids = rankCommands(ALL, "bkam").map((c) => c.id);
  assert.deepEqual(ids, []);
});

test("a query matching nothing returns nothing rather than everything", () => {
  assert.deepEqual(rankCommands(ALL, "zzzzz"), []);
});

test("results are capped and the cap is honoured", () => {
  const many = buildCommands(
    Array.from({ length: 200 }, (_, i) => asset(`T${i}`, `Test Corporation ${i}`, "Energy")),
  );
  assert.equal(rankCommands(many, "test", 12).length, 12);
});

test("ordering does not depend on the order assets arrived in", () => {
  const forwards = rankCommands(buildCommands(UNIVERSE), "corporation").map((c) => c.id);
  const backwards = rankCommands(buildCommands([...UNIVERSE].reverse()), "corporation").map((c) => c.id);
  assert.deepEqual(forwards, backwards);
});

test("every view command is reachable by its own label", () => {
  for (const view of VIEW_COMMANDS) {
    const top = rankCommands(ALL, view.label)[0];
    assert.equal(top?.id, view.id, `typing "${view.label}" should reach ${view.id}`);
  }
});

test("a dotted NSE ticker is reachable by its bare symbol", () => {
  assert.equal(rankCommands(ALL, "infy")[0]?.id, "asset:INFY.NS");
});
