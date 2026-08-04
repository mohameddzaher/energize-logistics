/**
 * partnerRegisters — كل سجلات العملاء والموردين في النظام في مكان واحد.
 *
 * The company never had ONE customer table. Each section grew its own, for good
 * reasons at the time: the finance `Customer` carries credit terms, the fleet's
 * `FleetCustomer` carries agreed route prices, the shipment-orders trial keeps a
 * deliberately disposable register, the CRM keeps leads, and customs work is
 * often recorded against a bare typed name.
 *
 * A portal login has to be creatable from ANY of them — "ادخل عند أي بروفايل أي
 * عميل من أي قسم واعمل من البروفايل بتاعه إنشاء إيميل". So this file is the one
 * place that knows what those registers are, what each row is called, and which
 * of our services the row implies. Everything else (the users page dropdown, the
 * profile "create login" card, the portal itself) reads it instead of
 * hard-coding a list that would rot the day a section adds a register.
 *
 * `service` is what the portal turns on for that partner — but only as a HINT:
 * the portal re-detects the real services from the actual work it finds under
 * the partner's name, so a fleet customer who also clears customs sees both.
 */

// The services a portal account can surface. Each maps to a portal tab.
const SERVICES = {
  heavy_transport: { ar: 'النقل الثقيل', en: 'Heavy transport' },
  shipment_orders: { ar: 'طلبات الشحن', en: 'Shipment orders' },
  customs: { ar: 'التخليص الجمركي', en: 'Customs clearance' },
  operations: { ar: 'منصة الأوبريشن', en: 'Operations platform' },
  finance: { ar: 'الفواتير والمدفوعات', en: 'Invoices & payments' },
  crm: { ar: 'إدارة العلاقات', en: 'Relationship' },
  procurement: { ar: 'المشتريات', en: 'Procurement' },
};

const REGISTERS = [
  // ── العملاء ──────────────────────────────────────────────────────────────
  {
    key: 'customer',
    kind: 'customer',
    model: 'Customer',
    nameField: 'companyName',
    ar: 'عميل مالي (فواتير وتحصيل)',
    en: 'Finance customer',
    service: 'finance',
    // Extra columns worth showing next to the name in the picker.
    select: 'companyName customerNumber email phone office grade clientStatus isActive creditTerm',
    detail: (d) => [d.customerNumber, d.office, d.grade && `فئة ${d.grade}`].filter(Boolean).join(' · '),
    profilePath: (id) => `/system/customers/${id}`,
  },
  {
    key: 'fleet_customer',
    kind: 'customer',
    model: 'FleetCustomer',
    nameField: 'name',
    ar: 'عميل النقل الثقيل',
    en: 'Heavy transport customer',
    service: 'heavy_transport',
    select: 'name email phone customerType rating isActive',
    detail: (d) => (d.customerType === 'branch' ? 'عميل فروع' : 'نقل ثقيل'),
    profilePath: (id) => `/system/fleet/customers/${id}`,
  },
  {
    key: 'shipment_order_customer',
    kind: 'customer',
    model: 'ShipmentOrderCustomer',
    nameField: 'name',
    ar: 'عميل طلبات الشحنات',
    en: 'Shipment orders customer',
    service: 'shipment_orders',
    select: 'name email phone isActive',
    detail: () => 'طلبات شحنات',
    profilePath: () => '/system/shipment-orders/customers',
  },
  {
    key: 'crm_company',
    kind: 'customer',
    model: 'CrmCompany',
    nameField: 'name',
    ar: 'شركة في الـCRM',
    en: 'CRM company',
    service: 'crm',
    select: 'name arabicName email phone type status city externalSource',
    detail: (d) => [d.status, d.city, d.externalSource === 'ops_upl' && 'من منصة الأوبريشن'].filter(Boolean).join(' · '),
    profilePath: (id) => `/system/crm/companies/${id}`,
  },
  {
    // Customs work is very often filed against a typed customer name with no row
    // anywhere. Rather than pretend those customers don't exist, this register is
    // VIRTUAL: its "rows" are the distinct customer names on customs files, and
    // the partner ref is the folded name instead of an ObjectId.
    key: 'customs_customer',
    kind: 'customer',
    virtual: true,
    model: 'CustomsClearance',
    nameField: 'customerName',
    ar: 'عميل تخليص جمركي',
    en: 'Customs customer',
    service: 'customs',
    profilePath: () => '/system/customs',
  },

  // ── الموردون ─────────────────────────────────────────────────────────────
  {
    key: 'crm_vendor',
    kind: 'vendor',
    model: 'CrmVendor',
    nameField: 'name',
    ar: 'مورد نقل (ناقل 3PL)',
    en: 'Transport vendor (3PL)',
    service: 'shipment_orders',
    select: 'name email mobile vendorType headOffice carsCount followUpStatus',
    detail: (d) => [d.vendorType, d.headOffice, d.carsCount != null && `${d.carsCount} سيارة`].filter(Boolean).join(' · '),
    profilePath: () => '/system/crm/vendors',
  },
  {
    key: 'shipment_order_supplier',
    kind: 'vendor',
    model: 'ShipmentOrderSupplier',
    nameField: 'name',
    ar: 'مورد طلبات الشحنات',
    en: 'Shipment orders supplier',
    service: 'shipment_orders',
    select: 'name email phone type isActive',
    detail: (d) => (d.type === 'freelancer' ? 'فرد/سائق مستقل' : 'شركة'),
    profilePath: () => '/system/shipment-orders/fleet',
  },
  {
    key: 'vendor',
    kind: 'vendor',
    model: 'Vendor',
    nameField: 'name',
    ar: 'مورد مشتريات',
    en: 'Procurement vendor',
    service: 'procurement',
    select: 'name email phone category isActive',
    detail: (d) => d.category || 'مشتريات',
    profilePath: () => '/system/vendors',
  },
];

const REGISTER_BY_KEY = Object.fromEntries(REGISTERS.map((r) => [r.key, r]));
const REGISTER_KEYS = REGISTERS.map((r) => r.key);

/** The mongoose model behind a register (required lazily to avoid import cycles). */
const modelFor = (key) => {
  const reg = REGISTER_BY_KEY[key];
  if (!reg) return null;
  if (reg.model === 'FleetCustomer') return require('../models/FleetModels').FleetCustomer;
  return require(`../models/${reg.model}`);
};

/** Serialisable view of the registers, for the frontend picker. */
const registerMeta = () => REGISTERS.map((r) => ({
  key: r.key, kind: r.kind, ar: r.ar, en: r.en, service: r.service, virtual: !!r.virtual,
}));

module.exports = { SERVICES, REGISTERS, REGISTER_BY_KEY, REGISTER_KEYS, modelFor, registerMeta };
