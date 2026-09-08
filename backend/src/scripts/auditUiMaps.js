/**
 * جداولُ العرض في الواجهة مقابل ما تحمله قاعدةُ البيانات فعلًا.
 *
 * قراءةُ لونٍ من مفتاحٍ ناقصٍ — `MAP[x].color` و`MAP[x]` غيرُ موجود — لا تُخلي
 * خانةً بل تُسقط الشاشةَ كلَّها: «Application error: a client-side exception».
 * وهو ما وقع في ملفّ المركبة: الخادمُ يبعث سبعَ حالاتِ مستنداتٍ والجدولُ يعرف
 * خمسًا، فأربعٌ وسبعون مركبةً من ثلاثٍ وثلاثين وثلاثِ مئة لا تفتح صفحتُها.
 *
 * والمفاتيحُ تُقرأ من ملفّات الواجهة نفسِها لا تُنسَخ هنا — قائمةٌ منسوخةٌ تشيخ
 * بصمت، فيمرّ الفحصُ ويسقط المستخدم.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const FE = path.join(__dirname, '../../../frontend/src');

/**
 * مفاتيحُ كائنٍ ثابتٍ في ملفّ TS — بقراءةِ الأقواس لا بالمسافات البادئة.
 * (أوّلُ محاولةٍ عدّت المسافاتِ فأسقطت كلَّ مفتاحٍ سبقه تعليق، فقال الفحصُ إنّ
 * الجدولَ يجهل مفاتيحَه هو.)
 */
function keysOf(file, mapName) {
  const src = fs.readFileSync(path.join(FE, file), 'utf8');
  const at = src.search(new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${mapName}\\b`));
  if (at < 0) return null;
  // بعد علامة الإسناد لا بعد الاسم: التسميةُ نوعٌ فيه أقواسٌ أيضًا
  // (`Record<string, { ar: string }>`)، وأوّلُ قوسٍ بعد الاسم قوسُ النوع لا
  // قوسُ الكائن — فكان الفحصُ يقرأ حقولَ النوع ويقول إنّ الجدولَ يجهل مفاتيحَه.
  const eq = src.indexOf('=', at);
  const open = src.indexOf('{', eq < 0 ? at : eq);
  if (open < 0) return null;

  const keys = [];
  let depth = 0; let i = open;
  for (; i < src.length; i += 1) {
    const c = src[i];
    // تُقفَز التعليقاتُ والنصوصُ حتى لا يُقرأ قوسٌ داخلها بنيةً.
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '{') { depth += 1; continue; }
    if (c === '}') { depth -= 1; if (depth === 0) break; continue; }
    // مفتاحٌ في المستوى الأوّل وحدَه
    if (depth === 1) {
      const m = /^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:/.exec(src.slice(i));
      if (m && !/[A-Za-z0-9_'"]/.test(src[i - 1] || '')) { keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}

const CHECKS = [
  // ولهاتين مفرداتان لا واحدة: `docStatus` في المتحكّم يترجم `not_applicable`
  // إلى `not_required` و`missing` إلى `none` قبل أن يبعثهما، فملفُّ المركبة
  // يقرأ المترجَم وصفحاتُ العائلات تقرأ الخام. وخلطُهما يُظهر عطبًا لا وجودَ له.
  ['ملفّ المركبة — حالة المستند', 'lib/vehicleRegistry.ts', 'STATUS_META', null, null, 'vehicleStatesMapped'],
  ['عائلات المستندات', 'lib/vehicleRegistry.ts', 'STATE_META', null, null, 'vehicleStatesRaw'],
  ['ماستر الموارد — الحالة', 'lib/hrMaster.ts', 'STATUS_META', 'employees', 'fieldStatus.iqamaNumberStatus', null],
  ['ماستر الموارد — الانتهاء', 'lib/hrMaster.ts', 'STATE_META', null, null, null],
  ['الإجازات', 'lib/hr.ts', 'LEAVE_STATUS', 'leaverequests', 'status', null],
  ['مهامّ الأقسام', 'components/section/SectionWork.tsx', 'STATUS', 'sectiontasks', 'status', null],
  ['شكاوى الأقسام', 'components/section/SectionWork.tsx', 'STATUS', 'sectioncomplaints', 'status', null],
  ['أولويّة المهامّ', 'components/section/SectionWork.tsx', 'PRIORITY', 'sectiontasks', 'priority', null],
  ['طلبات الشحنات — نوع الحقل', 'components/shipment-orders/FormFieldsManager.tsx', 'TYPE_LABELS', 'shipmentorderfields', 'inputType', null],
  ['طلبات الشحنات — المجموعة', 'lib/shipmentOrders.ts', 'GROUP_LABELS', 'shipmentorderfields', 'group', null],
  ['مخزن لوكيشن سوليوشن', 'app/system/ls2/store/page.tsx', 'STATUS', null, null, null],
  ['عملاء العقود', 'lib/contracts.ts', 'CUSTOMER_STATUS', 'contractcustomers', 'status', null],
  ['موردو العقود', 'lib/contracts.ts', 'VENDOR_STATUS', 'contractvendors', 'status', null],
  ['تصنيف العقود', 'lib/contracts.ts', 'CATEGORY_LABELS', 'contractcustomers', 'category', null],
  ['المحفظة', 'app/system/wallet/page.tsx', 'TYPE_CONFIG', 'wallettransactions', 'type', null],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const db = mongoose.connection.db;

  // حالاتُ مستندات المركبات تُشتقّ ولا تُخزَّن، فتُحسب كما يحسبها الخادم.
  let vehicleStates = null;
  const vehicleStatesFn = async () => {
    if (vehicleStates) return vehicleStates;
    const { VehicleMaster, VehicleRegistryConfig } = require('../models/VehicleMaster');
    const VDOC = require('../config/vehicleDocuments');
    const a = ((await VehicleRegistryConfig.findOne().lean()) || {}).alerts || {};
    const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    const raw = new Set(); const mapped = new Set();
    for (const v of await VehicleMaster.find({}).lean()) {
      for (const dt of VDOC.DOCUMENTS) {
        const { state } = VDOC.stateOf(getPath(v, dt.path), getPath(v, dt.statusPath), a[dt.key] || {});
        raw.add(state);
        mapped.add(state === 'not_applicable' ? 'not_required' : state === 'missing' ? 'none' : state);
      }
    }
    vehicleStates = { raw: [...raw], mapped: [...mapped] };
    return vehicleStates;
  };

  let problems = 0;
  console.log('');
  for (const [label, file, mapName, coll, field, derived] of CHECKS) {
    const known = keysOf(file, mapName);
    if (!known) { console.log(`  ?  ${label.padEnd(28)} لم يُعثر على ${mapName} في ${file}`); continue; }
    let seen;
    if (derived === 'vehicleStatesRaw') seen = (await vehicleStatesFn()).raw;
    else if (derived === 'vehicleStatesMapped') seen = (await vehicleStatesFn()).mapped;
    else if (coll) {
      const has = await db.listCollections({ name: coll }).toArray();
      if (!has.length) { console.log(`  —  ${label.padEnd(28)} لا مجموعةَ ${coll}`); continue; }
      seen = (await db.collection(coll).distinct(field)).filter((v) => v !== null && v !== undefined && v !== '');
    } else { console.log(`  ·  ${label.padEnd(28)} ${mapName}: ${known.length} مفتاحًا (يُشتقّ في الواجهة — لا مصدرَ يُقارَن به)`); continue; }

    const unknown = seen.filter((v) => !known.includes(String(v)));
    if (unknown.length) { problems += 1; console.log(`  ✗  ${label.padEnd(28)} ${mapName} لا يعرف: [${unknown.join(', ')}]`); }
    else console.log(`  ✓  ${label.padEnd(28)} ${mapName} — ${seen.length} قيمةً في القاعدة، كلُّها معروفة`);
  }
  console.log(`\n  جداولُ فيها قيمةٌ مجهولة: ${problems}\n`);
  await mongoose.disconnect();
})();
