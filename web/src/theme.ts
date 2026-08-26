/** Themes and accents - the single source of truth for both.
 *
 * There used to be two independent `Mode` unions, one here and one in
 * charts/palette.ts, that typechecked against each other by accident. There is
 * now one `ThemeName`, and chart code keys on it directly.
 *
 * Every surface below was run through the dataviz validator against its OWN
 * categorical set in charts/palette.ts, adjacent and all-pairs, before being
 * added. Adding a theme here is therefore not enough on its own: run
 * web/scripts/build_palettes.mjs, which reads this table, searches that
 * surface for a set that clears every gate, and prints the block to paste into
 * charts/palette.ts. A theme with no set of its own will not compile.
 */

export const THEME_NAMES = ["light", "dark", "midnight", "graphite", "sepia"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** Four inks, not four brand colours.
 *
 * The previous set was blue/purple/green/orange, and its blue was `#2a78d6` -
 * OKLab dE 0.0 from categorical slot one. The accent WAS the chart's blue, so a
 * button and a data series were the same colour and the page had no way to say
 * which saturated things carry meaning. These four were picked by an OKLCH
 * sweep against three gates, all measured: WCAG >= 3.0 against every surface in
 * their base (actual 5.15-11.35), WCAG >= 4.5 against their own ink (6.59-11.35),
 * and OKLab dE >= 15 from EVERY categorical hue in their base (15.0-20.2).
 * Data owns the hues; chrome wears ink. */
export const ACCENT_NAMES = ["teal", "plum", "ochre", "oxblood"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** Which band of the validator a surface is measured in - OKLCH L 0.43-0.77
 *  for a light ground, 0.48-0.67 for a dark one. This is no longer what picks
 *  a theme's colours (every theme has its own set now); it is the one fact
 *  about a surface the palette generator cannot infer, and it lives here so
 *  there is one copy of it rather than one here and one in the script. */
export type ChartBase = "light" | "dark";

export interface Theme {
  readonly label: string;
  readonly chartBase: ChartBase;
  readonly colorScheme: "light" | "dark";
  /** The chart surface (`--surface-1` in styles.css), as passed to the validator. */
  readonly surface: string;
  /** The raised panel (`--surface-2`). The SQL artifact sits on this, and its
   *  syntax colours are TEXT, so they are measured against this and not against
   *  the chart surface. */
  readonly panel: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light:    { label: "Light",    chartBase: "light", colorScheme: "light", surface: "#f7f9fb", panel: "#dee4ec" },
  dark:     { label: "Dark",     chartBase: "dark",  colorScheme: "dark",  surface: "#1a1a19", panel: "#232322" },
  midnight: { label: "Midnight", chartBase: "dark",  colorScheme: "dark",  surface: "#121826", panel: "#1a2233" },
  graphite: { label: "Graphite", chartBase: "dark",  colorScheme: "dark",  surface: "#2c2c2e", panel: "#3a3a3c" },
  sepia:    { label: "Sepia",    chartBase: "light", colorScheme: "light", surface: "#fbf6e9", panel: "#ece1c8" },
};

/** The hexes are here as well as in styles.css because the palette generator
 *  has to keep every series colour away from them, and it cannot read CSS.
 *  `check_palettes.mjs` parses styles.css and fails if the two ever disagree,
 *  so this is a second copy that cannot drift silently. */
export const ACCENTS: Record<AccentName, { label: string; hex: Record<ChartBase, string> }> = {
  teal:    { label: "Teal",    hex: { light: "#016869", dark: "#7fd3ce" } },
  plum:    { label: "Plum",    hex: { light: "#8a1e6e", dark: "#dda8fe" } },
  ochre:   { label: "Ochre",   hex: { light: "#744c00", dark: "#e5be6b" } },
  oxblood: { label: "Oxblood", hex: { light: "#97202b", dark: "#f0a9a0" } },
};

export const DEFAULT_THEME: ThemeName = "light";
export const DEFAULT_ACCENT: AccentName = "teal";

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && (THEME_NAMES as readonly string[]).includes(v);
}

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === "string" && (ACCENT_NAMES as readonly string[]).includes(v);
}
