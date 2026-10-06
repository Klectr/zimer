/** Inline SVG icon system: M3 outlined 24px style, no icon font.
 *  The svg carries width/height so bare usages default to 24px; CSS may override. */

export const ICONS: Record<string, string> = {
  timer: `<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9.5 2.5h5"/><path d="M12 2.5V5.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>`,
  group: `<circle cx="9" cy="8" r="3.5"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.8" cy="9" r="2.7"/><path d="M15.9 14.7c2.5.2 4.2 1.6 4.7 4.3"/>`,
  receipt: `<path d="M6 3.5h12V21l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8.5h6M9 12.5h6"/>`,
  download: `<path d="M12 4v11"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 20h14"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M6.5 14.5h4"/>`,
  add: `<path d="M12 5v14M5 12h14"/>`,
  chevron_left: `<path d="M14.5 6l-6 6 6 6"/>`,
  chevron_right: `<path d="M9.5 6l6 6-6 6"/>`,
  arrow_left: `<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>`,
  /* #473: repeat — restart a finished entry with one tap. */
  repeat: `<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`,
  delete: `<path d="M4 7h16"/><path d="M10 7V4.5h4V7"/><path d="M6.5 7l.9 13a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13"/><path d="M10 11v6M14 11v6"/>`,
  edit: `<path d="M4 20h4l11-11a1.8 1.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`,
  save: `<path d="M5.5 3.5h10L20 8v11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8 3.5V9h7V3.5"/><rect x="8" y="13" width="8" height="4.5" rx="0.5"/>`,
  palette: `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-.8 1.9-1.7 0-1.3-1.1-1.7-1.1-2.8 0-1.1.9-2 2.2-2h2.1a3.9 3.9 0 0 0 3.9-3.9c0-3.6-4-6.6-9-6.6z"/><circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/>`,
  play: `<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>`,
  logout: `<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor" stroke="none"/>`,
  /* #251: proper 8-tooth cog — the old circle-and-rays read as a sun/brightness
     icon. Outlined to match the M3 icon system. */
  settings: `<path d="M 18.90 10.34 L 20.91 10.75 L 20.91 13.25 L 18.90 13.66 A 7.1 7.1 0 0 1 18.05 15.71 L 19.19 17.42 L 17.42 19.19 L 15.71 18.05 A 7.1 7.1 0 0 1 13.66 18.90 L 13.25 20.91 L 10.75 20.91 L 10.34 18.90 A 7.1 7.1 0 0 1 8.29 18.05 L 6.58 19.19 L 4.81 17.42 L 5.95 15.71 A 7.1 7.1 0 0 1 5.10 13.66 L 3.09 13.25 L 3.09 10.75 L 5.10 10.34 A 7.1 7.1 0 0 1 5.95 8.29 L 4.81 6.58 L 6.58 4.81 L 8.29 5.95 A 7.1 7.1 0 0 1 10.34 5.10 L 10.75 3.09 L 13.25 3.09 L 13.66 5.10 A 7.1 7.1 0 0 1 15.71 5.95 L 17.42 4.81 L 19.19 6.58 L 18.05 8.29 A 7.1 7.1 0 0 1 18.90 10.34 Z"/><circle cx="12" cy="12" r="3.1"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  /* #404: warning triangle for error statuses (M3 error-outline style). */
  alert: `<path d="M12 4.5L21 19.5H3z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r="1.1" fill="currentColor" stroke="none"/>`,
  /* #448: bolt for the "Paid via Stripe" chip — the last emoji in the UI
     leaves the icon system here. M3 outlined 24px, matches the set. */
  bolt: `<path d="M13 2L4.5 13.5H11L9.5 22L18.5 10.5H12Z"/>`,
  /* #542: trend trio for the calendar week-over-week delta — the last text
     glyphs (↑/↓/→) in the UI give way to the icon system. Feather-style,
     M3 outlined 24px, matches the set. */
  trend_up: `<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>`,
  trend_down: `<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>`,
  trend_flat: `<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/>`,
  /* #654: distinct icons for the app-bar actions — a spreadsheet grid for
     Export entries CSV and a database for Download backup, so the two
     no longer share the generic download glyph. Lucide-style, M3
     outlined 24px, matching the set. */
  table: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.3h18M3 14.6h18M9 9.3V20"/>`,
  database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
};

export function icon(name: keyof typeof ICONS): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Brand mark: a hand-drawn hand keeping a wobbly clock. Drawn on a 64-grid
 *  (stroke-width 4) rather than the 24-grid M3 icon set, so it keeps its
 *  doodle proportions at any size. currentColor for theming. */
const LOGO_CLOCK = `<path d="M 34 9.5 C 41 9.5 45.5 15 45.5 22 C 45.5 29 41 34.5 34 34.5 C 27 34.5 20.5 29 20.5 22.2 C 20.5 15.2 26 10 33 9.6"/>`;
const LOGO_HANDS = `<path d="M 33 22 C 32.9 19.5 32.9 17.5 33 15"/><path d="M 33 22 C 34.8 22.8 36.5 23.6 38.2 24.4"/><circle cx="33" cy="22" r="2.4" fill="currentColor" stroke="none"/>`;
const LOGO_CUP = `<path d="M 11 35 C 15 49 25 56 35 56 C 45 56 53 48 55 37"/><path d="M 11 35 C 9 31 10 27 13 25"/><path d="M 55 37 C 57 33 56 29 53 27"/>`;
export function logo(size = 24, spinHands = false): string {
  /* #406: spinHands wraps the clock hands in a group so CSS can rotate them
     (update-check progress state). Default output is byte-identical to before. */
  const hands = spinHands ? `<g class="tk-logo-hands">${LOGO_HANDS}</g>` : LOGO_HANDS;
  const cls = spinHands ? ` class="tk-logo-spinning"` : "";
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LOGO_CLOCK}${hands}${LOGO_CUP}</svg>`;
}
