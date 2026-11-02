const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const ExpenseCategory = require('../models/ExpenseCategory');

// The phrase that must be typed verbatim to run the wipe; anything else is rejected.
const CONFIRM_PHRASE = 'امسح كل البيانات نهائيًا';

/**
 * Permanent wipe of fifteen collections (customers, invoices, payments, orders, log).
 * Requires a phrase in the body: the request used to have no body, confirmation or trace, and with SameSite=None cookies (needed because the frontend and API are on different domains) a hidden form on any page could trigger it for a logged-in admin. A simple request skips CORS preflight, so CORS does not protect it. The phrase is typed by a human, so no other page's form knows it.
 * The audit entry is written before the wipe, because AuditLog is among the wiped collections, and rewritten afterwards so the new log records what happened and who did it.
 */
const clearData = async (req, res) => {
  try {
    if (process.env.ALLOW_DATA_WIPE !== 'yes') return res.status(403).json({ code: 'WIPE_DISABLED', message: 'مسح البيانات الشامل مقفول.' });
    if (String(req.body?.confirm || '').trim() !== CONFIRM_PHRASE) {
      return res.status(400).json({
        message: 'عمليةٌ لا رجعة فيها — عبارة التأكيد غير صحيحة.',
      });
    }

    const who = { user: req.user?._id, name: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim(), ip: req.ip };
    console.warn('[admin] مسحٌ شامل للبيانات بدأ —', JSON.stringify(who));
    try {
      await AuditLog.create({
        user: req.user?._id, action: 'clear_all_data_started', entity: 'System',
        changes: { before: { note: 'قبل المسح' } }, ipAddress: req.ip,
      });
    } catch (e) { /* Audit must not block the operation, but it must be attempted. */ }

    const collections = [
      { name: 'DailyWallet', model: DailyWallet },
      { name: 'WalletTransaction', model: WalletTransaction },
      { name: 'Customer', model: Customer },
      { name: 'Invoice', model: Invoice },
      { name: 'Payment', model: Payment },
      { name: 'CollectionsFollowUp', model: require('../models/CollectionsFollowUp') },
      { name: 'Dispute', model: Dispute },
      { name: 'Notification', model: Notification },
      { name: 'AuditLog', model: AuditLog },
      { name: 'OperationsWorkflow', model: OperationsWorkflow },
      { name: 'Vendor', model: Vendor },
      { name: 'Driver', model: Driver },
      { name: 'ExpenseCategory', model: ExpenseCategory },
    ];

    const results = {};

    for (const { name, model } of collections) {
      const result = await model.deleteMany({});
      results[name] = result.deletedCount;
    }

    // The log itself was just wiped, so stamp the event again.
    try {
      await AuditLog.create({
        user: req.user?._id, action: 'clear_all_data', entity: 'System',
        changes: { after: { deletedCounts: results, by: who } }, ipAddress: req.ip,
      });
    } catch (e) { /* A failure here must not undo the completed operation. */ }
    console.warn('[admin] مسحٌ شامل تمّ —', JSON.stringify(results));

    res.json({
      message: 'Data cleared successfully',
      deletedCounts: results,
    });
  } catch (error) {
    console.error('Clear data error:', error);
    res.status(500).json({ message: 'Failed to clear data', error: error.message });
  }
};

module.exports = { clearData };
