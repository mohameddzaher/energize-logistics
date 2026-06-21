// Static option lists for the Procurement module, surfaced via
// GET /api/procurement/options.

const KSA_VAT_RATE = 15; // Saudi standard VAT

const PR_STATUSES = [
  { key: 'draft', nameEn: 'Draft', nameAr: 'مسودة' },
  { key: 'pending_approval', nameEn: 'Pending Approval', nameAr: 'بانتظار الموافقة' },
  { key: 'approved', nameEn: 'Approved', nameAr: 'معتمد' },
  { key: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض' },
  { key: 'ordered', nameEn: 'Ordered', nameAr: 'تم الطلب' },
];

const PO_STATUSES = [
  { key: 'draft', nameEn: 'Draft', nameAr: 'مسودة' },
  { key: 'sent', nameEn: 'Sent', nameAr: 'مُرسل' },
  { key: 'partially_received', nameEn: 'Partially Received', nameAr: 'مستلم جزئيًا' },
  { key: 'received', nameEn: 'Received', nameAr: 'مستلم' },
  { key: 'billed', nameEn: 'Billed', nameAr: 'مفوتر' },
  { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغي' },
];

const BILL_STATUSES = [
  { key: 'unpaid', nameEn: 'Unpaid', nameAr: 'غير مدفوع' },
  { key: 'partial', nameEn: 'Partially Paid', nameAr: 'مدفوع جزئيًا' },
  { key: 'paid', nameEn: 'Paid', nameAr: 'مدفوع' },
];

const PRIORITIES = [
  { key: 'low', nameEn: 'Low', nameAr: 'منخفضة' },
  { key: 'medium', nameEn: 'Medium', nameAr: 'متوسطة' },
  { key: 'high', nameEn: 'High', nameAr: 'عالية' },
  { key: 'urgent', nameEn: 'Urgent', nameAr: 'عاجلة' },
];

const CATEGORIES = [
  { key: 'spare_parts', nameEn: 'Spare Parts', nameAr: 'قطع غيار' },
  { key: 'fuel', nameEn: 'Fuel', nameAr: 'وقود' },
  { key: 'tyres', nameEn: 'Tyres', nameAr: 'إطارات' },
  { key: 'office', nameEn: 'Office Supplies', nameAr: 'مستلزمات مكتبية' },
  { key: 'it', nameEn: 'IT & Equipment', nameAr: 'تقنية ومعدات' },
  { key: 'services', nameEn: 'Services', nameAr: 'خدمات' },
  { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

module.exports = { KSA_VAT_RATE, PR_STATUSES, PO_STATUSES, BILL_STATUSES, PRIORITIES, CATEGORIES };
