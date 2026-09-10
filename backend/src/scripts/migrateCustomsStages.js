/**
 * نقلُ `stageDates`/`stageDone` القديمة إلى `paymentStages`.
 *
 * الخانتان القديمتان ثمانيَ مفتاحٍ في المخطَّط، وفيهما تاريخُ كلِّ معاملةٍ
 * مستورَدة. ومحوُهما محوٌ للتاريخ، وتركُهما بلا نقلٍ يجعل الشاشةَ الجديدة تبدو
 * فارغةً على معاملاتٍ سُدِّدت فعلًا — فيُعاد إدخالُ ما هو مُدخَل.
 *
 * فتُنقَل مرّةً واحدة. ويُوسَم المنقولُ بـ`note` كي يُعرَف أنّه من الاستيراد لا
 * من يد أحد، ولا يُنقَل مرّتين: الإدخالُ الموجودُ بالمفتاح نفسِه والتاريخ نفسِه
 * يُتجاوَز.
 *
 *   node src/scripts/migrateCustomsStages.js          # عرضٌ بلا كتابة
 *   node src/scripts/migrateCustomsStages.js --write  # التنفيذ
 */
require('dotenv').config();
const mongoose = require('mongoose');

const KEYS = [
  'doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid',
  'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate',
];
const MIGRATED_NOTE = 'مُنقَل من الاستيراد';

(async () => {
  const write = process.argv.includes('--write');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CustomsClearance = require('../models/CustomsClearance');
  const Lookup = require('../models/Lookup');
  const stages = await Lookup.find({ type: 'customs_payment_stage', deleted: { $ne: true } }).lean();
  const labelOf = new Map(stages.map((s) => [s.key, s.nameAr || s.nameEn || s.key]));

  const all = await CustomsClearance.find({}).select('refNumber stageDates stageDone paymentStages').lean();
  let touched = 0; let entries = 0; const perKey = {};

  for (const c of all) {
    const have = new Set((c.paymentStages || []).map((p) => `${p.key}|${p.date || ''}`));
    const add = [];
    for (const k of KEYS) {
      const date = String(c.stageDates?.[k] || '').trim();
      const done = !!c.stageDone?.[k];
      if (!date && !done) continue;
      if (have.has(`${k}|${date}`)) continue;
      add.push({
        key: k,
        label: labelOf.get(k) || k,
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        amount: null,
        // «تم» بلا تاريخٍ حالةٌ حقيقيّةٌ في الماستر — تُنقَل كما هي ويُقال ذلك.
        note: date ? MIGRATED_NOTE : `${MIGRATED_NOTE} — «تم» بلا تاريخ`,
        addedAt: c.createdAt || new Date(),
        addedByName: MIGRATED_NOTE,
      });
      perKey[k] = (perKey[k] || 0) + 1;
    }
    if (!add.length) continue;
    touched += 1; entries += add.length;
    if (write) {
      await CustomsClearance.updateOne({ _id: c._id }, { $push: { paymentStages: { $each: add } } });
    }
  }

  console.log(`\n  معاملات: ${all.length} · تحتاج نقلًا: ${touched} · إدخالات: ${entries}`);
  for (const [k, n] of Object.entries(perKey).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}×  ${labelOf.get(k) || k}`);
  }
  console.log(write ? '\n  ✓ كُتبت.\n' : '\n  (عرضٌ فقط — أضِف --write للتنفيذ)\n');
  await mongoose.disconnect();
})();
