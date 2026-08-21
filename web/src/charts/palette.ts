/**
 * Chart palette, validated rather than chosen by eye.
 *
 * Eight categorical slots pass the ADJACENT pairlist (lines, bars) in both
 * modes. The ALL-PAIRS pairlist used by scatter and small multiples caps at
 * THREE - no five-hue subset of 56 passes it, and only 2 of 70 four-hue subsets
 * do. So the risk/return scatter uses two hues (stock vs crypto), and the
 * sector small multiples use one hue for every panel: position and the panel
 * label carry sector identity, not colour, which is why that form survives 19
 * sectors when a 19-line chart cannot.
 *
 * Re-run the validator if you change a colour here.
 */

/** Categorical slots 1-8, light and dark steps (dark is selected, not flipped).
 *
 * Eight is the ceiling on the ADJACENT pairlist (lines, bars) and is validated
 * in both modes. The ALL-PAIRS pairlist used by scatter and small multiples
 * caps at THREE - see SCATTER_HUES. There is no ordering of eight that clears
 * all-pairs, so a ninth series folds into "Other" or the chart facets; hues are
 * never generated. */
const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

/** The first three slots are the only ones that validate all-pairs. */
export const SCATTER_HUE_CAP = 3;

/** Two hues for the scatter - slots 1 and 2, all-pairs validated. */
const ASSET_TYPE = {
  light: { stock: "#2a78d6", crypto: "#eb6834" },
  dark: { stock: "#3987e5", crypto: "#d95926" },
} as const;

/** Diverging pair for correlation: warm/cool poles, neutral gray midpoint.
 *  blue↔aqua was rejected upstream - two cool hues, midpoint doesn't read as
 *  "nothing". Correlation is inherently polar (-1..+1) so this is the right job. */
const DIVERGING = {
  light: { negative: "#2a78d6", mid: "#f0efec", positive: "#e34948" },
  dark: { negative: "#3987e5", mid: "#383835", positive: "#e66767" },
} as const;

/** Chart series are selected for a light or a dark surface. A theme declares
 *  which set it uses via `chartBase`; this is NOT the theme name. Re-declaring
 *  a second `Mode` union here is what let the two drift silently before. */
export type { ChartBase } from "../theme";
import type { ChartBase } from "../theme";

/** Colour for a sector, assigned by position in `sectors`.
 *
 * Takes the caller's sector list rather than a fixed global order, because the
 * universe now has 19 sectors and the old SECTOR_ORDER only knew five - an
 * unknown sector fell back to slot 0 and rendered in Technology's blue with no
 * error. Past the categorical cap this returns null so the caller must decide
 * (fold to "Other", or facet); it never wraps around and reuses a hue. */
export function sectorColor(
  sector: string,
  sectors: readonly string[],
  mode: ChartBase,
): string | null {
  const index = sectors.indexOf(sector);
  const slots = CATEGORICAL[mode];
  if (index < 0 || index >= slots.length) return null;
  return slots[index]!;
}

/** Neutral for anything past the categorical cap. */
export function otherColor(mode: ChartBase): string {
  return CONTEXT_GREYS[mode][0]!;
}

export function assetTypeColor(assetType: string, mode: ChartBase): string {
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
const CONTEXT_GREYS = {
  light: ["#8a8985", "#a8a7a2", "#c3c2bd"],
  dark: ["#8f8e88", "#767570", "#5e5d59"],
} as const;

export function emphasisColors(mode: ChartBase) {
  // A keyed lookup, not a ternary. The ternary silently returned the dark
  // greys for any value that was not exactly "light", so adding a chart base
  // would have compiled and been wrong.
  return { primary: CATEGORICAL[mode][0]!, context: [...CONTEXT_GREYS[mode]] };
}

/** Continuous mix across the diverging scale. `t` in [-1, 1]. */
export function divergingColor(t: number, mode: ChartBase): string {
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
