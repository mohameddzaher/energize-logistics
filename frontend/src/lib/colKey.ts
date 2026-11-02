/**
 * The value as read, for column filter lists.
 * Two values that differ only by whitespace (including a non-breaking space) read the same on screen, so they are one entry in the list. Values that look different (hamza variants, Arabic vs Western digits) stay different, as in Excel.
 * Server counterpart: backend/src/utils/colFilter.normKey; the rule is the same.
 */
const SPACE_RUN = new RegExp(
  '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200f\\u202a-\\u202f\\u205f\\u2060-\\u206f\\u3000\\ufeff]+',
  'g',
);

export const colKey = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).replace(SPACE_RUN, ' ').trim();
};
