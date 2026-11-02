/**
 * invoiceNumberKey: matches an invoice number between the collections ledger and the operations manifests.
 * The same number is written in different forms (Arabic digits, leading zeros, trailing space, dashes), so it is folded before comparing: whitespace, separators and leading zeros are removed and remaining letters upper-cased.
 * 'No invoice' is not a number: a manifest whose invoice field says none, 'no inv' or zero is not yet invoiced. Treating it as text would group thousands of manifests under one fake invoice (see the 'no inv' placeholder note).
 */
const NO_INVOICE = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|ىى|0|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;

function invoiceNumberKey(v) {
  const raw = v == null ? '' : String(v).trim();
  if (!raw || NO_INVOICE.test(raw)) return '';
  const s = raw.replace(/[\s\-_/\\]+/g, '');
  if (!s) return '';
  const digits = s.match(/^0*(\d+)$/);
  return digits ? digits[1] : s.toUpperCase();
}

module.exports = { invoiceNumberKey, NO_INVOICE };
