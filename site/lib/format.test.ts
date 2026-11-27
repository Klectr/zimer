import { describe, expect, test } from "bun:test";
import { addDays, clientColor, clientDay, clientTermsDescription, dayBounds, daysBetween, sundayOf, termsDescription, csvCell, fmtDur, greeting, safeCssColor, schemeColor, shortDateRange, shortDateRangeYear, shortYmd, utcWeekday, validYmd } from "./format.ts";

describe("addDays", () => {
  test("crosses month and year boundaries", () => {
    expect(addDays("2026-11-24", 1)).toBe("2026-11-25");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("years 0-99 stay their own years, not 1900-1999 (#1534)", () => {
    expect(addDays("0000-02-29", 1)).toBe("0000-03-01");
    expect(addDays("0099-03-01", 1)).toBe("0099-03-02");
    expect(addDays("9999-12-31", 1)).toBe("10000-01-01");
  });
});

describe("utcWeekday year edges (#1538)", () => {
  test("years 0-99 keep their own weekday, matching sundayOf", () => {
    expect(utcWeekday(99, 6, 15)).toBe(1);
    expect(utcWeekday(0, 2, 29)).toBe(2);
    expect(addDays("0099-06-15", -utcWeekday(99, 6, 15))).toBe(sundayOf("0099-06-15"));
    expect(addDays("0000-02-29", -utcWeekday(0, 2, 29))).toBe("0000-02-27");
  });

  test("ordinary years are unchanged", () => {
    expect(utcWeekday(2026, 11, 25)).toBe(3);
    expect(utcWeekday(2026, 11, 22)).toBe(0);
  });
});

describe("daysBetween / dayBounds / sundayOf year edges (#1536)", () => {
  test("daysBetween counts across the 0099 to 0100 boundary", () => {
    expect(daysBetween("0099-12-31", "0100-01-01")).toBe(1);
    expect(daysBetween("0099-01-01", "0099-01-02")).toBe(1);
    expect(daysBetween("0000-02-28", "0000-03-01")).toBe(2);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
  });

  test("dayBounds stay in the requested year and span one day", () => {
    const [from, to] = dayBounds("0099-06-15");
    expect(from).toContain("0099-");
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(86_400_000);
  });

  test("sundayOf stays in the requested year", () => {
    expect(sundayOf("0099-06-15")).toBe("0099-06-14");
    expect(sundayOf("2026-11-25")).toBe("2026-11-22");
  });

  test("dayBounds starts at local midnight in a midnight-transition zone", () => {
    const child = Bun.spawnSync({
      cmd: ["bun", "-e", `import("./site/lib/format.ts").then(m => console.log(new Date(m.dayBounds("2026-10-15")[0]).getHours()))`],
      cwd: process.cwd(),
      env: { ...process.env, TZ: "America/Santiago" },
    });
    expect(child.stdout.toString().trim()).toBe("0");
  });
});

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
    expect(csvCell("x\ry")).toBe("\"x\ry\"");
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
    expect(schemeColor("#f2c14e")).toBe("var(--color-primary)");
    expect(schemeColor("#F2C14E")).toBe("var(--color-primary)");
  });
  test("explicitly chosen colors pass through untouched", () => {
    expect(schemeColor("#9050f2")).toBe("#9050f2");
    expect(schemeColor("#fb923c")).toBe("#fb923c");
    expect(schemeColor("#9aa0a6")).toBe("#9aa0a6");
  });
  test("nullish colors pass through for call-site fallbacks", () => {
    expect(schemeColor(null)).toBeNull();
    expect(schemeColor(undefined)).toBeUndefined();
    expect(schemeColor("#60a5fa;position:fixed;inset:0")).toBeUndefined();
    expect(schemeColor("red")).toBeUndefined();
    expect(schemeColor("var(--color-primary)")).toBe("var(--color-primary)");
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

describe("greeting", () => {
  const at = (h: number) => new Date(2026, 10, 9, h, 0, 0);
  test("morning before noon", () => {
    expect(greeting(at(0))).toBe("Good morning");
    expect(greeting(at(5))).toBe("Good morning");
    expect(greeting(at(11))).toBe("Good morning");
  });
  test("afternoon from noon to 17:00", () => {
    expect(greeting(at(12))).toBe("Good afternoon");
    expect(greeting(at(16))).toBe("Good afternoon");
  });
  test("evening from 17:00", () => {
    expect(greeting(at(17))).toBe("Good evening");
    expect(greeting(at(23))).toBe("Good evening");
  });
});

describe("client-facing terms wording", () => {
  test("clientTermsDescription says invoice, never Zinvoice", () => {
    expect(clientTermsDescription("net_30")).toBe("Payment is due within 30 days of the invoice date.");
    expect(clientTermsDescription("due_on_receipt")).toBe("Payment is due upon receipt of this invoice.");
    expect(termsDescription("net_30")).toContain("Zinvoice"); // in-app text keeps the product word
  });
});

describe("clientDay", () => {
  const now = new Date("2026-11-22T02:30:00Z"); // 8:30pm Nov 21 in Chicago
  test("accepts the user's day within one day of UTC", () => {
    expect(clientDay("2026-11-21", now)).toBe("2026-11-21");
    expect(clientDay("2026-11-22", now)).toBe("2026-11-22");
    expect(clientDay("2026-11-23", now)).toBe("2026-11-23");
  });
  test("rejects malformed, impossible, or far-off days", () => {
    for (const v of ["", "11/21/2026", "2026-11-2", "2026-02-30", "2026-11-19", "2026-11-25", null, 20261121]) expect(clientDay(v as any, now)).toBeNull();
  });
});

describe("validYmd", () => {
  test("accepts any real calendar day, however far off", () => {
    expect(validYmd("2026-11-07")).toBe("2026-11-07");
    expect(validYmd("1999-01-31")).toBe("1999-01-31");
    expect(validYmd(" 2026-02-28 ")).toBe("2026-02-28");
  });
  test("rejects malformed and impossible days", () => {
    for (const v of ["", "11/07/2026", "2026-11-7", "2026-02-30", "2026-13-01", "2026-00-10", null, undefined, 20261107]) expect(validYmd(v as any)).toBeNull();
  });
});
