const COLOR_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/;

export function parseDesignTokens(md: string): [string, string][] {
  const lines = md.split("\n");
  const open = lines.indexOf("---");
  const close = open === -1 ? -1 : lines.indexOf("---", open + 1);
  if (open === -1 || close === -1) throw new Error("DESIGN.md: YAML frontmatter not found");
  const out: [string, string][] = [];
  let inColors = false;
  for (const line of lines.slice(open + 1, close)) {
    if (/^colors:/.test(line)) { inColors = true; continue; }
    if (!inColors) continue;
    if (/^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+(\w+):\s*"?([^"\n]+?)"?\s*$/);
    if (!m) continue;
    const [, name, value] = m;
    if (!COLOR_VALUE.test(value)) {
      throw new Error(`DESIGN.md: color token ${name} has an unsupported value: ${value}`);
    }
    out.push([name, value]);
  }
  if (out.length === 0) throw new Error("DESIGN.md: no color tokens parsed");
  return out;
}
