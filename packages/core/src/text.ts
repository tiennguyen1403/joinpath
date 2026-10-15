// Shared by the web's copy and the API's emails.

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
