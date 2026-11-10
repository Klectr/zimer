import { describe, expect, test } from "bun:test";
import { tooltip } from "./tooltip";
import { iconButton } from "./icon-button";

describe("tooltip", () => {
  test("renders the bubble with role=tooltip and the given id; label escaped", () => {
    const html = tooltip({ id: "t1", label: "Edit <b>entry</b>", contentHtml: "<button>x</button>" });
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('id="t1"');
    expect(html).not.toContain("<b>entry</b>");
    expect(html).toContain("ui-tooltip-bubble");
  });

  test("end alignment adds its modifier class", () => {
    expect(tooltip({ id: "t4", label: "L", align: "end", contentHtml: "" })).toContain("is-align-end");
  });

  test("start alignment adds its modifier class", () => {
    expect(tooltip({ id: "t5", label: "L", align: "start", contentHtml: "" })).toContain("is-align-start");
  });

  test("bottom placement adds the modifier class", () => {
    expect(tooltip({ id: "t2", label: "L", placement: "bottom", contentHtml: "" })).toContain("ui-tooltip is-bottom");
    expect(tooltip({ id: "t3", label: "L", contentHtml: "" })).not.toContain("is-bottom");
  });
});

describe("iconButton tooltip integration", () => {
  test("tooltip mode wraps the button, wires aria-describedby, drops native title", () => {
    const html = iconButton({ icon: "edit", label: "Edit entry", id: "ib1", tooltip: true });
    expect(html).toContain("ui-tooltip");
    expect(html).toContain('aria-describedby="ib1-tip"');
    expect(html).toContain('id="ib1-tip"');
    expect(html).not.toContain('title="');
  });

  test("tooltip mode without an id throws (bubble ids must be addressable)", () => {
    expect(() => iconButton({ icon: "edit", label: "Edit entry", tooltip: true })).toThrow();
  });

  test("plain mode uses the house data-tip and no wrapper (#1103)", () => {
    const html = iconButton({ icon: "edit", label: "Edit entry" });
    expect(html).toContain('data-tip="Edit entry"');
    expect(html).not.toContain('title="Edit entry"');
    expect(html).not.toContain("ui-tooltip");
  });
});
