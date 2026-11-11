/**
 * Seeds each section's KPI forms from seeds/data/sectionKpis.json (built from the owner's workbooks by scripts/extractSectionKpis.js).
 * Dry run by default; --apply writes. Idempotent: a form is matched on section + Arabic name; an existing form is left as it is
 * (its manager may have retuned it) unless --overwrite, and only missing employee assignments are added.
 * Employees are found by name: every word of the workbook name, in order, inside one active file's Arabic name or first+last name; ambiguous or unknown names are listed, not guessed.
 *
 * Run: node src/seeds/seedSectionKpis.js [--apply] [--overwrite] [--section "HR"]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const PerfTemplate = require('../models/PerfTemplate');
const Employee = require('../models/Employee');
const { nameKey } = require('../utils/nameKey');
const DATA = require('./data/sectionKpis.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OVERWRITE = args.includes('--overwrite');
const ONLY = args.includes('--section') ? args[args.indexOf('--section') + 1] : null;

const words = (s) => String(s || '').split(/\s+/).map(nameKey).filter(Boolean);
// Every word of `needle`, in order, as whole words of `hay`.
function inOrder(needle, hay) {
  let i = 0;
  for (const w of hay) if (w === needle[i]) i += 1;
  return needle.length > 0 && i === needle.length;
}

function matchEmployee(name, employees) {
  const want = words(name);
  const hits = employees.filter((e) => [e.arabicName, `${e.firstName || ''} ${e.lastName || ''}`]
    .some((n) => inOrder(want, words(n))));
  return hits.length === 1 ? hits[0] : { ambiguous: hits.length };
}

const sameCriteria = (a, b) => JSON.stringify((a || []).map((c) => [c.titleAr, c.title, Number(c.weight), c.groupAr || '', c.descriptionAr || '']))
  === JSON.stringify((b || []).map((c) => [c.titleAr, c.title, Number(c.weight), c.groupAr || '', c.descriptionAr || '']));

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const employees = await Employee.find({ employmentStatus: { $ne: 'terminated' } })
    .select('arabicName firstName lastName jobTitle').lean();

  const report = { created: 0, overwritten: 0, unchanged: 0, keptEdited: 0, assigned: 0, unmatched: [], ambiguous: [] };
  for (const t of DATA.templates) {
    if (ONLY && t.section !== ONLY) continue;
    const ids = [];
    for (const n of t.employeeNames || []) {
      const m = matchEmployee(n, employees);
      if (m && m._id) ids.push(m._id);
      else if (m.ambiguous) report.ambiguous.push(`${t.section} / ${n} (${m.ambiguous})`);
      else report.unmatched.push(`${t.section} / ${n}`);
    }
    const criteria = t.criteria.map((c, i) => ({ ...c, key: `k${i + 1}` }));
    const fields = {
      name: t.name, nameAr: t.nameAr, section: t.section, department: '',
      roles: t.roles || [], jobTitles: t.jobTitles || [], source: t.source || '', criteria,
      ...(t.tier ? { tier: t.tier } : {}),
    };
    const existing = await PerfTemplate.findOne({ section: t.section, nameAr: t.nameAr });
    const add = existing ? ids.filter((id) => !(existing.employees || []).some((x) => String(x) === String(id))) : ids;
    report.assigned += add.length;

    if (!existing) {
      report.created += 1;
      console.log(`+ ${t.section} | ${t.nameAr} | ${criteria.length} items | ${ids.length} employees`);
      if (APPLY) await PerfTemplate.create({ ...fields, employees: ids, active: true });
      continue;
    }
    const same = sameCriteria(existing.criteria, criteria);
    if (!same && OVERWRITE) {
      report.overwritten += 1;
      console.log(`~ ${t.section} | ${t.nameAr} | overwritten from the workbook`);
    } else if (!same) {
      report.keptEdited += 1;
      console.log(`= ${t.section} | ${t.nameAr} | differs from the workbook (edited in the system), kept`);
    } else report.unchanged += 1;
    if (APPLY && ((!same && OVERWRITE) || add.length)) {
      const set = !same && OVERWRITE ? { ...fields } : {};
      await PerfTemplate.updateOne({ _id: existing._id }, { $set: set, $addToSet: { employees: { $each: add } } });
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (add --apply to write)'}`);
  console.log(JSON.stringify({ ...report, unmatched: report.unmatched.length, ambiguous: report.ambiguous.length }));
  if (report.unmatched.length) console.log('No employee file found for:\n  ' + report.unmatched.join('\n  '));
  if (report.ambiguous.length) console.log('Several files match (not assigned; the manager assigns from the section settings):\n  ' + report.ambiguous.join('\n  '));
  await mongoose.disconnect();
}

run().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
