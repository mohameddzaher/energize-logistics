// إدارة الأسطول — types + vocabulary. Our own trucks: booking, drivers,
// follow-up calls. Sibling of lib/shipmentOrders.ts (that section books
// supplier trucks); the status vocabulary is the same on purpose.

export type Lang = 'en' | 'ar';

export interface FleetVehicle {
  _id: string;
  plate: string;
  name?: string;
  trailerType?: string; // سطحة / ستارة …
  gpsType?: string;     // LS / EX
  supervisor?: string | null;   // المشرف المسؤول — يعيّنه مدير القسم
  supervisorName?: string;
  notes?: string;
  drivers?: { _id: string; name: string; phone?: string; working?: boolean }[];
  // إثراء حي وقت الاختيار: أين هي الآن، وماذا تحمل بالفعل، وهل وصلت وجهتها.
  live?: { city: string | null; status?: string | null; lastMessageAt?: string | null } | null;
  trip?: { waybillNumber: number; status: string; fromCity: string; toCity: string; expectedArrival: string | null } | null;
  atDestination?: boolean;
}

// سطر توافر السيارة أثناء الاختيار: «متاحة — في جدة» / «عليها حمولة إلى الرياض
// · متوقع …» / «وصلت نطاق الدمام — تفريغ». يظهر في قائمة الاختيار ويُبحث فيه،
// فكتابة اسم مدينة تُظهر سيارات هذه المدينة فورًا.
export const vehicleAvailabilityText = (v: FleetVehicle, lang: Lang): string => {
  const ar = lang === 'ar';
  if (v.trip) {
    if (v.atDestination) return ar ? `وصلت نطاق ${v.trip.toCity} — تفريغ` : `Reached ${v.trip.toCity} — unloading`;
    const eta = v.trip.expectedArrival ? ` · ${ar ? 'متوقع' : 'ETA'} ${fmtDT(v.trip.expectedArrival, lang)}` : '';
    return ar ? `عليها حمولة إلى ${v.trip.toCity || '—'}${eta}` : `Carrying to ${v.trip.toCity || '—'}${eta}`;
  }
  if (v.live?.city) return ar ? `متاحة — في ${v.live.city}` : `Available — in ${v.live.city}`;
  return ar ? 'متاحة' : 'Available';
};

export interface FleetDriver {
  _id: string;
  name: string;
  phone?: string;
  iqama?: string;
  working: boolean;       // حالة السائق: يعمل أم لا
  offReason?: '' | 'sick' | 'leave' | 'other'; // سبب التوقف — مرضية/إجازة/أخرى
  offNote?: string;
  onSponsorship: boolean; // على الكفالة أم لا
  vehicle?: FleetVehicle | string | null;
  notes?: string;
}

export interface FleetCustomer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  routes: { fromCity: string; toCity: string; price: number | null }[];
  notes?: string;
}

export interface FleetShipment {
  _id: string;
  waybillNumber: number; // بوليصة الشحن — its own 100001+ series
  customer?: FleetCustomer | string | null;
  customerName?: string;
  vehicle?: FleetVehicle | string | null;
  vehiclePlate?: string;
  trailerType?: string;
  gpsType?: string;
  driver?: FleetDriver | string | null;
  driverName?: string;
  driverPhone?: string;
  secondDriver?: FleetDriver | string | null;
  secondDriverName?: string;
  supervisor?: string | null;
  supervisorName?: string;
  loadDate?: string | null;
  fromCity?: string;
  toCity?: string;
  status: string;
  lastContactAt?: string | null;
  expectedArrival?: string | null;
  notes?: string;
  createdAt?: string;
}

export interface FleetEvent {
  _id: string;
  type: 'created' | 'updated' | 'status' | 'driver_change' | 'followup';
  data: any;
  byName?: string;
  createdAt: string;
}

// Same keys/colours as the ops mirror and the shipment-orders trial.
export const FLEET_STATUSES = [
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

export const fleetStatus = (k?: string) => FLEET_STATUSES.find((s) => s.key === k) || null;
export const fleetStatusLabel = (k: string | undefined, lang: Lang) => {
  const s = fleetStatus(k);
  return s ? (lang === 'ar' ? s.ar : s.en) : (k || '—');
};

export const TRAILER_TYPES = ['سطحة', 'ستارة', 'جوانب', 'براد', 'صهريج', 'لوبد'];
export const GPS_TYPES = ['LS', 'EX'];

// Quick notes the follow-up call usually ends with — chips, not typing.
export const FOLLOWUP_NOTES_AR = [
  'في الطريق إلى موقع التنزيل', 'في الطريق إلى موقع التحميل', 'حمّل وتحرّك',
  'نايم — استراحة', 'فاضي', 'واقف — مشكلة على الطريق', 'وصل موقع التنزيل', 'جاري التفريغ',
];

export const fmtDT = (v?: string | null, lang: Lang = 'ar') => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(v); }
};

export const fmtD = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

// "آخر تواصل من ساعتين" — the number the follow-up cadence runs on.
export const hoursSince = (v?: string | null): number | null => {
  if (!v) return null;
  const ms = Date.now() - new Date(v).getTime();
  return Math.floor(ms / 3600000);
};

export const foldAr = (x: string) => x.toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

// Roles mirror backend/src/routes/fleet.js — OR a dynamic grant from the
// permissions matrix (backend rbac honours an 'edit' grant even on admin
// routes, so the UI must too). Pass the USER: only it carries the grants.
import { canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
export const FLEET_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'moderator', 'fleet_manager', 'fleet_supervisor'];
export const FLEET_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

// حالة البطاقة على اللوحة الرئيسية — تُحسب تلقائيًا في الخادم.
export const BOARD_STATES: Record<string, { ar: string; en: string; card: string; chip: string; dot: string }> = {
  late: { ar: 'متأخرة عن الوصول', en: 'Late', card: 'border-red-300 bg-red-50', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  arrived: { ar: 'وصلت موقع التنزيل', en: 'Arrived', card: 'border-emerald-300 bg-emerald-50', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  moving: { ar: 'في الطريق', en: 'On the road', card: 'border-amber-300 bg-amber-50', chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  preparing: { ar: 'تحميل / تجهيز', en: 'Loading', card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  idle: { ar: 'بدون حمولة', en: 'Idle', card: 'border-slate-200 bg-white', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};
export const canEditFleet = (u: RoleOrUser) => FLEET_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Fleet Management');
export const canAdminFleet = (u: RoleOrUser) => FLEET_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Fleet Management');
