/**
 * importMobilyLines — خطوطُ الجوّال من ملفّ موبايلي إلى عهدة الموارد البشريّة.
 *
 *   node src/scripts/importMobilyLines.js --dry
 *   node src/scripts/importMobilyLines.js --apply
 *
 * ── ما يفعله ────────────────────────────────────────────────────────────────
 * الخطُّ عهدةٌ كالحاسوب: في يد إنسانٍ ويُسأل عنه عند إخلاء الطرف. وكان أربعةٌ
 * وستّون خطًّا مسجَّلًا عندنا برقمه وحدَه — بلا باقةٍ ولا عقدٍ ولا تاريخِ انتهاء،
 * وبلا **المفوَّض**: الاسمِ المسجَّل لدى المزوّد على الخطّ. وهو غيرُ من الخطُّ في
 * يده في عشرين خطًّا من تسعةٍ وسبعين، ومن يراجع موبايلي يحتاجه لا يحتاج المستخدم.
 *
 * فيُقرأ الملفُّ ويُفعَل شيئان: يُضاف الخطُّ غيرُ المسجَّل عهدةً على صاحبه،
 * ويُكمَّل المسجَّلُ بما ينقصه. ولا يُكتب فوق ما كُتب بيدٍ إلّا أن يكون فارغًا.
 *
 * ── ومَن ليس موظّفًا ────────────────────────────────────────────────────────
 * سبعةُ صفوفٍ مستخدمُها ليس شخصًا: «عهدة الشركة» و«رجب قسم الصيانة». تلك خطوطٌ
 * في يد الشركة لا في يد أحد — تُسجَّل بحائزٍ مكتوبِ الاسم (`holderKind: external`)
 * ولا تُنسَب إلى موظّفٍ لم يستلمها، وإلّا مَنَعت إخلاءَ طرفِ من لم يأخذها.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const FILE = path.join(__dirname, '..', '..', '..', 'final hr data', 'new edits', 'ملف موبايلي.xlsx');
const S = (v) => (v == null ? '' : String(v).trim());
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const D = (v) => (typeof v === 'number' && v > 1
  ? new Date(XLS_EPOCH + Math.round(v) * 86400000).toISOString().slice(0, 10)
  : S(v));
/** رقمُ الجوّال يُطوى: ٩٦٦ أو صفرٌ بادئٌ أو مسافاتٌ لا تغيّر الخطّ. */
const fone = (v) => {
  let d = S(v).replace(/\D/g, '');
  if (d.startsWith('966')) d = d.slice(3);
  return d.replace(/^0+/, '');
};
const fold = (x) => S(x).replace(/\s+/g, '').replace(/[أإآٱ]/g, 'ا')
  .replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
/** الاسمُ الذي لا يدلّ على إنسان — خطُّ الشركة لا خطُّ موظّف. */
const NOT_A_PERSON = /^(عهدة\s*الشركة|الشركة|عهده\s*الشركه)$/i;

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ في ${FILE}`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Asset = require('../models/Asset');
  const Employee = require('../models/Employee');

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const hdr = raw[0].map(S);
  const rows = raw.slice(1)
    .filter((r) => r && r.some((v) => v != null && S(v) !== ''))
    .map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]])));

  const emps = await Employee.find({}).select('arabicName englishName iqamaNumber nationalId employeeNumber').lean();
  const byIqama = new Map();
  for (const e of emps) for (const k of [e.iqamaNumber, e.nationalId]) if (S(k)) byIqama.set(S(k), e);
  const byName = new Map();
  for (const e of emps) for (const n of [e.arabicName, e.englishName]) if (S(n) && !byName.has(fold(n))) byName.set(fold(n), e);

  const sims = await Asset.find({ type: 'sim' });
  const byPhone = new Map();
  for (const a of sims) { const k = fone(a.serialNumber); if (k) byPhone.set(k, a); }

  console.log(`\n  الملفّ: ${rows.length} خطًّا${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  خطوطٌ مسجَّلةٌ عندنا: ${sims.length}\n`);

  let created = 0; let filled = 0; let untouched = 0; const noEmp = [];
  const ops = [];
  for (const r of rows) {
    const phone = fone(r['رقم الشريحة']);
    if (!phone) continue;
    const userName = S(r['اسم المستخدم']);
    const authName = S(r['اسم المفوض']);
    const iqama = S(r['الاقامة']);

    const emp = byIqama.get(iqama) || (NOT_A_PERSON.test(userName) ? null : byName.get(fold(userName)) || null);
    if (!emp) noEmp.push(`${iqama} · ${userName}`);
    const authEmp = byName.get(fold(authName)) || null;

    const tel = {
      iccid: S(r['الرقم التسلسلي']),
      package: S(r['الباقة']),
      contractMonths: Number(r['المدة بالاشهر']) || null,
      expiryDate: D(r['تاريخ الانتهاء']),
      authorizedEmployee: authEmp ? authEmp._id : null,
      authorizedName: authName,
      provider: 'موبايلي',
    };

    const existing = byPhone.get(phone);
    if (!existing) {
      created += 1;
      ops.push({ kind: 'create', phone, userName, emp, tel });
      continue;
    }
    // ── ولا يُكتب فوق ما كُتب بيد ─────────────────────────────────────────
    // يُملأ الفارغُ وحدَه. ومن صحّح باقةً أو مفوَّضًا في الشاشة لا يُدهَس تصحيحُه
    // في أوّل استيرادٍ بعده — وهو ما يجعل الناسَ تكفّ عن التصحيح أصلًا.
    const patch = {};
    for (const [k, v] of Object.entries(tel)) {
      if (v === null || v === '' ) continue;
      const cur = existing.telecom ? existing.telecom[k] : undefined;
      if (cur === undefined || cur === null || cur === '') patch[`telecom.${k}`] = v;
    }
    if (!existing.employee && emp) patch.employee = emp._id;
    if (!S(existing.holderName) && !emp && userName) { patch.holderName = userName; patch.holderKind = 'external'; }
    if (Object.keys(patch).length) { filled += 1; ops.push({ kind: 'fill', id: existing._id, phone, patch }); }
    else untouched += 1;
  }

  console.log(`  ✚ خطوطٌ تُضاف عهدةً          ${created}`);
  console.log(`  ✎ مسجَّلةٌ يُكمَّل ناقصُها     ${filled}`);
  console.log(`  = مسجَّلةٌ ولا ينقصها شيء     ${untouched}`);
  if (noEmp.length) {
    console.log(`\n  ⚠ مستخدمٌ ليس موظّفًا في السجلّ (${noEmp.length}) — تُسجَّل باسم حائزها لا بموظّف:`);
    for (const x of [...new Set(noEmp)]) console.log(`       ${x}`);
  }

  if (!APPLY) { console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }

  for (const op of ops) {
    if (op.kind === 'create') {
      await Asset.create({
        name: 'SIM Card',
        type: 'sim',
        serialNumber: op.phone,
        employee: op.emp ? op.emp._id : null,
        holderKind: op.emp ? 'employee' : 'external',
        holderName: op.emp ? '' : op.userName,
        status: op.emp ? 'assigned' : 'assigned',
        issuedBySection: 'telecom',
        category: 'telecom',
        condition: 'good',
        telecom: op.tel,
        importKey: `mobily:${op.phone}`,
      });
    } else {
      await Asset.updateOne({ _id: op.id }, { $set: op.patch });
    }
  }
  const total = await Asset.countDocuments({ type: 'sim' });
  const withPkg = await Asset.countDocuments({ type: 'sim', 'telecom.package': { $gt: '' } });
  const withAuth = await Asset.countDocuments({ type: 'sim', 'telecom.authorizedName': { $gt: '' } });
  console.log(`\n  ✔ خطوطٌ في السجلّ الآن: ${total}   منها بباقة ${withPkg} · بمفوَّض ${withAuth}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
