/**
 * Contains-search on Atlas Search, shared by the collections whose search was a regex over many fields (operations reports, shipment orders).
 * A regex over N fields scans every report's keys or documents; the search index keeps each field as one folded term, so the contains-match runs on Lucene's term dictionary.
 * Folding mirrors utils/arabicSearch (alef, ta marbuta, ya and waw forms, diacritics, Arabic-Indic digits, case).
 * Name fields keep spaces (without them 'دهام حمد' would contain 'محمد'); code fields drop them, as searchKey does (a plate or container written with or without spaces is one value).
 * The index follows its collection on its own, so no write path maintains it.
 */
const FOLD_MAP = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  ' ': ' ', '\t': ' ',
  'ً': '', 'ٌ': '', 'ٍ': '', 'َ': '', 'ُ': '', 'ِ': '', 'ّ': '', 'ْ': '', 'ٰ': '', 'ـ': '',
};
const COMPACT_MAP = { ...FOLD_MAP, ' ': '', ' ': '', '\t': '' };

/** The query side of the same folding (Lucene does not analyze wildcard terms). `compact` drops spaces, as code fields are indexed. */
const foldTerm = (s, compact = false) => {
  const map = compact ? COMPACT_MAP : FOLD_MAP;
  let out = '';
  for (const ch of String(s || '')) out += Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
  // Wildcard syntax characters are escaped so a typed * or ? is matched literally.
  return out.trim().toLowerCase().replace(/[\\*?]/g, '\\$&');
};

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

/**
 * One searchable collection: its index name and the two field lists.
 * `searchStage(term, { namesOnly })`: names are tried spaced and, when the term has spaces, compact as well (the regex it replaces allowed any spacing between words); codes compact.
 */
function textSearchIndex({ collection, name, nameFields, codeFields }) {
  function searchStage(term, { namesOnly = false } = {}) {
    const spaced = foldTerm(term);
    const compact = foldTerm(term, true);
    if (!compact) return null;
    const should = [{ wildcard: { path: nameFields, query: `*${spaced}*`, allowAnalyzedField: true } }];
    if (compact !== spaced) should.push({ wildcard: { path: nameFields, query: `*${compact}*`, allowAnalyzedField: true } });
    if (!namesOnly && codeFields.length) should.push({ wildcard: { path: codeFields, query: `*${compact}*`, allowAnalyzedField: true } });
    return { $search: { index: name, compound: { should, minimumShouldMatch: 1 } } };
  }

  function definition() {
    const fields = {};
    for (const f of nameFields) setPath(fields, f, nameDef);
    for (const f of codeFields) setPath(fields, f, codeDef);
    const analyzer = (n, mappings) => ({ name: n, charFilters: [{ type: 'mapping', mappings }], tokenizer: { type: 'keyword' }, tokenFilters: [{ type: 'lowercase' }] });
    return { analyzers: [analyzer('folded', FOLD_MAP), analyzer('foldedCompact', COMPACT_MAP)], mappings: { dynamic: false, fields } };
  }

  /**
   * Ids of `model` documents containing `term`; null when the index cannot answer (not built, unavailable, or more than `cap` matches to pass as a list), so the caller keeps its regex.
   */
  async function ids(model, term, { namesOnly = false, cap = 15000 } = {}) {
    const stage = searchStage(term, { namesOnly });
    if (!stage) return null;
    try {
      const rows = await model.aggregate([stage, { $limit: cap + 1 }, { $project: { _id: 1 } }]);
      return rows.length > cap ? null : rows.map((r) => r._id);
    } catch (e) {
      if (!ids.warned) { ids.warned = true; console.warn(`[search ${name}] Atlas Search unavailable, using regex:`, e.message); }
      return null;
    }
  }

  return { collection, INDEX_NAME: name, NAME_FIELDS: nameFields, CODE_FIELDS: codeFields, searchStage, definition, ids };
}

module.exports = { textSearchIndex, foldTerm };
