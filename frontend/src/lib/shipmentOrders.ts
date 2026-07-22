// Shared types + vocabulary for the Shipment Orders trial section (طلبات
// الشحنات) — shipments created natively instead of on the external UPL system.
//
// The status keys deliberately match the ops mirror's so the team reads one
// vocabulary, but this file owns its copy: the section must survive the ops
// integration being turned off, which is its whole reason to exist.

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

export interface FormFieldOption { key: string; ar: string; en: string }
export interface FormField {
  _id: string;
  key: string;
  labelAr: string;
  labelEn?: string;
  group: 'pickup_delivery' | 'shipment' | 'pricing_time' | 'payment';
  inputType: 'select' | 'cards' | 'text' | 'number' | 'datetime' | 'textarea';
  options: FormFieldOption[];
  required: boolean;
  order: number;
  active: boolean;
  isSystem: boolean;
}

export interface ShipmentOrder {
  _id: string;
  waybillNumber: number; // رقم البوليصة
  fromCity?: string; toCity?: string; addressFrom?: string; addressTo?: string;
  truckType?: string; cargoType?: string; truckLength?: string; quantity?: number | null;
  customer?: OrderCustomer | string | null;
  customerName?: string;
  driverName?: string; driverPhone?: string; vehicleName?: string;
  agentName?: string;
  pickupTime?: string | null; startTime?: string | null; arrivalTime?: string | null;
  sellPrice?: number | null; buyPrice?: number | null;
  driverRentType?: string; paymentMethod?: string; driverRentPrice?: number | null;
  branch?: string; status: string; notes?: string;
  customFields?: Record<string, unknown>;
  createdBy?: { firstName?: string; lastName?: string } | string | null;
  createdAt?: string;
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

export const orderStatus = (k?: string) => ORDER_STATUSES.find((s) => s.key === k) || null;
export const statusLabel = (k: string | undefined, lang: Lang) => {
  const s = orderStatus(k);
  return s ? (lang === 'ar' ? s.ar : s.en) : (k || '—');
};

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
}

export interface OrderVehicle {
  _id: string;
  plate: string;
  name?: string;
  truckType?: string;
  supplier?: OrderSupplier | string | null; // null = our own fleet
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
    return new Date(v).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return String(v); }
};

export const money = (n?: number | null) =>
  (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// The four questions other logic reads — mirror of the backend's
// CORE_FIELD_KEYS. Everything else is deletable from form-settings.
export const CORE_FIELD_KEYS = new Set(['fromCity', 'toCity', 'sellPrice', 'pickupTime']);

// Roles mirroring backend/src/routes/shipmentOrders.js.
export const SO_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'moderator'];
export const SO_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];
export const canEditOrders = (role?: string | null) => !!role && SO_EDIT_ROLES.includes(role);
export const canAdminOrders = (role?: string | null) => !!role && SO_ADMIN_ROLES.includes(role);
