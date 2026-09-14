/** Inline SVG icon system: M3 outlined 24px style, no icon font.
 *  The svg carries width/height so bare usages default to 24px; CSS may override. */

export const ICONS: Record<string, string> = {
  timer: `<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9.5 2.5h5"/><path d="M12 2.5V5.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>`,
  group: `<circle cx="9" cy="8" r="3.5"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.8" cy="9" r="2.7"/><path d="M15.9 14.7c2.5.2 4.2 1.6 4.7 4.3"/>`,
  receipt: `<path d="M6 3.5h12V21l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8.5h6M9 12.5h6"/>`,
  doc: `<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/>`,
  download: `<path d="M12 4v11"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 20h14"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M6.5 14.5h4"/>`,
  add: `<path d="M12 5v14M5 12h14"/>`,
  chevron_left: `<path d="M14.5 6l-6 6 6 6"/>`,
  chevron_right: `<path d="M9.5 6l6 6-6 6"/>`,
  arrow_left: `<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>`,
  delete: `<path d="M4 7h16"/><path d="M10 7V4.5h4V7"/><path d="M6.5 7l.9 13a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13"/><path d="M10 11v6M14 11v6"/>`,
  edit: `<path d="M4 20h4l11-11a1.8 1.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`,
  save: `<path d="M5.5 3.5h10L20 8v11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8 3.5V9h7V3.5"/><rect x="8" y="13" width="8" height="4.5" rx="0.5"/>`,
  palette: `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-.8 1.9-1.7 0-1.3-1.1-1.7-1.1-2.8 0-1.1.9-2 2.2-2h2.1a3.9 3.9 0 0 0 3.9-3.9c0-3.6-4-6.6-9-6.6z"/><circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/>`,
  play: `<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>`,
  logout: `<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor" stroke="none"/>`,
};

export function icon(name: keyof typeof ICONS): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
