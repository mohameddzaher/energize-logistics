import type { PersonDocs } from '@/components/system/PersonDocDate';
// Fleet management: types and vocabulary. Our own trucks: booking, drivers, follow-up calls. Sibling of lib/shipmentOrders.ts (that section books supplier trucks); the status vocabulary is the same on purpose.

export type Lang = 'en' | 'ar';

export interface FleetVehicle {
  _id: string;
  plate: string;
  name?: string;
  trailerType?: string; // Flatbed / curtain-side ...
  gpsType?: string;     // LS / EX
  brand?: string;
  color?: string;
  supervisor?: string | null;   // Responsible supervisor, assigned by the department manager
  supervisorName?: string;
  notes?: string;
  /** Its entry in the vehicle registry; identity and documents are read from there. */
  vehicleMaster?: string | null;
  /** Whether it is linked to the vehicle registry (`registry` is non-empty). */
  linked?: boolean;
  /** Its snapshot from the vehicle registry, sent with the list; the brand and colour above come from it. */
  registry?: FleetRegistryView | null;
  /**
   * Drivers on it, ordered by seat: first, then second.
   * The order comes from the server, not the frontend: three screens read drivers[0] as the first driver, and the shipment form seats it in the primary driver field.
   */
  drivers?: { _id: string; name: string; phone?: string; working?: boolean; seat?: 1 | 2; hrLinked?: boolean; offSource?: string }[];
  // Live enrichment at selection time: where it is now, what it already carries, and whether it reached its destination.
  live?: { city: string | null; status?: string | null; lastMessageAt?: string | null } | null;
  /** Maintenance status from Location Solutions; read with the location because the decision needs both. */
  maintenance?: { status: 'ok' | 'due' | 'overdue'; kmToService: number | null; nextServiceName: string; unitId?: number | null } | null;
  trip?: { waybillNumber: number; status: string; fromCity: string; toCity: string; expectedArrival: string | null } | null;
  atDestination?: boolean;
}

// Vehicle availability line during selection, e.g. "available - in Jeddah" / "loaded to Riyadh, expected ..." / "arrived Dammam zone - unloading". It appears in the picker and is searchable, so typing a city shows that city's vehicles at once.
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

/**
 * The truck's two drivers by rank: [first, second]; either may be null.
 * Read in three screens (trucks, drivers, shipment form); if each computed it, the screens would disagree on who is first once the order changes.
 */
export const seatsOf = (v?: Pick<FleetVehicle, 'drivers'> | null) => {
  const list = v?.drivers || [];
  return [
    list.find((d) => (d.seat || 1) === 1) || null,
    list.find((d) => d.seat === 2) || null,
  ] as const;
};

/** A vehicle document from the vehicle registry, with the status computed there. */
export interface FleetRegistryDoc {
  key: string; ar: string; en: string;
  expiryDate: string | null;
  state: 'valid' | 'upcoming' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable' | string;
  days: number | null;
}
export interface FleetRegistryView {
  _id: string;
  plateNumber: string;
  brand: string; model: string; year: number | null; chassis: string; color: string;
  sector?: string; serviceStatus?: string;
  docs: FleetRegistryDoc[];
}

/** The driver's HR file as sent with the list. */
export interface FleetDriverHr {
  _id: string; name: string; employeeNumber?: string;
  employmentStatus: 'active' | 'on_leave' | 'suspended' | 'terminated' | string;
  department?: string; jobTitle?: string; onLeave?: boolean;
}

export interface FleetDriver extends PersonDocs {
  _id: string;
  name: string;
  phone?: string;
  iqama?: string;
  /** IBAN: entered in the driver's file and read by the driver expenses page. */
  iban?: string;
  nationality?: string;
  working: boolean;       // Driver status: working or not
  offReason?: '' | 'sick' | 'leave' | 'other'; // Reason for stopping: sick / leave / other
  offNote?: string;
  /** 'hr' when HR says he is not working (leave, suspension, termination). */
  offSource?: '' | 'hr';
  /** Its HR entry; name, mobile, iqama, nationality and IBAN come from it. */
  employee?: string | null;
  hrLinked?: boolean;
  hr?: FleetDriverHr | null;
  onSponsorship: boolean; // Whether on sponsorship
  vehicle?: FleetVehicle | string | null;
  /**
   * The other driver on the same truck, computed by the server with the list.
   * A truck carries at most two drivers (a section rule) and the question after which truck is with whom. It comes from the server rather than being matched in each frontend, so web and mobile give the same answer.
   */
  mate?: { _id: string; name: string; phone?: string; working?: boolean; seat?: 1 | 2 } | null;
  /** Number of people on the truck: one or two, or zero for a driver with no truck. */
  seatMates?: number;
  /** His seat on his truck: first or second; null for a driver with no truck. */
  seat?: 1 | 2 | null;
  notes?: string;
}

export interface FleetCustomer {
  customerCode?: string;
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  customerType?: 'heavy' | 'branch' | '';
  rating?: number;
  routes: { fromCity: string; toCity: string; price: number | null }[];
  notes?: string;
  /** Agreed payment type; key from fleet_payment_type (tax/cash). */
  paymentType?: string;
  taxNumber?: string;
  address?: string;
  isActive?: boolean;
  /** Link to its company in the CRM, plus a snapshot of it for display. */
  crmCompany?: string | null;
  crm?: { _id: string; name: string; arabicName?: string; status?: string; rating?: number } | null;
  /** Its figures, computed with the list so the table does not query row by row. */
  trips?: number;
  income?: number;
  openTrips?: number;
  avgTrip?: number;
  lastTrip?: string | null;
  firstTrip?: string | null;
}

export interface FleetShipment {
  _id: string;
  waybillNumber: number; // Shipping waybill: its own 100001+ series
  customer?: FleetCustomer | string | null;
  customerName?: string;
  vehicle?: FleetVehicle | string | null;
  vehiclePlate?: string;
  trailerType?: string;
  gpsType?: string;
  driver?: FleetDriver | string | null;
  driverName?: string;
  driverPhone?: string;
  driverIqama?: string;
  driverNationality?: string;
  vehicleBrand?: string;
  vehicleColor?: string;
  rentType?: string;
  paymentType?: string;
  loadType?: string;
  price?: number;
  fullRent?: number;
  customerType?: 'heavy' | 'branch' | '';
  driverExpense?: number;
  driverAdvance?: string;
  fridayBonus?: boolean;
  branch?: string;
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
  'في الطريق إلى موقع التنزيل', 'في الطريق إلى موقع التحميل', 'حمَّل وتحرّك',
  'متوقف — استراحة', 'فارغ', 'متوقف — عُطل على الطريق', 'وصل موقع التنزيل', 'جارٍ التفريغ',
];

export const fmtDT = (v?: string | null, lang: Lang = 'ar') => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(v); }
};

export const fmtD = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

// "Last contact two hours ago": the number the follow-up cadence runs on.
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
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';
// Mirrors EDIT_ROLES in backend/src/routes/fleet.js, data team included.
export const FLEET_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor',
  'data_manager', 'data_analyst', 'data_entry'];
export const FLEET_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

// Card status on the main board; computed automatically on the server.
export const BOARD_STATES: Record<string, { ar: string; en: string; card: string; chip: string; dot: string }> = {
  late: { ar: 'متأخرة عن الوصول', en: 'Late', card: 'border-red-300 bg-red-50', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  arrived: { ar: 'وصلت موقع التنزيل', en: 'Arrived', card: 'border-emerald-300 bg-emerald-50', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  // Unloaded: its receipt was sent and it is empty; it is prepared for what follows, not rushed.
  unloaded: { ar: 'فرّغت', en: 'Unloaded', card: 'border-cyan-300 bg-cyan-50', chip: 'bg-cyan-100 text-cyan-700', dot: 'bg-cyan-500' },
  moving: { ar: 'في الطريق', en: 'On the road', card: 'border-amber-300 bg-amber-50', chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  preparing: { ar: 'تحميل / تجهيز', en: 'Loading', card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  idle: { ar: 'بدون حمولة', en: 'Idle', card: 'border-slate-200 bg-white', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};
export const canEditFleet = (u: RoleOrUser) => FLEET_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Fleet Management');
export const canAdminFleet = (u: RoleOrUser) => FLEET_ADMIN_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Fleet Management');
// View tier: a role granted VIEW on the section can open the read pages (board,
// lists) even though it can't create or edit anything.
export const canViewFleet = (u: RoleOrUser) => FLEET_EDIT_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Fleet Management');

// The three analysis screens: expected arrivals, vehicle analysis, load analysis.
// The types describe the replies of `/api/fleet/arrivals`, `/vehicles/:id/analytics` and `/loads-analysis`. They live here, not in the pages, because the pages overlap: a load row in load analysis opens its vehicle's analysis, and both show the same load figures.

/** The period as resolved by the server; shown as is, not recomputed in the browser. */
export interface FleetPeriod {
  from: string;
  to: string;
  preset?: string;
  monthsInRange?: number;
}

export interface FleetIdleVehicle {
  _id: string;
  plate: string;
  name?: string;
  trailerType?: string;
  gpsType?: string;
  supervisorName?: string;
  drivers: { _id: string; name: string; phone?: string; working?: boolean }[];
  // The last trip it made before becoming empty: how long empty and where it returned from.
  lastTrip: { waybillNumber: number; toCity?: string; status?: string; customerName?: string; at?: string | null } | null;
}

export interface FleetArrivals {
  period: FleetPeriod;
  arriving: FleetShipment[];
  /** Loads in transit with no registered expected arrival; they appear in no time window. */
  noEta: FleetShipment[];
  idle: FleetIdleVehicle[];
  /** Busy vehicles by name with each one's load, to open the busy card. */
  busyList: (FleetIdleVehicle & {
    trip: { _id: string; waybillNumber: number; customerName?: string; fromCity?: string; toCity?: string; status: string; expectedArrival?: string | null; driverName?: string } | null;
  })[];
  byCity: { city: string; n: number }[];
  summary: { arriving: number; noEta: number; idle: number; vehicles: number; busy: number };
}

export interface FleetVehicleAnalytics {
  vehicle: FleetVehicle & {
    monthlyTarget?: number;
    drivers: { _id: string; name: string; phone?: string; working?: boolean; offReason?: string }[];
    currentTrip: { _id: string; waybillNumber: number; status: string; fromCity?: string; toCity?: string; expectedArrival?: string | null; customerName?: string; loadDate?: string | null } | null;
  };
  period: FleetPeriod;
  totals: {
    trips: number; income: number; fullRent: number; driverExpense: number; branchShare: number;
    net: number; avgTripIncome: number; avgTripExpense: number;
    monthlyTarget: number; periodTarget: number; achievedPct: number | null; achieved: boolean | null;
  };
  byRoute: { fromCity: string; toCity: string; trips: number; income: number; driverExpense: number }[];
  byCustomer: { _id: string | null; name: string; trips: number; income: number; driverExpense: number }[];
  byStatus: Record<string, number>;
  monthlyTrend: { month: string; trips: number; income: number; driverExpense: number }[];
  shipments: FleetShipment[];
  truncated: boolean;
  /** Technical status of the truck from Location Solutions and the heavy-transport store. Both talk about the same truck, and separating them from its operating figures lets a truck with overdue maintenance be dispatched because the decision screen does not mention it. */
  tech?: {
    ls2: {
      plate: string; maintenanceStatus: 'ok' | 'due' | 'overdue';
      kmToService: number | null; nextServiceName: string; nextServiceKm: number | null; unitId?: number | null;
      odometerKm: number | null; lastMessageAt: string | null;
    } | null;
    mountedTires: number;
    openRepairs: { _id: string; category?: string; status: string; description?: string; cost?: number; createdAt: string }[];
    recentServices: { _id: string; createdAt: string; byName?: string; note?: string; odometerKm?: number; items?: { label?: string; status?: string }[] }[];
    partsIssued: { _id: string; itemName: string; quantity: number; reason?: string; issueReason?: string; date?: string; issueRequestNo?: string; createdAt: string; performedByName?: string }[];
    partsCount: number;
  } | null;
}

export interface FleetLoadsAnalysis {
  period: FleetPeriod;
  totals: {
    loads: number; income: number; fullRent: number; driverExpense: number;
    fridayBonuses: number; branchShare: number; net: number; avgIncome: number; avgExpense: number;
  };
  byDay: { day: string; loads: number; income: number; driverExpense: number }[];
  bySupervisor: { _id: string | null; name: string; loads: number; income: number; driverExpense: number }[];
  byCustomer: { _id: string | null; name: string; loads: number; income: number; driverExpense: number }[];
  byVehicle: { _id: string | null; plate: string; loads: number; income: number; driverExpense: number }[];
  byDriver: { _id: string | null; name: string; loads: number; income: number; driverExpense: number }[];
  byStatus: Record<string, number>;
  shipments: FleetShipment[];
  /** Rows are capped and totals are not; the difference is announced instead of being found by manual summing. */
  truncated: boolean;
  shown: number;
}

export const money = (n?: number | null) => (Number(n) || 0).toLocaleString('en-US');

/** Vehicle id from a load, whether returned as a reference or an embedded object. */
export const shipmentVehicleId = (s: FleetShipment): string | null => {
  const v = s.vehicle as any;
  if (!v) return null;
  return typeof v === 'string' ? v : (v._id || null);
};

/** Customer id from a load; same reason. */
export const shipmentCustomerId = (s: FleetShipment): string | null => {
  const c = s.customer as any;
  if (!c) return null;
  return typeof c === 'string' ? c : (c._id || null);
};

/** Vehicle document status as read in fleet; same colours and names as the vehicle registry (config/vehicleDocuments), so two screens never show two states for one document. */
export const REGISTRY_DOC_STATE: Record<string, { ar: string; en: string; cls: string }> = {
  expired: { ar: 'منتهي', en: 'Expired', cls: 'bg-red-500/15 text-red-700' },
  critical: { ar: 'حرج', en: 'Critical', cls: 'bg-orange-500/15 text-orange-700' },
  warning: { ar: 'تحذير', en: 'Warning', cls: 'bg-amber-500/15 text-amber-700' },
  upcoming: { ar: 'قريب', en: 'Upcoming', cls: 'bg-sky-500/15 text-sky-700' },
  valid: { ar: 'ساري', en: 'Valid', cls: 'bg-emerald-500/15 text-emerald-700' },
  missing: { ar: 'بلا تاريخ', en: 'No date', cls: 'bg-slate-500/15 text-slate-600' },
  not_applicable: { ar: 'غير مطلوب', en: 'N/A', cls: 'bg-slate-500/10 text-slate-500' },
};
/** Worst document of the vehicle, for the compact table cell. */
export const worstRegistryDoc = (docs?: FleetRegistryDoc[] | null): FleetRegistryDoc | null => {
  const rank: Record<string, number> = { expired: 5, critical: 4, warning: 3, upcoming: 2, missing: 1, valid: 0, not_applicable: -1 };
  let worst: FleetRegistryDoc | null = null;
  for (const d of docs || []) if (!worst || (rank[d.state] ?? 0) > (rank[worst.state] ?? 0)) worst = d;
  return worst;
};
