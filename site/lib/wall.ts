/** #1081: wall-clock time. An entry keeps the wall time it was logged at:
 *  8–5 worked in California shows 8–5 when viewed from Florida, and lands on
 *  the day it was worked. Instants stay UTC (durations are zone-free); each
 *  entry records the IANA zone it was logged in (`time_entries.tz`), and
 *  every display or day-bucketing reads the entry's own zone. Entries logged
 *  before the column existed have tz NULL and keep the old behavior: they
 *  render in the zone you're viewing from.
 *
 *  Dependency-free: Intl does all the zone math. */

/** Validate an IANA zone string ("America/Chicago"); null when absent or
    invalid. "UTC" is accepted too. */
const validTzCache = new Map<string, string | null>();
export function validTz(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz || tz.length > 64) return null;
  if (tz !== "UTC" && !/^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)+$/.test(tz)) return null;
  const cached = validTzCache.get(tz);
  if (cached !== undefined) return cached;
  let result: string | null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); result = tz; } catch { result = null; }
  if (validTzCache.size >= 256) validTzCache.delete(validTzCache.keys().next().value!);
  validTzCache.set(tz, result);
  return result;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export type WallParts = { y: number; m: number; d: number; hh: number; mm: number; ss: number };

/** Wall-clock parts of an instant in a zone. A null zone means the server's
    own local time (the legacy fallback when no zone is known at all). */
export function wallParts(at: Date | string, tz: string | null): WallParts {
  const d = typeof at === "string" ? new Date(at) : at;
  if (!tz) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes(), ss: d.getSeconds() };
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour! % 24, mm: +p.minute!, ss: +p.second! };
}

const pad = (n: number) => String(n).padStart(2, "0");
/* #1544: the year pads to 4 digits like every other YMD builder
   (format.ts, calendar ymdUTC) — entryDay results are compared
   lexically against padded bounds, so a raw year under 1000 fell
   outside its own range. Wider/negative years stay as-is. */
export const ymdOf = (p: { y: number; m: number; d: number }) => `${p.y >= 0 && p.y <= 9999 ? String(p.y).padStart(4, "0") : p.y}-${pad(p.m)}-${pad(p.d)}`;
export const hmOf = (p: { hh: number; mm: number }) => `${pad(p.hh)}:${pad(p.mm)}`;

/** The zone an entry is shown in: its own, else the viewer's (legacy rows). */
export function entryZone(e: { tz?: string | null }, viewerTz: string | null): string | null {
  return validTz(e.tz) ?? viewerTz;
}

/** YYYY-MM-DD the entry was worked on, in its own zone. */
export function entryDay(e: { start_time: string; tz?: string | null }, viewerTz: string | null): string {
  return ymdOf(wallParts(e.start_time, entryZone(e, viewerTz)));
}

/* Milliseconds for a UTC wall time. Date.UTC maps years 0-99 to
   1900-1999, so build on base year 2000 and set the full year — the
   same trap normalizeEntryTimestamp avoids (#1434, #1532). */
function utcMs(y: number, mo: number, d: number, hh: number, mm: number, ss = 0): number {
  const dt = new Date(Date.UTC(2000, mo - 1, d, hh, mm, ss));
  dt.setUTCFullYear(y);
  return dt.getTime();
}

/** UTC offset of a zone at an instant, in minutes (CDT = -300). */
export function zoneOffsetMin(tz: string, at: Date): number {
  const p = wallParts(at, tz);
  const asUTC = utcMs(p.y, p.m, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** The UTC instant (ISO) of a wall time in a zone. Iterative: the offset is
    sampled at the guess and refined, converging across DST transitions. A
    wall time inside a spring-forward gap resolves to the later offset. */
export function wallToIso(ymd: string, hm: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const target = utcMs(y!, mo!, d!, hh!, mm!);
  let guess = target;
  for (let i = 0; i < 3; i++) guess = target - zoneOffsetMin(tz, new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

/** A bare "YYYY-MM-DDTHH:MM" wall time (what a datetime-local input or the
    calendar's time pickers produce) to a UTC ISO instant in `tz`. Null when
    the string isn't a bare wall time or names an impossible date. */
export function bareWallToIso(raw: unknown, tz: string): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!, hh = +m[4]!, mm = +m[5]!;
  const check = new Date(Date.UTC(2000, mo - 1, d, hh, mm));
  check.setUTCFullYear(y);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d
    || check.getUTCHours() !== hh || check.getUTCMinutes() !== mm) return null;
  const iso = wallToIso(`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}:${m[5]}`, tz);
  /* #1532: a zone offset can push a 9999/0000-edge wall time across the
     4-digit-year boundary into extended-year form — unaddressable when
     stored, so invalid like an impossible date. */
  return /^\d{4}-/.test(iso) ? iso : null;
}

/** Instant window that covers every entry whose wall day falls in
    [fromYmd, toYmdExclusive) in any zone: UTC offsets span −12h…+14h, so
    widen by a day on each side and let `onWallDays` do the exact cut. */
export function widenedWindow(fromYmd: string, toYmdExclusive: string): [string, string] {
  const from = new Date(`${fromYmd}T00:00:00.000Z`);
  const to = new Date(`${toYmdExclusive}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  /* #1534: an exclusive bound in year 10000+ (addDays past 9999-12-31)
     is not a parseable Date — it still means "past every stored entry". */
  if (Number.isNaN(to.getTime())) return [from.toISOString(), "9999-12-31T23:59:59.999Z"];
  to.setUTCDate(to.getUTCDate() + 1);
  const upper = to.toISOString();
  /* #1534: past 9999 the ISO string switches to extended-year form
     ("+010000-…"), and "+" sorts before digits — as a lexical SQL bound
     it would exclude every late-9999 entry before onWallDays can cut.
     Stored timestamps are 4-digit years, so clamp to the last one. */
  return [from.toISOString(), upper.startsWith("+") ? "9999-12-31T23:59:59.999Z" : upper];
}

/** A viewer's local day and zone, as the timer page sends them. */
export type WallDay = { day: string; tz: string };

/** Parse ?day=YYYY-MM-DD&tz=Zone; null unless both are valid. */
export function wallDayParam(day: unknown, tz: unknown): WallDay | null {
  const z = validTz(tz);
  if (!z || typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(utcMs(y!, m!, d!, 0, 0));
  if (dt.getUTCFullYear() !== y! || dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== d!) return null;
  return { day, tz: z };
}

/** Keep the entries whose own-zone wall day is in [fromYmd, toYmdExclusive). */
export function onWallDays<E extends { start_time: string; tz?: string | null }>(
  rows: E[], fromYmd: string, toYmdExclusive: string, viewerTz: string | null,
): E[] {
  return rows.filter((e) => { const d = entryDay(e, viewerTz); return d >= fromYmd && d < toYmdExclusive; });
}
