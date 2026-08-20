/**
 * Chart palette — validated, not chosen by eye.
 *
 * Every set below was run through the dataviz skill's validator
 * (`validate_palette.js`) in both light and dark mode before being used. The
 * results that shaped this file:
 *
 *   - 5 categorical slots PASS on the *adjacent* pairlist (lines, bars), with a
 *     contrast WARN that obliges visible labels or a table view. Sector lines
 *     therefore carry direct end-labels.
 *   - 5 slots HARD FAIL on the *all-pairs* pairlist (scatter): magenta vs
 *     orange measures ΔE 12.9 normal-vision, below the 15 floor, which
 *     secondary encoding does not excuse.
 *   - A search of all 56 five-hue subsets found ZERO that pass all-pairs in
 *     both modes; of 70 four-hue subsets only 2 pass, neither a natural sector
 *     palette. So the risk/return scatter does not colour by sector at all —
 *     it uses two hues (stock vs crypto), which pass every check with room to
 *     spare, and carries a direct label on all 16 points.
 *
 * If you change a colour here, re-run the validator. Do not reason about it.
 */

/** Fixed sector → slot assignment.
 *
 * Colour follows the entity, never its rank: filtering or re-sorting must not
 * repaint the survivors. A reader who learned "Energy is orange" keeps that.
 */
export const SECTOR_ORDER = [
  "Technology",
  "Energy",
  "Financials",
  "Healthcare",
  "Crypto",
] as const;

export type Sector = (typeof SECTOR_ORDER)[number];

/** Categorical slots 1-5, light and dark steps (dark is selected, not flipped). */
const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
} as const;

/** Two hues for the scatter — slots 1 and 2, all-pairs validated. */
const ASSET_TYPE = {
  light: { stock: "#2a78d6", crypto: "#eb6834" },
  dark: { stock: "#3987e5", crypto: "#d95926" },
} as const;

/** Diverging pair for correlation: warm/cool poles, neutral gray midpoint.
 *  blue↔aqua was rejected upstream — two cool hues, midpoint doesn't read as
 *  "nothing". Correlation is inherently polar (-1..+1) so this is the right job. */
const DIVERGING = {
  light: { negative: "#2a78d6", mid: "#f0efec", positive: "#e34948" },
  dark: { negative: "#3987e5", mid: "#383835", positive: "#e66767" },
} as const;

export type Mode = "light" | "dark";

export function sectorColor(sector: string, mode: Mode): string {
  const index = SECTOR_ORDER.indexOf(sector as Sector);
  const slots = CATEGORICAL[mode];
  return slots[index >= 0 ? index : 0]!;
}

export function assetTypeColor(assetType: string, mode: Mode): string {
  return assetType === "crypto"
    ? ASSET_TYPE[mode].crypto
    : ASSET_TYPE[mode].stock;
}

/** Series colour for the single-asset price chart.
 *
 * This is an EMPHASIS form, not a categorical one: the close price is the
 * subject and the moving averages are context. Giving each MA its own
 * categorical hue would imply four peer series and bury the point.
 */
export function emphasisColors(mode: Mode) {
  return {
    primary: CATEGORICAL[mode][0]!,
    context: mode === "light" ? ["#8a8985", "#a8a7a2", "#c3c2bd"] : ["#8f8e88", "#767570", "#5e5d59"],
  };
}

/** Continuous mix across the diverging scale. `t` in [-1, 1]. */
export function divergingColor(t: number, mode: Mode): string {
  const { negative, mid, positive } = DIVERGING[mode];
  const clamped = Math.max(-1, Math.min(1, t));
  const target = clamped < 0 ? negative : positive;
  return mixHex(mid, target, Math.abs(clamped));
}

function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return rgbToHex(mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2]));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Relative luminance, for choosing ink that clears contrast inside a filled cell. */
export function inkOn(background: string): string {
  const [r, g, b] = hexToRgb(background).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#0b0b0b" : "#ffffff";
}

/** Mark specs, fixed across every chart in this app. */
export const MARK = {
  lineWidth: 2,
  contextLineWidth: 1.5,
  markerRadius: 4.5, // >= 8px diameter
  surfaceRing: 2,
  areaOpacity: 0.1,
} as const;
