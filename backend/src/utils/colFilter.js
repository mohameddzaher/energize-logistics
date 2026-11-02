/**
 * Column filters: the list shows what its selection returns, with the same count.
 * Stored values differ only in whitespace (trailing, repeated, non-breaking U+00A0) because sync and import skip schema `trim`; Mongoose also trims query values, so selecting the padded variant returned zero.
 * Values that read identically are one value: merged into one list line, and selecting it matches all variants with a fixed pattern (not trimmed). Visibly different values (alef forms, digit scripts, case) stay different.
 */

// Everything that renders as blank or not at all. `\s` in the Mongo regex engine excludes non-breaking space and its siblings, so they are listed explicitly.
// The characters are written as themselves, not escapes: `\u00a0` is JavaScript syntax and the Mongo engine (PCRE) rejects it, so the class is built from the characters.
const SPACE_CHARS = `\\s\u00a0\u1680\u180e\u2000-\u200f\u202a-\u202f\u205f\u2060-\u206f\u3000\ufeff`;
const SP = `[${SPACE_CHARS}]`;
const SPACE_RUN_RX = new RegExp(`${SP}+`, 'g');
const BLANK_RX = new RegExp(`^${SP}*$`);

/** The value as read: a single blank between words and nothing at the ends. */
function normKey(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).replace(SPACE_RUN_RX, ' ').trim();
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A pattern matching every stored value that reads as `v`, whatever its whitespace.
 * An empty value (or whitespace only) matches the 'nothing but whitespace' pattern.
 */
function textMatcher(v) {
  const k = normKey(v);
  if (!k) return BLANK_RX;
  return new RegExp(`^${SP}*${k.split(' ').map(escapeRx).join(`${SP}+`)}${SP}*$`);
}

/** What 'blank' means: field missing, null, empty string or whitespace only. */
const BLANK_VALUES = ['', null, BLANK_RX];

/**
 * Condition 'column equals one of these values' for a text column.
 * `values` as received from the list; `''` (or anything the caller reads as empty) means blank.
 */
function textIn(field, values) {
  const list = [];
  let blank = false;
  for (const v of values || []) {
    if (!normKey(v)) { blank = true; continue; }
    list.push(textMatcher(v));
  }
  if (blank) list.push(...BLANK_VALUES);
  if (!list.length) return null;
  return { [field]: { $in: list } };
}

/**
 * Merges list values that read identically into one line (`value` is the read form).
 * `rows`: [{ value, count }]; order is recomputed after merging by each line's count.
 * `keyOf` is for non-text values (date/number), which are left as they are.
 */
function mergeOptions(rows, { keyOf = normKey } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyOf(r.value);
    m.set(k, (m.get(k) || 0) + (Number(r.count) || 0));
  }
  return [...m.entries()].map(([value, count]) => ({ value, count }));
}

/** Counts a column's values from in-memory rows, by the read key. */
function tallyRows(rows, read, { blank = '' } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const k = normKey(read(r)) || blank;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

module.exports = {
  SPACE_CHARS, BLANK_RX, BLANK_VALUES, normKey, textMatcher, textIn, mergeOptions, tallyRows,
};
