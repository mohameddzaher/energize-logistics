import type { PersonDocs } from '@/components/system/PersonDocDate';
// Shared types and vocabulary for the Shipment Orders trial section: shipments created natively instead of on the external UPL system.
// The status keys deliberately match the ops mirror's so the team reads one vocabulary, but this file owns its copy: the section must survive the ops integration being turned off, which is its whole reason to exist.

import type { PaymentSubtype } from '@/lib/paymentKind';

export type Lang = 'en' | 'ar';

export interface OrderRoute { fromCity: string; toCity: string; price: number | null }

export interface OrderCustomer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  routes: OrderRoute[];
  defaults?: {
    truckType?: string; cargoType?: string; paymentMethod?: string;
    driverRentType?: string; branch?: string;
  };
}

export interface FormFieldOption {
  key: string; ar: string; en: string;
  /** What the choice implies: the driver-hire type decides the payment method. */
  paymentMethod?: string;
}

export interface FormField {
  _id: string;
  key: string;
  labelAr: string;
  labelEn?: string;
  group: 'pickup_delivery' | 'shipment' | 'pricing_time' | 'payment';
  // 'date', not 'datetime': shipment dates are a day, not a moment; see models/ShipmentOrderField.
  inputType: 'select' | 'cards' | 'text' | 'number' | 'date' | 'datetime' | 'textarea';
  options: FormFieldOption[];
  required: boolean;
  order: number;
  active: boolean;
  isSystem: boolean;
}

export interface ShipmentOrder {
  _id: string;
  waybillNumber: number; // Waybill number.
  fromCity?: string; toCity?: string; addressFrom?: string; addressTo?: string;
  truckType?: string; cargoType?: string; truckLength?: string; quantity?: number | null;
  customer?: OrderCustomer | string | null;
  customerName?: string;
  driverName?: string; driverPhone?: string; vehicleName?: string;
  agentName?: string;
  pickupTime?: string | null; startTime?: string | null; arrivalTime?: string | null;
  sellPrice?: number | null; buyPrice?: number | null;
  /** Payment kind: the ops workflow keys (lib/paymentKind). It replaced the hire type in the form. */
  paymentSubtype?: '' | PaymentSubtype;
  driverRentType?: string; paymentMethod?: string; driverRentPrice?: number | null;
  branch?: string; status: string; notes?: string;
  customFields?: Record<string, unknown>;
  createdBy?: { firstName?: string; lastName?: string } | string | null;
  createdAt?: string;
  // Status transition log: from where to where, when, why and by whom. When it became in transit and who delayed it are asked a week later, and cannot be answered if only the last status is kept.
  statusLog?: { _id?: string; from?: string; to?: string; note?: string; at?: string; by?: string; byName?: string; fileUrl?: string; fileName?: string; editedAt?: string | null; editedByName?: string }[];
}

// Same keys and colours as the ops mirror so a status reads identically on
// both screens.
export const ORDER_STATUSES = [
  { key: 'requesting', en: 'Requesting', ar: 'قيد الطلب', bg: 'bg-slate-100', text: 'text-slate-700' },
  { key: 'loading', en: 'Loading', ar: 'جاري التحميل', bg: 'bg-amber-100', text: 'text-amber-700' },
  { key: 'uploaded', en: 'Uploaded', ar: 'تم التحميل', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  { key: 'on_way', en: 'On Way', ar: 'في الطريق', bg: 'bg-blue-100', text: 'text-blue-700' },
  { key: 'arrived', en: 'Arrived', ar: 'وصلت', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { key: 'bond_sent', en: 'Bond Sent', ar: 'أُرسل السند', bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { key: 'bond_received', en: 'Bond Received', ar: 'استُلم السند', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { key: 'late', en: 'Late', ar: 'متأخرة', bg: 'bg-orange-100', text: 'text-orange-700' },
  { key: 'invoiced', en: 'Invoiced', ar: 'تمت الفوترة', bg: 'bg-violet-100', text: 'text-violet-700' },
  { key: 'cancelled', en: 'Cancelled', ar: 'ملغاة', bg: 'bg-red-100', text: 'text-red-700' },
] as const;

// Each status color as a number: cards are colored by it directly, and since a status added from settings also has a numeric color, the screen needs only one way to color.
export const STATUS_HEX: Record<string, string> = {
  requesting: '#64748b', loading: '#d97706', uploaded: '#ca8a04', on_way: '#2563eb',
  arrived: '#4f46e5', bond_sent: '#0891b2', bond_received: '#059669',
  late: '#ea580c', invoiced: '#7c3aed', cancelled: '#dc2626',
};

export const orderStatus = (k?: string) => ORDER_STATUSES.find((s) => s.key === k) || null;
export const statusLabel = (k: string | undefined, lang: Lang) => {
  const s = orderStatus(k);
  return s ? (lang === 'ar' ? s.ar : s.en) : (k || '—');
};

// Labels are set from section settings. The keys above are a contract: analytics counts on them, alerts fire from them and the external platform speaks them. The visible name, color, order and whether it is in use today come from settings, so a status added as an eleventh appears here too.
export interface StatusVocab {
  key: string; ar: string; en: string; color: string; order: number; active: boolean; isCore: boolean;
}

// The core ones as in code, shown even before the server replies so the screen is not drawn empty and then filled.
export const FALLBACK_STATUS_VOCAB: StatusVocab[] = ORDER_STATUSES.map((s, i) => ({
  key: s.key, ar: s.ar, en: s.en, color: STATUS_HEX[s.key] || '#64748b', order: i, active: true, isCore: true,
}));

export const vocabLabel = (v: StatusVocab, lang: Lang) => (lang === 'ar' ? v.ar : v.en);

export const GROUP_LABELS: Record<FormField['group'], { ar: string; en: string }> = {
  pickup_delivery: { ar: 'الاستلام والتسليم', en: 'Pickup & delivery' },
  shipment: { ar: 'تفاصيل الشحنة', en: 'Shipment details' },
  pricing_time: { ar: 'الأسعار والتوقيت', en: 'Pricing & timing' },
  payment: { ar: 'المدفوعات', en: 'Payments' },
};

export const fieldLabel = (f: FormField, lang: Lang) => (lang === 'ar' ? f.labelAr : (f.labelEn || f.labelAr));
export const optionLabel = (o: FormFieldOption, lang: Lang) => (lang === 'ar' ? (o.ar || o.key) : (o.en || o.key));

export interface OrderSupplier {
  _id: string;
  name: string;
  type: 'company' | 'freelancer';
  phone?: string;
  email?: string;
  notes?: string;
  vehicleCount?: number;
  /** How many drivers work for him, read before opening his file like the truck count. */
  driverCount?: number;
  /** His financial papers. A supplier is not just a name and phone: it is a commercial registration and an IBAN to transfer money to, and a manager with a number; calling the owner about an invoice wastes a day. Four of five have them written, so they are read from the row before a file is opened. */
  commercialRegister?: string;
  taxCard?: string;
  iban?: string;
  bankName?: string;
  managerName?: string;
  managerPhone?: string;
  paymentTerms?: string;
}

/** A carrier truck driver: a record that was entirely missing. The driver was a name and phone typed on the truck row, with no file, residency number, operating card or its expiry. The operations platform keeps each one's file, so the record was imported from it. */
export interface OrderDriver extends PersonDocs {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  nationality?: string;
  /** Residency number: identifies the man when names are similar. */
  residenceNumber?: string;
  driverCardNumber?: string;
  /** Operating card expiry: a driver with an expired card is stopped by the road, not by us. */
  driverCardExpiry?: string;
  companyName?: string;
  sponsorName?: string;
  supplier?: OrderSupplier | string | null;
  vehicle?: OrderVehicle | string | null;
  /** His HR file if he is our employee; name, mobile and nationality come from it. */
  employee?: string | null;
  hr?: { _id: string; name: string; phone?: string; nationality?: string; idNumber?: string } | null;
  notes?: string;
}

export interface OrderVehicle {
  _id: string;
  plate: string;
  name?: string;
  truckType?: string;
  /** Make and color; printed in the vehicle data of the waybill. */
  brand?: string;
  color?: string;
  modelYear?: string;
  operationCardNumber?: string;
  operationCardExpiry?: string;
  supplier?: OrderSupplier | string | null;
  /** Whose truck it is, explicit and not by absence. An empty `supplier` used to mean ours, then thirteen thousand trucks from order history arrived without a supplier reference and were read as our fleet, which is fifty-eight. Absence means unknown, not ours. */
  ownership?: 'supplier' | 'ours' | 'unknown';
  /** Our truck in the vehicle register; make, color and model year come from it. */
  vehicleMaster?: string | null;
  registry?: { _id: string; plateNumber: string; brand?: string; model?: string; modelYear?: string; color?: string } | null;
  defaultDriverName?: string;
  defaultDriverPhone?: string;
  notes?: string;
}

// Sections the form always renders itself, regardless of field config: they
// carry logic (customer autofill, vehicle registry, waybill, status) rather
// than plain answers.
export const FIXED_KEYS = new Set([
  'customer', 'waybillNumber', 'status', 'agentName',
  'vehicleName', 'driverName', 'driverPhone',
]);

export const fmtDT = (v?: string | null, lang: Lang = 'ar') => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return String(v); }
};

export const money = (n?: number | null) =>
  (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// The four questions other logic reads — mirror of the backend's
// CORE_FIELD_KEYS. Everything else is deletable from form-settings.
export const CORE_FIELD_KEYS = new Set(['fromCity', 'toCity', 'sellPrice', 'pickupTime']);

// Roles mirroring backend/src/routes/shipmentOrders.js — OR a dynamic grant
// from the permissions matrix (the backend's rbac honours an 'edit' grant even
// on its admin-listed routes, so the UI must too or granted roles see dead
// screens). Pass the USER, not the role string: only the user carries grants.
import { canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
// Mirrors EDIT_ROLES in backend/src/routes/shipmentOrders.js: the section team and data roles create shipments, customers and suppliers.
export const SO_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator',
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup', 'data_manager', 'data_analyst', 'data_entry'];
/** One shipment is one record: only these delete it, from either screen. */
export const canDeleteShipments = (u: RoleOrUser) => ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'].includes(roleOf(u));
export const SO_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];
/** Merging suppliers is by role only; counterpart of authorize.strict on the server (not to be loosened). */
export const canMergeSuppliers = (u: RoleOrUser) => [...SO_ADMIN_ROLES, 'shipment_orders_manager'].includes(roleOf(u));
export const canEditOrders = (u: RoleOrUser) => SO_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Shipment Orders');
export const canAdminOrders = (u: RoleOrUser) => SO_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Shipment Orders');
