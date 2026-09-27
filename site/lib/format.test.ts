import { describe, expect, test } from "bun:test";
import { shortDateRange, shortDateRangeYear, shortYmd } from "./format.ts";

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
