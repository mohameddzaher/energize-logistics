/**
 * Atlas Search over the operations reports' text fields.
 * A contains-regex over 23 fields read ~600k index keys per query (0.7-1 s each, eight queries per search). The search index keeps each field as one folded term, so a contains-match runs on Lucene's term dictionary instead.
 * Folding mirrors utils/arabicSearch (alef, ta marbuta, ya and waw forms, diacritics, Arabic-Indic digits, case) and drops spaces, as searchKey does: a container or plate written with or without spaces is one value.
 * The index follows the collection on its own, so no write path has to maintain it.
 */
const INDEX_NAME = 'workflow_text';

// Same lists as buildWorkflowFilter: names and places, then codes.
const NAME_FIELDS = [
  'username', 'carOwner', 'driverName', 'branch', 'payingBranch',
  'fromLocation', 'toLocation', 'finalReportDestination',
  'truckType', 'truckSize', 'agentName', 'representativeName',
  'ownerName', 'carName', 'product',
];
const CODE_FIELDS = ['carNumber', 'plateNumber', 'customsLink.refNumber', 'customsLink.blNumber', 'customsLink.containersText', 'loadNumber', 'reference', 'invoiceRef'];

const FOLD_MAP = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  ' ': '', ' ': '', '\t': '',
  'ً': '', 'ٌ': '', 'ٍ': '', 'َ': '', 'ُ': '', 'ِ': '', 'ّ': '', 'ْ': '', 'ٰ': '', 'ـ': '',
};

/** The query side of the same folding; Lucene does not analyze wildcard terms, so the term is folded here. */
const foldTerm = (s) => {
  let out = '';
  for (const ch of String(s || '')) out += Object.prototype.hasOwnProperty.call(FOLD_MAP, ch) ? FOLD_MAP[ch] : ch;
  // Wildcard syntax characters are escaped so a typed * or ? is matched literally.
  return out.toLowerCase().replace(/[\\*?]/g, '\\$&');
};

const fieldDef = { type: 'string', analyzer: 'folded', searchAnalyzer: 'folded' };
const setPath = (obj, path, def) => {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] = cur[parts[i]] || { type: 'document', fields: {} };
    cur = cur[parts[i]].fields;
  }
  cur[parts[parts.length - 1]] = def;
};

function definition() {
  const fields = {};
  for (const f of [...NAME_FIELDS, ...CODE_FIELDS]) setPath(fields, f, fieldDef);
  return {
    analyzers: [{
      name: 'folded',
      charFilters: [{ type: 'mapping', mappings: FOLD_MAP }],
      tokenizer: { type: 'keyword' },
      tokenFilters: [{ type: 'lowercase' }],
    }],
    mappings: { dynamic: false, fields },
  };
}

module.exports = { INDEX_NAME, NAME_FIELDS, CODE_FIELDS, foldTerm, definition };
