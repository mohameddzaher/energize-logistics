/**
 * Customer emails: more than one address.
 * `emails` is the list and the legacy `email` stays as its first item so existing readers do not break. Anyone needing the recipients reads from here, and every save goes through `normalizeEmails`.
 */
const RX = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

/** Clean list: split by comma or newline, lower-cased, duplicates and malformed removed. */
function normalizeEmails(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;،]+/);
  const out = [];
  for (const x of raw) {
    const e = String(x || '').trim().toLowerCase();
    if (e && RX.test(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, 10);
}

/** Every known email for the party: the list, then the legacy one. */
const emailsOf = (p = {}) => normalizeEmails([...(p.emails || []), p.email || '']);

/** Sets both fields together in a save body if either is sent. */
function applyEmails(body) {
  if (body.emails === undefined && body.email === undefined) return body;
  const list = normalizeEmails(body.emails !== undefined ? body.emails : body.email);
  body.emails = list;
  body.email = list[0] || '';
  return body;
}

module.exports = { normalizeEmails, emailsOf, applyEmails, isEmail: (e) => RX.test(String(e || '').trim()) };
