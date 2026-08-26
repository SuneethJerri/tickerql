/**
 * Derive one validated chart palette per theme, against that theme's surface.
 *
 * Until now every theme shared one of two palettes, selected by `chartBase`,
 * so Light and Sepia drew identical charts and so did Dark, Midnight and
 * Graphite. Switching theme changed the page and left the data alone, which is
 * backwards - the surface is exactly what a series colour has to survive.
 *
 * That was measurably wrong, not only dull. Run against each real surface, the
 * two shared sets take a sub-3:1 contrast relief on three of the five:
 *
 *   light    #f7f9fb  3 of 8 below 3:1 (worst #eda100 at 2.05)
 *   sepia    #fbf6e9  4 of 8 below 3:1 (worst #eda100 at 2.01)
 *   graphite #2c2c2e  1 of 8 below 3:1 (#008300 at 2.82 - the dark set carries
 *                     the light set's green verbatim, and graphite is the
 *                     lightest dark surface, so it is the one that fails)
 *
 * This searches for a set per surface that needs no relief at all. Every gate
 * is measured, none is eyeballed, and the final verdict on every set comes
 * from scripts/validate_palette.js rather than from the search's own maths:
 *
 *   OKLCH L inside the mode band        (validator)
 *   OKLCH C >= 0.10                     (validator)
 *   adjacent CVD dE >= 8.0              (validator TARGET, not the 6.0 floor)
 *   adjacent normal-vision dE >= 15     (validator)
 *   first three also clear ALL-PAIRS    (the scatter and the small multiples
 *                                        draw from them, and those forms are
 *                                        measured on every pair, not neighbours)
 *   WCAG >= 3.0 vs the theme's surface, with no relief taken anywhere
 *
 * Run: node build_palettes.mjs        prints the TS block; reports on stderr
 */
import { validate, contrast } from "./validate_palette.js";
// The surfaces and their validator bands come from the app's own theme table,
// not from a second copy here. A second copy is exactly how the two `Mode`
// unions this codebase used to carry drifted apart while still typechecking.
import { THEMES as APP_THEMES } from "../src/theme.ts";

const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
const CVD_MIN = 8.0;
const NORMAL_MIN = 15.0;
// Tried in order, highest first. 3.0 is the validator's own gate, so even the
// last rung is a clean pass - the ladder buys margin where a surface can afford
// it rather than deciding between passing and failing.
const CONTRAST_LADDER = [3.6, 3.4, 3.2, 3.05];
/** Target OKLCH chroma, and how far off it a slot may sit.
 *
 * The first working version of this search maximised chroma, and produced sets
 * like #1e20f5 / #f226d8 - every gate cleared and every line shouting. The
 * design direction here is ledger paper and ink; a series colour has to be
 * legible, not loud. So chroma is aimed at a target rather than maximised, and
 * the freedom left over by clearing the gates with room to spare is spent on
 * restraint instead. These targets sit in the same range as the dataviz
 * reference palette (0.13-0.19), which is what a chart colour normally is. */
const TARGET_C = { light: 0.148, dark: 0.132 };

/**
 * `avoid` is the hue the surface itself casts, in OKLCH degrees, or null where
 * the surface is neutral enough that its hue angle is numerically meaningless
 * (below about C 0.01 the angle is noise, and #1a1a19 and #2c2c2e are both
 * under it). Where there IS a cast, no series may sit within AVOID_ARC of it:
 * a blue line on a blue ground reads as a tint of the ground rather than as
 * data, and it is the one failure a contrast ratio does not catch - the shipped
 * dark blue clears 5.9:1 on midnight and still looks like the page.
 *
 * `objective` is what to spend on once the gates are met. A near-black ground
 * gives contrast away, so there the spend goes on chroma; graphite is the
 * lightest dark surface and the only one where contrast is the binding
 * constraint, so it spends on contrast instead.
 */
const AVOID_LADDER = [16, 12, 8];

/**
 * The hue the emphasis colour aims for, per theme.
 *
 * `emphasisColors().primary` is the single hue behind every sparkline, every
 * small-multiple panel and the close-price line - by area it is the most
 * visible colour in the app, and it should not be whatever slot the ordering
 * search happened to put first. It is chosen instead as the member of the
 * theme's OWN set nearest a target hue, so it stays inside the validated
 * palette while being picked for how it reads rather than for where it sorted.
 *
 * The target is ink navy, which is the design direction's own register -
 * except on Midnight, whose ground IS navy. There a navy lead would be the
 * exact failure the avoid arc exists to prevent, so Midnight aims at amber
 * instead, roughly navy's complement and the classic pairing against it.
 */
const LEAD_HUE = { light: 250, sepia: 250, dark: 250, midnight: 45, graphite: 250 };
const DEFAULT_LEAD = 250;
const THEMES = [
  { name: "light",    mode: "light", surface: "#f7f9fb", avoid: null, objective: "chroma" },
  { name: "sepia",    mode: "light", surface: "#fbf6e9", avoid: 92,   objective: "chroma" },
  { name: "dark",     mode: "dark",  surface: "#1a1a19", avoid: null, objective: "chroma" },
  { name: "midnight", mode: "dark",  surface: "#121826", avoid: 264,  objective: "chroma" },
  { name: "graphite", mode: "dark",  surface: "#2c2c2e", avoid: null, objective: "contrast" },
];

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};

// ── colour maths (search only; the validator remains the authority) ───────────
const lin2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const toHex = (rgb) =>
  "#" + rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("");
const oklchToHex = (L, C, h) => toHex(oklchToLinear(L, C, h).map(lin2s));

function maxChroma(L, h) {
  let lo = 0, hi = 0.45;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid;
  }
  return lo;
}

const hexLin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => s2lin(v / 255));
};
function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function deltaE(h1, h2, kind) {
  const sim = (h) => {
    const rgb = hexLin(h);
    if (!kind) return rgb;
    const M = MACHADO[kind];
    return [0, 1, 2].map((i) => Math.max(0, Math.min(1, M[i][0] * rgb[0] + M[i][1] * rgb[1] + M[i][2] * rgb[2])));
  };
  const a = oklabFromLin(sim(h1)), b = oklabFromLin(sim(h2));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
const hueGap = (a, b) => { const d = ((a - b) % 360 + 360) % 360; return Math.min(d, 360 - d); };

const hueOf = (hex) => { const [, a, b] = oklabFromLin(hexLin(hex)); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };

function surfaceHue(hex) {
  const [, a, b] = oklabFromLin(hexLin(hex));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

// ── candidates ────────────────────────────────────────────────────────────────
/** Up to three colours for one hue: the deepest feasible, the lightest, and the
 *  one the theme's objective prefers. Offering a slot more than one lightness
 *  is what lets the ordering search find sets that separate on L as well as
 *  hue - fixing one lightness per slot up front is what made the first two
 *  attempts at this infeasible on sepia and graphite. */
function candidatesForHue(h, theme, floor) {
  const [lo, hi] = BAND[theme.mode];
  const feasible = [];
  for (let L = lo; L <= hi + 1e-9; L += 0.005) {
    let bestAtL = null;
    for (const scale of [0.94, 0.86, 0.78, 0.7, 0.6, 0.5]) {
      const C = maxChroma(L, h) * scale;
      if (C < 0.105) continue;
      const hex = oklchToHex(L, C, h);
      const ratio = contrast(hex, theme.surface);
      if (ratio < floor) continue;
      // Contrast past floor + HEADROOM stops earning: without the cap the
      // contrast objective walks every slot to one end of the band, the set
      // converges on a single lightness, and the separation gates fail for want
      // of variety.
      const useful = Math.min(ratio, floor + HEADROOM);
      const restraint = -Math.abs(C - TARGET_C[theme.mode]) * 20;
      const score = theme.objective === "contrast" ? useful * 2.2 + restraint : useful * 0.35 + restraint * 2;
      if (!bestAtL || score > bestAtL.score) bestAtL = { hex, L, C, ratio, score };
    }
    if (bestAtL) feasible.push(bestAtL);
  }
  if (!feasible.length) return [];
  const deepest = feasible[0];
  const lightest = feasible[feasible.length - 1];
  const preferred = feasible.reduce((a, b) => (b.score > a.score ? b : a));
  const seen = new Set();
  return [preferred, deepest, lightest].filter((c) => !seen.has(c.hex) && seen.add(c.hex));
}
const HEADROOM = 1.5;

// ── ordering ──────────────────────────────────────────────────────────────────
/** Bottleneck score of an ordering: the weakest link, normalised so 1.0 means
 *  "exactly on the gate". The pairs that count are the seven neighbours a line
 *  chart is measured on, PLUS (0,2) - slots 1-3 are also read as an all-pairs
 *  set by the scatter and the small multiples, and (0,1) and (1,2) are already
 *  neighbours, so (0,2) is the only extra pair that constraint adds. */
function bottleneck(order, W) {
  let worst = Infinity;
  for (let i = 0; i < order.length - 1; i++) worst = Math.min(worst, W[order[i]][order[i + 1]]);
  if (order.length >= 3) worst = Math.min(worst, W[order[0]][order[2]]);
  return worst;
}

/** Best Hamiltonian path by bottleneck, exactly, via subset DP - then a 2-opt
 *  swap pass to account for the (0,2) pair the DP cannot see. */
function bestOrder(W) {
  const n = W.length, full = (1 << n) - 1;
  const dp = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(-1));
  const prev = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[1 << i][i] = Infinity;
  for (let mask = 1; mask <= full; mask++) {
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i)) || dp[mask][i] < 0) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << j);
        const v = Math.min(dp[mask][i], W[i][j]);
        if (v > dp[next][j]) { dp[next][j] = v; prev[next][j] = i; }
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (dp[full][i] > dp[full][end]) end = i;
  const order = [];
  for (let mask = full, i = end; i >= 0; ) {
    order.push(i);
    const p = prev[mask][i];
    mask ^= 1 << i;
    i = p;
  }
  order.reverse();

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n && !improved; i++) {
      for (let j = i + 1; j < n; j++) {
        const swapped = order.slice();
        [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
        if (bottleneck(swapped, W) > bottleneck(order, W)) {
          order.splice(0, n, ...swapped);
          improved = true;
          break;
        }
      }
    }
  }
  return order;
}

// ── search ────────────────────────────────────────────────────────────────────
function build(theme) {
  // Eight hues spaced 45 degrees apart cover the circle, so an avoid arc of
  // 2*ARC degrees leaves only 45 - 2*ARC degrees of legal rotation. At ARC 16
  // that is a 13-degree window, and sepia had no set inside it that also
  // cleared the separation gates. Rather than drop the rule, widen the window
  // in steps and report which one the answer needed.
  for (const arc of AVOID_LADDER) {
    for (const floor of CONTRAST_LADDER) {
      const found = search(theme, floor, arc);
      if (found) return { ...found, arc };
    }
  }
  return null;
}

function search(theme, floor, arc) {
  {
    let best = null;
    for (let h0 = 0; h0 < 45; h0 += 0.5) {
      const hues = Array.from({ length: 8 }, (_, k) => (h0 + k * 45) % 360);
      if (theme.avoid != null && hues.some((h) => hueGap(h, theme.avoid) < arc)) continue;
      const pools = hues.map((h) => candidatesForHue(h, theme, floor));
      if (pools.some((p) => !p.length)) continue;

      // A deterministic sweep of which hues take their deep variant and which
      // take their light one: bit k of `pick` chooses for hue k. 256 draws is
      // the whole space for two variants and a fair sample for three.
      for (let pick = 0; pick < 256; pick++) {
        const set = pools.map((p, k) => p[Math.min((pick >> k) & 1 ? 1 : 0, p.length - 1)].hex);
        if (new Set(set).size !== 8) continue;

        const W = set.map((a) => set.map((b) =>
          a === b ? 0 : Math.min(
            Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan")) / CVD_MIN,
            deltaE(a, b) / NORMAL_MIN,
          )));
        const order = bestOrder(W);
        const strength = bottleneck(order, W);
        if (strength < 1) continue;

        const palette = order.map((i) => set[i]);
        const adj = validate(palette, { mode: theme.mode, surface: theme.surface });
        const trio = validate(palette.slice(0, 3), { mode: theme.mode, surface: theme.surface, pairs: "all" });
        const m = metrics(adj), t = metrics(trio);
        if (!adj.ok || !trio.ok || m.relief || t.relief) continue;
        if (m.cvd < CVD_MIN || t.cvd < CVD_MIN) continue;

        const minContrast = Math.min(...palette.map((c) => contrast(c, theme.surface)));
        // Clearing a gate by more than a little buys nothing a reader can see,
        // so surplus separation is capped and the rest of the score goes to
        // sitting near the chroma target.
        const spread = Math.min(strength, 1.6) * 6;
        const drift = palette.reduce((sum, c) => sum + Math.abs(chromaOf(c) - TARGET_C[theme.mode]), 0);
        const score = spread + minContrast * 0.5 - drift * 6;
        if (!best || score > best.score) best = { palette, score, m, t, floor, minContrast, strength };
      }
    }
    return best;
  }
}

const chromaOf = (hex) => { const [, a, b] = oklabFromLin(hexLin(hex)); return Math.hypot(a, b); };

/** Read the numbers back out of the validator's own report rows, so every
 *  figure reported here is the validator's and not a second implementation. */
function metrics({ report }) {
  const row = (name) => report.find(([n]) => n === name);
  return {
    cvd: Number(/ΔE ([\d.]+) \(/.exec(row("CVD separation")[2])?.[1] ?? 0),
    normal: Number(/ΔE ([\d.]+) \(normal\)/.exec(row("Normal-vision floor")[2])?.[1] ?? 0),
    relief: row("Contrast vs surface")[1] !== "pass",
  };
}

// ── neutrals and the diverging scale, per theme ───────────────────────────────
/** Three context greys carrying the surface's own hue at near-zero chroma.
 *  These are the moving-average lines behind an emphasised close price: they
 *  have to read as background on THIS surface, not on a generic one. */
function greys(theme) {
  const [lo, hi] = BAND[theme.mode];
  const h = surfaceHue(theme.surface);
  const steps = theme.mode === "light"
    ? [lo + 0.13, lo + 0.24, lo + 0.34]
    : [hi - 0.06, hi - 0.16, hi - 0.25];
  return steps.map((L) => oklchToHex(L, 0.008, h));
}

/** Cool and warm poles for correlation, with a neutral midpoint that reads as
 *  "nothing" on this surface. The midpoint is the tell: a diverging scale whose
 *  centre looks like a colour makes zero correlation look like a result. */
function diverging(theme) {
  const pole = (h) => {
    const c = candidatesForHue(h, theme, 3.05);
    return (c.find((x) => x) ?? { hex: "#888888" }).hex;
  };
  const h = surfaceHue(theme.surface);
  const midL = theme.mode === "light" ? 0.95 : 0.31;
  return { negative: pole(255), mid: oklchToHex(midL, 0.006, h), positive: pole(27) };
}

// ── run ───────────────────────────────────────────────────────────────────────
const out = {};
for (const theme of THEMES) {
  const found = build(theme);
  if (!found) {
    console.error(`${theme.name.padEnd(9)} NO FEASIBLE PALETTE`);
    process.exitCode = 1;
    continue;
  }
  const target = LEAD_HUE[theme.name] ?? DEFAULT_LEAD;
  const primary = found.palette.reduce((a, b) =>
    hueGap(hueOf(b), target) < hueGap(hueOf(a), target) ? b : a);
  out[theme.name] = { ...found, primary, greys: greys(theme), diverging: diverging(theme) };
  console.error(
    `${theme.name.padEnd(9)} adjacent CVD ${found.m.cvd.toFixed(1)} / normal ${found.m.normal.toFixed(1)}   ` +
    `trio CVD ${found.t.cvd.toFixed(1)} / normal ${found.t.normal.toFixed(1)}   ` +
    `min contrast ${found.minContrast.toFixed(2)}:1 (floor ${found.floor}` +
    `${theme.avoid != null ? `, arc ${found.arc}` : ""})  lead ${out[theme.name].primary}`,
  );
}

const q = (a) => a.map((c) => `"${c}"`).join(", ");
const present = THEMES.filter((t) => out[t.name]);
console.log("// generated by web/scripts/build_palettes.mjs — do not hand-edit");
console.log("const CATEGORICAL = {");
for (const t of present) console.log(`  ${t.name}: [${q(out[t.name].palette)}],`);
console.log("} as const;\n");
console.log("const PRIMARY = {");
for (const t of present) console.log(`  ${t.name}: "${out[t.name].primary}",`);
console.log("} as const;\n");
console.log("const CONTEXT_GREYS = {");
for (const t of present) console.log(`  ${t.name}: [${q(out[t.name].greys)}],`);
console.log("} as const;\n");
console.log("const DIVERGING = {");
for (const t of present) {
  const d = out[t.name].diverging;
  console.log(`  ${t.name}: { negative: "${d.negative}", mid: "${d.mid}", positive: "${d.positive}" },`);
}
console.log("} as const;");
