/**
 * Validate the palettes AS SHIPPED - read out of src/charts/palette.ts, not out
 * of the generator that produced them.
 *
 * build_palettes.mjs validates what it is about to print. That leaves one gap
 * between a green run and a correct app: the paste. A transcription slip, a
 * hand-edit "just to warm that green up", a theme added to theme.ts with no set
 * of its own - none of those are visible to the generator, and all of them ship.
 * So this parses the real file and re-runs the real gates on it.
 *
 * Run: node check_palettes.mjs          exits 1 on any failure
 *      node check_palettes.mjs --self-test   mutates one hex first, expects a fail
 */
import { readFileSync } from "node:fs";
import { validate, contrast } from "./validate_palette.js";
import { THEMES, ACCENTS } from "../src/theme.ts";

const CVD_MIN = 8.0;
const CONTRAST_MIN = 3.0;
const ACCENT_MIN_DE = 15.0;
const NORMAL_MIN = 15.0;
const TEXT_MIN = 4.5;

const source = readFileSync(new URL("../src/charts/palette.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
  // Comments first: a block comment sitting above a rule is otherwise
  // captured as part of that rule's selector, and the rule is lost.
  .replace(/\/\*[\s\S]*?\*\//g, "");

// ── colour maths for the gates the validator does not cover ──────────────────
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLin = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => s2lin(v / 255));
};
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s_,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s_,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s_,
  ];
}
const deltaE = (a, b) => {
  const x = oklab(hexLin(a)), y = oklab(hexLin(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** Every `selector { ... }` rule in the stylesheet, as selector -> declarations.
 *  Parsed once rather than regex-escaping a selector at each call site, which
 *  is where the first version of this went wrong. */
const RULES = new Map();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const selector of m[1].split(",")) {
    const key = selector.trim().replace(/\s+/g, " ");
    if (!key || key.startsWith("@") || key.startsWith("/*")) continue;
    RULES.set(key, (RULES.get(key) ?? "") + m[2]);
  }
}

/** A custom property's value on one selector, or null. */
function cssVar(selector, prop) {
  const decls = RULES.get(selector);
  if (!decls) return null;
  const all = [...decls.matchAll(new RegExp(`--${prop}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  return all.length ? all[all.length - 1][1].toLowerCase() : null;
}

/** Pull `name: [...]` rows out of one `const NAME = { ... } as const;` block. */
function table(name) {
  const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(source);
  if (!block) throw new Error(`${name} not found in palette.ts`);
  const rows = {};
  for (const m of block[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    rows[m[1]] = [...m[2].matchAll(/#[0-9a-fA-F]{6}/g)].map((h) => h[0]);
  }
  return rows;
}

const selfTest = process.argv.includes("--self-test");
const categorical = table("CATEGORICAL");
if (selfTest) {
  // A hue nudged onto its neighbour. If the checker still passes, it is not
  // checking anything, and every "validated" claim resting on it is worthless.
  const victim = Object.keys(categorical)[0];
  categorical[victim] = [...categorical[victim]];
  categorical[victim][1] = categorical[victim][0];
  console.log(`self-test: ${victim} slot 2 overwritten with slot 1 — expecting FAIL\n`);
}

let failed = false;
const themeNames = Object.keys(THEMES);
for (const name of themeNames) {
  const palette = categorical[name];
  if (!palette || palette.length !== 8) {
    console.log(`${name.padEnd(9)} FAIL  no 8-slot set in palette.ts`);
    failed = true;
    continue;
  }
  const { surface, panel, chartBase: mode } = THEMES[name];
  const adj = validate(palette, { mode, surface });
  const trio = validate(palette.slice(0, 3), { mode, surface, pairs: "all" });

  const problems = [];
  for (const [label, result] of [["adjacent", adj], ["trio all-pairs", trio]]) {
    for (const [check, state, detail] of result.report) {
      if (state === true || state === "pass") continue;
      // The CVD "floor" band and the contrast "relief" band are legal for the
      // validator and NOT legal here: these sets were generated to clear the
      // target outright, so anything less means the file drifted from them.
      problems.push(`${label} · ${check}: ${state} — ${detail}`);
    }
  }
  const cvd = (r) => Number(/ΔE ([\d.]+) \(/.exec(r.report.find(([n]) => n === "CVD separation")[2])[1]);
  if (cvd(adj) < CVD_MIN) problems.push(`adjacent CVD ${cvd(adj).toFixed(1)} below target ${CVD_MIN}`);
  const worstContrast = Math.min(...palette.map((c) => contrast(c, surface)));
  if (worstContrast < CONTRAST_MIN) problems.push(`contrast ${worstContrast.toFixed(2)}:1 below ${CONTRAST_MIN}`);

  // CHROME WEARS INK. Not something the dataviz validator knows about - it
  // measures a palette against itself and its surface, and has no concept of
  // the app's buttons. This is the gate the first per-theme generator missed.
  let worstAccent = Infinity, accentPair = "";
  for (const [accentName, accent] of Object.entries(ACCENTS)) {
    const hex = accent.hex[mode];
    for (const c of palette) {
      const d = deltaE(hex, c);
      if (d < worstAccent) { worstAccent = d; accentPair = `${accentName} ${hex} vs series ${c}`; }
    }
  }
  if (worstAccent < ACCENT_MIN_DE) {
    problems.push(`accent collision: dE ${worstAccent.toFixed(1)} — ${accentPair}`);
  }

  // The SQL syntax colours, read out of the stylesheet that actually ships
  // them. They are TEXT on --surface-2, so the gate is 4.5:1, not 3:1.
  const selector = name === "light" ? ":root" : `:root[data-theme="${name}"]`;
  const ink = ["sql-kw", "sql-lit", "sql-id"].map((v) => cssVar(selector, v));
  if (ink.some((c) => !c)) {
    problems.push(`no --sql-* declarations found for ${name}`);
  } else {
    for (const [i, c] of ink.entries()) {
      const r = contrast(c, panel);
      if (r < TEXT_MIN) problems.push(`SQL ${["kw", "lit", "id"][i]} ${c} is ${r.toFixed(2)}:1 on ${panel}, below ${TEXT_MIN}`);
    }
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      const d = deltaE(ink[i], ink[j]);
      if (d < NORMAL_MIN) problems.push(`SQL ${ink[i]} and ${ink[j]} are dE ${d.toFixed(1)} apart`);
    }
  }

  if (problems.length) {
    failed = true;
    console.log(`${name.padEnd(9)} FAIL`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    console.log(
      `${name.padEnd(9)} pass  adjacent CVD ${cvd(adj).toFixed(1)} · normal ` +
      `${/ΔE ([\d.]+) \(normal\)/.exec(adj.report.find(([n]) => n === "Normal-vision floor")[2])[1]} · ` +
      `trio CVD ${cvd(trio).toFixed(1)} · min contrast ${worstContrast.toFixed(2)}:1 · ` +
      `accent dE ${worstAccent.toFixed(1)}`,
    );
  }
}

// Every table has to cover every theme, or a theme resolves to undefined at
// runtime and the charts render with no colour at all.
for (const table_ of ["PRIMARY", "CONTEXT_GREYS", "DIVERGING"]) {
  const block = new RegExp(`const ${table_} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(source);
  const covered = [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const missing = themeNames.filter((t) => !covered.includes(t));
  if (missing.length) {
    console.log(`${table_} FAIL  missing: ${missing.join(", ")}`);
    failed = true;
  }
}

// The lead hue is what the dashboard, the sector pages, the asset chart and
// every sparkline are drawn in - by area the most visible colour in the app,
// and for most views the ONLY series colour on screen. If two themes share it
// they have the same charts whatever their eight-slot sets say, which is how
// four of five themes shipped looking identical.
const leadBlock = /const PRIMARY = \{([\s\S]*?)\n\} as const;/.exec(source);
const leads = leadBlock
  ? Object.fromEntries([...leadBlock[1].matchAll(/^\s*(\w+):\s*"(#[0-9a-fA-F]{6})"/gm)].map((m) => [m[1], m[2]]))
  : {};
const leadNames = Object.keys(leads);
for (let i = 0; i < leadNames.length; i++) {
  for (let j = i + 1; j < leadNames.length; j++) {
    const [a, b] = [leadNames[i], leadNames[j]];
    const d = deltaE(leads[a], leads[b]);
    if (d < NORMAL_MIN) {
      console.log(`LEADS   ${a} ${leads[a]} and ${b} ${leads[b]} are only dE ${d.toFixed(1)} apart — those two themes draw the same chart`);
      failed = true;
    }
  }
}
{
  const pairs = [];
  for (let i = 0; i < leadNames.length; i++)
    for (let j = i + 1; j < leadNames.length; j++)
      pairs.push(deltaE(leads[leadNames[i]], leads[leadNames[j]]));
  if (pairs.length) console.log(`leads   ${leadNames.length} distinct, closest pair dE ${Math.min(...pairs).toFixed(1)}`);
}

// theme.ts carries the surfaces and the accent hexes so the generator can read
// them; styles.css carries them because that is what paints the page. Neither
// can import the other, so the only thing keeping them honest is this.
for (const [name, t] of Object.entries(THEMES)) {
  const selector = `:root[data-theme="${name}"]`;
  for (const [prop, expected] of [["surface-1", t.surface], ["surface-2", t.panel]]) {
    const actual = cssVar(selector, prop);
    if (actual && actual !== expected.toLowerCase()) {
      console.log(`DRIFT   ${name} --${prop} is ${actual} in styles.css, ${expected} in theme.ts`);
      failed = true;
    }
  }
}
for (const [name, a] of Object.entries(ACCENTS)) {
  const light = cssVar(":root", `hue-${name}`);
  if (light && light !== a.hex.light.toLowerCase()) {
    console.log(`DRIFT   accent ${name} light is ${light} in styles.css, ${a.hex.light} in theme.ts`);
    failed = true;
  }
}

if (selfTest) {
  console.log(failed ? "\nself-test OK — the checker caught the mutation" : "\nSELF-TEST FAILED — checker is inert");
  process.exit(failed ? 0 : 1);
}
console.log(failed ? "\nFAIL" : "\nall themes pass, as shipped");
process.exit(failed ? 1 : 0);
