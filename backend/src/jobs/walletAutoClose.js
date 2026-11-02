const cron = require('node-cron');
const DailyWallet = require('../models/DailyWallet');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

// Helper: get YYYY-MM-DD string for today
const toDateStr = () => {
  const dt = new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/**
 * Auto-close all open wallets for the current day.
 * No count that did not happen is written. It used to write `actualCash = closingBalance` and `cashDifference = 0` because "the system computed it", which records that cash was counted and matched the ledger exactly when nobody counted it; that difference is what cash review rests on. A day auto-closed and then changed (a movement added, or a correction rolling forward from an earlier day) kept the old counted figure and a zero difference. Twelve days across three branches were like that, one with a real difference of 20,328 reading as zero.
 * So the field stays empty: `null` means not counted, and every screen reads it so. `autoClosedNote` says why it was closed without a count.
 */
const autoCloseOpenWallets = async () => {
  const today = toDateStr();
  console.log(`[Auto-Close] Running wallet auto-close — closing every open day before ${today}`);

  try {
    // Close past days, not the current working day. It used to close today at 23:59, so someone recording a movement in the last minute found the ledger closed while still in their day. Closing happens at midnight, when the day has ended.
    // Every past day is closed, not only yesterday: if the server was down for a night a day would stay open forever; this sweep closes it the next night.
    const openWallets = await DailyWallet.find({ date: { $lt: today }, isClosed: false });

    if (openWallets.length === 0) {
      console.log('[Auto-Close] No open wallets found. Nothing to close.');
      return;
    }

    console.log(`[Auto-Close] Found ${openWallets.length} open wallet(s) to auto-close.`);

    for (const wallet of openWallets) {
      wallet.isClosed = true;
      wallet.closedAt = new Date();
      // No closedBy since this is a system action (leave it null)
      wallet.actualCash = null;
      wallet.cashDifference = null;
      wallet.autoClosedNote = 'Auto-closed by system at end of day';
      await wallet.save();

      await logAudit({
        // The wallet belongs to the branch, not to an employee, and `wallet.user` is an empty legacy field in new ones, so the actor is explicitly the system rather than a field hoped to be filled.
        bySystem: true,
        user: wallet.user || null,
        action: 'auto_close_wallet_day',
        entity: 'DailyWallet',
        entityId: wallet._id,
        changes: {
          after: {
            date: wallet.date,
            closingBalance: wallet.closingBalance,
            // No `actualCash`: it was not counted, and the entry records what happened, not what did not.
            counted: false,
            autoClosedNote: 'Auto-closed by system at end of day',
          },
        },
        ipAddress: 'system',
      });

      try {
        const populated = await DailyWallet.findById(wallet._id)
          .populate('user', 'firstName lastName')
          .populate('branch', 'name');
        emitToAll('wallet:dayClosed', { wallet: populated });
      } catch (e) {
        // Socket emit is non-critical
      }

      console.log(`[Auto-Close] Closed wallet ${wallet._id} for user ${wallet.user}`);
    }

    console.log(`[Auto-Close] Successfully auto-closed ${openWallets.length} wallet(s).`);
  } catch (error) {
    console.error('[Auto-Close] Error auto-closing wallets:', error.message);
  }
};

/**
 * Schedule the auto-close job for one minute past midnight, Riyadh time.
 * After midnight rather than before: closing happens after the day ends, so anyone working in the last minute can still record a movement. The minute is a safety margin so a run exactly on the second does not read yesterday's date.
 */
const startWalletAutoCloseJob = () => {
  cron.schedule('1 0 * * *', async () => {
    await autoCloseOpenWallets();
  }, {
    timezone: 'Asia/Riyadh', // Saudi Arabia timezone
  });

  console.log('[Auto-Close] Wallet auto-close job scheduled for 00:01 daily (Asia/Riyadh).');
};

module.exports = { startWalletAutoCloseJob, autoCloseOpenWallets };
