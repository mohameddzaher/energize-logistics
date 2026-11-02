/* eslint-disable no-console, no-await-in-loop */
/**
 * Moves the heavy-store rim lines into the tire side (models/Ls2Rim) so they are counted once.
 * Per store item: find/create the rim type, copy its store movements as read-only history, write a closing
 * store movement and hide the item, then open the same balance on the rim. Each step checks what is already
 * there, so a second run (or a run after a crash) finishes the job without counting anything twice.
 * Usage: node src/scripts/moveRimsFromStore.js [--apply]   (dry run by default)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Ls2StoreItem, Ls2StoreMovement } = require('../models/Ls2Store');
const { Ls2Rim, Ls2RimMovement, rimKey, rimName, foldRimText } = require('../models/Ls2Rim');
const { todayKey } = require('../utils/companyDay');

const APPLY = process.argv.includes('--apply');
// The owner's list, as written in the store.
const TARGETS = ['جنط صيني 385', 'جنط صيني سكراب 315', 'جنط صيني سكراب 385', 'جنط صيني مستعمل 315', 'جنط صيني مستعمل 385'];
const CLOSE_REASON = 'نُقل إلى «السطحات والكاوتشات ← الجنوط»';
const BY = 'نقل الجنوط من المخزن';

const fold = (s) => foldRimText(String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const TARGET_KEYS = new Set(TARGETS.map(fold));

/** «جنط صيني مستعمل 315» -> { brand: 'صيني', condition: 'used', size: '315' }. */
function parseName(name) {
  const words = fold(name).split(' ').filter(Boolean);
  if (words[0] !== 'جنط') return null;
  let condition = 'new'; let size = ''; const brand = [];
  for (const w of words.slice(1)) {
    if (w === 'مستعمل') condition = 'used';
    else if (w === 'سكراب') condition = 'scrap';
    else if (w === 'جديد') condition = 'new';
    else if (/^\d{3}$/.test(w)) size = w;
    else brand.push(w);
  }
  if (!size || !brand.length) return null;
  return { brand: brand.join(' '), size, condition };
}

async function ensureRim(fields, item, plan) {
  const key = rimKey(fields);
  let rim = await Ls2Rim.findOne({ sourceStoreItems: item._id });
  if (!rim) rim = await Ls2Rim.findOne({ key, isActive: true });
  plan.rim = rim ? `${rim.name} (موجود، رصيده ${rim.quantity})` : `${rimName(fields)} (جديد)`;
  if (!APPLY) return rim;
  if (!rim) {
    rim = await Ls2Rim.create({ ...fields, quantity: 0, unitPrice: Number(item.unitPrice) || 0, minQuantity: Number(item.minQuantity) || 0, notes: item.notes || '', sourceStoreItems: [item._id], createdByName: BY });
    await Ls2RimMovement.create({ rim: rim._id, rimName: rim.name, type: 'edit', reason: 'created', quantity: 0, balanceAfter: 0, date: todayKey(), storeItem: item._id, notes: `أُنشئ من صنف المخزن «${item.name}»`, performedByName: BY });
  } else {
    const set = {};
    if (!rim.unitPrice && Number(item.unitPrice) > 0) set.unitPrice = Number(item.unitPrice);
    if (Number(item.minQuantity) > (rim.minQuantity || 0)) set.minQuantity = Number(item.minQuantity);
    await Ls2Rim.updateOne({ _id: rim._id }, { $addToSet: { sourceStoreItems: item._id }, ...(Object.keys(set).length ? { $set: set } : {}) });
  }
  return rim;
}

async function copyHistory(rim, item, plan) {
  const rows = await Ls2StoreMovement.find({ item: item._id, reason: { $ne: CLOSE_REASON } }).sort({ createdAt: 1 }).lean();
  const have = rim ? await Ls2RimMovement.countDocuments({ rim: rim._id, storeMovement: { $in: rows.map((m) => m._id) } }) : 0;
  plan.history = `${rows.length} حركة سابقة (${rows.length - have} تُنسخ الآن)`;
  if (!APPLY || !rows.length) return;
  await Ls2RimMovement.bulkWrite(rows.map((m) => ({
    updateOne: {
      filter: { rim: rim._id, storeMovement: m._id },
      update: {
        $setOnInsert: {
          rim: rim._id, rimName: m.itemName || item.name, type: m.type, reason: 'legacy', legacy: true, storeMovement: m._id, storeItem: item._id,
          quantity: m.quantity, balanceAfter: m.balanceAfter, unitPrice: m.unitPrice ?? null, supplierName: m.supplierName || '',
          vehiclePlate: m.vehiclePlate || '', plateKey: null, vehicleMaster: m.vehicleMaster || null,
          date: m.date || new Date(new Date(m.createdAt).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10),
          at: m.createdAt, notes: [m.reason, m.reversed ? `تراجع: ${m.reversalReason || ''}` : ''].filter(Boolean).join(' · '),
          performedBy: m.performedBy || null, performedByName: m.performedByName || '',
          reversed: !!m.reversed, reversedAt: m.reversedAt || null, reversedByName: m.reversedByName || '', reversalReason: m.reversalReason || '',
        },
      },
      upsert: true,
    },
  })), { ordered: false });
}

/** Zeroes and hides the store item behind a closing movement; returns the quantity moved, or null on a conflict. */
async function closeStoreItem(item, plan) {
  let closing = await Ls2StoreMovement.findOne({ item: item._id, reason: CLOSE_REASON }).lean();
  if (item.isActive === false) {
    plan.store = closing ? `مُغلق من قبل (${closing.quantity})` : 'مخفيّ من قبل';
    return closing ? closing.quantity : 0;
  }
  const qty = Number(item.quantity) || 0;
  if (closing && closing.quantity !== qty) {
    plan.store = `تعارض: حركة الإغلاق ${closing.quantity} والرصيد الآن ${qty} — راجعه يدويًا`;
    return null;
  }
  plan.store = `يُصفَّر (${qty}) ويُخفى من المخزن`;
  if (!APPLY) return qty;
  if (!closing && qty > 0) {
    closing = await Ls2StoreMovement.create({
      warehouse: item.warehouse || 'heavy', item: item._id, itemName: item.name, type: 'out', quantity: qty,
      reason: CLOSE_REASON, balanceAfter: 0, date: todayKey(), performedByName: BY,
    });
  }
  // Only if nobody moved stock since it was read; otherwise undo the closing row and stop for this item.
  const done = await Ls2StoreItem.findOneAndUpdate({ _id: item._id, isActive: { $ne: false }, quantity: qty }, { $set: { quantity: 0, isActive: false } });
  if (!done) {
    if (closing && !closing.reversed) await Ls2StoreMovement.deleteOne({ _id: closing._id });
    plan.store = 'تغيّر رصيده أثناء النقل — لم يُنقل، أعد التشغيل';
    return null;
  }
  return qty;
}

async function openBalance(rim, item, qty, plan) {
  const opened = rim ? await Ls2RimMovement.findOne({ rim: rim._id, storeItem: item._id, reason: 'from_store' }).lean() : null;
  if (opened) { plan.open = `فُتح من قبل (${opened.quantity})`; return 0; }
  plan.open = qty > 0 ? `يُضاف ${qty} إلى رصيد الجنط` : 'لا رصيد ينقل';
  if (!APPLY || !(qty > 0)) return qty;
  const after = await Ls2Rim.findOneAndUpdate({ _id: rim._id }, { $inc: { quantity: qty } }, { new: true });
  await Ls2RimMovement.create({
    rim: rim._id, rimName: after.name, type: 'in', reason: 'from_store', quantity: qty, balanceAfter: after.quantity,
    unitPrice: Number(item.unitPrice) || null, storeItem: item._id, date: todayKey(), notes: `من صنف المخزن «${item.name}»`, performedByName: BY,
  });
  return qty;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('No MONGODB_URI');
  await mongoose.connect(uri);
  console.log(`DB host: ${mongoose.connection.host} · ${mongoose.connection.name} · ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (APPLY) { await Ls2Rim.init(); await Ls2RimMovement.init(); }

  const heavy = await Ls2StoreItem.find({ warehouse: { $ne: 'light' }, name: { $regex: 'جنط' } }).lean();
  const targets = heavy.filter((i) => TARGET_KEYS.has(fold(i.name)));
  const others = heavy.filter((i) => !TARGET_KEYS.has(fold(i.name)) && i.isActive !== false);
  const missing = TARGETS.filter((t) => !heavy.some((i) => fold(i.name) === fold(t)));

  let moved = 0; let conflicts = 0;
  for (const item of targets) {
    const plan = { item: `${item.name} [${item._id}]`, quantity: item.quantity, unitPrice: item.unitPrice, active: item.isActive !== false };
    const fields = parseName(item.name);
    if (!fields) { console.log(JSON.stringify({ ...plan, skip: 'تعذّر قراءة النوع والمقاس من الاسم' })); continue; }
    // A hidden item with no closing row was deleted by hand before; leave it alone.
    const closed = await Ls2StoreMovement.exists({ item: item._id, reason: CLOSE_REASON });
    if (item.isActive === false && !closed && !(await Ls2Rim.exists({ sourceStoreItems: item._id }))) {
      console.log(JSON.stringify({ ...plan, skip: 'مخفيّ في المخزن قبل النقل — لم يُلمس' }));
      continue;
    }
    const rim = await ensureRim(fields, item, plan);
    await copyHistory(rim, item, plan);
    const qty = await closeStoreItem(item, plan);
    if (qty === null) { conflicts += 1; console.log(JSON.stringify(plan)); continue; }
    const rimNow = APPLY ? await Ls2Rim.findOne({ sourceStoreItems: item._id }) : rim;
    moved += await openBalance(rimNow, item, qty, plan);
    console.log(JSON.stringify(plan));
  }
  if (missing.length) console.log(`غير موجودة في المخزن: ${missing.join(' · ')}`);
  if (others.length) console.log(`أصناف جنوط أخرى في المخزن لم تُنقل (ليست في القائمة): ${others.map((i) => `${i.name} (${i.quantity})`).join(' · ')}`);

  const rims = await Ls2Rim.find({ isActive: true }).sort({ name: 1 }).lean();
  console.log(`الجنوط بعد التشغيل: ${rims.map((r) => `${r.name}=${r.quantity}`).join(' · ') || '—'}`);
  console.log(`${APPLY ? 'نُقل' : 'سيُنقل'} ${moved} جنطًا من ${targets.length} صنفًا · تعارضات ${conflicts}${APPLY ? '' : ' · عرضٌ فقط (--apply للكتابة)'}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
