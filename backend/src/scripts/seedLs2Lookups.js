/**
 * يملأ قوائمَ القسم المنسدلة (ماركاتُ الكاوتش، مقاساتُه، وحداتُ الأصناف) بما هو
 * مكتوبٌ فعلًا في السجلّات — فلا تُفتَح القائمةُ فارغةً ولا تُخترَع مفرداتٌ لا
 * يعرفها أحد. ما هو في القائمة لا يُكرَّر (بعد طيّ الحالة والمسافات).
 *
 *   node src/scripts/seedLs2Lookups.js           ← عرضٌ فقط
 *   node src/scripts/seedLs2Lookups.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Lookup = require('../models/Lookup');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const { Ls2StoreItem } = require('../models/Ls2Store');

const APPLY = process.argv.includes('--apply');
// المسافاتُ تُطوى كلُّها: «315/80 R22.5» و«315/80R22.5» مقاسٌ واحدٌ كُتب بصيغتين —
// يُضاف بأكثر صيغتَيه استعمالًا. وما كُتب مرّةً واحدةً خطأُ كتابةٍ («MICHLAIN»)
// لا مفردةٌ من القائمة.
const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
const junk = (v) => !v || /^(-|—|غير محدد|unknown|n\/a|na|لا يوجد)$/i.test(v);

async function fill(type, values) {
  const have = new Set((await Lookup.find({ type }).select('nameAr nameEn').lean()).flatMap((x) => [fold(x.nameAr), fold(x.nameEn)]));
  const counts = new Map();
  for (const raw of values) {
    const v = String(raw || '').trim().replace(/\s+/g, ' '); if (junk(v)) continue;
    const k = fold(v); const cur = counts.get(k) || { n: 0, forms: new Map() };
    cur.n += 1; cur.forms.set(v, (cur.forms.get(v) || 0) + 1); counts.set(k, cur);
  }
  for (const x of counts.values()) x.v = [...x.forms.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const add = [...counts.entries()].filter(([k, x]) => !have.has(k) && x.n >= 2).sort((a, b) => b[1].n - a[1].n);
  console.log(`── ${type}: ${have.size ? 'في القائمة قيمٌ' : 'فارغة'} · يُضاف ${add.length}: ${add.map(([, x]) => `${x.v} (${x.n})`).join(' · ') || '—'}`);
  if (!APPLY || !add.length) return;
  const base = await Lookup.countDocuments({ type });
  await Lookup.insertMany(add.map(([, x], i) => ({ type, key: `${type}_${Date.now().toString(36)}_${i}`, nameAr: x.v, nameEn: x.v, order: base + i + 1, isActive: true })));
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const tires = await Ls2TireAsset.find({}).select('type size').lean();
  await fill('ls2_tire_brand', tires.map((t) => t.type));
  await fill('ls2_tire_size', tires.map((t) => t.size));
  await fill('ls2_store_unit', (await Ls2StoreItem.find({ isActive: { $ne: false } }).select('unit').lean()).map((i) => i.unit));
  console.log(APPLY ? 'كُتب.' : 'عرضٌ فقط (--apply للكتابة).');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
