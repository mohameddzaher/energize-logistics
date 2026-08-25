const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CollectionActivity = require('../models/CollectionActivity');
const CollectionTask = require('../models/CollectionTask');
const TaskSuggestion = require('../models/TaskSuggestion');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const ExpenseCategory = require('../models/ExpenseCategory');

// العبارة التي يجب أن تُكتَب حرفيًّا لتنفيذ المسح. أيّ شيءٍ سواها يُرَدّ.
const CONFIRM_PHRASE = 'امسح كل البيانات نهائيًا';

/**
 * مسحٌ نهائيّ لخمس عشرة مجموعة — العملاء والفواتير والمدفوعات والطلبات والسجلّ.
 *
 * ── لماذا يشترط عبارةً في الجسم ─────────────────────────────────────────────
 * كان طلبًا بلا جسمٍ ولا تأكيدٍ ولا أثر. ومع كوكيز `SameSite=None` — وهي لازمة
 * لأن الواجهة والخادم على نطاقين — يكفي أن يفتح مديرٌ صفحةً فيها استمارةٌ خفيّة
 * تُرسِل نفسها ليضيع سجلّ الشركة المالي كلُّه. والطلب البسيط لا يمرّ بفحصٍ
 * مسبقٍ للأصل، فالحماية لا تأتي من CORS.
 *
 * والعبارة تُكتَب بيد الإنسان، فلا تعرفها استمارةٌ في صفحةٍ أخرى.
 *
 * ── ولماذا يُكتَب الأثر قبل المسح ───────────────────────────────────────────
 * `AuditLog` من المجموعات التي تُمسَح، فأثرٌ يُكتَب بعدها يمسح نفسه. يُكتَب
 * أوّلًا، ويُعاد كتابته بعد التمام ليبقى في السجلّ الجديد ما حدث ومَن فعله.
 */
const clearData = async (req, res) => {
  try {
    if (String(req.body?.confirm || '').trim() !== CONFIRM_PHRASE) {
      return res.status(400).json({
        message: `عمليةٌ لا رجعة فيها. أرسل confirm بالعبارة: «${CONFIRM_PHRASE}»`,
        required: CONFIRM_PHRASE,
      });
    }

    const who = { user: req.user?._id, name: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim(), ip: req.ip };
    console.warn('[admin] مسحٌ شامل للبيانات بدأ —', JSON.stringify(who));
    try {
      await AuditLog.create({
        user: req.user?._id, action: 'clear_all_data_started', entity: 'System',
        changes: { before: { note: 'قبل المسح' } }, ipAddress: req.ip,
      });
    } catch (e) { /* الأثر لا يمنع العملية، لكنّ محاولته واجبة */ }

    const collections = [
      { name: 'DailyWallet', model: DailyWallet },
      { name: 'WalletTransaction', model: WalletTransaction },
      { name: 'Customer', model: Customer },
      { name: 'Invoice', model: Invoice },
      { name: 'Payment', model: Payment },
      { name: 'CollectionActivity', model: CollectionActivity },
      { name: 'CollectionTask', model: CollectionTask },
      { name: 'TaskSuggestion', model: TaskSuggestion },
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

    // السجلّ نفسه مُسِح للتوّ، فيُعاد ختم ما حدث فيه من جديد.
    try {
      await AuditLog.create({
        user: req.user?._id, action: 'clear_all_data', entity: 'System',
        changes: { after: { deletedCounts: results, by: who } }, ipAddress: req.ip,
      });
    } catch (e) { /* لا يُبطل العملية بعد تمامها */ }
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
