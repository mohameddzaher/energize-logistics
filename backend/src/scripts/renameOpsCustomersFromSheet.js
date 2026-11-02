/**
 * Customer name matching: from the department sheet to the operations platform, then to collections.
 * Sheet columns: 'Application Customer' (name on the platform today) and 'System Customer' (the correct name).
 * The edit follows the same path as a screen edit: the name is written on the platform (PATCH /admin/users/:id), then collections and saved statements follow (utils/renameOpsCustomer), so the old name stays an alias and the debt is not split. See also controllers/opsController.update.
 * Dry run by default; `--apply` writes to an external system.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const FILE = path.join(__dirname, '../../../operation files/مطابقه اسماء العملاء.xlsx');
const S = (v) => String(v ?? '').trim();
// Same folding as collections: hamza, taa marbuta and spaces.
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

  // Fetch all platform customers once instead of one search call per name.
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
    // A spelling-only difference is still executed. A line whose two sides match after folding was treated as already correct and skipped, leaving the platform on the old spelling so searching there with the correct sheet name found nothing. Skip only when the text matches, not when the folded form matches.
    if (p.from === p.to) { plan.already.push(p); continue; }
    const hits = byKey.get(fold(p.from)) || [];
    if (!hits.length) {
      // It may already have been renamed to the correct name
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
  // A name sharing no word with the previous one is listed for review. Most lines are wording fixes, some are an entirely different name. It may be correct (trade name of an entity registered under another name) but also looks like a row-offset error, so it is shown on its own rather than buried among the rest.
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

  // 'Already correct' means on the platform only. A line already named correctly on the platform counts as done, while our record may keep the old spelling; folding joins them so the debt is not split, but the two screens would show different names. So our name is written without touching the platform.
  const CollectionsParty = require('../models/CollectionsParty');
  let synced = 0;
  for (const p of plan.already) {
    if (p.from === p.to) continue;
    const stale = await CollectionsParty.findOne({ kind: 'customer', name: p.from }).select('_id').lean();
    if (!stale) continue;
    const r = await renameOpsCustomer(p.from, p.to);
    synced += 1;
    console.log(`↺ «${p.from}» ← «${p.to}» (سجلُّنا فقط)${r ? ` · كشوف: ${r.sheets}` : ''}`);
  }
  if (synced) console.log(`ووُفِّق سجلُّنا مع المنصّة في ${synced} اسمًا.`);

  // The old name is an alias whatever the route. The alias is added when the edit goes through `renameOpsCustomer`, but some lines never did (already correct on the platform, or renamed from another screen), leaving old names unfindable. So the alias is ensured for every sheet line.
  let tagged = 0;
  for (const p of [...plan.change, ...plan.already, ...plan.targetExists, ...plan.ambiguous]) {
    if (p.from === p.to) continue;
    const key = CollectionsParty.fold(p.from);
    // The alias goes on both accounts. One company has a cash account and a tax account under one name, both intentional; putting the alias on the first match makes a search by the old name hit only one of them.
    const owners = await CollectionsParty.find({
      kind: 'customer', isActive: { $ne: false }, nameKey: CollectionsParty.fold(p.to),
    }).select('_id aliasKeys').lean();
    const need = owners.filter((o) => !(o.aliasKeys || []).includes(key));
    if (!need.length) continue;
    await CollectionsParty.updateMany(
      { _id: { $in: need.map((o) => o._id) } },
      { $addToSet: { aliases: p.from, aliasKeys: key } },
    );
    tagged += 1;
    console.log(`+ لقبٌ: «${p.from}» ← «${p.to}»`);
  }
  if (tagged) console.log(`وأُضيف ${tagged} اسمًا قديمًا لقبًا — فيجدهم البحث.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
