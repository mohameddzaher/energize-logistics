/**
 * Atlas Search over the operations reports' text fields.
 * A contains-regex over 23 fields read ~600k index keys per query (0.7-1 s each, eight queries per search). The search index keeps each field as one folded term, so a contains-match runs on Lucene's term dictionary instead.
 * Folding mirrors utils/arabicSearch (alef, ta marbuta, ya and waw forms, diacritics, Arabic-Indic digits, case).
 * Codes also drop spaces, as searchKey does (a container or plate written with or without spaces is one value). Names keep them: without spaces 'دهام حمد' would contain 'محمد'.
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
  ' ': ' ', '\t': ' ',
  'ً': '', 'ٌ': '', 'ٍ': '', 'َ': '', 'ُ': '', 'ِ': '', 'ّ': '', 'ْ': '', 'ٰ': '', 'ـ': '',
};
const COMPACT_MAP = { ...FOLD_MAP, ' ': '', ' ': '', '\t': '' };

/** The query side of the same folding (Lucene does not analyze wildcard terms). `compact` drops spaces, as the code fields are indexed. */
const foldTerm = (s, compact = false) => {
  const map = compact ? COMPACT_MAP : FOLD_MAP;
  let out = '';
  for (const ch of String(s || '')) out += Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
  // Wildcard syntax characters are escaped so a typed * or ? is matched literally.
  return out.trim().toLowerCase().replace(/[\\*?]/g, '\\$&');
};

/**
 * The $search stage for a contains-match of `term`: names on the spaced form, codes on the compact one.
 * `namesOnly` is the whole-phrase alternative; the regex it replaces allowed any spacing between the words, so the phrase is also tried without spaces.
 */
function searchStage(term, { namesOnly = false } = {}) {
  const spaced = foldTerm(term);
  const compact = foldTerm(term, true);
  if (!compact) return null;
  const should = [{ wildcard: { path: NAME_FIELDS, query: `*${spaced}*`, allowAnalyzedField: true } }];
  if (namesOnly && compact !== spaced) should.push({ wildcard: { path: NAME_FIELDS, query: `*${compact}*`, allowAnalyzedField: true } });
  if (!namesOnly) should.push({ wildcard: { path: CODE_FIELDS, query: `*${compact}*`, allowAnalyzedField: true } });
  return { $search: { index: INDEX_NAME, compound: { should, minimumShouldMatch: 1 } } };
}

const nameDef = { type: 'string', analyzer: 'folded', searchAnalyzer: 'folded' };
const codeDef = { type: 'string', analyzer: 'foldedCompact', searchAnalyzer: 'foldedCompact' };
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
  for (const f of NAME_FIELDS) setPath(fields, f, nameDef);
  for (const f of CODE_FIELDS) setPath(fields, f, codeDef);
  const analyzer = (name, mappings) => ({ name, charFilters: [{ type: 'mapping', mappings }], tokenizer: { type: 'keyword' }, tokenFilters: [{ type: 'lowercase' }] });
  return {
    analyzers: [analyzer('folded', FOLD_MAP), analyzer('foldedCompact', COMPACT_MAP)],
    mappings: { dynamic: false, fields },
  };
}

module.exports = { INDEX_NAME, NAME_FIELDS, CODE_FIELDS, foldTerm, searchStage, definition };
