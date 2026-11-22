/** Loading placeholder rows, shown until a region's first fetch lands. */
export function skeletonRows(n = 3): string {
  return `<div class="skel-stack" aria-hidden="true">${`<div class="skel skel-row"></div>`.repeat(n)}</div>`;
}
