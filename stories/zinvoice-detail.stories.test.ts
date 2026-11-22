import { describe, expect, test } from "bun:test";
import { zinvoiceDetailStories } from "./zinvoice-detail.stories";
import config from "../zandbox.config";

describe("zinvoice detail stories", () => {
  test("cover the head, every status, the share card states, chart, proof and notes", () => {
    const all = zinvoiceDetailStories.map((s) => s.render()).join("");
    expect(all).toContain('class="detail-title no-print"');
    for (const c of ["ui-chip-draft", "ui-chip-sent", "ui-chip-overdue", "ui-chip-paid", "stripe-paid-chip"]) expect(all).toContain(c);
    expect(all).toContain("ui-progress-fill-error");
    expect(all).toContain('class="share-url"');
    expect(all).toContain("Create client link");
    expect(all).toContain('class="share-label warn"');
    expect(all).toContain('class="tb-chart"');
    expect(all).toContain('class="proof-row"');
    expect(all).toContain("proof-nudge");
    expect(all).toContain("internal-notes");
  });

  test("are registered in the Zandbox config", () => {
    const ids = config.stories.map((s) => s.id);
    for (const s of zinvoiceDetailStories) expect(ids).toContain(s.id);
  });
});
