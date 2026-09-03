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
 * Sets actualCash = closingBalance (system-calculated) since no manual count was performed.
 */
const autoCloseOpenWallets = async () => {
  const today = toDateStr();
  console.log(`[Auto-Close] Running wallet auto-close for date: ${today}`);

  try {
    const openWallets = await DailyWallet.find({ date: today, isClosed: false });

    if (openWallets.length === 0) {
      console.log('[Auto-Close] No open wallets found. Nothing to close.');
      return;
    }

    console.log(`[Auto-Close] Found ${openWallets.length} open wallet(s) to auto-close.`);

    for (const wallet of openWallets) {
      wallet.isClosed = true;
      wallet.closedAt = new Date();
      // No closedBy since this is a system action (leave it null)
      wallet.actualCash = wallet.closingBalance;
      wallet.cashDifference = 0;
      wallet.autoClosedNote = 'Auto-closed by system at end of day';
      await wallet.save();

      await logAudit({
        // المحفظةُ للفرع لا لموظّف، و`wallet.user` أثرٌ قديمٌ فارغٌ في الجديد —
        // فالفاعلُ هنا النظامُ صراحةً لا حقلٌ يُرجى أن يكون مملوءًا.
        bySystem: true,
        user: wallet.user || null,
        action: 'auto_close_wallet_day',
        entity: 'DailyWallet',
        entityId: wallet._id,
        changes: {
          after: {
            date: today,
            closingBalance: wallet.closingBalance,
            actualCash: wallet.closingBalance,
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
 * Schedule the auto-close job to run at 11:59 PM every day.
 */
const startWalletAutoCloseJob = () => {
  // Run at 23:59 every day
  cron.schedule('59 23 * * *', async () => {
    await autoCloseOpenWallets();
  }, {
    timezone: 'Asia/Riyadh', // Saudi Arabia timezone
  });

  console.log('[Auto-Close] Wallet auto-close job scheduled for 23:59 daily (Asia/Riyadh).');
};

module.exports = { startWalletAutoCloseJob, autoCloseOpenWallets };
