const Notification = require('../models/Notification');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { emitToUser } = require('../websocket/socketManager');

const createNotification = async ({ recipient, type, title, message, relatedEntity, relatedEntityId }) => {
  const notification = await Notification.create({
    recipient,
    type,
    title,
    message,
    relatedEntity,
    relatedEntityId,
  });

  try {
    emitToUser(recipient.toString(), 'notification:new', notification);
  } catch (e) {}

  return notification;
};

const generateDueAlerts = async () => {
  const now = new Date();
  const fiveDaysFromNow = new Date(now);
  fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);

  // Invoices due within 5 days
  const dueSoon = await Invoice.find({
    status: { $nin: ['paid', 'frozen'] },
    dueDate: { $gte: now, $lte: fiveDaysFromNow },
  }).populate('customer', 'companyName assignedCollector');

  for (const inv of dueSoon) {
    const daysLeft = Math.ceil((inv.dueDate - now) / (1000 * 60 * 60 * 24));

    // Notify assigned collector
    if (inv.customer?.assignedCollector) {
      await createNotification({
        recipient: inv.customer.assignedCollector,
        type: 'invoice_due_soon',
        title: 'Invoice Due Soon',
        message: `Invoice #${inv.invoiceNumber} for ${inv.customer.companyName} is due in ${daysLeft} days (Balance: ${inv.balance})`,
        relatedEntity: 'Invoice',
        relatedEntityId: inv._id,
      });
    }

    // Notify client portal user
    const clientUser = await User.findOne({ linkedCustomer: inv.customer._id, role: 'client', isActive: true });
    if (clientUser) {
      await createNotification({
        recipient: clientUser._id,
        type: 'invoice_due_soon',
        title: 'Payment Due Soon',
        message: `Invoice #${inv.invoiceNumber} is due in ${daysLeft} days. Amount: ${inv.balance}`,
        relatedEntity: 'Invoice',
        relatedEntityId: inv._id,
      });
    }
  }

  // Overdue invoices
  const overdue = await Invoice.find({
    status: { $nin: ['paid', 'frozen'] },
    dueDate: { $lt: now },
  }).populate('customer', 'companyName assignedCollector');

  const admins = await User.find({ role: { $in: ['super_admin', 'admin'] }, isActive: true });

  for (const inv of overdue) {
    const overdueDays = Math.ceil((now - inv.dueDate) / (1000 * 60 * 60 * 24));

    // Only notify for newly overdue (< 2 days) or weekly
    if (overdueDays === 1 || overdueDays % 7 === 0) {
      for (const admin of admins) {
        await createNotification({
          recipient: admin._id,
          type: 'invoice_overdue',
          title: 'Invoice Overdue',
          message: `Invoice #${inv.invoiceNumber} for ${inv.customer?.companyName} is ${overdueDays} days overdue (Balance: ${inv.balance})`,
          relatedEntity: 'Invoice',
          relatedEntityId: inv._id,
        });
      }
    }
  }

  return { dueSoonCount: dueSoon.length, overdueCount: overdue.length };
};

/**
 * خبرٌ يخصّ قسمًا — صفٌّ واحدٌ يراه كلُّ من يملك القسمَ في صلاحيّاته.
 *
 * ── ولماذا صفٌّ واحدٌ لا صفٌّ لكلّ شخص ───────────────────────────────────────
 * الكتابةُ لكلّ مستلمٍ على حدةٍ كانت تضخّم المجموعةَ بعدد أهل القسم — رفعُ
 * مستندٍ واحدٍ صار ثلاثةَ عشرَ صفًّا، وبلغ المجموعُ سبعين ألفًا. والأسوأ أنّ
 * قائمةَ المستلمين تُكتب بيدٍ في كلّ موضع، فدورٌ يُستحدَث لا يصله شيء.
 *
 * فيُكتب الخبرُ مرّةً ويُوجَّه إلى القسم، ويُقرَّر القارئُ وقتَ القراءة من
 * مصفوفة الصلاحيّات — راجع controllers/notificationController.
 *
 * @param {string} section مفتاحُ القسم كما في config/sections.
 */
const notifySection = async (section, { type = 'system_alert', title, message, relatedEntity, relatedEntityId }) => {
  if (!section) throw new Error('notifySection needs a section');
  const n = await Notification.create({ section, type, title, message, relatedEntity, relatedEntityId });
  // ولا بثَّ لحظيًّا هنا: المقصودون يُحسَبون بالصلاحيّات لا بقائمةِ مقابسَ
  // مفتوحة. والشاشةُ تسحب الجرسَ عند فتحه وعند الأحداث الحيّة لقسمها.
  return n;
};

module.exports = { createNotification, notifySection, generateDueAlerts };
