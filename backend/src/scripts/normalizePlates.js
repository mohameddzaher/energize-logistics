/**
 * توحيدُ صيغةِ اللوحات في السجلّات كلِّها.
 *
 * ── الحال قبل ──────────────────────────────────────────────────────────────
 * اللوحةُ الواحدة تُكتب في شاشةٍ بصيغةٍ وفي أخرى بغيرها:
 *
 *   سجلُّ المركبات والنقلُ الخفيف والحوادث   «أ س ي 7357»
 *   إدارةُ الأسطول ولوكيشن سوليوشن            «1080 RXA»
 *   شاحناتُ الناقلين                          «0749 jxa» · «1000 EDA» · «0008»
 *
 * وبينها فروقٌ لا معنى لها: مسافتان أو ثلاث، ولاتينيّةٌ صغيرةٌ أو كبيرة، وأرقامٌ
 * عربيّةٌ أو غربيّة. فيبحث الموظّفُ باللوحة كما يراها فلا يجدها.
 *
 * ── وما يُمسُّ وما لا يُمسّ ──────────────────────────────────────────────────
 * يُضبَط: الفراغُ والأبجديّةُ وأرقامُ العدّ.
 * لا يُمسّ: ترتيبُ الحروف والرقم — «1611 ب ق ب» تبقى كما كُتبت. إعادةُ ترتيبها
 * تغييرٌ للبيان لا تنسيقٌ له: اللوحةُ تُطابَق بنصّها في الاستيراد ومع لوكيشن
 * سوليوشن.
 *
 * ولا يُمسّ المفتاحُ المشتقّ (`plateKey`): هو مطويٌّ أصلًا فلا يتغيّر بتغيُّر
 * الفراغ — والسكربتُ يتحقّق من ذلك قبل الكتابة ويرفض أيّ صفٍّ يتغيّر مفتاحُه.
 *
 * الاستعمال:  node src/scripts/normalizePlates.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { formatPlate, registryPlateKey } = require(`${ROOT}/utils/plateKey`);

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);
  const { FleetVehicle } = require(`${ROOT}/models/FleetModels`);
  const Ls2Vehicle = require(`${ROOT}/models/Ls2Vehicle`);
  const { LightTransportEmployee } = require(`${ROOT}/models/LightTransport`);
  const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
  const VehicleClaim = require(`${ROOT}/models/VehicleClaim`);

  const targets = [
    ['سجلّ المركبات', VehicleMaster, 'plateNumber'],
    ['إدارة الأسطول', FleetVehicle, 'plate'],
    ['لوكيشن سوليوشن', Ls2Vehicle, 'plate'],
    ['النقل الخفيف', LightTransportEmployee, 'vehiclePlate'],
    ['شاحنات الناقلين', ShipmentOrderVehicle, 'plate'],
    ['الحوادث', VehicleClaim, 'vehiclePlate'],
  ];

  let grandTotal = 0;
  for (const [label, Model, field] of targets) {
    const rows = await Model.find({ [field]: { $nin: ['', null] } }).select(field).limit(50000).lean();
    const ops = [];
    const samples = [];
    let keyMoved = 0;
    for (const r of rows) {
      const before = String(r[field] || '');
      const after = formatPlate(before);
      if (after === before || !after) continue;
      // حارسٌ: مفتاحُ المطابقة لا يجوز أن يتغيّر — ولو تغيّر فهذا تعديلٌ في
      // البيان لا تنسيقٌ له، فيُترك الصفُّ ويُقال.
      if (registryPlateKey(before) !== registryPlateKey(after)) { keyMoved += 1; continue; }
      if (samples.length < 4) samples.push(`«${before}» → «${after}»`);
      ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { [field]: after } } } });
    }
    grandTotal += ops.length;
    console.log(`${label}: ${rows.length} صفًّا · يُضبَط ${ops.length}${keyMoved ? ` · تُركت ${keyMoved} لتغيُّر مفتاحها` : ''}`);
    if (samples.length) console.log(`   ${samples.join(' · ')}`);
    if (APPLY && ops.length) {
      for (let i = 0; i < ops.length; i += 500) await Model.bulkWrite(ops.slice(i, i + 500));
    }
  }

  console.log(APPLY ? `\nكُتب: ${grandTotal} لوحة.` : `\nالمجموع: ${grandTotal} لوحة — (عرضٌ فقط، أضِف --apply)`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
