import type { Story } from "../.zandbox/story";
import { docSections, publicFoot } from "../site/ui/doc-sections";

/* Fictional data only. */
export const publicPagesStories: Story[] = [
  {
    id: "public-doc-sections",
    group: "Public pages",
    title: "Privacy / terms — sections and footer",
    render: () => `<main class="page-public page-changelog" style="margin:0">` +
      docSections([
        { heading: "What we store", body: "Your clients, projects, time entries and Zinvoices — nothing else." },
        { heading: "Analytics", html: true, body: "The hosted site uses <a href=\"#\">a product analytics tool</a>. Self-hosted instances send us nothing." },
        { heading: "Deletion", body: "Email support from your account address and we'll delete everything." },
      ]) +
      publicFoot([{ label: "Changelog", href: "#" }, { label: "Terms", href: "#" }]) +
      `</main>`,
  },
];
