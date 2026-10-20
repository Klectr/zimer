import { describe, expect, test } from "bun:test";
import { clientColor, csvCell, fmtDur, schemeColor, shortDateRange, shortDateRangeYear, shortYmd } from "./format.ts";

/* #914: CSV formula injection — cells starting with =, +, - or @ (after
   leading whitespace) get a single-quote prefix so Excel/Sheets open them
   as text instead of executing them as formulas. */
describe("csvCell", () => {
  test("neutralizes formula prefixes", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+123")).toBe("'+123");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@handle")).toBe("'@handle");
    expect(csvCell(" =cmd|' /c calc'!A0")).toBe("' =cmd|' /c calc'!A0");
  });
  test("prefix survives quote escaping", () => {
    expect(csvCell("=1+1,\"x\"")).toBe("\"'=1+1,\"\"x\"\"\"");
  });
  test("ordinary cells keep existing quoting behavior", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("he said \"hi\"")).toBe("\"he said \"\"hi\"\"\"");
    expect(csvCell("x\ny")).toBe("\"x\ny\"");
    expect(csvCell("no trigger at start: = sign")).toBe("no trigger at start: = sign");
  });
});

/* #582: the invoice detail billing period is year-aware so it matches the
   PDF and is never ambiguous across year boundaries. */
describe("shortDateRangeYear", () => {
  test("same-year range carries one year", () => {
    expect(shortDateRangeYear("2026-09-01", "2026-09-28")).toBe("Sep 1 – Sep 28, 2026");
  });
  test("cross-year range carries both years", () => {
    expect(shortDateRangeYear("2026-12-20", "2027-01-05")).toBe("Dec 20, 2026 – Jan 5, 2027");
  });
  test("single date carries the year", () => {
    expect(shortDateRangeYear("2026-09-01", "2026-09-01")).toBe("Sep 1, 2026");
    expect(shortDateRangeYear("2026-09-01", null)).toBe("Sep 1, 2026");
  });
  test("empty from stays empty", () => {
    expect(shortDateRangeYear(null, "2026-09-28")).toBe("");
    expect(shortDateRangeYear(undefined, undefined)).toBe("");
  });
});

/* shortDateRange (per-line date cells) stays yearless — unchanged. */
describe("shortDateRange", () => {
  test("range and single date have no year", () => {
    expect(shortDateRange("2026-09-01", "2026-09-28")).toBe("Sep 1 – Sep 28");
    expect(shortDateRange("2026-09-01", "2026-09-01")).toBe("Sep 1");
    expect(shortDateRange(null, "2026-09-28")).toBe("");
  });
});

describe("shortYmd", () => {
  test("formats and passes through garbage", () => {
    expect(shortYmd("2026-09-01")).toBe("Sep 1");
    expect(shortYmd("nope")).toBe("nope");
  });
});

/* #596: whole-minute durations drop the pointless 00s; #817: whole-hour
   durations drop the pointless 00m ("15h", not "15h 00m"). */
describe("fmtDur", () => {
  test("hours branch pads nonzero minutes, drops 00m", () => {
    expect(fmtDur(54000)).toBe("15h");
    expect(fmtDur(23400)).toBe("6h 30m");
  });
  test("whole minutes drop the 00s", () => {
    expect(fmtDur(1800)).toBe("30m");
    expect(fmtDur(3600)).toBe("1h");
    expect(fmtDur(60)).toBe("1m");
  });
  test("nonzero seconds stay", () => {
    expect(fmtDur(204)).toBe("3m 24s");
    expect(fmtDur(45)).toBe("45s");
  });
});

/* #841: rows stored under the legacy gold default track the theme primary. */
describe("schemeColor", () => {
  test("legacy gold maps to the theme primary variable", () => {
    expect(schemeColor("#f2c14e")).toBe("var(--md-sys-color-primary)");
    expect(schemeColor("#F2C14E")).toBe("var(--md-sys-color-primary)");
  });
  test("explicitly chosen colors pass through untouched", () => {
    expect(schemeColor("#9050f2")).toBe("#9050f2");
    expect(schemeColor("#fb923c")).toBe("#fb923c");
    expect(schemeColor("#9aa0a6")).toBe("#9aa0a6");
  });
  test("nullish colors pass through for call-site fallbacks", () => {
    expect(schemeColor(null)).toBeNull();
    expect(schemeColor(undefined)).toBeUndefined();
  });
});

describe("clientColor (#990)", () => {
  test("plain #rrggbb values pass through", () => {
    expect(clientColor("#fb923c")).toBe("#fb923c");
    expect(clientColor("#7CC4FF")).toBe("#7CC4FF");
    expect(clientColor("  #b39ddb ")).toBe("#b39ddb");
  });
  test("anything else falls back to the brand default", () => {
    expect(clientColor("#fff;position:fixed;inset:0")).toBe("#fb923c");
    expect(clientColor("red")).toBe("#fb923c");
    expect(clientColor("#fff")).toBe("#fb923c");
    expect(clientColor("")).toBe("#fb923c");
    expect(clientColor(null)).toBe("#fb923c");
    expect(clientColor(undefined)).toBe("#fb923c");
  });
});
