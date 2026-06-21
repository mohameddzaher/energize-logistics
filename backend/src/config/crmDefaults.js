// Static option lists for the CRM module. Surfaced to the frontend via
// GET /api/crm/options so dropdowns and the pipeline board stay in sync with
// the backend without a database round-trip. Kept here (not in the DB) because
// they're configuration, not data.

// Sales pipeline. `won`/`lost` are terminal stages mapped to deal.status.
const PIPELINE_STAGES = [
  { key: 'new', nameEn: 'New', nameAr: 'جديد', probability: 10, color: '#94a3b8' },
  { key: 'contacted', nameEn: 'Contacted', nameAr: 'تم التواصل', probability: 25, color: '#3b82f6' },
  { key: 'qualified', nameEn: 'Qualified', nameAr: 'مؤهّل', probability: 40, color: '#6366f1' },
  { key: 'proposal', nameEn: 'Proposal', nameAr: 'عرض سعر', probability: 60, color: '#a855f7' },
  { key: 'negotiation', nameEn: 'Negotiation', nameAr: 'تفاوض', probability: 80, color: '#f97316' },
  { key: 'won', nameEn: 'Won', nameAr: 'تم الفوز', probability: 100, color: '#22c55e' },
  { key: 'lost', nameEn: 'Lost', nameAr: 'خسارة', probability: 0, color: '#ef4444' },
];

const COMPANY_STATUSES = [
  { key: 'lead', nameEn: 'Lead', nameAr: 'عميل محتمل' },
  { key: 'prospect', nameEn: 'Prospect', nameAr: 'مهتم' },
  { key: 'active', nameEn: 'Active', nameAr: 'نشط' },
  { key: 'inactive', nameEn: 'Inactive', nameAr: 'غير نشط' },
  { key: 'churned', nameEn: 'Churned', nameAr: 'منسحب' },
];

const COMPANY_TYPES = [
  { key: 'customer', nameEn: 'Customer', nameAr: 'عميل' },
  { key: 'partner', nameEn: 'Partner', nameAr: 'شريك' },
  { key: 'vendor', nameEn: 'Vendor', nameAr: 'مورّد' },
  { key: 'reseller', nameEn: 'Reseller', nameAr: 'موزّع' },
  { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

const COMPANY_SIZES = [
  { key: 'small', nameEn: 'Small (1-50)', nameAr: 'صغيرة (1-50)' },
  { key: 'medium', nameEn: 'Medium (51-250)', nameAr: 'متوسطة (51-250)' },
  { key: 'large', nameEn: 'Large (251-1000)', nameAr: 'كبيرة (251-1000)' },
  { key: 'enterprise', nameEn: 'Enterprise (1000+)', nameAr: 'مؤسسة (1000+)' },
];

const SOURCES = [
  { key: 'referral', nameEn: 'Referral', nameAr: 'توصية' },
  { key: 'website', nameEn: 'Website', nameAr: 'الموقع' },
  { key: 'cold_call', nameEn: 'Cold Call', nameAr: 'اتصال مباشر' },
  { key: 'social', nameEn: 'Social Media', nameAr: 'سوشيال ميديا' },
  { key: 'event', nameEn: 'Event', nameAr: 'فعالية' },
  { key: 'campaign', nameEn: 'Campaign', nameAr: 'حملة' },
  { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

const INDUSTRIES = [
  { key: 'logistics', nameEn: 'Logistics', nameAr: 'لوجستيات' },
  { key: 'manufacturing', nameEn: 'Manufacturing', nameAr: 'تصنيع' },
  { key: 'retail', nameEn: 'Retail', nameAr: 'تجزئة' },
  { key: 'wholesale', nameEn: 'Wholesale', nameAr: 'جملة' },
  { key: 'construction', nameEn: 'Construction', nameAr: 'إنشاءات' },
  { key: 'food', nameEn: 'Food & Beverage', nameAr: 'أغذية ومشروبات' },
  { key: 'tech', nameEn: 'Technology', nameAr: 'تقنية' },
  { key: 'healthcare', nameEn: 'Healthcare', nameAr: 'رعاية صحية' },
  { key: 'oil_gas', nameEn: 'Oil & Gas', nameAr: 'نفط وغاز' },
  { key: 'government', nameEn: 'Government', nameAr: 'حكومي' },
  { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

const ACTIVITY_TYPES = [
  { key: 'call', nameEn: 'Call', nameAr: 'مكالمة' },
  { key: 'meeting', nameEn: 'Meeting', nameAr: 'اجتماع' },
  { key: 'email', nameEn: 'Email', nameAr: 'بريد' },
  { key: 'whatsapp', nameEn: 'WhatsApp', nameAr: 'واتساب' },
  { key: 'visit', nameEn: 'Visit', nameAr: 'زيارة' },
  { key: 'note', nameEn: 'Note', nameAr: 'ملاحظة' },
];

const TASK_PRIORITIES = [
  { key: 'low', nameEn: 'Low', nameAr: 'منخفضة' },
  { key: 'medium', nameEn: 'Medium', nameAr: 'متوسطة' },
  { key: 'high', nameEn: 'High', nameAr: 'عالية' },
  { key: 'urgent', nameEn: 'Urgent', nameAr: 'عاجلة' },
];

const TASK_STATUSES = [
  { key: 'todo', nameEn: 'To Do', nameAr: 'للتنفيذ' },
  { key: 'in_progress', nameEn: 'In Progress', nameAr: 'قيد التنفيذ' },
  { key: 'done', nameEn: 'Done', nameAr: 'مكتملة' },
  { key: 'cancelled', nameEn: 'Cancelled', nameAr: 'ملغاة' },
];

module.exports = {
  PIPELINE_STAGES,
  COMPANY_STATUSES,
  COMPANY_TYPES,
  COMPANY_SIZES,
  SOURCES,
  INDUSTRIES,
  ACTIVITY_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
};
