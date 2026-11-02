/**
 * HR field-status counters, computed in the database instead of Node.
 * Loading every employee document to count in JS was dominated by transfer cost (about 95 KB/s from the cluster); counting in the database transfers only the small result.
 * Status rule, same as `statusOf`: 'required' and filled is filled; an explicit status is kept; no status is filled or missing.
 */
const H = require('../config/hrFields');

/** Expression for a field's value; matches `H.valueOf`, including the two identity columns. */
function valueExpr(key) {
  if (key === 'iqamaNumber') {
    // Identity is two columns: Saudis in `nationalId`, others in `iqamaNumber`.
    // Uses first non-empty rather than `$ifNull`: `$ifNull` falls back only on null/missing, while JS `||` also falls back on an empty string. Employees with an empty `nationalId` and a number in `iqamaNumber` must read as having a number.
    const first = (a, b2) => ({
      $let: {
        vars: { x: { $ifNull: [a, ''] }, y: { $ifNull: [b2, ''] } },
        in: { $cond: [{ $ne: ['$$x', ''] }, '$$x', '$$y'] },
      },
    });
    return {
      $cond: [{ $eq: ['$idType', 'national_id'] },
        first('$nationalId', '$iqamaNumber'),
        first('$iqamaNumber', '$nationalId')],
    };
  }
  return { $ifNull: [`$${key}`, ''] };
}

/** Is it filled? Empty string, empty zero and null are all empty. */
function filledExpr(key) {
  const v = valueExpr(key);
  // A numeric field's zero counts as empty because it is the schema default (see numberField in config/hrFields).
  const empties = H.getField(key)?.type === 'number' ? ['', null, [], 0] : ['', null, []];
  return { $not: [{ $in: [v, empties] }] };
}

/** Field status as an aggregation expression. */
function statusExpr(key) {
  const st = { $ifNull: [`$fieldStatus.${H.statusKeyOf(key)}`, ''] };
  const filled = filledExpr(key);
  return {
    $switch: {
      branches: [
        { case: { $and: [{ $eq: [st, 'required'] }, filled] }, then: 'filled' },
        { case: { $ne: [st, ''] }, then: st },
        { case: filled, then: 'filled' },
      ],
      default: 'none',
    },
  };
}

/**
 * Count of each status per field for the matching employees.
 * Returns: { [fieldKey]: { required, not_required, filled, none, ... } }
 */
async function statusCounts(Employee, match, keys) {
  const project = { _id: 0 };
  for (const k of keys) project[k.replace(/\./g, '__')] = statusExpr(k);

  // One group computes every counter: one per field per status.
  const group = { _id: null };
  const STATES = ['required', 'not_required', 'filled', 'none', 'cash_payroll', 'inactive', 'unparseable'];
  for (const k of keys) {
    const safe = k.replace(/\./g, '__');
    for (const s of STATES) {
      group[`${safe}__${s}`] = { $sum: { $cond: [{ $eq: [`$${safe}`, s] }, 1, 0] } };
    }
  }

  const [row] = await Employee.aggregate([
    { $match: match },
    { $project: project },
    { $group: group },
  ]).allowDiskUse(true);

  const out = {};
  for (const k of keys) {
    const safe = k.replace(/\./g, '__');
    out[k] = {};
    for (const s of STATES) out[k][s] = row ? (row[`${safe}__${s}`] || 0) : 0;
  }
  return out;
}

/** Value distribution of groupable fields, also in the database; the card shows 20 values with counts, and shipping every value to Node would repeat the transfer cost. */
async function valueDistributions(Employee, match, keys, limit = 25) {
  if (!keys.length) return {};
  const facet = {};
  for (const k of keys) {
    facet[k.replace(/\./g, '__')] = [
      { $group: {
        _id: {
          $let: {
            vars: { v: valueExpr(k) },
            in: {
              $switch: {
                branches: [
                  { case: { $eq: ['$$v', true] }, then: 'نعم' },
                  { case: { $eq: ['$$v', false] }, then: 'لا' },
                  { case: { $in: ['$$v', ['', null, []]] }, then: '—' },
                ],
                default: { $toString: '$$v' },
              },
            },
          },
        },
        count: { $sum: 1 },
      } },
      { $sort: { count: -1, _id: 1 } },
    ];
  }
  const [row] = await Employee.aggregate([{ $match: match }, { $facet: facet }]).allowDiskUse(true);
  const out = {};
  for (const k of keys) {
    const list = (row?.[k.replace(/\./g, '__')] || []).map((x) => ({ value: String(x._id), count: x.count }));
    out[k] = { list: list.slice(0, limit), total: list.length };
  }
  return out;
}

/** Row count under a logical condition, for general totals (outside the kingdom, freelancer, etc.). */
async function boolCounts(Employee, match, exprs) {
  const group = { _id: null, total: { $sum: 1 } };
  for (const [name, expr] of Object.entries(exprs)) {
    group[name] = { $sum: { $cond: [expr, 1, 0] } };
  }
  const [row] = await Employee.aggregate([{ $match: match }, { $group: group }]);
  const out = { total: row?.total || 0 };
  for (const name of Object.keys(exprs)) out[name] = row ? (row[name] || 0) : 0;
  return out;
}

/**
 * Expiry states of document groups, in the database.
 * Mirrors `H.stateOf` exactly: not-required or none means not applicable, then no date means missing, then negative days means expired, then the two thresholds.
 */
async function docStateCounts(Employee, match, groups, alert = {}) {
  const crit = Number(alert.criticalDays ?? 30);
  const warn = Number(alert.warnDays ?? 60);
  const docs = groups.filter((g) => g.document && g.expiryField);
  if (!docs.length) return {};

  const project = { _id: 0 };
  for (const g of docs) {
    const st = statusExpr(g.expiryField);
    // `stateOf` receives '' when the status is filled, so only the two states are read.
    // Seven of the eight expiry fields are stored as `YYYY-MM-DD` strings, not Date objects. `$dateDiff` rejects strings, so they go through `$convert` with `onError: null` so one malformed value cannot fail the whole query; an unreadable date counts as missing, as `daysLeft` does.
    const asDate = { $convert: { input: `$${g.expiryField}`, to: 'date', onError: null, onNull: null } };
    const days = {
      $let: {
        vars: { dd: asDate },
        in: { $cond: [{ $eq: ['$$dd', null] }, null,
          { $dateDiff: { startDate: '$$NOW', endDate: '$$dd', unit: 'day' } }] },
      },
    };
    project[`${g.key}__days`] = {
      $let: { vars: { d: days }, in: { $cond: [{ $gte: ['$$d', 0] }, '$$d', null] } },
    };
    project[g.key] = {
      $let: {
        vars: { s: st, d: days },
        in: {
          $switch: {
            branches: [
              { case: { $in: ['$$s', ['not_required', 'none']] }, then: 'not_applicable' },
              { case: { $eq: ['$$d', null] }, then: 'missing' },
              { case: { $lt: ['$$d', 0] }, then: 'expired' },
              { case: { $lte: ['$$d', crit] }, then: 'critical' },
              { case: { $lte: ['$$d', warn] }, then: 'warning' },
            ],
            default: 'valid',
          },
        },
      },
    };
  }

  const STATES = ['valid', 'warning', 'critical', 'expired', 'missing', 'not_applicable'];
  const group = { _id: null };
  for (const g of docs) {
    for (const st of STATES) {
      group[`${g.key}__${st}`] = { $sum: { $cond: [{ $eq: [`$${g.key}`, st] }, 1, 0] } };
    }
    // Nearest expiry not yet passed: the number the card shows.
    group[`${g.key}__nearest`] = { $min: `$${g.key}__days` };
  }

  const [row] = await Employee.aggregate([{ $match: match }, { $project: project }, { $group: group }]).allowDiskUse(true);
  const out = {};
  for (const g of docs) {
    out[g.key] = { states: {}, nearest: row ? row[`${g.key}__nearest`] : null };
    for (const st of STATES) out[g.key].states[st] = row ? (row[`${g.key}__${st}`] || 0) : 0;
  }
  return out;
}

module.exports = {
  statusCounts, valueDistributions, boolCounts, docStateCounts,
  statusExpr, filledExpr, valueExpr,
};
