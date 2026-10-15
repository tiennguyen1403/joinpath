import type { IsoDate } from '@joinpath/core';

const DAY: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};
const utc = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
const UTC_DAY = utc(DAY);
const UTC_DAY_YEAR = utc({ ...DAY, year: 'numeric' });
const UTC_MONTH_DAY = utc({ month: 'short', day: 'numeric' });
const UTC_DAY_IN_FULL = utc({ weekday: 'long', month: 'long', day: 'numeric' });
const atMidnight = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

/** "Mon, Oct 26". A business date is a calendar day (PLAN §4.6), so no time zone moves it. */
export const formatDate = (date: IsoDate) => UTC_DAY.format(atMidnight(date));

/** "Mon, Oct 26, 2026". */
export const formatDateLong = (date: IsoDate) =>
  UTC_DAY_YEAR.format(atMidnight(date));

/** "Oct 26". */
export const formatMonthDay = (date: IsoDate) =>
  UTC_MONTH_DAY.format(atMidnight(date));

/** "Monday, October 26". */
export const formatDateInFull = (date: IsoDate) =>
  UTC_DAY_IN_FULL.format(atMidnight(date));

const zoned = (
  timestamp: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(
    new Date(timestamp),
  );
const CLOCK: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** The calendar day of a real timestamp, where the company is. */
export const formatDateIn = (timestamp: string, timeZone: string) =>
  zoned(timestamp, timeZone, DAY);

/**
 * "Wed, Oct 14, 09:41": a real moment, where the company is. Never "Today": a sandbox's
 * business date may be ahead of the real one (PLAN §4.6).
 */
export const formatMomentIn = (timestamp: string, timeZone: string) =>
  zoned(timestamp, timeZone, { ...DAY, ...CLOCK });

/** "Oct 14, 09:41". */
export const formatShortMomentIn = (timestamp: string, timeZone: string) =>
  zoned(timestamp, timeZone, { month: 'short', day: 'numeric', ...CLOCK });

/** "09:41". */
export const formatTimeIn = (timestamp: string, timeZone: string) =>
  zoned(timestamp, timeZone, CLOCK);

// The API words its emails the same way.
export { capitalized, firstName, inWords } from '@joinpath/core';

/** "in 12 days", "today" or "3 days ago", counted from the org's today. */
export function formatFromToday(today: IsoDate, date: IsoDate) {
  const days = Math.round(
    (atMidnight(date).getTime() - atMidnight(today).getTime()) / 86_400_000,
  );
  const span = `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  return days === 0 ? 'today' : days > 0 ? `in ${span}` : `${span} ago`;
}
