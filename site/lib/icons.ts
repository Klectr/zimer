/** Inline SVG icon system: Lucide-style stroke icons on the 24 grid
 *  (2px stroke, round caps and joins, no fills). Geometry follows the
 *  Lucide set (ISC licensed, lucide.dev). The svg carries width/height
 *  so bare usages default to 24px; CSS may override. */

export const ICONS: Record<string, string> = {
  timer: `<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>`,
  group: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  receipt: `<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`,
  check: `<polyline points="20 6 9 17 4 12"/>`,
  card: `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>`,
  add: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  /* #949: hamburger for the compact navigation drawer. */
  menu: `<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>`,
  chevron_left: `<polyline points="15 18 9 12 15 6"/>`,
  chevron_right: `<polyline points="9 18 15 12 9 6"/>`,
  arrow_left: `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  refresh: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`,
  /* #473: repeat — restart a finished entry with one tap. */
  repeat: `<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`,
  delete: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`,
  edit: `<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>`,
  save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>`,
  palette: `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-.8 1.9-1.7 0-1.3-1.1-1.7-1.1-2.8 0-1.1.9-2 2.2-2h2.1a3.9 3.9 0 0 0 3.9-3.9c0-3.6-4-6.6-9-6.6z"/><circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
  play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>`,
  /* #251: proper 8-tooth cog — the old circle-and-rays read as a sun/brightness
     icon. Outlined to match the stroke set. */
  settings: `<path d="M 18.90 10.34 L 20.91 10.75 L 20.91 13.25 L 18.90 13.66 A 7.1 7.1 0 0 1 18.05 15.71 L 19.19 17.42 L 17.42 19.19 L 15.71 18.05 A 7.1 7.1 0 0 1 13.66 18.90 L 13.25 20.91 L 10.75 20.91 L 10.34 18.90 A 7.1 7.1 0 0 1 8.29 18.05 L 6.58 19.19 L 4.81 17.42 L 5.95 15.71 A 7.1 7.1 0 0 1 5.10 13.66 L 3.09 13.25 L 3.09 10.75 L 5.10 10.34 A 7.1 7.1 0 0 1 5.95 8.29 L 4.81 6.58 L 6.58 4.81 L 8.29 5.95 A 7.1 7.1 0 0 1 10.34 5.10 L 10.75 3.09 L 13.25 3.09 L 13.66 5.10 A 7.1 7.1 0 0 1 15.71 5.95 L 17.42 4.81 L 19.19 6.58 L 18.05 8.29 A 7.1 7.1 0 0 1 18.90 10.34 Z"/><circle cx="12" cy="12" r="3.1"/>`,
  close: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
  /* #404: warning triangle for error statuses. */
  alert: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`,
  /* #448: bolt for the "Paid via Stripe" chip — the last emoji in the UI
     leaves the icon system here. */
  bolt: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  /* #542: trend trio for the calendar week-over-week delta — the last text
     glyphs (↑/↓/→) in the UI give way to the icon system. */
  trend_up: `<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>`,
  trend_down: `<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>`,
  trend_flat: `<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/>`,
  /* #654: distinct icons for the app-bar actions — a spreadsheet grid for
     Export entries CSV and a database for Download backup, so the two
     no longer share the generic download glyph. */
  table: `<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>`,
  database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
};

export function icon(name: keyof typeof ICONS): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Brand mark: a hand-drawn hand keeping a wobbly clock. Drawn on a 64-grid
 *  (stroke-width 4) rather than the 24-grid stroke icon set, so it keeps its
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
