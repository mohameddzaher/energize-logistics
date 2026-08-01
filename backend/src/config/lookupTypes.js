// Registry of every editable reference list (lookup type) in the system.
// Each entry declares: a stable `type` id, the module it belongs to, bilingual
// labels, the roles allowed to manage it, and the default rows to seed once.
//
// To add a new editable dropdown anywhere in the app you only need to:
//   1. add an entry here (with seed rows), and
//   2. point a <ManagedSelect type="..."> at it on the frontend.
// No new model / controller / route is required.
const crmDefaults = require('./crmDefaults');
const procurementDefaults = require('./procurementDefaults');
const assetDefaults = require('./assetDefaults');

// Roles that can manage every lookup regardless of module.
const BASE_WRITE_ROLES = ['super_admin', 'admin'];

const FLEET_ROLES = ['fleet_manager', 'operations_manager', 'operations'];
const REGISTRY = [
  // ── إدارة الأسطول — قوائم منسدلة قابلة للتعديل ────────────────────────────
  {
    type: 'fleet_rent_type',
    module: 'fleet',
    nameEn: 'Fleet Rent Types',
    nameAr: 'أنواع الإيجار (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'forward', nameEn: 'Forward', nameAr: 'قدام' },
      { key: 'return', nameEn: 'Return', nameAr: 'راجعة' },
    ],
  },
  {
    type: 'fleet_payment_type',
    module: 'fleet',
    nameEn: 'Fleet Payment Types',
    nameAr: 'أنواع الدفع (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'cash', nameEn: 'Cash', nameAr: 'كاش' },
      { key: 'tax', nameEn: 'Tax invoice', nameAr: 'ضريبي' },
    ],
  },
  {
    type: 'fleet_load_type',
    module: 'fleet',
    nameEn: 'Fleet Load Types',
    nameAr: 'أنواع الحمولة (الأسطول)',
    roles: FLEET_ROLES,
    seed: [
      { key: 'general', nameEn: 'General cargo', nameAr: 'بضائع عامة' },
      { key: 'containers', nameEn: 'Containers', nameAr: 'حاويات' },
      { key: 'vehicles', nameEn: 'Vehicles', nameAr: 'سيارات' },
      { key: 'equipment', nameEn: 'Equipment', nameAr: 'معدات' },
      { key: 'reefer', nameEn: 'Refrigerated', nameAr: 'مبرّدة' },
      { key: 'liquids', nameEn: 'Liquids', nameAr: 'سوائل' },
    ],
  },
  {
    type: 'procurement_category',
    module: 'procurement',
    nameEn: 'Procurement Categories',
    nameAr: 'فئات المشتريات',
    roles: ['procurement_manager', 'purchasing'],
    seed: procurementDefaults.CATEGORIES,
  },
  {
    type: 'vendor_category',
    module: 'procurement',
    nameEn: 'Vendor Categories',
    nameAr: 'فئات الموردين',
    roles: ['procurement_manager', 'purchasing', 'operations_manager', 'operations'],
    seed: [
      { key: 'spare_parts', nameEn: 'Spare Parts', nameAr: 'قطع غيار' },
      { key: 'fuel', nameEn: 'Fuel', nameAr: 'وقود' },
      { key: 'services', nameEn: 'Services', nameAr: 'خدمات' },
      { key: 'logistics', nameEn: 'Logistics', nameAr: 'لوجستيات' },
      { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
    ],
  },
  {
    type: 'crm_industry',
    module: 'crm',
    nameEn: 'CRM Industries',
    nameAr: 'صناعات العملاء',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.INDUSTRIES,
  },
  {
    type: 'crm_source',
    module: 'crm',
    nameEn: 'Lead Sources',
    nameAr: 'مصادر العملاء',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.SOURCES,
  },
  {
    type: 'crm_company_type',
    module: 'crm',
    nameEn: 'Company Types',
    nameAr: 'أنواع الشركات',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.COMPANY_TYPES,
  },
  {
    type: 'crm_company_size',
    module: 'crm',
    nameEn: 'Company Sizes',
    nameAr: 'أحجام الشركات',
    roles: ['crm_manager', 'crm_specialist', 'sales_manager'],
    seed: crmDefaults.COMPANY_SIZES,
  },
  {
    type: 'asset_type',
    module: 'it',
    nameEn: 'Custody & Store Item Types',
    nameAr: 'أنواع أصناف العهد والمستودع',
    roles: ['it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],
    seed: assetDefaults.TYPE_SEED,
  },
  {
    type: 'asset_condition',
    module: 'it',
    nameEn: 'Item Conditions',
    nameAr: 'حالات الأصناف',
    roles: ['it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],
    seed: assetDefaults.CONDITION_SEED,
  },
];

const byType = (type) => REGISTRY.find((r) => r.type === type) || null;

// Roles allowed to create/update/delete a given type.
const writeRolesFor = (type) => {
  const entry = byType(type);
  return [...BASE_WRITE_ROLES, ...((entry && entry.roles) || [])];
};

const canManage = (type, role) => writeRolesFor(type).includes(role);

// Public metadata (no seed payload) for the management UI, annotated with whether
// the requesting role may manage each type.
const typesForRole = (role) =>
  REGISTRY.map((r) => ({
    type: r.type,
    module: r.module,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    canManage: canManage(r.type, role),
  }));

// Idempotent seeding: insert any missing default rows. Existing rows (including
// user edits) are never overwritten.
const ensureDefaultLookups = async () => {
  const Lookup = require('../models/Lookup');
  for (const entry of REGISTRY) {
    for (let i = 0; i < (entry.seed || []).length; i++) {
      const row = entry.seed[i];
      const exists = await Lookup.findOne({ type: entry.type, key: row.key }).select('_id').lean();
      if (!exists) {
        await Lookup.create({
          type: entry.type,
          key: row.key,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          color: row.color,
          order: i,
          isActive: true,
          isSystem: true,
        });
      }
    }
  }
};

module.exports = { REGISTRY, byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups };
