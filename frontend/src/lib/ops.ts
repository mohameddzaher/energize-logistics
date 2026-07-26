// Operations Platform (قسم الأوبريشن) — shared config + helpers.
//
// This section is a LIVE MIRROR of the external UPL field-ops system (B2B:
// Fleet Management + 3PL). Our Next.js backend proxies every call to UPL at
// /api/ops/* and broadcasts changes over socket.io, so these pages read/write
// UPL directly while staying up to date without a refresh.

import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
import {
  Truck, Users, Car, UserSquare, Building2, MapPin, Globe, Boxes, Ruler,
  Package, Tag, Palette, ShieldCheck, type LucideIcon,
} from 'lucide-react';

export type Lang = 'en' | 'ar';

// ---- Roles ---------------------------------------------------------------
// Mirror of backend OPS_PLATFORM_*_ROLES (config/constants.js). Read access is
// broad (all internal staff except B2C + client) so ops data can be embedded
// across every section dashboard; writes stay limited to the admin tier.
export const OPS_STAFF_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee', 'operations_manager', 'operations',
  'workshop_manager', 'workshop_employee', 'purchasing',
  'hr_manager', 'hr_specialist',
  'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent',
  'finance_manager', 'accountant',
  'sales_manager', 'sales_rep',
  'procurement_manager',
  'customs_manager', 'customs_officer',
  'remote_manager',
];
export const OPS_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'];
// Core operations roles — used for the dedicated sidebar section so it isn't
// shown in every staff member's nav even though they CAN read the data.
export const OPS_SECTION_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'moderator', 'employee'];
export const isOpsStaff = (u: RoleOrUser) => OPS_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Operations Platform');
export const isOpsAdmin = (u: RoleOrUser) => OPS_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Operations Platform');

// ---- Shipment statuses (the heart of the operation) ----------------------
export interface StatusStyle { key: string; en: string; ar: string; bg: string; text: string; dot: string }
export const SHIPMENT_STATUSES: StatusStyle[] = [
  { key: 'requesting',    en: 'Requesting',    ar: 'قيد الطلب',     bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  { key: 'loading',       en: 'Loading',       ar: 'جاري التحميل',  bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'uploaded',      en: 'Uploaded',      ar: 'تم التحميل',    bg: 'bg-yellow-100',  text: 'text-yellow-700',  dot: 'bg-yellow-500' },
  { key: 'on_way',        en: 'On Way',        ar: 'في الطريق',     bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  { key: 'arrived',       en: 'Arrived',       ar: 'وصلت',          bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  { key: 'bond_sent',     en: 'Bond Sent',     ar: 'أُرسل السند',   bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  { key: 'bond_received', en: 'Bond Received', ar: 'استُلم السند',  bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'late',          en: 'Late',          ar: 'متأخرة',        bg: 'bg-orange-100',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  { key: 'invoiced',      en: 'Invoiced',      ar: 'تمت الفوترة',   bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  { key: 'cancelled',     en: 'Cancelled',     ar: 'ملغاة',         bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500' },
];
export const statusStyle = (k?: string) => SHIPMENT_STATUSES.find((s) => s.key === k) || null;
export const PAYMENT_METHODS = [
  { value: 'cash', en: 'Cash', ar: 'كاش' },
  { value: 'late', en: 'Deferred', ar: 'آجل' },
];

// ---- Value helpers -------------------------------------------------------
// UPL localized fields come back either as a plain string or as { en, ar }.
export function locName(v: unknown, lang: Lang): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const pick = o[lang] ?? o.en ?? o.ar;
    if (typeof pick === 'string' || typeof pick === 'number') return String(pick);
    // Nested relation objects (e.g. city/branch) carry their label under `.name`.
    if (o.name != null) return locName(o.name, lang);
    return '';
  }
  return '';
}

// One timeline event → { who did it, an optional note }. Tolerant of the UPL
// shapes we actually get back: `admin` is null for some statuses (the platform
// simply doesn't record who), and `details` is often `{}` or an object (so a
// naive `${ev.details}` printed "[object Object]"). The person occasionally
// lives inside `details` instead of `admin`.
export function timelineMeta(ev: Record<string, unknown> | null | undefined, lang: Lang = 'en'): { who: string; note: string } {
  if (!ev) return { who: '', note: '' };
  const details = ev.details;
  const who =
    locName((ev.admin as Record<string, unknown>)?.name, lang) ||
    locName(ev.admin, lang) ||
    (details && typeof details === 'object' ? locName((details as Record<string, unknown>).admin, lang) : '') ||
    '';
  let note = '';
  if (typeof details === 'string') {
    note = details.trim();
  } else if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    const cand = d.reason ?? d.note ?? d.message ?? d.text ?? d.description ?? d.comment;
    if (typeof cand === 'string' || typeof cand === 'number') note = String(cand).trim();
    else if (cand && typeof cand === 'object') note = locName(cand, lang);
  }
  return { who, note };
}

export function fmtDateTime(v?: string | null, lang: Lang = 'en'): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
export function fmtMoney(v?: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function fmtNum(v?: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('en-US');
}

// ---- Column + Field definitions ------------------------------------------
export type ColKind = 'text' | 'badge' | 'bool' | 'date' | 'money' | 'num' | 'rel' | 'img' | 'phone';
export interface Col { key: string; en: string; ar: string; kind?: ColKind; rel?: string }
export type FieldType = 'text' | 'number' | 'localized' | 'bool' | 'select' | 'date' | 'image' | 'ref';
export interface FieldDef {
  key: string; en: string; ar: string; type: FieldType; required?: boolean;
  options?: { value: string; en: string; ar: string }[];
  ref?: string; // resource key this id points to (for ref pickers)
  note?: string;
}
export interface ResourceCfg {
  key: string;          // route segment + /api/ops/<key>
  en: string; ar: string;
  icon: LucideIcon;
  countKey?: string;    // key inside dashboard stats.counts
  columns: Col[];
  fields?: FieldDef[];  // create/edit form (omit => read+delete only)
  filters?: { key: string; en: string; ar: string; options: { value: string; en: string; ar: string }[] }[];
  hasActive?: boolean;  // supports the active=true/false flag (soft enable)
  profile?: boolean;    // clicking a row opens a dedicated profile page (/system/ops/<key>/<id>) instead of the detail modal
}

const ACTIVE_FIELD: FieldDef = { key: 'active', en: 'Active', ar: 'مُفعّل', type: 'bool' };
const ACTIVE_FILTER = {
  key: 'active', en: 'Status', ar: 'الحالة',
  options: [{ value: 'true', en: 'Active', ar: 'مُفعّل' }, { value: 'false', en: 'Inactive', ar: 'غير مُفعّل' }],
};

// Resources we expose. Order here drives the sidebar + dashboard quick-links.
export const RESOURCES: ResourceCfg[] = [
  {
    key: 'shipments', en: 'Shipments', ar: 'الشحنات', icon: Truck, countKey: 'shipments',
    columns: [
      { key: 'reference_num', en: 'Ref #', ar: 'المرجع' },
      { key: 'status', en: 'Status', ar: 'الحالة', kind: 'badge' },
      { key: 'address_from', en: 'From', ar: 'من' },
      { key: 'address_to', en: 'To', ar: 'إلى' },
      { key: 'driver', en: 'Driver', ar: 'السائق', kind: 'rel', rel: 'name' },
      { key: 'selling_price', en: 'Selling', ar: 'البيع', kind: 'money' },
      { key: 'payment_method', en: 'Payment', ar: 'الدفع' },
      { key: 'created_at', en: 'Created', ar: 'الإنشاء', kind: 'date' },
    ],
    // Shipments have their own dedicated page (rich filters + status workflow).
  },
  {
    key: 'drivers', en: 'Drivers', ar: 'السائقون', icon: Users, countKey: 'drivers', hasActive: false, profile: true,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'phone', en: 'Phone', ar: 'الهاتف', kind: 'phone' },
      { key: 'nationality', en: 'Nationality', ar: 'الجنسية' },
      { key: 'driver_card_number', en: 'Card #', ar: 'رقم البطاقة' },
      { key: 'company_name', en: 'Company', ar: 'الشركة' },
      { key: 'created_at', en: 'Created', ar: 'الإنشاء', kind: 'date' },
    ],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'text', required: true },
      { key: 'phone', en: 'Phone', ar: 'الهاتف', type: 'text', required: true },
      { key: 'email', en: 'Email', ar: 'البريد', type: 'text' },
      { key: 'nationality', en: 'Nationality', ar: 'الجنسية', type: 'text', required: true },
      { key: 'residence_number', en: 'Residence #', ar: 'رقم الإقامة', type: 'text' },
      { key: 'driver_card_number', en: 'Driver Card #', ar: 'رقم بطاقة السائق', type: 'text', required: true },
      { key: 'driver_card_expiry', en: 'Card Expiry', ar: 'انتهاء البطاقة', type: 'date' },
      { key: 'company_name', en: 'Company', ar: 'الشركة', type: 'text' },
      { key: 'sponsor_name', en: 'Sponsor', ar: 'الكفيل', type: 'text' },
      { key: 'car_owner_id', en: 'Car Owner ID', ar: 'معرّف صاحب السيارة', type: 'ref', ref: 'car-owners', required: true },
      { key: 'car_id', en: 'Car ID', ar: 'معرّف السيارة', type: 'ref', ref: 'cars', required: true },
    ],
  },
  {
    key: 'cars', en: 'Cars', ar: 'المركبات', icon: Car, countKey: 'cars', hasActive: true,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'plate_number', en: 'Plate', ar: 'اللوحة' },
      { key: 'car_number', en: 'Car #', ar: 'رقم المركبة' },
      { key: 'car_model_year', en: 'Year', ar: 'الموديل' },
      { key: 'owner', en: 'Owner', ar: 'المالك', kind: 'rel', rel: 'name' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'car_number', en: 'Car Number', ar: 'رقم المركبة', type: 'text', required: true },
      { key: 'plate_number', en: 'Plate Number', ar: 'رقم اللوحة', type: 'text', required: true },
      { key: 'car_model_year', en: 'Model Year', ar: 'سنة الموديل', type: 'number', required: true },
      { key: 'car_record_number', en: 'Record #', ar: 'رقم السجل', type: 'text' },
      { key: 'insurance_details', en: 'Insurance', ar: 'التأمين', type: 'text' },
      { key: 'operation_card_number', en: 'Operation Card #', ar: 'رقم كرت التشغيل', type: 'text' },
      { key: 'operation_card_expiry', en: 'Op. Card Expiry', ar: 'انتهاء كرت التشغيل', type: 'date' },
      { key: 'truck_type_id', en: 'Truck Type ID', ar: 'نوع الشاحنة', type: 'ref', ref: 'truck-types', required: true },
      { key: 'country_id', en: 'Country ID', ar: 'الدولة', type: 'ref', ref: 'countries', required: true },
      { key: 'car_brand_id', en: 'Brand ID', ar: 'الماركة', type: 'ref', ref: 'car-brands', required: true },
      { key: 'car_color_id', en: 'Color ID', ar: 'اللون', type: 'ref', ref: 'car-colors', required: true },
      { key: 'owner_id', en: 'Owner ID', ar: 'المالك', type: 'ref', ref: 'car-owners', required: true },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'car-owners', en: 'Car Owners', ar: 'أصحاب المركبات', icon: UserSquare, countKey: 'carOwners',
    columns: [
      { key: 'owner_name', en: 'Owner', ar: 'المالك' },
      { key: 'owner_phone', en: 'Phone', ar: 'الهاتف', kind: 'phone' },
      { key: 'car_owner_number', en: 'Owner #', ar: 'رقم المالك' },
      { key: 'manager_name', en: 'Manager', ar: 'المدير' },
      { key: 'created_at', en: 'Created', ar: 'الإنشاء', kind: 'date' },
    ],
    fields: [
      { key: 'owner_name', en: 'Owner Name', ar: 'اسم المالك', type: 'text' },
      { key: 'owner_phone', en: 'Owner Phone', ar: 'هاتف المالك', type: 'text' },
      { key: 'car_owner_number', en: 'Owner Number', ar: 'رقم المالك', type: 'text' },
      { key: 'commercial_register', en: 'Commercial Register', ar: 'السجل التجاري', type: 'text' },
      { key: 'tax_card', en: 'Tax Card', ar: 'البطاقة الضريبية', type: 'text' },
      { key: 'national_address', en: 'National Address', ar: 'العنوان الوطني', type: 'text' },
      { key: 'bank_name', en: 'Bank', ar: 'البنك', type: 'text' },
      { key: 'iban', en: 'IBAN', ar: 'الآيبان', type: 'text' },
      { key: 'manager_name', en: 'Manager Name', ar: 'اسم المدير', type: 'text' },
      { key: 'manager_phone', en: 'Manager Phone', ar: 'هاتف المدير', type: 'text' },
      { key: 'accountant_name', en: 'Accountant', ar: 'المحاسب', type: 'text' },
      { key: 'accountant_phone', en: 'Accountant Phone', ar: 'هاتف المحاسب', type: 'text' },
      { key: 'payment_terms', en: 'Payment Terms', ar: 'شروط الدفع', type: 'text', required: true },
      { key: 'agreed_price_statement', en: 'Agreed Price', ar: 'السعر المتفق', type: 'text', required: true },
      { key: 'owner_id', en: 'User (Owner) ID', ar: 'معرّف المستخدم', type: 'ref', ref: 'users', required: true },
      { key: 'delegate_id', en: 'Delegate ID', ar: 'معرّف المندوب', type: 'ref', ref: 'admins', required: true },
    ],
  },
  {
    key: 'users', en: 'Customers', ar: 'العملاء', icon: Users, countKey: 'users', profile: true,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'phone', en: 'Phone', ar: 'الهاتف', kind: 'phone' },
      { key: 'email', en: 'Email', ar: 'البريد' },
      { key: 'user_type', en: 'Type', ar: 'النوع' },
      { key: 'verified', en: 'Verified', ar: 'موثّق', kind: 'bool' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER, {
      key: 'verified', en: 'Verified', ar: 'التوثيق',
      options: [{ value: 'true', en: 'Verified', ar: 'موثّق' }, { value: 'false', en: 'Unverified', ar: 'غير موثّق' }],
    }, {
      key: 'user_type', en: 'Type', ar: 'النوع',
      options: [{ value: 'individual', en: 'Individual', ar: 'فرد' }, { value: 'business', en: 'Business', ar: 'شركة' }],
    }],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'text' },
      { key: 'phone', en: 'Phone', ar: 'الهاتف', type: 'text', required: true },
      { key: 'email', en: 'Email', ar: 'البريد', type: 'text' },
      { key: 'user_type', en: 'User Type', ar: 'نوع المستخدم', type: 'text', required: true, note: 'fleet / 3pl' },
      { key: 'address', en: 'Address', ar: 'العنوان', type: 'text' },
      { key: 'zip_code', en: 'Zip', ar: 'الرمز البريدي', type: 'number' },
      { key: 'city_id', en: 'City ID', ar: 'المدينة', type: 'ref', ref: 'cities' },
      ACTIVE_FIELD,
      { key: 'verified', en: 'Verified', ar: 'موثّق', type: 'bool' },
    ],
  },
  {
    key: 'branches', en: 'Branches', ar: 'الفروع', icon: Building2, countKey: 'branches', hasActive: true,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'country', en: 'Country', ar: 'الدولة', kind: 'rel', rel: 'name' },
      { key: 'city', en: 'City', ar: 'المدينة', kind: 'rel', rel: 'name' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'country_id', en: 'Country ID', ar: 'الدولة', type: 'ref', ref: 'countries', required: true },
      { key: 'city_id', en: 'City ID', ar: 'المدينة', type: 'ref', ref: 'cities', required: true },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'cities', en: 'Cities', ar: 'المدن', icon: MapPin,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'country', en: 'Country', ar: 'الدولة', kind: 'rel', rel: 'name' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'country_id', en: 'Country ID', ar: 'الدولة', type: 'ref', ref: 'countries', required: true },
      { key: 'lat', en: 'Latitude', ar: 'خط العرض', type: 'number' },
      { key: 'lng', en: 'Longitude', ar: 'خط الطول', type: 'number' },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'countries', en: 'Countries', ar: 'الدول', icon: Globe,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'flag', en: 'Flag', ar: 'العلم', kind: 'img' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'flag', en: 'Flag (URL)', ar: 'العلم (رابط)', type: 'image', required: true },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'truck-types', en: 'Truck Types', ar: 'أنواع الشاحنات', icon: Boxes,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'image', en: 'Image', ar: 'الصورة', kind: 'img' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'image', en: 'Image (URL)', ar: 'الصورة (رابط)', type: 'image' },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'truck-sizes', en: 'Truck Sizes', ar: 'أحجام الشاحنات', icon: Ruler,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'truck_type', en: 'Truck Type', ar: 'نوع الشاحنة', kind: 'rel', rel: 'name' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'truck_type_id', en: 'Truck Type ID', ar: 'نوع الشاحنة', type: 'ref', ref: 'truck-types', required: true },
      { key: 'image', en: 'Image (URL)', ar: 'الصورة (رابط)', type: 'image' },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'load-types', en: 'Load Types', ar: 'أنواع الحمولة', icon: Package,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'image', en: 'Image', ar: 'الصورة', kind: 'img' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'image', en: 'Image (URL)', ar: 'الصورة (رابط)', type: 'image' },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'car-brands', en: 'Car Brands', ar: 'ماركات المركبات', icon: Tag,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'image', en: 'Logo', ar: 'الشعار', kind: 'img' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'image', en: 'Logo (URL)', ar: 'الشعار (رابط)', type: 'image' },
      ACTIVE_FIELD,
    ],
  },
  {
    key: 'car-colors', en: 'Car Colors', ar: 'ألوان المركبات', icon: Palette,
    columns: [
      { key: 'name', en: 'Name', ar: 'الاسم' },
      { key: 'color_code', en: 'Color', ar: 'الكود', kind: 'text' },
      { key: 'active', en: 'Active', ar: 'مُفعّل', kind: 'bool' },
    ],
    filters: [ACTIVE_FILTER],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'localized', required: true },
      { key: 'color_code', en: 'Color Code (hex)', ar: 'كود اللون', type: 'text', required: true },
      ACTIVE_FIELD,
    ],
  },
];

export const resourceByKey = (key: string) => RESOURCES.find((r) => r.key === key);

// Bilingual micro-helper for page text.
export function opsText(lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  return {
    ar,
    section: t('Operations Platform', 'منصة الأوبريشن'),
    dashboard: t('Operations Dashboard', 'لوحة الأوبريشن'),
    liveSubtitle: t('Live mirror of the field operations system', 'مرآة حيّة لنظام عمليات الميدان'),
    search: t('Search…', 'بحث…'),
    add: t('Add', 'إضافة'),
    edit: t('Edit', 'تعديل'),
    save: t('Save', 'حفظ'),
    cancel: t('Cancel', 'إلغاء'),
    delete: t('Delete', 'حذف'),
    confirmDelete: t('Delete this record?', 'حذف هذا السجل؟'),
    details: t('Details', 'التفاصيل'),
    actions: t('Actions', 'إجراءات'),
    noData: t('No records', 'لا توجد سجلات'),
    notAuthorized: t('You do not have access to this section', 'لا تملك صلاحية لهذا القسم'),
    all: t('All', 'الكل'),
    of: t('of', 'من'),
    page: t('Page', 'صفحة'),
    prev: t('Previous', 'السابق'),
    next: t('Next', 'التالي'),
    total: t('Total', 'الإجمالي'),
    live: t('Live', 'مباشر'),
    refresh: t('Refresh', 'تحديث'),
    updateStatus: t('Update Status', 'تحديث الحالة'),
    openInOps: t('Open', 'فتح'),
    viewAll: t('View all', 'عرض الكل'),
    loading: t('Loading…', 'جاري التحميل…'),
    saveFailed: t('Save failed', 'فشل الحفظ'),
    required: t('Please fill required fields', 'يرجى ملء الحقول المطلوبة'),
  };
}

export interface Paginated<T> { items: T[]; meta?: { totalItems: number; currentPage: number; totalPages: number; limit: number } }
