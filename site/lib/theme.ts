/** #884: app theme — the accent color family behind the :root --primary vars
 *  (site/static/style.css). Stored per-database in meta ("theme"); pumpkin is
 *  the default. Tones are dark-scheme M3 palettes: crimson is the M3 error
 *  palette, blue the M3 blue palette; green and yellow follow the same
 *  light-on-dark contrast shape. */

export interface ThemeDef {
  key: string;
  name: string;
  primary: string;
  onPrimary: string;
  container: string;
  onContainer: string;
}

export const THEMES: ThemeDef[] = [
  { key: "pumpkin", name: "Pumpkin", primary: "#fb923c", onPrimary: "#442100", container: "#713d00", onContainer: "#ffdcc2" },
  { key: "crimson", name: "Crimson", primary: "#ffb4a8", onPrimary: "#690005", container: "#93000a", onContainer: "#ffdad4" },
  { key: "blue", name: "Blue", primary: "#a8c7fa", onPrimary: "#0a305f", container: "#284777", onContainer: "#d3e3fd" },
  { key: "green", name: "Green", primary: "#9be1a0", onPrimary: "#053204", container: "#174d22", onContainer: "#b7f0b1" },
  { key: "yellow", name: "Yellow", primary: "#ffe07d", onPrimary: "#3a2a00", container: "#554500", onContainer: "#ffecb3" },
];

export const DEFAULT_THEME = "pumpkin";

/** Validate a stored/form value — anything unknown degrades to the default. */
export function themeKey(raw: unknown): string {
  const k = String(raw ?? "").trim().toLowerCase();
  return THEMES.some((t) => t.key === k) ? k : DEFAULT_THEME;
}

export function themeByKey(key: string): ThemeDef {
  return THEMES.find((t) => t.key === themeKey(key))!;
}

/** The :root override emitted into the app layout's <head>. Always concrete
 *  values (pumpkin when unset), so the page never renders unthemed. */
export function themeCss(key: string): string {
  const t = themeByKey(key);
  return `:root{--primary:${t.primary};--on-primary:${t.onPrimary};--primary-container:${t.container};--on-primary-container:${t.onContainer};}`;
}
