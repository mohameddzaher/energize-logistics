/**
 * vendorContractAlerts: a carrier contract whose end date is within the section's alert window, or past, is
 * announced to the Vendors Management section once per state (soon, then expired). `contractAlertKey` is claimed
 * atomically before sending, so two workers never send the same notification; a new end date clears it.
 */
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const { VendorSetting } = require('../models/VendorsMgmt');
const { notifySection } = require('../services/notificationService');
const { startOfDay, todayKey } = require('../utils/companyDay');

const EVERY_MS = 3 * 60 * 60 * 1000;
let timer = null;
let running = false;

async function sweepOnce() {
  if (running) return { skipped: true };
  running = true;
  let sent = 0;
  try {
    const s = await VendorSetting.findById('alerts').lean();
    const days = Math.min(365, Math.max(1, Number(s?.value?.contractDays) || 30));
    const today = startOfDay(todayKey()).getTime();
    const horizon = new Date(today + (days + 1) * 86400000);
    const rows = await ShipmentOrderSupplier.find({ mergedInto: null, isActive: { $ne: false }, contracted: true, contractEndDate: { $ne: null, $lte: horizon } })
      .select('name contractEndDate contractAlertKey followOwner').lean();
    for (const v of rows) {
      const end = new Date(v.contractEndDate).toISOString().slice(0, 10);
      const left = Math.ceil((startOfDay(end).getTime() - today) / 86400000);
      if (left > days) continue;
      const key = `${end}:${left < 0 ? 'expired' : 'soon'}`;
      if (v.contractAlertKey === key) continue;
      // eslint-disable-next-line no-await-in-loop
      const won = await ShipmentOrderSupplier.updateOne({ _id: v._id, contractAlertKey: { $ne: key } }, { $set: { contractAlertKey: key } });
      if (!won.modifiedCount) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await notifySection('Vendors Management', {
          type: 'system_alert',
          title: left < 0 ? `انتهى عقد المورّد «${v.name}»` : `عقد المورّد «${v.name}» ينتهي خلال ${left} يوم`,
          message: `تاريخ نهاية العقد ${end}${v.followOwner ? ` · مسؤول المتابعة: ${v.followOwner}` : ''} — جدِّد العقد أو حدِّث تاريخ نهايته من ملفّ المورّد.`,
          relatedEntity: 'ShipmentOrderSupplier', relatedEntityId: v._id,
        });
        sent += 1;
      } catch (_) { /* A missed notification must not stop the round. */ }
    }
  } catch (e) {
    console.log('[vendorContractAlerts] error:', e.message);
  } finally {
    running = false;
  }
  return { sent };
}

function startVendorContractAlerts() {
  if (timer) return;
  timer = setInterval(() => { sweepOnce().catch(() => {}); }, EVERY_MS);
  setTimeout(() => { sweepOnce().catch(() => {}); }, 90 * 1000);
}

module.exports = { startVendorContractAlerts, sweepOnce };
