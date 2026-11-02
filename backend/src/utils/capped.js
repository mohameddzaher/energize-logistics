/**
 * A row limit that announces itself instead of silently truncating: request cap + 1, and if the extra row returns the result is truncated and the response says so.
 * A silent cut looks complete and gets trusted (daily B2C orders once hit 43k under a 5k cap).
 * const { rows, truncated, limit } = await cappedFind(Model.find(f).sort(s), 1000);
 * res.json({ rows, ...(truncated && { truncated, limit, note: CAP_NOTE }) });
 */
const CAP_NOTE_AR = 'النتيجة مبتورة عند الحدّ — ضيّق المدى أو ارفع limit';
const CAP_NOTE_EN = 'Result truncated at the cap — narrow the range or raise limit';

/**
 * @param {import('mongoose').Query} query  prepared query without `limit`
 * @param {number} cap  maximum number of rows returned
 * @returns {Promise<{rows: any[], truncated: boolean, limit: number}>}
 */
async function cappedFind(query, cap) {
  const rows = await query.limit(cap + 1).lean();
  if (rows.length > cap) {
    return { rows: rows.slice(0, cap), truncated: true, limit: cap };
  }
  return { rows, truncated: false, limit: cap };
}

/** Reads `limit` from the query with a min and max, so nobody requests millions by mistake. */
function askedLimit(q, fallback, max) {
  const n = Number(q && q.limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

module.exports = { cappedFind, askedLimit, CAP_NOTE_AR, CAP_NOTE_EN };
