import type { IsoDate } from '@joinpath/core';

const DAY: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};
const UTC_DAY = new Intl.DateTimeFormat('en-US', { ...DAY, timeZone: 'UTC' });

/** "Mon, Oct 26". A business date is a calendar day (PLAN §4.6), so no time zone moves it. */
export const formatDate = (date: IsoDate) =>
  UTC_DAY.format(new Date(`${date}T00:00:00Z`));

/** The calendar day of a real timestamp, where the company is. */
export const formatDateIn = (timestamp: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { ...DAY, timeZone }).format(
    new Date(timestamp),
  );
