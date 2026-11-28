import { describe, expect, test } from "bun:test";
import { zinvoicesStories } from "./zinvoices.stories";
import config from "../zandbox.config";

describe("zinvoices stories", () => {
  test("render every status and the empty state", () => {
    const all = zinvoicesStories.map((s) => s.render()).join("");
    expect(all).toContain('class="ui-card inv-table-card"');
    for (const chip of ["ui-chip-draft", "ui-chip-sent", "ui-chip-overdue", "ui-chip-paid"]) expect(all).toContain(chip);
    expect(all).toContain("20d");
    expect(all).toContain("Due Dec 12");
    expect(all).toContain('role="tooltip" id="inv-tip-INV-1038">Paid Oct 18</span>');
    expect(all).toContain('tabindex="0" aria-describedby="inv-tip-INV-1045"');
    expect(all).not.toContain(">Issued<");
    expect(all).toContain("<em>No client</em>");
    expect(all).toContain("No Zinvoices match this filter.");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of zinvoicesStories) expect(ids).toContain(s.id);
  });
});

