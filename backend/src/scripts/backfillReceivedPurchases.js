/**
 * Land the purchases that were received while the stock flow was inverted.
 *
 * `receivePurchaseRequest` used to SUBTRACT from inventory on receipt, and
 * nothing in the workshop ever added — so every delivery accepted before that
 * was fixed arrived on the shelf physically but never in the system, and the
 * store reads empty while purchasing knows it has the parts.
 *
 * This walks the requests that are still sitting in `received` (goods in, not
 * yet issued to a job) and adds them to stock exactly as the corrected flow
 * now does. `fulfilled` requests are deliberately skipped: those parts were
 * already issued, so their net effect on stock is zero.
 *
 * Idempotent — a request that already carries an `inventoryItem` link has been
 * landed and is left alone, so re-running never double-counts.
 *
 * Usage (from the backend folder):
 *   node src/scripts/backfillReceivedPurchases.js --dry
 *   node src/scripts/backfillReceivedPurchases.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const WorkshopPurchaseRequest = require('../models/WorkshopPurchaseRequest');
const InventoryItem = require('../models/InventoryItem');

const DRY = process.argv.includes('--dry');
const escapeRx = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function run() {
  await connectDB();

  const pending = await WorkshopPurchaseRequest.find({
    status: 'received',
    $or: [{ inventoryItem: null }, { inventoryItem: { $exists: false } }],
  }).lean();

  console.log(`${pending.length} received purchase(s) never reached the store.\n`);
  if (!pending.length) {
    await mongoose.connection.close();
    process.exit(0);
  }

  let created = 0;
  let toppedUp = 0;

  for (const req of pending) {
    const qty = Math.max(1, Number(req.quantity) || 1);
    // Only active lines — a soft-deleted one is invisible everywhere, so adding
    // to it would hide the delivery all over again.
    let item = await InventoryItem.findOne({
      name: new RegExp(`^${escapeRx(req.itemName)}$`, 'i'),
      isActive: true,
    });

    const action = item ? 'top up' : 'create';
    console.log(`  ${action.padEnd(7)} ${req.itemName} × ${qty}${req.supplier ? ` — ${req.supplier}` : ''}`);
    if (DRY) continue;

    if (!item) {
      item = await InventoryItem.create({
        code: `WS-${new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase()}`,
        name: req.itemName,
        category: '',
        quantity: 0,
        unit: 'piece',
        costPrice: req.cost && qty ? Number(req.cost) / qty : 0,
        supplier: req.supplier || '',
        notes: 'أُضيف تلقائياً من طلب شراء مستلَم',
        createdBy: req.requestedBy,
        approvalStatus: 'approved',
      });
      created++;
    } else {
      toppedUp++;
    }

    item.quantity = (Number(item.quantity) || 0) + qty;
    if (req.supplier && !item.supplier) item.supplier = req.supplier;
    await item.save();

    await WorkshopPurchaseRequest.updateOne({ _id: req._id }, { $set: { inventoryItem: item._id } });
  }

  console.log(
    DRY
      ? '\nDRY RUN — nothing written.'
      : `\nDone. stock lines created=${created} topped up=${toppedUp}`,
  );
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((e) => { console.error('Backfill failed:', e); process.exit(1); });
