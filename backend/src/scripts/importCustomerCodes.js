/**
 * Customer codes from a sheet (customer name + code) onto the master customers,
 * copied to every section by customerHub. The code then identifies the customer.
 *
 *   node src/scripts/importCustomerCodes.js --file=<xlsx>            # dry run + report
 *   node src/scripts/importCustomerCodes.js --file=<xlsx> --apply    # write
 *   node src/scripts/importCustomerCodes.js --from-collections       # seed from collections account codes
 *
 * Matching: the folded name against the master and every linked record's name and
 * aliases. Ambiguous names (several masters), unknown names, a code already held
 * by another customer, and a code repeated in the sheet are reported, never written.
 * Runs only when invoked directly; writes only with --apply.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const FROM_COLLECTIONS = process.argv.includes('--from-collections');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg ? path.resolve(fileArg.slice(7)) : '';
const reportArg = process.argv.find((a) => a.startsWith('--report='));

function readSheet(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file);
  const out = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const hi = rows.findIndex((r) => r.some((c) => /كود|code|رقم الحساب/i.test(String(c))) && r.some((c) => /اسم|عميل|name|customer/i.test(String(c))));
    if (hi < 0) continue;
    const h = rows[hi].map((c) => String(c).trim());
    const ci = h.findIndex((c) => /كود|code|رقم الحساب/i.test(c));
    const ni = h.findIndex((c, i) => i !== ci && /اسم|عميل|name|customer/i.test(c));
    for (const r of rows.slice(hi + 1)) {
      const nm = String(r[ni] || '').trim(); const code = String(r[ci] || '').trim();
      if (nm || code) out.push({ sheet: name, line: rows.indexOf(r) + 1, name: nm, code });
    }
  }
  return out;
}

async function main() {
  const { normCode } = require('../utils/customerCode');
  const hub = require('../services/customerHub');
  const Crm = require('../models/CrmCompany');
  await mongoose.connect(process.env.MONGODB_URI);

  // Every name a master is known by: its own and every linked record's (and aliases).
  const masters = await Crm.find({}).select('name nameKey customerCode').lean();
  const byKey = new Map();
  const add = (key, id) => { if (!key) return; if (!byKey.has(key)) byKey.set(key, new Set()); byKey.get(key).add(String(id)); };
  for (const m of masters) add(m.nameKey || hub.foldName(m.name), m._id);
  for (const reg of hub.REG_KEYS.filter((k) => k !== 'crm')) {
    const R = hub.REG[reg];
    const rows = await R.model().find({ ...R.base, crmCompany: { $ne: null } }).select('name aliases crmCompany').lean().catch(() => []);
    for (const d of rows) { add(hub.foldName(d.name), d.crmCompany); for (const a of d.aliases || []) add(hub.foldName(a), d.crmCompany); }
  }
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  let input = [];
  if (FROM_COLLECTIONS) {
    const P = require('../models/CollectionsParty');
    const parties = await P.find({ kind: 'customer', code: { $gt: '' } }).select('name code crmCompany').lean();
    input = parties.map((p) => ({ sheet: 'collections', line: 0, name: p.name, code: p.code, master: p.crmCompany ? String(p.crmCompany) : '' }));
  } else {
    if (!FILE || !fs.existsSync(FILE)) { console.error('Pass --file=<xlsx> or --from-collections'); process.exit(1); }
    input = readSheet(FILE);
  }

  const plan = []; const problems = [];
  const codeSeen = new Map();
  for (const r of input) {
    const code = normCode(r.code);
    if (!code) { problems.push({ ...r, problem: 'no code' }); continue; }
    if (!r.name && !r.master) { problems.push({ ...r, problem: 'no name' }); continue; }
    const ids = r.master ? new Set([r.master]) : (byKey.get(hub.foldName(r.name)) || new Set());
    if (!ids.size) { problems.push({ ...r, code, problem: 'name not found' }); continue; }
    if (ids.size > 1) { problems.push({ ...r, code, problem: `name matches ${ids.size} customers: ${[...ids].map((i) => masterById.get(i)?.name).join(' | ')}` }); continue; }
    const id = [...ids][0];
    if (codeSeen.has(code) && codeSeen.get(code) !== id) { problems.push({ ...r, code, problem: `code repeated for another customer (${masterById.get(codeSeen.get(code))?.name})` }); continue; }
    codeSeen.set(code, id);
    const holder = masters.find((m) => m.customerCode === code && String(m._id) !== id);
    if (holder) { problems.push({ ...r, code, problem: `code already held by ${holder.name}` }); continue; }
    const cur = masterById.get(id)?.customerCode || '';
    plan.push({ ...r, code, master: id, masterName: masterById.get(id)?.name, change: cur === code ? 'same' : cur ? `replace ${cur}` : 'new' });
  }
  // One master given two different codes in the input.
  const perMaster = new Map();
  for (const p of plan) { if (!perMaster.has(p.master)) perMaster.set(p.master, new Set()); perMaster.get(p.master).add(p.code); }
  const twoCodes = [...perMaster.entries()].filter(([, c]) => c.size > 1).map(([id]) => id);
  const finalPlan = plan.filter((p) => !twoCodes.includes(p.master));
  for (const p of plan.filter((x) => twoCodes.includes(x.master))) problems.push({ ...p, problem: `customer given several codes: ${[...perMaster.get(p.master)].join(', ')}` });

  const count = (k) => finalPlan.filter((p) => p.change === k || (k === 'replace' && p.change.startsWith('replace'))).length;
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — rows ${input.length} · matched ${finalPlan.length} (new ${count('new')}, same ${count('same')}, replace ${count('replace')}) · problems ${problems.length}`);
  const reasons = {};
  for (const p of problems) { const k = p.problem.split(':')[0].replace(/\(.*\)/, '').trim(); reasons[k] = (reasons[k] || 0) + 1; }
  console.log('problems by kind:', JSON.stringify(reasons));
  problems.slice(0, 25).forEach((p) => console.log(`  ✗ ${p.name || '—'} [${p.code || '—'}] — ${p.problem}`));

  if (reportArg) {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finalPlan.map((p) => ({ 'الاسم في الشيت': p.name, 'الكود': p.code, 'العميل في النظام': p.masterName, 'التغيير': p.change }))), 'مطابَق');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(problems.map((p) => ({ 'الاسم في الشيت': p.name, 'الكود': p.code, 'المشكلة': p.problem }))), 'يحتاج مراجعة');
    XLSX.writeFile(wb, path.resolve(reportArg.slice(9)));
    console.log('report:', path.resolve(reportArg.slice(9)));
  }

  if (APPLY) {
    let ok = 0; const failed = [];
    for (const p of finalPlan.filter((x) => x.change !== 'same')) {
      // eslint-disable-next-line no-await-in-loop
      const r = await hub.setMasterCode(p.master, p.code);
      if (r.ok) ok += 1; else failed.push(`${p.masterName}: ${r.reason}${r.by ? ` (${r.by})` : ''}`);
    }
    console.log(`written ${ok} · failed ${failed.length}`);
    failed.slice(0, 20).forEach((f) => console.log(`  ! ${f}`));
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) { /* */ } process.exit(1); });
}
