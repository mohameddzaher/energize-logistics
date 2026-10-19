/**
 * hrListsUnify — الجنسيّةُ والمدينةُ والمشروعُ قوائمُ مغلقة (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 *   node src/scripts/hrListsUnify.js            ← عرضٌ فقط
 *   node src/scripts/hrListsUnify.js --apply
 *
 * ١. المدينة (`branchName` و`workLocation`): صورُ الكتابة إلى اسمٍ واحد —
 *    Jeddah/جده ← جدة · مكه/مكة/Makkah ← مكة المكرمة. وما بقي يُضاف إلى القائمة.
 * ٢. الجنسيّة: ما في الملفّات وليس في القائمة يُضاف إليها (لا يُغيَّر في الملفّ).
 * ٣. المشروع: صورُ الكتابة إلى اسمٍ واحد (هنقرستيشن ← هنجرستيشن، «كيتا جده» ← كيتا…).
 *    ثمّ موظّفُ B2C: مشروعُه من سجلّه هناك. وإن كان سجلُّه بلا مشروعٍ وفي ملفّه
 *    مشروعٌ من مشاريع B2C، كُتب في سجلّه أوّلًا — فلا يضيع ما عُرف.
 *    وبقيّةُ المشاريع تصير قائمةَ `hr_project`.
 * ولكلّ موظّفٍ تغيّر فيه شيءٌ سطرٌ في سجلّه بما كان وما صار.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Lookup = require('../models/Lookup');
const { LightTransportEmployee } = require('../models/LightTransport');

const APPLY = process.argv.includes('--apply');
const S = (v) => String(v ?? '').trim();
const CITY = { Jeddah: 'جدة', 'جده': 'جدة', 'مكه': 'مكة المكرمة', 'مكة': 'مكة المكرمة', Makkah: 'مكة المكرمة', 'مكه المكرمه': 'مكة المكرمة', Riyadh: 'الرياض', 'غير مطلوب': '', '-': '' };
const PROJECT = {
  'هنقرستيشن': 'هنجرستيشن', 'كيتا جده': 'كيتا', 'كيتا جدة': 'كيتا', 'كيتا مكه': 'كيتا', 'سائق كيتا': 'كيتا', 'نينجا جدة': 'نينجا',
  'النقل الثقبل': 'النقل الثقيل', 'اداره': 'الإدارة', 'ادارة': 'الإدارة', it: 'IT', 'تسويق و اعلان': 'التسويق والاعلان', 'التسويق': 'التسويق والاعلان',
  'الموارد البشريه': 'الموارد البشرية', 'خدمه عملاء': 'خدمة عملاء', 'فروع': 'الفروع', 0: '', '0': '', 'غير مطلوب': '',
};
const B2C_UNSET = '(غير محدد)';

async function ensureRows(type, names) {
  const have = await Lookup.find({ type }).lean();
  const live = new Set(have.filter((r) => !r.deleted).map((r) => r.nameAr));
  const add = [...new Set(names)].filter((n) => n && !live.has(n));
  if (APPLY) {
    let order = have.length;
    for (const n of add) {
      const dead = have.find((r) => r.nameAr === n && r.deleted);
      if (dead) await Lookup.updateOne({ _id: dead._id }, { $set: { deleted: false, isActive: true } }); // eslint-disable-line no-await-in-loop
      else await Lookup.create({ type, key: `${type}_${Date.now().toString(36)}_${order}`, nameAr: n, nameEn: n, order: order++, isActive: true, isSystem: false }); // eslint-disable-line no-await-in-loop
    }
  }
  return add;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const ltProjects = (await Lookup.find({ type: 'lt_project', deleted: { $ne: true } }).lean()).map((r) => r.nameAr).filter((n) => n !== B2C_UNSET);
  const emps = await Employee.find({ isHrRecord: { $ne: false } }).select('employeeNumber arabicName branchName workLocation nationality project').lean();
  const lt = await LightTransportEmployee.find({ employee: { $ne: null } }).select('employee projectAr').lean();
  const ltOf = new Map(lt.map((r) => [String(r.employee), r]));

  const ops = []; const audits = []; const ltOps = []; const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const e of emps) {
    const set = {}; const before = {};
    for (const f of ['branchName', 'workLocation']) {
      const v = S(e[f]);
      if (CITY[v] !== undefined && CITY[v] !== v) { set[f] = CITY[v]; before[f] = v; count(`${f}: «${v}» ← «${CITY[v]}»`); }
    }
    let p = S(e.project);
    if (PROJECT[p] !== undefined) p = PROJECT[p];
    const row = ltOf.get(String(e._id));
    if (row) {
      const ltp = S(row.projectAr);
      if ((!ltp || ltp === B2C_UNSET) && ltProjects.includes(p)) {
        ltOps.push({ updateOne: { filter: { _id: row._id }, update: { $set: { projectAr: p } } } });
        count(`سجل B2C بلا مشروع ← «${p}» من الملفّ`);
      } else {
        p = ltp === B2C_UNSET ? '' : ltp;
      }
    }
    if (p !== S(e.project)) { set.project = p; before.project = S(e.project); count(`project: «${S(e.project)}» ← «${p}»${row ? ' (B2C)' : ''}`); }
    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: set } } });
      audits.push({
        bySystem: true, userName: 'النظام', action: 'hr_lists_unified', entity: 'Employee', entityId: e._id,
        changes: { details: `توحيد القوائم: ${Object.keys(set).map((k) => `${k} «${before[k]}» ← «${set[k]}»`).join(' · ')}`, before, after: set },
        createdAt: new Date(),
      });
    }
  }
  // ما سيبقى في الملفّات بعد التوحيد — منه تُبنى القوائم.
  const after = emps.map((e) => {
    const o = ops.find((x) => String(x.updateOne.filter._id) === String(e._id));
    return { ...e, ...(o ? o.updateOne.update.$set : {}) };
  });
  const cities = after.flatMap((e) => [S(e.branchName), S(e.workLocation)]).filter(Boolean);
  const nats = after.map((e) => S(e.nationality)).filter(Boolean);
  const hrProjects = after.map((e) => S(e.project)).filter((p) => p && !ltProjects.includes(p));

  console.log(`موظّفون يتغيّرون: ${ops.length} · صفوف B2C تُملأ: ${ltOps.length}`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('\nتُضاف إلى القوائم:');
  console.log('  المدن:', (await ensureRows('hr_work_location', cities)).join('، ') || '—');
  console.log('  الجنسيات:', (await ensureRows('hr_nationality', nats)).join('، ') || '—');
  console.log('  المشاريع (غير B2C):', (await ensureRows('hr_project', hrProjects)).join('، ') || '—');
  console.log('  مشاريع B2C (lt_project):', ltProjects.join('، '));

  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  if (ltOps.length) await LightTransportEmployee.bulkWrite(ltOps);
  if (ops.length) await Employee.bulkWrite(ops);
  if (audits.length) await mongoose.connection.db.collection('auditlogs').insertMany(audits);
  console.log(`\nApplied: ${ops.length} موظّف · ${ltOps.length} صفّ B2C`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
