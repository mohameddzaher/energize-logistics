/**
 * أسماءُ مراحل دورة التخليص — للإشعارات وسجلّ المراجعة ولوحة القسم.
 * المفاتيحُ وترتيبُها في models/CustomsClearance (STAGES)؛ وهنا أسماؤها وحدَها.
 * «الحاويات» في الاسم تصير «السيّارات» في معاملة السيّارات — راجع stageLabel.
 */
const CUSTOMS_STAGE_AR = {
  papers_received: 'استلام الأوراق',
  declaration_paid: 'سداد البيان الجمركي',
  do_requested: 'طلب فاتورة إذن التسليم',
  do_invoice_paid: 'سداد فاتورة إذن التسليم',
  do_linked: 'ربط إذن التسليم',
  port_fees_paid: 'سداد أجور الموانئ',
  unloading_fees_paid: 'سداد أجور التفريغ',
  transport_order: 'أمر النقل',
  transport_to_yard: 'نقل الحاويات من الميناء إلى الساحة',
  transport_to_customer: 'نقل الحاويات من الميناء إلى العميل',
  unloaded_stored: 'التفريغ والتخزين',
  yard_to_customer: 'نقل الحاويات من الساحة إلى العميل',
  containers_returned: 'إرجاع الحاويات',
  invoiced: 'إصدار الفاتورة',
  // مفتاحُ ما قبل تفريع النقل — باقٍ في سجلّاتٍ قديمة.
  containers_transported: 'نقل الحاويات',
};

const CUSTOMS_STAGE_EN = {
  papers_received: 'Papers received',
  declaration_paid: 'Customs declaration paid',
  do_requested: 'DO invoice requested',
  do_invoice_paid: 'DO invoice paid',
  do_linked: 'DO linked',
  port_fees_paid: 'Port fees paid',
  unloading_fees_paid: 'Unloading fees paid',
  transport_order: 'Transport order',
  transport_to_yard: 'Containers: port to yard',
  transport_to_customer: 'Containers: port to customer',
  unloaded_stored: 'Unloading & storage',
  yard_to_customer: 'Containers: yard to customer',
  containers_returned: 'Containers returned',
  invoiced: 'Invoice issued',
  containers_transported: 'Containers transported',
};

const stageLabel = (key, cargoType = 'containers', lang = 'ar') => {
  const base = (lang === 'en' ? CUSTOMS_STAGE_EN : CUSTOMS_STAGE_AR)[key] || key;
  if (cargoType !== 'vehicles') return base;
  return lang === 'en' ? base.replace('Containers', 'Vehicles') : base.replace('الحاويات', 'السيّارات');
};

module.exports = { CUSTOMS_STAGE_AR, CUSTOMS_STAGE_EN, stageLabel };
