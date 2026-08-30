/* eslint-disable no-console */
/**
 * نقلُ شحنات منصّة الأوبريشن إلى قسم طلبات الشحنات — وإبقاؤها متزامنة.
 *
 *   node src/scripts/importOpsShipments.js --dry
 *   node src/scripts/importOpsShipments.js --yes            # الجديدُ والمعدَّل
 *   node src/scripts/importOpsShipments.js --yes --full     # من أوّل صفحة
 *
 * ── نسخٌ لا مرآة ────────────────────────────────────────────────────────────
 * قسمُ «منصّة الأوبريشن» يقرأ من نظامٍ خارجيّ لحظةً بلحظة: إن انقطع انقطع
 * القسم، ولا تُحلَّل بياناتُه ولا تُفلتَر إلّا بما يسمح به. فتُنسخ الشحناتُ
 * إلى نظامنا لتصير عندنا: تُحلَّل وتُفلتَر وتُصدَّر، ونعمل عليها إن توقّفت
 * المنصّة يومًا.
 *
 * ── ورقمُ كشف التخريج يبقى رقمَهم ──────────────────────────────────────────
 * لا يُعاد ترقيمُ ما نُقل: يبقى رقمُ كشف التخريج كما هو، فيكمل الفريقُ عليه
 * حين ينتقل إلى نظامنا. وشحناتُنا تُرقَّم من عدّادنا ويسبقها حرف («E-500»)،
 * فلا يلتبس رقمٌ برقم ولو تصادف العددان.
 *
 * ── والمزامنةُ تُعيد المعدَّل ولا تُكرِّر ──────────────────────────────────
 * المطابقةُ بمعرّف المنصّة. والتشغيلُ المعتاد يقف عند أوّل صفحةٍ لا جديدَ فيها
 * (مرتّبةً بآخر تعديل)، فالمزامنةُ اليوميّة ثوانٍ لا ساعة. و`--full` يمسح الكلّ.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const upl = require('../services/uplClient');

const DRY = !process.argv.includes('--yes');
const FULL = process.argv.includes('--full');

const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const label = (v) => (v && typeof v === 'object' ? n(v.ar) || n(v.en) : n(v));

/** حالاتُ المنصّة ← حالاتنا. المفاتيحُ نفسُها عمدًا، وما شذّ يُردّ إلى أقربه. */
// ── مطابقةٌ واحدة ────────────────────────────────────────────────────────────
// كانت هنا نسخةٌ ثانيةٌ من `mapShipment`. فحين صُحِّح حقلٌ في خدمة المزامنة بقي
// خطأً هنا، فاختلف ما يصل بالاستطلاع عمّا يصل بالنقل الكامل. المصدرُ واحد الآن،
// ويُضاف إليه تاريخُ الإنشاء الأصليّ وحدَه — النقلُ الكامل يحفظه، والاستطلاعُ
// اللحظيُّ لا يحتاجه.
const { mapShipment: mapCore } = require('../services/shipmentOrderSyncService');
const mapShipment = (x) => ({ ...mapCore(x), createdAt: date(x.created_at) || new Date() });

(async () => {
  console.log('\n' + '='.repeat(74));
  console.log(DRY ? '  نقلُ شحنات المنصّة — تجربةٌ فقط' : `  نقلُ شحنات المنصّة — تنفيذ${FULL ? ' (كامل)' : ' (الجديد والمعدَّل)'}`);
  console.log('='.repeat(74));
  if (!upl.isConfigured()) { console.error('  ✗ اتّصالُ المنصّة غير مهيّأ'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);
  const ShipmentOrder = require('../models/ShipmentOrder');

  const known = new Map();
  for (const d of await ShipmentOrder.find({ source: 'platform' }).select('externalId updatedAt status').lean()) {
    if (d.externalId) known.set(String(d.externalId), d);
  }
  console.log(`  عندنا الآن: ${known.size} شحنةً منقولة`);

  let page = 1; let seen = 0; let created = 0; let updated = 0; let total = null;
  let quietPages = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = await upl.get('/admin/shipments', { query: { limit: 100, page, 'sort[updated_at]': 'desc' } });
    const d = (r && r.data) || {};
    const items = d.items || [];
    total = d.meta ? d.meta.totalItems : total;
    if (!items.length) break;

    const ops = [];
    for (const x of items) {
      seen += 1;
      const mapped = mapShipment(x);
      if (!mapped.externalId) continue;
      const hit = known.get(mapped.externalId);
      if (hit) { updated += 1; ops.push({ updateOne: { filter: { externalId: mapped.externalId }, update: { $set: mapped } } }); }
      else { created += 1; ops.push({ insertOne: { document: { ...mapped, updatedAt: new Date() } } }); }
    }
    const newHere = ops.filter((o) => o.insertOne).length;
    quietPages = newHere ? 0 : quietPages + 1;

    if (!DRY && ops.length) {
      // eslint-disable-next-line no-await-in-loop
      try { await ShipmentOrder.bulkWrite(ops, { ordered: false }); }
      catch (e) { console.error(`\n     ! صفحة ${page}: ${e.message.split('\n')[0]}`); }
    }
    process.stdout.write(`\r  صفحة ${page} · مقروء ${seen}${total ? '/' + total : ''} · جديد ${created} · محدَّث ${updated}      `);

    // التشغيلُ المعتاد يقف بعد صفحتين بلا جديد — المرتَّبُ بآخر تعديلٍ يضع
    // الجديدَ أوّلًا، فما بعده مقروءٌ من قبل.
    if (!FULL && quietPages >= 2) { console.log('\n  (وقفَ عند صفحتين بلا جديد — أضف --full لمسح الكلّ)'); break; }
    if (!d.meta || !d.meta.hasNextPage) break;
    page += 1;
  }

  console.log(`\n  ${DRY ? 'كان سيُنشأ' : 'أُنشئ'} ${created} · ${DRY ? 'كان سيُحدَّث' : 'حُدِّث'} ${updated}`);
  if (!DRY) {
    const byS = await ShipmentOrder.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }]);
    console.log('\n  في القسم الآن:');
    byS.forEach((x) => console.log(`     ${x._id === 'platform' ? 'من المنصّة' : 'من نظامنا'}: ${x.n}`));
  } else console.log('\n  — تجربةٌ فقط.');
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
