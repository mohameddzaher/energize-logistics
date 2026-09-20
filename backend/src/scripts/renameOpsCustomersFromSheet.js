/**
 * مطابقةُ أسماء العملاء — من شيت القسم إلى منصّة التشغيل ثمّ إلى التحصيل.
 *
 * الشيت («operation files/مطابقه اسماء العملاء.xlsx» · ورقة «مطابقه») عمودان:
 *   Application Customer  الاسمُ كما هو في المنصّة اليوم
 *   System Customer       الاسمُ الصحيح كما يجب أن يكون
 *
 * والتعديلُ يمرّ بالمسار الذي يمرّ به تعديلُ الشاشة نفسِه: يُكتب الاسمُ في
 * المنصّة (PATCH /admin/users/:id)، ثمّ يتبعه قسمُ التحصيل والكشوفُ المحفوظة
 * (utils/renameOpsCustomer) — فالاسمُ القديم يبقى صيغةً أخرى للطرف ولا ينقسم
 * دَينُه. راجع أيضًا controllers/opsController.update.
 *
 * تجربةٌ افتراضًا؛ `--apply` للكتابة — وهي كتابةٌ في نظامٍ خارجيّ.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const FILE = path.join(__dirname, '../../../operation files/مطابقه اسماء العملاء.xlsx');
const S = (v) => String(v ?? '').trim();
// الطيُّ نفسُه المستعمل في التحصيل: الهمزةُ والتاءُ المربوطة والمسافات.
const fold = (v) => String(v || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  if (!upl.isConfigured()) { console.log('منصّة التشغيل غير مهيّأة'); process.exit(1); }

  const wb = XLSX.readFile(FILE, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['مطابقه'], { header: 1, defval: null, blankrows: false, raw: true }).slice(1);
  const pairs = [];
  for (const [appName, sysName] of rows) {
    const from = S(appName); const to = S(sysName);
    if (!from || !to) continue;
    pairs.push({ from, to, same: fold(from) === fold(to) });
  }

  // كلُّ عملاء المنصّة مرّةً واحدة — لا نداءُ بحثٍ لكلّ اسم.
  const users = [];
  for (let page = 1; ; page += 1) {
    const out = await upl.get('/admin/users', { query: { limit: 100, page } });
    const d = out?.data ?? out;
    const items = d?.items || d?.data || [];
    users.push(...items);
    if (!d?.meta?.hasNextPage || page > 40) break;
  }
  const byKey = new Map();
  for (const u of users) {
    const k = fold(u.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(u);
  }
  console.log(`عملاء المنصّة: ${users.length} · أسطر الشيت: ${pairs.length}`);

  const plan = { change: [], already: [], notFound: [], ambiguous: [], targetExists: [] };
  for (const p of pairs) {
    if (p.same) { plan.already.push(p); continue; }
    const hits = byKey.get(fold(p.from)) || [];
    if (!hits.length) {
      // ربّما سُمِّي بالاسم الصحيح من قبل
      if ((byKey.get(fold(p.to)) || []).length) plan.already.push(p);
      else plan.notFound.push(p);
      continue;
    }
    if (hits.length > 1) { plan.ambiguous.push({ ...p, ids: hits.map((h) => h.id) }); continue; }
    const other = (byKey.get(fold(p.to)) || []).filter((u) => u.id !== hits[0].id);
    if (other.length) plan.targetExists.push({ ...p, id: hits[0].id, otherId: other[0].id });
    else plan.change.push({ ...p, id: hits[0].id });
  }

  console.log({
    'سيُعدَّل': plan.change.length,
    'صحيحٌ أصلًا': plan.already.length,
    'لا عميل بهذا الاسم': plan.notFound.length,
    'اسمٌ مكرَّر في المنصّة': plan.ambiguous.length,
    'الاسم الجديد موجود لعميلٍ آخر': plan.targetExists.length,
    applied: apply,
  });
  const show = (title, list, n = 10) => {
    if (!list.length) return;
    console.log(`\n${title} (${list.length}):`);
    list.slice(0, n).forEach((x) => console.log(`  «${x.from}» ← «${x.to}»`));
    if (list.length > n) console.log(`  … و${list.length - n}`);
  };
  show('لا عميل بهذا الاسم في المنصّة', plan.notFound, 40);
  show('اسمٌ مكرَّر في المنصّة — يُراجَع بيدٍ', plan.ambiguous);
  show('الاسم الجديد يحمله عميلٌ آخر — يُراجَع بيدٍ', plan.targetExists);
  // ── واسمٌ لا يشترك مع سابقه في كلمة يُعرَض ليُراجَع ───────────────────────
  // أكثرُ الأسطر تصحيحُ صياغة («كانو» ← «شركة كانو لخدمات مراكز الشحن»)، وبعضُها
  // اسمٌ آخرُ تمامًا. وهو قد يكون صحيحًا (اسمٌ تجاريّ لكيانٍ مسجَّل باسمٍ آخر)،
  // لكنّه أيضًا شكلُ خطأِ إزاحةِ صفّ — فيُعرَض بعينه ولا يُدفَن في مئةٍ وعشرين.
  const toks = (v) => new Set(fold(v).split(/\s+/).filter((w) => w.length > 2
    && !['شركه', 'شركة', 'مؤسسه', 'مؤسسة', 'موسسه', 'مصنع', 'مكتب', 'المحدوده', 'المحدودة', 'واحد', 'شخص'].includes(w)));
  const weak = plan.change.filter((c) => {
    const a2 = toks(c.from); const b2 = toks(c.to);
    return ![...a2].some((w) => b2.has(w));
  });
  show('⚠ اسمٌ جديدٌ لا يشترك مع القديم في كلمة — يُراجَع', weak, 40);
  show('سيُعدَّل', plan.change, 15);

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }

  const { renameOpsCustomer } = require('../utils/renameOpsCustomer');
  let ok = 0; const failed = [];
  for (const c of plan.change) {
    try {
      await upl.patch(`/admin/users/${encodeURIComponent(c.id)}`, { body: { name: c.to } });
      const r = await renameOpsCustomer(c.from, c.to);
      ok += 1;
      console.log(`✓ «${c.from}» ← «${c.to}»${r ? ` · كشوف: ${r.sheets}${r.merged ? ' · دُمج' : ''}` : ''}`);
    } catch (e) {
      failed.push({ ...c, error: e.message });
      console.log(`✗ «${c.from}»: ${e.message}`);
    }
  }
  console.log(`\nتمّ: ${ok} · تعذّر: ${failed.length}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
