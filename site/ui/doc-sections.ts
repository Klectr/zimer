import { esc } from "../lib/format";

/** Public document pages (privacy, terms): a heading + paragraph per
 *  section, and the footer line. Body text is escaped unless the section
 *  opts into trusted HTML (authored links in our own copy, never user data). */
export interface DocSection {
  heading: string;
  body: string;
  /** Trusted, authored HTML (e.g. a link). */
  html?: boolean;
}

export function docSections(sections: DocSection[]): string {
  return sections.map((s) => `
      <section class="changelog-release">
        <h2 class="ui-app-title">${esc(s.heading)}</h2>
        <p>${s.html ? s.body : esc(s.body)}</p>
      </section>`).join("");
}

/** "Shared securely via Zimer · Changelog · Terms" */
export function publicFoot(links: { label: string; href: string }[] = []): string {
  const tail = links.map((l) => ` · <a href="${esc(l.href)}">${esc(l.label)}</a>`).join("");
  return `<p class="muted tiny no-print public-foot">Shared securely via Zimer${tail}</p>`;
}
