/**
 * Arabic search tolerant of spelling variants (alef forms, ta marbuta vs ha, ya vs alef maqsura), Arabic-Indic vs Latin digits and extra spaces.
 * Both ends are left unanchored because searching part of a name or number is the common case.
 */

/** Arabic-Indic digits to Latin: the two forms of 2585 are the same number. */
const westernDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/**
 * Regular expression tolerant of Arabic letter variants and spacing.
 * @param {string} s search text as typed by the user
 * @returns {RegExp}
 */
const arabicSearchRegex = (s) => {
  const body = westernDigits(String(s || '').trim())
    // Regex symbols are escaped first: text containing an opening parenthesis would otherwise throw on the whole group.
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Diacritics and tatweel are ignored: text is copied from documents and typed without them.
    .replace(/[ً-ْـ]/g, '')
    .replace(/[اأإآٱ]/g, '[اأإآٱ]')
    .replace(/[هة]/g, '[هة]')
    .replace(/[يىئ]/g, '[يىئ]')
    .replace(/[وؤ]/g, '[وؤ]')
    .replace(/\s+/g, '\\s*');
  return new RegExp(body, 'i');
};

/** `$or` condition over a list of fields, built once and reusable. */
const searchOr = (fields, s) => {
  const rx = arabicSearchRegex(s);
  return fields.map((f) => ({ [f]: rx }));
};

/**
 * Comparison key for in-memory search: both the text and the query are folded the same way, then containment is tested.
 * Beyond what `arabicSearchRegex` folds, all separators are dropped, not just spaces: a container number is written with spaces, with a dash or with none, and a waybill number is copied from email with a dash and from paper without; they are one number.
 */
const searchKey = (s) => westernDigits(String(s == null ? '' : s))
  .toLowerCase()
  .replace(/[ً-ْٰـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/[ىئ]/g, 'ي')
  .replace(/ؤ/g, 'و')
  // Spaces, dashes, dots, slashes and similar separators.
  .replace(/[\s\-_./\\,:;#|'"()[\]{}–—]+/g, '');

module.exports = { arabicSearchRegex, searchOr, westernDigits, searchKey };
