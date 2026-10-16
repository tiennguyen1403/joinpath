// Workflow dates are calendar days with no time of day (PLAN §4.6). They travel as
// 'YYYY-MM-DD' strings, which compare correctly with < and >.
export type IsoDate = string;

/**
 * The org's business date: today in its time zone, moved on by the demo clock. Takes `now`
 * so the core never reads the clock itself.
 */
export function today(
  timeZone: string,
  clockOffsetDays: number,
  now: Date,
): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  return addDays(
    `${part('year')}-${part('month')}-${part('day')}`,
    clockOffsetDays,
  );
}

/** Counted in UTC, so the machine's own time zone never moves the result. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A move of the demo clock: from `at` on, the org's business date ran `offsetDays` ahead. */
export interface ClockAdvance {
  at: Date;
  offsetDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A real moment as the org lived it (PLAN §4.6): moved on by the days the demo clock was ahead
 * then, as the last advance up to it left it, or 0 before any. A moment still to come, such as
 * an invitation's expiry, goes by the clock as it is now. `history` runs oldest first.
 * ponytail: whole 24-hour days, so across a DST change the time of day slips an hour; move
 * the date in the org's zone if a sandbox ever runs in one with DST.
 */
export function businessMoment(moment: Date, history: ClockAdvance[]): Date {
  const offsetDays =
    history.findLast((advance) => advance.at <= moment)?.offsetDays ?? 0;
  return new Date(moment.getTime() + offsetDays * DAY_MS);
}
