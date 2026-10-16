import type { IsoDate } from './dates.js';

// Shared by the web's copy and the API's emails and notifications.

// A business date is a calendar day (PLAN §4.6), so no time zone moves it.
const utcDay = (options: Intl.DateTimeFormatOptions) => {
  const format = new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC',
  });
  return (date: IsoDate) => format.format(new Date(`${date}T00:00:00Z`));
};

/** "Mon, Oct 26". */
export const formatDate = utcDay({
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "Monday, October 26". */
export const formatDateInFull = utcDay({
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

// Small counts read as words, as the canvas writes them: "Two people have the IT role".
const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
export const inWords = (n: number) => WORDS[n] ?? String(n);
export const capitalized = (text: string) =>
  text[0].toUpperCase() + text.slice(1);

// What a person is called by: "An" for An Vo.
export const firstName = (fullName: string) => fullName.split(' ')[0];
