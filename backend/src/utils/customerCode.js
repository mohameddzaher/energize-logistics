/**
 * Customer code — the customer's identity across every section (owner's rule,
 * 2026-10-29): records are matched by code first, the name is for display.
 * The code lives on the master (CrmCompany.customerCode) and is copied to every
 * linked register by services/customerHub (collections keep it in `code`).
 */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Latin digits, no spaces, upper case: «c ١٢٣» and «C123» are one code. */
function normCode(v) {
  return String(v == null ? '' : v)
    .replace(ARABIC_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(d) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Schema path for a register's copy of the code (normalised on write). */
const codeField = (extra = {}) => ({ type: String, trim: true, default: '', index: true, set: normCode, ...extra });

module.exports = { normCode, codeField };
