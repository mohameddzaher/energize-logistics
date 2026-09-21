/**
 * مسافتان في اسمِ عميلٍ تُخفيانه عن كلّ مَن يبحث عنه — فتُطويان.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * «مكتب  بترو المحيط» و«مؤسسه  الايمان للمقاولات» مكتوبان في منصّة التشغيل
 * بمسافتين، ومن هناك جاءا إلى التحصيل وإلى كشوفهما. وشاشاتُنا تتسامح — البحثُ
 * عندنا يطوي المسافات (utils/plateKey · flexSpaceRegex) — أمّا المنصّةُ فتبحث
 * بالحرف: مَن كتب الاسمَ كما يقرأه، بمسافةٍ واحدة، قيل له «لا نتائج»، فظنّ
 * العميلَ محذوفًا وهو قائمٌ بكشوفه وفواتيره.
 *
 * والاسمُ لا يتغيّر هنا: تُطوى مسافةٌ زائدةٌ لا غير — في المنصّة أوّلًا (هي
 * الأصل) ثمّ يتبعها التحصيلُ والكشوفُ بالمسار المعتاد (utils/renameOpsCustomer).
 *
 * تجربةٌ افتراضًا؛ `--apply` للكتابة — وهي كتابةٌ في نظامٍ خارجيّ.
 *   node src/scripts/squeezeCustomerNameSpaces.js [--apply]
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const S = (v) => String(v ?? '');
const squeeze = (v) => S(v).replace(/\s+/g, ' ').trim();
const odd = (v) => S(v) !== squeeze(v);

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  if (!upl.isConfigured()) { console.log('منصّة التشغيل غير مهيّأة'); process.exit(1); }

  const users = [];
  for (let page = 1; ; page += 1) {
    const out = await upl.get('/admin/users', { query: { limit: 100, page } });
    const d = out?.data ?? out;
    users.push(...(d?.items || d?.data || []));
    if (!d?.meta?.hasNextPage || page > 40) break;
  }

  const W = mongoose.connection.collection('operationsworkflows');
  const CollectionsParty = require('../models/CollectionsParty');

  // ما في المنصّة، وما في سجلّنا وإن لم يكن هناك (عميلٌ قديمٌ حُذف من المنصّة).
  const targets = new Map();
  for (const u of users) if (odd(u.name)) targets.set(S(u.name), { id: u.id || u._id });
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name code').lean();
  for (const p of parties) if (odd(p.name)) if (!targets.has(p.name)) targets.set(p.name, { id: null });

  if (!targets.size) { console.log('لا اسمَ فيه مسافةٌ زائدة.'); process.exit(0); }
  console.log(`أسماءٌ فيها مسافةٌ زائدة: ${targets.size}`);
  for (const [name, t] of targets) {
    const sheets = await W.countDocuments({ username: name });
    console.log(`  «${name}» ← «${squeeze(name)}» · كشوف: ${sheets}${t.id ? '' : ' · ليس في المنصّة'}`);
  }

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }

  const { renameOpsCustomer } = require('../utils/renameOpsCustomer');
  let ok = 0;
  for (const [name, t] of targets) {
    const to = squeeze(name);
    try {
      if (t.id) await upl.patch(`/admin/users/${encodeURIComponent(t.id)}`, { body: { name: to } });
      const r = await renameOpsCustomer(name, to);
      ok += 1;
      console.log(`✓ «${name}» ← «${to}»${r ? ` · كشوف: ${r.sheets}` : ''}`);
    } catch (e) {
      console.log(`✗ «${name}»: ${e.message}`);
    }
  }
  console.log(`\nتمّ: ${ok} من ${targets.size}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
