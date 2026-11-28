import type { Story } from "../.zandbox/story";

const COLOR_TOKENS = [
  "primary", "success", "warning", "error", "info",
  "text", "text-secondary", "text-tertiary", "text-quaternary",
  "bg-layout", "bg-container", "bg-elevated", "bg-spotlight",
  "border", "border-secondary",
  "fill", "fill-secondary", "fill-tertiary", "fill-quaternary",
];

function swatches(): string {
  return (
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">` +
    COLOR_TOKENS.map(
      (name) =>
        `<div style="border:1px solid var(--color-border-secondary);border-radius:var(--radius-lg);overflow:hidden">` +
        `<div style="height:44px;background:var(--color-${name})"></div>` +
        `<div style="padding:8px 10px;font-size:var(--font-size-sm)">--color-${name}</div></div>`,
    ).join("") +
    `</div>`
  );
}

export const tokenStories: Story[] = [
  {
    id: "tokens-css-vars",
    group: "Tokens",
    title: "Color — from style.css variables",
    render: swatches,
  },
  {
    id: "tokens-surfaces",
    group: "Tokens",
    title: "Surface stack",
    render: () =>
      `<div style="background:var(--color-bg-layout);padding:var(--spacing);border-radius:var(--radius-lg)">` +
      `<div style="background:var(--color-bg-container);padding:var(--spacing);border-radius:var(--radius);border:1px solid var(--color-border-secondary)">` +
      `<div style="background:var(--color-bg-elevated);padding:var(--spacing);border-radius:var(--radius);box-shadow:var(--box-shadow-tertiary)">` +
      `<span style="font-size:var(--font-size)">Container → elevated</span></div></div></div>`,
  },
  {
    id: "tokens-type",
    group: "Tokens",
    title: "Type scale",
    render: () =>
      `<div style="display:grid;gap:var(--spacing-xs)">` +
      `<div style="font-size:var(--font-size-heading-3);font-weight:var(--font-weight-strong)">Heading 3 · 24</div>` +
      `<div style="font-size:var(--font-size-xl)">XL · 20</div>` +
      `<div style="font-size:var(--font-size-lg)">Large · 16</div>` +
      `<div style="font-size:var(--font-size)">Base · 14</div>` +
      `<div style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">Small · 12, secondary text</div>` +
      `<div style="font-family:var(--font-family-code);font-size:var(--font-size)">Mono · 1h 24m · $2,550.00</div>` +
      `</div>`,
  },
];
