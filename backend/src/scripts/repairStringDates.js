/* eslint-disable no-console */
/**
 * إصلاح تواريخ حُفظت بصيغة `Date.toString()` في حقولٍ نصّيّة.
 *
 *   node src/scripts/repairStringDates.js --dry   # معاينة بلا كتابة
 *   node src/scripts/repairStringDates.js         # تنفيذ
 *
 * ── ما الذي حدث ─────────────────────────────────────────────────────────────
 * أكثرُ حقول التاريخ في ملفّ الموظّف نصٌّ صريح («YYYY-MM-DD») لأنها تحمل أحيانًا
 * كلمةً إدارية مكان التاريخ. وكان تعديلُ الخانة من الشاشة يكتب فيها كائن تاريخ،
 * فيحوّله Mongoose بـ`toString()` إلى «Wed Jun 30 2027 03:00:00 GMT+0300».
 *
 * والعطل صامت: الشاشة تعرضه سليمًا لأنها تقرؤه تاريخًا. لكنّ الترتيب النصّيّ
 * ينكسر، ومطابقةَ الاستيراد تفشل، والتصديرُ يخرج بهذا السطر كما هو. وكلُّ تعديلٍ
 * جديد كان يزيد الرقم.
 *
 * ── ولماذا لا يُقرأ بـ`new Date()` وحده ─────────────────────────────────────
 * النصّ يحمل منطقة زمنية (+٣). و`new Date(...).toISOString()` يحوّل إلى غرينتش،
 * فيرجع التاريخ يومًا إلى الوراء لكلّ ما وقع قبل الثالثة فجرًا. اليومُ يُقرأ من
 * مكوّنات التاريخ المحلّيّة كما كُتبت.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const pad = (n) => String(n).padStart(2, '0');
/** «Wed Jun 30 2027 03:00:00 GMT+0300» → «2027-06-30» بالتقويم المحلّيّ. */
const toYmd = (raw) => {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const H = require('../config/hrFields');

  // الحقول النصّيّة وحدها: الحقل المعرَّف `Date` يخزّن كائنًا سليمًا ولا شأن له.
  const keys = H.ALL_FIELDS
    .filter((f) => f.type === 'date')
    .map((f) => f.key)
    .filter((k) => Employee.schema.path(k)?.instance === 'String');

  console.log(`حقول تاريخٍ نصّيّة: ${keys.length}`);
  let total = 0; let fixed = 0; const unreadable = [];

  for (const k of keys) {
    // العلامة: صيغة `toString()` تبدأ بيومٍ من ثلاثة أحرف وتحمل GMT.
    const rows = await Employee.find({ [k]: { $regex: 'GMT' } })
      .select(`iqamaNumber arabicName ${k}`).lean();
    if (!rows.length) continue;
    total += rows.length;
    console.log(`\n${k}: ${rows.length}`);
    for (const r of rows.slice(0, 3)) console.log(`   ${String(r[k]).slice(0, 40)}…  →  ${toYmd(r[k]) || '؟'}`);
    if (rows.length > 3) console.log(`   … و${rows.length - 3} غيرها`);

    if (DRY) continue;
    for (const r of rows) {
      const ymd = toYmd(r[k]);
      // ما لا يُقرأ لا يُخمَّن: يُترك ويُعلَن، فقيمةٌ مخترَعة أسوأ من قيمةٍ ظاهرة العطل.
      if (!ymd) { unreadable.push(`${r.iqamaNumber} · ${k} · ${r[k]}`); continue; }
      await Employee.updateOne({ _id: r._id }, { $set: { [k]: ymd } });
      fixed += 1;
    }
  }

  console.log(`\nالإجمالي: ${total}`);
  if (DRY) { console.log('معاينة — لم يُكتب شيء.'); process.exit(0); }
  console.log(`أُصلح: ${fixed}`);
  if (unreadable.length) {
    console.log(`تعذّرت قراءته (${unreadable.length}) — تُرك كما هو:`);
    unreadable.slice(0, 10).forEach((u) => console.log(`   ${u}`));
  }
  process.exit(0);
})();
