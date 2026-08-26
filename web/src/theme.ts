/** Themes and accents - the single source of truth for both.
 *
 * There used to be two independent `Mode` unions, one here and one in
 * charts/palette.ts, that typechecked against each other by accident. There is
 * now one `ThemeName`, and chart code asks a theme for its `chartBase` rather
 * than assuming the theme name is also a chart mode.
 *
 * Every surface below was run through the dataviz validator against the
 * categorical set in charts/palette.ts, adjacent and all-pairs, before being
 * added. Check a new surface with web/scripts/validate_palette.js.
 */

export const THEME_NAMES = ["light", "dark", "midnight", "graphite", "sepia"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const ACCENT_NAMES = ["blue", "purple", "green", "orange"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** Which set of chart series steps a theme uses. Series colours are selected
 *  for a light or a dark surface; a theme picks the set its surface belongs to
 *  rather than each theme carrying its own hexes. */
export type ChartBase = "light" | "dark";

export interface Theme {
  readonly label: string;
  readonly chartBase: ChartBase;
  readonly colorScheme: "light" | "dark";
  /** The chart surface, as passed to the validator. */
  readonly surface: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light:    { label: "Light",    chartBase: "light", colorScheme: "light", surface: "#fcfcfb" },
  dark:     { label: "Dark",     chartBase: "dark",  colorScheme: "dark",  surface: "#1a1a19" },
  midnight: { label: "Midnight", chartBase: "dark",  colorScheme: "dark",  surface: "#121826" },
  graphite: { label: "Graphite", chartBase: "dark",  colorScheme: "dark",  surface: "#2c2c2e" },
  sepia:    { label: "Sepia",    chartBase: "light", colorScheme: "light", surface: "#fbf6e9" },
};

export const ACCENTS: Record<AccentName, { label: string }> = {
  blue:   { label: "Blue" },
  purple: { label: "Purple" },
  green:  { label: "Green" },
  orange: { label: "Orange" },
};

export const DEFAULT_THEME: ThemeName = "light";
export const DEFAULT_ACCENT: AccentName = "blue";

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && (THEME_NAMES as readonly string[]).includes(v);
}

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === "string" && (ACCENT_NAMES as readonly string[]).includes(v);
}
