/**
 * API samples, generated from the code — never written by hand (owner, 2026-10-27).
 *
 * Every endpoint in the docs carries a request sample and a response record
 * shape. Both are derived when the docs are built:
 *
 *   • The model: the handler's source is scanned for a registered Mongoose
 *     model it calls (`Employee.find(`, `CollectionInvoice.findOne(` …). The
 *     first one is the endpoint's record.
 *   • The record shape: built from that model's schema — every path with a
 *     value of its type (ObjectId, Date, enum's first value, nested objects and
 *     arrays of sub-documents). A field added to a schema appears in the sample
 *     with the next deploy; a removed one disappears.
 *   • The request body: the fields the handler actually reads (apiFieldScan),
 *     typed from the same schema when the model has the field, otherwise from
 *     the field's name (…Date → a date, …Id → an ObjectId, amount → a number).
 *
 * Results are memoised per handler: routes and schemas do not change while the
 * process runs, and a deploy starts a fresh process.
 */
const mongoose = require('mongoose');

const SAMPLE_ID = '6a96c6b71dabbd8fad1405e6';
const SAMPLE_DATE = '2026-10-27T09:30:00.000Z';
const MAX_DEPTH = 3;
const MAX_KEYS = 60;

const memo = new WeakMap();
const shapeMemo = new Map();

/** Registered model names, longest first — so `CollectionInvoice` wins over `Collection…`. */
function modelNames() {
  return mongoose.modelNames().slice().sort((a, b) => b.length - a.length);
}

/** The first registered model the handler calls, read from its own source. */
function modelOfHandler(fn) {
  if (typeof fn !== 'function') return null;
  if (memo.has(fn)) return memo.get(fn);
  let found = null;
  try {
    const src = Function.prototype.toString.call(fn);
    let best = Infinity;
    for (const name of modelNames()) {
      const rx = new RegExp(`\\b${name}\\s*\\.\\s*(find|findOne|findById|findByIdAndUpdate|findOneAndUpdate|create|insertMany|aggregate|countDocuments|updateOne|updateMany|deleteOne|exists|distinct)\\b`);
      const m = rx.exec(src);
      if (m && m.index < best) { best = m.index; found = name; }
    }
  } catch (_) { /* native or bound function — no source */ }
  memo.set(fn, found);
  return found;
}

/** camelCase / snake_case → lower-case words: `accountantName` → ['accountant', 'name']. */
const wordsOf = (n) => String(n || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_\-.]+/).filter(Boolean);

const NUMBER_WORDS = new Set(['amount', 'price', 'total', 'value', 'cost', 'net', 'tax', 'vat', 'qty', 'quantity', 'count', 'days',
  'limit', 'page', 'km', 'weight', 'rate', 'percent', 'score', 'balance', 'salary', 'age', 'year', 'month', 'seat', 'odometer']);
const DATE_WORDS = new Set(['date', 'at', 'since', 'until', 'from', 'to', 'expiry', 'start', 'end', 'day']);
const BOOL_FIRST = new Set(['is', 'has', 'can', 'should', 'include', 'with', 'only', 'all']);

/** A value for a field whose type is only known by its name (whole words, never substrings). */
function valueByName(name) {
  const n = String(name || '');
  const w = wordsOf(n);
  const first = w[0] || '';
  const last = w[w.length - 1] || '';
  if (n === 'page') return 1;
  if (n === 'limit') return 100;
  if (n === '_id' || last === 'id' || ['employee', 'vehicle', 'party', 'customer', 'supplier', 'driver', 'user', 'project', 'clearance'].includes(n)) return SAMPLE_ID;
  if (last === 'ids') return [SAMPLE_ID];
  if (last === 'email' || last === 'emails') return 'name@example.com';
  if (['phone', 'mobile', 'whatsapp'].includes(last)) return '0500000000';
  if (DATE_WORDS.has(last) && !['number', 'name'].includes(last)) return SAMPLE_DATE.slice(0, 10);
  if (BOOL_FIRST.has(first) && w.length > 1) return true;
  if (['active', 'enabled', 'archived', 'locked'].includes(n.toLowerCase())) return true;
  if (NUMBER_WORDS.has(last) || (NUMBER_WORDS.has(first) && w.length === 1)) return 0;
  if (['q', 'search', 'query'].includes(n.toLowerCase())) return 'search text';
  return 'string';
}

/** One schema path → a sample value. */
function sampleOfType(type, path, depth) {
  const inst = type && type.instance;
  if (inst === 'ObjectId' || inst === 'ObjectID') return SAMPLE_ID;
  if (inst === 'Date') return SAMPLE_DATE;
  if (inst === 'Number' || inst === 'Decimal128') return 0;
  if (inst === 'Boolean') return false;
  if (inst === 'Buffer') return '<binary>';
  if (inst === 'Map' || inst === 'Mixed') return {};
  if (inst === 'String') {
    const en = type.enumValues || (type.options && type.options.enum);
    if (Array.isArray(en) && en.length) return String(en.find((x) => x !== '' && x != null) ?? en[0]);
    // A string field keeps a string sample: an email, a phone or a date-like name;
    // never a number or a boolean guessed from the name.
    const v = valueByName(path);
    return typeof v === 'string' ? v : 'string';
  }
  if (inst === 'Embedded' || inst === 'SubdocumentPath') return depth < MAX_DEPTH && type.schema ? shapeOfSchema(type.schema, depth + 1) : {};
  if (inst === 'Array' || inst === 'DocumentArray') {
    if (type.schema) return depth < MAX_DEPTH ? [shapeOfSchema(type.schema, depth + 1)] : [{}];
    const caster = type.caster || type.$embeddedSchemaType;
    return caster ? [sampleOfType(caster, path, depth + 1)] : [];
  }
  return 'string';
}

/** A schema → a nested sample object (dotted paths are folded back into objects). */
function shapeOfSchema(schema, depth = 0) {
  const out = {};
  let n = 0;
  schema.eachPath((p, type) => {
    if (n >= MAX_KEYS || p === '__v') return;
    n += 1;
    const parts = p.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cur[parts[i]] = cur[parts[i]] && typeof cur[parts[i]] === 'object' ? cur[parts[i]] : {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = sampleOfType(type, parts[parts.length - 1], depth);
  });
  return out;
}

/** The record shape of a model, by name. */
function modelShape(name) {
  if (!name) return null;
  if (shapeMemo.has(name)) return shapeMemo.get(name);
  let shape = null;
  try { shape = shapeOfSchema(mongoose.model(name).schema); } catch (_) { shape = null; }
  shapeMemo.set(name, shape);
  return shape;
}

/** The type of one field of a model, when the model has it. */
function fieldSample(modelName, field) {
  try {
    if (modelName) {
      const t = mongoose.model(modelName).schema.path(field);
      if (t) {
        const v = sampleOfType(t, field, 1);
        return v === SAMPLE_DATE ? SAMPLE_DATE.slice(0, 10) : v;
      }
    }
  } catch (_) { /* unknown model */ }
  return valueByName(field);
}

/** JSON-schema type of a sample value — for the field tables. */
function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'string' && /^[0-9a-f]{24}$/.test(v)) return 'objectId';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
  return 'string';
}

/**
 * Everything the docs need for one route: its model, a typed sample per body
 * and query field, a request body example and a response example.
 */
function routeSamples({ method, path, handler, fields }) {
  const model = modelOfHandler(handler);
  const shape = modelShape(model);
  const body = (fields.body || []).map((f) => {
    const v = fieldSample(model, f.name);
    return { ...f, type: typeOf(v), example: v };
  });
  const query = (fields.query || []).map((f) => {
    const v = fieldSample(model, f.name);
    return { ...f, type: typeOf(v), example: Array.isArray(v) ? v.join(',') : v };
  });
  const requestExample = body.length ? Object.fromEntries(body.map((f) => [f.name, f.example])) : null;

  // The response: the record itself for one record, a list of records for a
  // collection read. Writes answer with the saved record.
  let responseExample = null;
  if (shape) {
    const record = { _id: SAMPLE_ID, ...shape };
    const isOne = /\/:[A-Za-z0-9_]+$/.test(path) || method !== 'GET';
    responseExample = method === 'DELETE' ? { message: 'Deleted' } : (isOne ? record : [record]);
  } else if (method === 'DELETE') responseExample = { message: 'Deleted' };
  return { model, body, query, requestExample, responseExample };
}

module.exports = { routeSamples, modelOfHandler, modelShape, SAMPLE_ID };
