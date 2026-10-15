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
