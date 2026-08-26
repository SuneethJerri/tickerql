import { useCallback, useEffect, useState } from "react";
import {
  ACCENT_NAMES,
  AccentName,
  DEFAULT_ACCENT,
  ThemeName,
  isAccentName,
  isThemeName,
} from "./theme";

const THEME_KEY = "theme";
const ACCENT_KEY = "accent";

/** `null` means follow the OS. The previous version had no way back to this
 *  once a theme was chosen. */
export type ThemeChoice = ThemeName | null;

function readStored<T>(key: string, guard: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    // Previously cast without checking, so a stale value was written straight
    // to data-theme with no matching CSS rule and silently fell back to light.
    return guard(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    readStored(THEME_KEY, isThemeName),
  );
  const [accent, setAccentState] = useState<AccentName>(
    () => readStored(ACCENT_KEY, isAccentName) ?? DEFAULT_ACCENT,
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: ThemeName = choice ?? (systemDark ? "dark" : "light");

  useEffect(() => {
    const root = document.documentElement;
    // Only stamp when the user chose. Leaving it unstamped is what lets the
    // prefers-color-scheme block apply.
    if (choice) root.setAttribute("data-theme", choice);
    else root.removeAttribute("data-theme");
    root.setAttribute("data-accent", accent);
  }, [choice, accent]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next) localStorage.setItem(THEME_KEY, next);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      /* private mode; the choice still applies for this session */
    }
  }, []);

  const setAccent = useCallback((next: AccentName) => {
    setAccentState(next);
    try {
      localStorage.setItem(ACCENT_KEY, next);
    } catch {
      /* as above */
    }
  }, []);

  return {
    theme,
    accent,
    choice,
    setTheme,
    setAccent,
    followsSystem: choice === null,
    accents: ACCENT_NAMES,
  };
}
