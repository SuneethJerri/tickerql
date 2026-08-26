/** What a URL can put in front of the pins parser.
 *
 * `?pins=` is hand-editable and shareable, so its contents are untrusted input
 * in the ordinary sense: anything at all can arrive there. These are the cases
 * that decide whether a bad one degrades or ends up rendered.
 *
 * Run with `npm test` - node's own runner, no test framework added. Node strips
 * the types itself, so this imports the real module rather than a copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePins, MAX_PINS } from "./pins.ts";

test("nothing in the URL yields nothing", () => {
  assert.deepEqual(parsePins(null), []);
  assert.deepEqual(parsePins(""), []);
  assert.deepEqual(parsePins(",,,"), []);
});

test("keeps order, which is what colours the compare chart", () => {
  // sectorColor assigns by position, so a reordered list is a recoloured
  // chart. Sorting here would silently reshuffle a shared link's colours.
  assert.deepEqual(parsePins("MPC,BTC,AAPL"), ["MPC", "BTC", "AAPL"]);
});

test("normalises case and whitespace", () => {
  assert.deepEqual(parsePins("aapl, msft ,  Nvda"), ["AAPL", "MSFT", "NVDA"]);
});

test("keeps the dot in an NSE ticker", () => {
  assert.deepEqual(parsePins("RELIANCE.NS,INFY.NS"), ["RELIANCE.NS", "INFY.NS"]);
});

test("de-duplicates, including across case", () => {
  assert.deepEqual(parsePins("AAPL,aapl,AAPL"), ["AAPL"]);
});

test("drops anything that is not ticker-shaped", () => {
  // The strip renders whatever it is given, so an unmatched entry would sit
  // there forever showing em dashes - and markup would sit there as text.
  assert.deepEqual(parsePins("AAPL,<script>,MSFT"), ["AAPL", "MSFT"]);
  assert.deepEqual(parsePins("AAPL,WAY.TOO.LONG.TICKER,MSFT"), ["AAPL", "MSFT"]);
  assert.deepEqual(parsePins("AAPL,a b,MSFT"), ["AAPL", "MSFT"]);
});

test("caps at MAX_PINS and keeps the first ones", () => {
  const nine = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const parsed = parsePins(nine.join(","));
  assert.equal(parsed.length, MAX_PINS);
  assert.deepEqual(parsed, nine.slice(0, MAX_PINS));
});

test("the cap counts accepted tickers, not commas", () => {
  // Rejected entries must not consume a slot, or a URL padded with junk would
  // silently truncate a legitimate watchlist.
  const padded = "!!,??,A,##,B,$$,C,%%,D,^^,E,&&,F,**,G,((,H";
  assert.deepEqual(parsePins(padded), ["A", "B", "C", "D", "E", "F", "G", "H"]);
});
