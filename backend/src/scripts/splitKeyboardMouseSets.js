/* eslint-disable no-console */
/**
 * Splits each keyboard-and-mouse set into a mouse and a keyboard.
 * Usage: node src/scripts/splitKeyboardMouseSets.js [--apply] (preview by default)
 * The two are issued, returned and damaged independently. 1) The original becomes the keyboard: it keeps its id so AssetEvent history, import key, tech reports (relatedAsset) and review entry stay valid; type, name and brand are cleaned. 2) The mouse is a new asset copying status, holder, delivery data, serial, model, notes, quantity, location, value, department and creation date, plus a copy of the event history with original dates and actors. 3) Both get an updated line recording the split and the other id. 4) The keyboard_mouse reference row is disabled. Rerun is safe: the mouse is keyed split-km:<asset id>, history is copied only if missing, and converted originals are no longer picked up.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { deriveAssetName, normalizeBrand } = require('../config/itCustody');

const APPLY = process.argv.includes('--apply');
const SET_TYPE = 'keyboard_mouse';
const keyOf = (id) => `split-km:${id}`;
const SPLIT_MARK = 'قُسم من طقم ماوس وكيبورد';

// Today's date in Riyadh time, as in itController.
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Cleans the brand. Some rows have the set description in the brand (such as a mouse-plus-keyboard text) or a stray symbol, and some have no brand while the name carries it. */
const cleanBrand = (brand, name) => {
  let b = String(brand || '').trim();
  if (!b) b = String(name || '').replace(/ماوس\s*و\s*كيبورد|لوحة مفاتيح\s*و\s*فأرة/g, '').trim();
  b = b
    .replace(/\b(mouse\s*[+&/]?\s*(and\s+)?keyboard|keyboard\s*[+&/]?\s*(and\s+)?mouse)\b/gi, '')
    .replace(/ماوس\s*و\s*كيبورد|لوحة مفاتيح\s*و\s*فأرة|ماوس|كيبورد/g, '')
    .replace(/[#/+&|،,\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeBrand(b);
};

const withNote = (notes, line) => {
  const n = String(notes || '').trim();
  if (n.includes(SPLIT_MARK)) return n;
  return n ? `${n} — ${line}` : line;
};

const pad = (s, w) => {
  const str = String(s ?? '');
  return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Asset = require('../models/Asset');
  const AssetEvent = require('../models/AssetEvent');
  const Employee = require('../models/Employee');
  const Lookup = require('../models/Lookup');
  const logAudit = require('../utils/auditLogger');

  console.log(`قسمة أطقم «ماوس وكيبورد» إلى ماوس وكيبورد${APPLY ? '' : '   (تجربة — لن يُكتب شيء؛ أضف --apply للتنفيذ)'}\n`);

  const sets = await Asset.find({ type: SET_TYPE }).sort({ createdAt: 1 }).lean();
  const empIds = sets.map((a) => a.employee).filter(Boolean);
  const emps = await Employee.find({ _id: { $in: empIds } }).select('firstName lastName arabicName employeeNumber').lean();
  const empName = new Map(emps.map((e) => [String(e._id), e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim()]));
  const holderOf = (a) => (a.employee ? (empName.get(String(a.employee)) || String(a.employee)) : (a.holderName || '—'));

  console.log(`أطقم نوعها ${SET_TYPE}: ${sets.length} صنفًا · ${sets.reduce((s, a) => s + Math.max(1, Number(a.quantity) || 1), 0)} وحدة\n`);
  if (sets.length) {
    console.log([pad('المعرّف', 24), pad('الاسم الحالي', 34), pad('← كيبورد (الأصل)', 20), pad('+ ماوس (جديد)', 18),
      pad('الحالة', 9), pad('كمية', 4), pad('حركات', 5), 'بيد'].join(' │ '));
    console.log('─'.repeat(150));
  }

  const plan = [];
  for (const a of sets) {
    const brand = cleanBrand(a.brand, a.name);
    const events = await AssetEvent.countDocuments({ asset: a._id });
    const existingMouse = await Asset.findOne({ importKey: keyOf(a._id) }).select('_id').lean();
    plan.push({ a, brand, events, existingMouse });
    console.log([
      pad(a._id, 24), pad(a.name, 34), pad(deriveAssetName('keyboard', brand), 20),
      pad(existingMouse ? `(موجود ${existingMouse._id})` : deriveAssetName('mouse', brand), 18),
      pad(a.status, 9), pad(Math.max(1, Number(a.quantity) || 1), 4), pad(events, 5),
      `${holderOf(a)}${a.assignedDate ? ` منذ ${a.assignedDate}` : ''}`,
    ].join(' │ '));
  }

  const lookupRow = await Lookup.findOne({ type: 'asset_type', key: SET_TYPE }).select('isActive').lean();
  console.log(`\nصفّ المرجعيّات asset_type/${SET_TYPE}: ${lookupRow ? (lookupRow.isActive ? 'مفعَّل ← سيُعطَّل' : 'معطَّل مسبقًا') : 'غير موجود'}`);

  if (!APPLY) {
    console.log(`\nسيُنشأ ${plan.filter((p) => !p.existingMouse).length} ماوسًا، ويتحوّل ${plan.length} طقمًا إلى كيبورد.`);
    console.log('لم يُكتب شيء. أعد التشغيل مع --apply للتنفيذ.');
    await mongoose.disconnect();
    return;
  }

  const day = today();
  let created = 0;
  let eventsCopied = 0;
  for (const { a, brand, existingMouse } of plan) {
    const line = `${SPLIT_MARK} (${a.name}) يوم ${day}`;

    // 1. Mouse. Written through the collection directly, not the model, so its creation date is the set's date and it does not appear as newly bought in this month's additions report.
    let mouseId = existingMouse?._id;
    if (!mouseId) {
      const { _id, __v, importKey, ...rest } = a;
      mouseId = new mongoose.Types.ObjectId();
      await Asset.collection.insertOne({
        ...rest,
        _id: mouseId,
        type: 'mouse',
        brand,
        name: deriveAssetName('mouse', brand),
        notes: withNote(a.notes, `${line} — الكيبورد ${a._id}`),
        importKey: keyOf(a._id),
        createdAt: a.createdAt || new Date(),
        updatedAt: new Date(),
      });
      created += 1;
    }

    // 2. Mouse event history: a copy of the set's history with original dates and actors.
    const hasEvents = await AssetEvent.exists({ asset: mouseId });
    if (!hasEvents) {
      const evs = await AssetEvent.find({ asset: a._id }).sort({ createdAt: 1, _id: 1 }).lean();
      if (evs.length) {
        await AssetEvent.collection.insertMany(evs.map(({ _id, __v, ...e }) => ({ ...e, asset: mouseId })));
        eventsCopied += evs.length;
      }
    }

    // 3. Split line on each asset.
    const splitEvent = (assetId, other, what) => ({
      asset: assetId,
      action: 'updated',
      date: day,
      condition: a.condition,
      notes: `${line}: هذا ${what}، و${what === 'الماوس' ? 'الكيبورد' : 'الماوس'} ${other}`,
      byName: 'النظام',
      section: a.issuedBySection === 'hr' ? 'hr' : 'it',
    });
    if (!(await AssetEvent.exists({ asset: mouseId, action: 'updated', notes: { $regex: SPLIT_MARK } }))) {
      await AssetEvent.create(splitEvent(mouseId, a._id, 'الماوس'));
    }
    if (!(await AssetEvent.exists({ asset: a._id, action: 'updated', notes: { $regex: SPLIT_MARK } }))) {
      await AssetEvent.create(splitEvent(a._id, mouseId, 'الكيبورد'));
    }

    // 4. The original becomes the keyboard, as the last step so a rerun picks it up if earlier steps were interrupted.
    await Asset.updateOne(
      { _id: a._id, type: SET_TYPE },
      { $set: {
        type: 'keyboard',
        brand,
        name: deriveAssetName('keyboard', brand),
        notes: withNote(a.notes, `${line} — الماوس ${mouseId}`),
      } },
    );

    await logAudit({
      bySystem: true,
      action: 'split_keyboard_mouse_set',
      entity: 'Asset',
      entityId: a._id,
      changes: {
        details: `قُسم طقم «${a.name}» (${a.status === 'assigned' ? `بعهدة ${holderOf(a)}` : a.status}، الكمية ${Math.max(1, Number(a.quantity) || 1)}) إلى «${deriveAssetName('keyboard', brand)}» (${a._id}) و«${deriveAssetName('mouse', brand)}» (${mouseId}) — الماوسُ والكيبوردُ صنفان لا طقم بقرار الإدارة`,
        keyboard: String(a._id),
        mouse: String(mouseId),
        before: { type: SET_TYPE, name: a.name, brand: a.brand || '' },
        status: a.status,
        employee: a.employee ? String(a.employee) : null,
        holderName: a.holderName || '',
        quantity: Math.max(1, Number(a.quantity) || 1),
      },
      ipAddress: 'script',
    });
  }

  if (lookupRow && lookupRow.isActive) {
    await Lookup.updateOne({ _id: lookupRow._id }, { $set: { isActive: false } });
    await logAudit({
      bySystem: true, action: 'update', entity: 'Lookup', entityId: lookupRow._id,
      changes: { details: `عُطّل نوع الصنف «${SET_TYPE}» (لوحة مفاتيح وفأرة) — الطقم أُلغي صنفًا` },
      ipAddress: 'script',
    });
  }

  try { require('../utils/ttlCache').clear('it:'); require('../utils/ttlCache').clear('hr:'); } catch (_) { /* Outside the server */ }

  const left = await Asset.countDocuments({ type: SET_TYPE });
  console.log(`\n✓ أُنشئ ${created} ماوسًا، ونُسخ ${eventsCopied} سطرَ حركة، وتحوّل ${plan.length} طقمًا إلى كيبورد. بقي من الأطقم: ${left}.`);
  console.log('تذكير: الخادمُ يحتفظ بذاكرةٍ مؤقّتة لكلّ عامل — أعد تحميله (pm2 reload) أو انتظر انتهاءها لتظهر الأرقام الجديدة.');
  await mongoose.disconnect();
  // logAudit announces to the bell without waiting; a short delay lets it finish before exiting.
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('فشل:', e); process.exit(1); });
