/**
 * journeyPlan: reads the JP sheet (who visits whom on which day, and what happened).
 * The sheet is a matrix: a row per customer, and from column 12 on, a block of five columns per day (Plan, Request, Status, Collected, action). The block's date is in row 4 and the day name in row 5. Each customer-day cell with any content is a task that happened or was planned.
 * It is a separate file because the ledger import counted JP rows but never wrote them, and it wipes `CollectionTask` first, so every re-import erased visit history. Reading lives here and both the full import and the single script use it.
 * Dates are serial numbers read with explicit arithmetic, not `cellDates`, which loses a day on this machine (see the XLSX date epoch note).
 */
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => (typeof v === 'number' ? v : (parseFloat(String(v || '').replace(/,/g, '')) || 0));

/** Excel serial number to `YYYY-MM-DD`; values outside a sane range are not dates. */
function serialToISO(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 20000 || v > 80000) return '';
  return new Date(XLS_EPOCH + Math.round(v) * 86400000).toISOString().slice(0, 10);
}

const FIRST_DAY_COL = 12;   // First column after the customer data.
const BLOCK = 5;            // Plan · Request · Status · Collected · action
const HEADER_ROW = 6;
const DATE_ROW = 4;

/**
 * @returns {{ tasks: Array, days: string[], rows: number, skipped: number }}
 * tasks: one row per (customer x day) that has anything.
 */
function parseJourneyPlan(sheetRows) {
  const dateRow = sheetRows[DATE_ROW] || [];
  const width = sheetRows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);

  const blocks = [];
  for (let c = FIRST_DAY_COL; c + BLOCK - 1 < width + BLOCK; c += BLOCK) {
    const iso = serialToISO(dateRow[c]);
    if (iso) blocks.push({ c, date: iso });
  }

  const tasks = [];
  let rows = 0; let skipped = 0;
  for (let i = HEADER_ROW + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (!r) continue;
    const code = S(r[0]);
    // Totals row or empty row: no customer.
    if (!code || !/^[\dC]/i.test(code)) { if (r.some((v) => v != null && S(v) !== '')) skipped += 1; continue; }
    rows += 1;
    const partyName = S(r[1]);
    const officerName = S(r[3]);
    for (const b of blocks) {
      const planned = S(r[b.c]);
      const requestType = S(r[b.c + 1]);
      const status = S(r[b.c + 2]);
      const collected = N(r[b.c + 3]);
      const action = S(r[b.c + 4]);
      if (!planned && !requestType && !status && !collected && !action) continue;
      tasks.push({
        partyCode: code,
        partyName,
        officerName,
        date: b.date,
        requestType,
        // 'x' in the sheet means it was in the plan. An action or collection written without 'x' happened outside the plan; it is recorded and not claimed as planned.
        planned: /^x$/i.test(planned),
        status,
        collected,
        action,
      });
    }
  }
  return { tasks, days: blocks.map((b) => b.date), rows, skipped };
}

module.exports = { parseJourneyPlan, serialToISO };
