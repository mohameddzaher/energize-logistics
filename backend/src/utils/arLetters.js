/**
 * Persian letters in Arabic names are mapped back to Arabic.
 * The company name spelled with the three-dot Persian jeem existed as a second owner of one name, splitting the company across counts and searches (2,356 sheets on one form and about five thousand on the other). Platform input passes through here so the variant does not return.
 */
const MAP = { 'چ': 'ج', 'پ': 'ب', 'ڤ': 'ف', 'ک': 'ك', 'ی': 'ي', 'ۀ': 'ه' };
const arLetters = (s) => String(s ?? '').replace(/[چپڤکیۀ]/g, (c) => MAP[c] || c);
module.exports = { arLetters };
