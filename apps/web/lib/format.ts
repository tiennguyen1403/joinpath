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
const atMidnight = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

/** "Mon, Oct 26". A business date is a calendar day (PLAN §4.6), so no time zone moves it. */
export const formatDate = (date: IsoDate) => UTC_DAY.format(atMidnight(date));

/** "Mon, Oct 26, 2026". */
export const formatDateLong = (date: IsoDate) =>
  UTC_DAY_YEAR.format(atMidnight(date));

/** "Oct 26". */
export const formatMonthDay = (date: IsoDate) =>
  UTC_MONTH_DAY.format(atMidnight(date));

/** The calendar day of a real timestamp, where the company is. */
export const formatDateIn = (timestamp: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { ...DAY, timeZone }).format(
    new Date(timestamp),
  );

// The API words its emails the same way.
export { capitalized, inWords } from '@joinpath/core';

/** "in 12 days", "today" or "3 days ago", counted from the org's today. */
export function formatFromToday(today: IsoDate, date: IsoDate) {
  const days = Math.round(
    (atMidnight(date).getTime() - atMidnight(today).getTime()) / 86_400_000,
  );
  const span = `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  return days === 0 ? 'today' : days > 0 ? `in ${span}` : `${span} ago`;
}
