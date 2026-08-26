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
import { THEMES } from "../src/theme.ts";

const CVD_MIN = 8.0;
const CONTRAST_MIN = 3.0;

const source = readFileSync(new URL("../src/charts/palette.ts", import.meta.url), "utf8");

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
  const { surface, chartBase: mode } = THEMES[name];
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

  if (problems.length) {
    failed = true;
    console.log(`${name.padEnd(9)} FAIL`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    console.log(
      `${name.padEnd(9)} pass  adjacent CVD ${cvd(adj).toFixed(1)} · normal ` +
      `${/ΔE ([\d.]+) \(normal\)/.exec(adj.report.find(([n]) => n === "Normal-vision floor")[2])[1]} · ` +
      `trio CVD ${cvd(trio).toFixed(1)} · min contrast ${worstContrast.toFixed(2)}:1`,
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

if (selfTest) {
  console.log(failed ? "\nself-test OK — the checker caught the mutation" : "\nSELF-TEST FAILED — checker is inert");
  process.exit(failed ? 0 : 1);
}
console.log(failed ? "\nFAIL" : "\nall themes pass, as shipped");
process.exit(failed ? 1 : 0);
