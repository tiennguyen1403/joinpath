import type { IsoDate } from '@joinpath/core';

const DAY: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};
const utc = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
const UTC_DAY_YEAR = utc({ ...DAY, year: 'numeric' });
const UTC_MONTH_DAY = utc({ month: 'short', day: 'numeric' });
const atMidnight = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

/** "Mon, Oct 26, 2026". A business date is a calendar day (PLAN §4.6), so no time zone moves it. */
export const formatDateLong = (date: IsoDate) =>
  UTC_DAY_YEAR.format(atMidnight(date));

/** "Oct 26". */
export const formatMonthDay = (date: IsoDate) =>
  UTC_MONTH_DAY.format(atMidnight(date));

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

// The API words its emails and notifications the same way.
export {
  capitalized,
  firstName,
  formatDate,
  formatDateInFull,
  inWords,
} from '@joinpath/core';

/** Calendar days from one date to another, negative when it is sooner. */
export const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round(
    (atMidnight(to).getTime() - atMidnight(from).getTime()) / 86_400_000,
  );

/** "in 12 days", "today" or "3 days ago", counted from the org's today. */
export function formatFromToday(today: IsoDate, date: IsoDate) {
  const days = daysBetween(today, date);
  const span = `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  return days === 0 ? 'today' : days > 0 ? `in ${span}` : `${span} ago`;
}

/** "2 days later", "a week sooner": how far a date moved. */
export function formatShift(days: number) {
  const span =
    Math.abs(days) === 1
      ? 'a day'
      : Math.abs(days) === 7
        ? 'a week'
        : `${Math.abs(days)} days`;
  return `${span} ${days > 0 ? 'later' : 'sooner'}`;
}
