/**
 * توحيدُ أسماء الموظفين على الشيتات الثلاثةَ عشر.
 *
 *   node src/scripts/unifyEmployeeNames.js          # تقرير
 *   node src/scripts/unifyEmployeeNames.js --yes    # تنفيذ
 *
 * ── لماذا الشيتات لا الماستر ────────────────────────────────────────────────
 * قرارُ صاحب الشركة. والشيتُ التفصيليّ يُصدَّر من مصدره (أبشر، التأمينات،
 * الجوازات) فاسمُه هو الاسمُ الرسميّ، بينما الماسترُ يُجمَّع باليد.
 *
 * ── والشيتاتُ نفسُها قد تختلف ───────────────────────────────────────────────
 * ثلاثةَ عشرَ ملفًّا كلُّها تحمل عمودَ «الاسم». واثنا عشرَ منها صادرةٌ من
 * دفعةٍ واحدة فتتّفق حرفًا بحرف، والمخالفُ في الغالب ملفُّ العقود وحدَه —
 * وفيه أحيانًا الاسمُ القانونيُّ الأطول («Muhammad Ajmal Haji Munir Ahmad»
 * مقابل «MUHAMMAD AJMAL»).
 *
 * فيُؤخَذ **الأكثرُ ورودًا**: اثنا عشرَ ملفًّا رسميًّا أرجحُ من واحد. ولا
 * يضيع الاسمُ القانونيّ — هو محفوظٌ على العقد نفسِه في `employeeNameAr` من
 * استيراد العقود، وهو موضعُه: اسمُ العقد للعقد، واسمُ التشغيل للشاشات.
 *
 * والاسمُ الحاليُّ يُحفَظ في backups قبل أن يُكتب فوقه: الاسمُ هويّة، والتراجعُ
 * عن مئةٍ ونصفٍ يجب أن يكون ممكنًا بأمر.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { readSheet } = require('./lib/xlsxStream');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--yes');
const DIR = path.join(__dirname, '../seeds/data/hr-2026-08');
const MASTER = 'master-of-hr.xlsx';

const n = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
/** يُطبَّع للمقارنة فقط — الفروقُ التي لا تُغيّر الاسم لا تُعدُّ اختلافًا. */
const fold = (v) => n(v).toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s/g, '');

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  توحيد أسماء الموظفين — تنفيذ' : '  توحيد أسماء الموظفين — تقريرٌ فقط');
  console.log('='.repeat(72));

  // ── ما تقوله الشيتات ─────────────────────────────────────────────────────
  const votes = new Map(); // iqama -> Map(name -> count)
  let filesRead = 0;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.xlsx') || f.startsWith('~$') || f === MASTER) continue;
    let rows;
    try { rows = readSheet(path.join(DIR, f), 'xl/worksheets/sheet1.xml'); } catch (e) { continue; }
    // ملفُّ العقود ترويستُه في الصفّ الثاني والهويّةُ في A والاسمُ في B —
    // كالبقيّة، إلّا أنّ الصفَّ الأوّل عدّادٌ لا عنوان.
    const header = rows.findIndex((r) => /الهوية|الهويه/.test(n(r.cells.A)) || /الاسم/.test(n(r.cells.B)));
    if (header < 0) continue;
    filesRead += 1;
    for (const r of rows.slice(header + 1)) {
      const id = n(r.cells.A);
      const nm = n(r.cells.B);
      if (!/^\d{6,}$/.test(id) || !nm) continue;
      if (!votes.has(id)) votes.set(id, new Map());
      const m = votes.get(id);
      m.set(nm, (m.get(nm) || 0) + 1);
    }
  }
  console.log(`  قُرئ ${filesRead} شيتًا · ${votes.size} هويّةً لها اسم`);

  /** الاسمُ الذي تقوله الشيتات: الأكثرُ ورودًا، فإن تساوت فالأطول. */
  const chosen = new Map();
  let disagreed = 0;
  const disagreements = [];
  for (const [id, m] of votes) {
    const list = [...m.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    chosen.set(id, list[0][0]);
    // اختلافٌ حقيقيّ: رسمان مختلفان بعد التطبيع، لا فرقُ همزةٍ أو مسافة.
    const forms = new Set(list.map(([x]) => fold(x)));
    if (forms.size > 1) {
      disagreed += 1;
      if (disagreements.length < 8) disagreements.push(`${id}: ${list.map(([x, c]) => `«${x}» ×${c}`).join('  ·  ')}`);
    }
  }
  if (disagreed) {
    console.log(`\n  ⚠ الشيتاتُ نفسُها تختلف في ${disagreed} اسمًا — أُخذ الأكثرُ ورودًا:`);
    disagreements.forEach((d) => console.log('     ' + d));
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const emps = await Employee.find({}).select('arabicName firstName lastName iqamaNumber nationalId employeeNumber').lean();

  const plan = [];
  let identical = 0; let cosmetic = 0; let noSheet = 0;
  for (const e of emps) {
    const id = n(e.iqamaNumber) || n(e.nationalId);
    const want = id && chosen.get(id);
    if (!want) { noSheet += 1; continue; }
    const have = n(e.arabicName) || n(`${e.firstName || ''} ${e.lastName || ''}`);
    if (have === want) { identical += 1; continue; }
    if (fold(have) === fold(want)) { cosmetic += 1; }
    plan.push({ _id: e._id, num: e.employeeNumber || '—', have, want, cosmetic: fold(have) === fold(want) });
  }

  const real = plan.filter((p) => !p.cosmetic);
  console.log(`\n  في القاعدة: ${emps.length} · مطابقٌ حرفًا بحرف ${identical} · لا اسمَ له في الشيتات ${noSheet}`);
  console.log(`  سيُوحَّد: ${plan.length}  (منها ${cosmetic} فرقُ رسمٍ فقط — همزةٌ أو مسافة، و${real.length} اسمٌ مختلف فعلًا)`);
  console.log('\n  عيّنةٌ من المختلف فعلًا:');
  real.slice(0, 15).forEach((p) => console.log(`     #${String(p.num).padEnd(8)} «${p.have}»  →  «${p.want}»`));

  if (!APPLY) { console.log(`\n  — تقريرٌ فقط. أضف --yes للتنفيذ (${plan.length} اسمًا).\n`); await mongoose.disconnect(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '../../backups', `employee-names-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify(plan, null, 1));
  console.log(`\n  ↩ الأسماءُ السابقة: backups/${path.basename(dir)}/before.json`);

  let done = 0;
  for (const p of plan) {
    // الاسمُ الكامل هو المعروضُ في كلّ مكان؛ ويُشقُّ أوّلًا وأخيرًا لأنّ
    // المخطّطَ يوجبهما ولأنّ بعضَ الشاشات ترتّب بالاسم الأوّل.
    const parts = p.want.split(' ');
    await Employee.updateOne({ _id: p._id }, {
      $set: {
        arabicName: p.want,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || parts[0],
      },
    });
    done += 1;
  }
  console.log(`  ✓ وُحِّد ${done} اسمًا\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
