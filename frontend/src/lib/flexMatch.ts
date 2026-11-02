// Matching that ignores spaces and spelling variants.
// Frontend twin of backend/src/utils/plateKey.js. The server searches with flexSpaceRegex and returns the right row, then the screen re-filtered it with a literal match, dropping the row the server just found and showing an empty screen. That happened in all the document tabs: registry search found the plate while operating cards did not, though they call the same endpoint. Saudi plates have three letters and a number, trailers two with the third slot left empty (two spaces); we store one space.
export const flexNormalize = (v: unknown): string => String(v ?? '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي').replace(/[ؤو]/g, 'و')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();

/** Whether any of the fields contains the search text after folding; empty text means all. */
export const flexIncludes = (needle: unknown, ...fields: unknown[]): boolean => {
  const n = flexNormalize(needle);
  if (!n) return true;
  return fields.some((f) => flexNormalize(f).includes(n));
};

/**
 * One plate display format for the whole system; twin of formatPlate in backend/src/utils/plateKey.js.
 * A twin is needed because waybills and reports render on the server while tables render in the browser; differing rules would show the plate one way on screen and another on paper. It used to be written in four formats with meaningless differences (two or three spaces, lower or upper case Latin, Arabic or Western digits). Rule: Western digits, Arabic letters spaced, Latin letters joined and uppercase.
 */
export const formatPlate = (v: unknown): string => {
  if (v == null) return '';
  const raw = String(v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  if (!raw) return '';
  const digitsMatch = raw.match(/\d+/);
  if (!digitsMatch) return raw.replace(/\s+/g, ' ');
  const digits = digitsMatch[0];
  const before = raw.slice(0, digitsMatch.index).trim();
  const after = raw.slice((digitsMatch.index || 0) + digits.length).trim();
  // Arabic letters are separated by a space as read on the plate; Latin letters are joined and uppercase as written on the licence.
  const tidy = (part: string) => (/[A-Za-z]/.test(part)
    ? part.replace(/\s+/g, '').toUpperCase()
    : part.split(/\s+/).filter(Boolean).join(' '));
  // Letters on both sides of the number stay on both sides. E.g. "Car 4263 SNA" has letters before and after the number; keeping one side would delete part of what is written on the plate, which is destruction, not formatting.
  const head = before ? tidy(before) : '';
  const tail = after ? tidy(after) : '';
  if (!head && !tail) return digits;
  return [head, digits, tail].filter(Boolean).join(' ');

};
