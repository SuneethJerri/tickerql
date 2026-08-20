import { useEffect, useState } from "react";

export type Mode = "light" | "dark";

/** Tracks the effective colour mode.
 *
 * Charts need the resolved mode as a *value*, not just a CSS variable: Recharts
 * takes colours as props, and the palette's dark steps are separately selected
 * rather than derived, so they cannot be expressed as a CSS filter.
 */
export function useTheme() {
  const [override, setOverride] = useState<Mode | null>(
    () => (localStorage.getItem("theme") as Mode | null) ?? null,
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const mode: Mode = override ?? (systemDark ? "dark" : "light");

  useEffect(() => {
    const root = document.documentElement;
    if (override) root.setAttribute("data-theme", override);
    else root.removeAttribute("data-theme");
  }, [override]);

  const toggle = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setOverride(next);
    localStorage.setItem("theme", next);
  };

  return { mode, toggle };
}
