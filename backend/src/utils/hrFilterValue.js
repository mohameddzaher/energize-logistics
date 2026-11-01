/**
 * What a filter should say about an employee's field, shared by every HR filter so
 * the count and the rows agree. A value the employee cannot have is not "not set":
 * staff category exists only in two departments, and a field marked not required or
 * none is an answer, not a blank.
 */
const H = require('../config/hrFields');

const CATEGORY_DEPARTMENTS = ['B2C', 'النقل الثقيل'];
const ANSWER_CODES = ['not_required', 'none'];
const ANSWER_LABELS = ANSWER_CODES.map((c) => H.STATUS_LABELS[c].ar);

const fieldStatusOf = (row, key) => {
  const st = row?.fieldStatus;
  const sk = H.statusKeyOf(key);
  return (typeof st?.get === 'function' ? st.get(sk) : st?.[sk]) || '';
};

/** False when this field does not apply to this employee at all. */
const applies = (row, key) => key !== 'staffCategory' || CATEGORY_DEPARTMENTS.includes(String(row?.department || '').trim());

/** The label a blank field shows when HR recorded an answer for it, or ''. */
const answerOf = (row, key) => {
  const code = fieldStatusOf(row, key);
  return ANSWER_CODES.includes(code) ? H.STATUS_LABELS[code].ar : '';
};

module.exports = { CATEGORY_DEPARTMENTS, ANSWER_CODES, ANSWER_LABELS, applies, answerOf };
