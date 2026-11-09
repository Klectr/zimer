import { describe, expect, test } from "bun:test";
import { card } from "./card";

describe("card", () => {
  test("renders a div with the ui-card class and the given content", () => {
    expect(card({ content: "<p>Hello</p>" })).toBe('<div class="ui-card"><p>Hello</p></div>');
  });

  test("tracking variant adds the tracking class", () => {
    expect(card({ content: "x", tracking: true })).toBe('<div class="ui-card tracking">x</div>');
  });

  test("id is included and escaped", () => {
    expect(card({ content: "x", id: "timer-card" })).toContain('id="timer-card"');
    expect(card({ content: "x", id: 'a"b' })).toContain('id="a&quot;b"');
    expect(card({ content: "x", id: 'a"b' })).not.toContain('id="a"b"');
  });
});
