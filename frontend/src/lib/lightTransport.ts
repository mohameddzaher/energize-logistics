import { docStateLabel, type PersonDocs } from '@/components/system/PersonDocDate';
/**
 * Light transport: its types, calls and table columns.
 * Columns are defined once here: header, filter funnel and export read the same definition, so what is filtered is what is shown and exported. Two definitions drift apart and export a column nobody sees or filter on a value that is not displayed.
 */
import api from '@/lib/api';
import { FINANCE_FULL_ROLES } from '@/lib/financeAuthority';

export interface LTEmployee extends PersonDocs {
  _id: string;
  idNumber: string;
  name: string;
  nationalityAr?: string;
  phone?: string;
  hireDate?: string | null;
  cityAr?: string;
  projectAr?: string;
  jobTitleAr?: string;
  staffKind?: 'rep' | 'driver' | 'admin' | 'unknown';
  contractTypeAr?: string;
  registerNumber?: string;
  vehicleTypeAr?: string;
  vehiclePlate?: string;
  /** Service ended but the vehicle is still with him; his order stays pending until the vehicle is received or handed to someone else. */
  vehicleHold?: { at?: string | null; reason?: string };
  /** Operating card and periodic inspection, from the vehicle register, with their status computed by the vehicles department thresholds. See `docOf` on the server. */
  operatingCard?: LTDoc;
  inspection?: LTDoc;
  supervisorName?: string;
  /** The supervisor's system account is the source and the name is a snapshot of it. See backend/utils/b2cSupervisors: whoever is assigned a rider here sees him in the start-of-duty check. */
  supervisorUser?: { _id: string; firstName?: string; lastName?: string; role?: string } | string | null;
  /** Two supervisors. `supervisorUser` is the operational supervisor, who owns the rider in the field all day. `dutySupervisorUser` is the check supervisor, whom he reports to in the morning and photographs before going out; it splits the start-of-duty check screen. They need not be the same person. */
  dutySupervisorUser?: { _id: string; firstName?: string; lastName?: string; role?: string } | string | null;
  dutySupervisorName?: string;
  workStatusAr?: string;
  /** Status as read: the department status, overridden by HR when HR negates it. */
  workStatusShown?: string;
  /** Contract kind as the server counts it (`contractKindOf`): sponsored, freelance, users, or empty. */
  contractTypeShown?: string;
  /** Vehicle type from its register entry when linked; one vocabulary for both. */
  vehicleTypeShown?: string;
  /** Who set the status: HR (not editable here), the department (`opStatus`), or nobody (working). */
  statusSource?: 'hr' | 'section' | '';
  /** Today's status written by the department: empty (working), leave, suspended or accident. */
  opStatus?: '' | 'leave' | 'suspended' | 'accident';
  opStatusNote?: string;
  opStatusAt?: string | null;
  /** With the meanings of the department board (backend utils/b2cBoard). */
  categoryShown?: 'rep' | 'admin' | 'tech' | 'none';
  engagementShown?: 'sponsored' | 'freelance' | 'trainee' | 'users' | 'none';
  registerShown?: string;
  authState?: '' | 'authorized' | 'expired' | 'none';
  hrLinked?: boolean;
  employeeNumber?: string;
  notesAr?: string;
  isActive?: boolean;
  housingRoom?: string;
  vehicle?: {
    _id: string; plateNumber?: string; serialNumber?: string; registrationTypeAr?: string;
    brandAr?: string; modelAr?: string;
    /** Authorization paper on the vehicle: who may drive it and until when. */
    authorizedPerson?: {
      name?: string; iqamaNumber?: string; phone?: string;
      authorizationNumber?: string; startDate?: string | null; expiryDate?: string | null;
    } | null;
    /** The actual driver, not always the authorized person. */
    actualDriver?: { name?: string; idNumber?: string } | null;
  } | null;
  housing?: { _id: string; name?: string; cityAr?: string } | null;
  employee?: { _id: string; employeeNumber?: string; arabicName?: string; employmentStatus?: string } | null;
  supervisor?: { _id: string; arabicName?: string; employeeNumber?: string } | null;
  history?: LTHistory[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LTHistory {
  _id?: string; at?: string; byName?: string; kind?: string;
  fromValue?: string; toValue?: string; note?: string;
}

/** Contract kind folded, so spelling variants of sponsored and of freelance are equal. Used by counting and filtering together so the card matches the table. */
export const foldContract = (v?: string) => String(v || '')
  .replace(/[ً-ْ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, '');
export const isFreelance = (r: { contractTypeAr?: string }) => foldContract(r.contractTypeAr).includes('فريلانسر');
export const hasContract = (r: { contractTypeAr?: string }) => !!foldContract(r.contractTypeAr);

/** Filter keys computed on screen and not sent to the server: the two derived ones (contract kind, document status) and all card keys. Cards are counted by facets, each group without its own filter (`ltFacetedTotals`), which needs the rows before the card filter. */
export const LOCAL_KEYS = ['contractKind', 'doc', 'staffKind', 'status', 'hasVehicle', 'housing', 'dutySupervisor'] as const;
export const serverFilters = (f: Record<string, string>) => {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v && !LOCAL_KEYS.includes(k as any)) o[k] = v;
  return o;
};

/** Status of a document on the employee's vehicle; same vocabulary as the vehicles department. */
export interface LTDoc {
  expiryDate?: string | null;
  number?: string;
  statusAr?: string;
  state: 'valid' | 'upcoming' | 'warning' | 'critical' | 'expired' | 'missing' | 'not_applicable';
  days: number | null;
}

/** Document status colors, shared by every screen that reads them. */
export const DOC_CLS: Record<string, string> = {
  expired: 'bg-red-100 text-red-700',
  critical: 'bg-orange-100 text-orange-700',
  warning: 'bg-amber-100 text-amber-800',
  upcoming: 'bg-sky-100 text-sky-700',
  valid: 'bg-emerald-100 text-emerald-700',
  missing: 'bg-slate-100 text-slate-500',
  not_applicable: 'bg-slate-100 text-slate-400',
};
export const DOC_AR: Record<string, string> = {
  expired: 'منتهية', critical: 'حرج', warning: 'تحذير', upcoming: 'قريبًا',
  valid: 'سارية', missing: 'غير مسجَّلة', not_applicable: 'غير مطلوبة',
};
export const DOC_EN: Record<string, string> = {
  expired: 'Expired', critical: 'Critical', warning: 'Warning', upcoming: 'Soon',
  valid: 'Valid', missing: 'Not recorded', not_applicable: 'N/A',
};

export interface LTTotals {
  total: number;
  /** Contract kind: two fixed cards above the table, computed after filtering. */
  sponsored: number;
  freelance: number;
  /** Riders with no check supervisor; they appear to nobody on the check screen. */
  noDutySupervisor: number;
  cardGap: number; cardSoon: number;
  inspectionGap: number; inspectionSoon: number; reps: number; admins: number; drivers?: number; unknownKind?: number; working: number; notWorking: number;
  onLeave: number; terminated: number; suspended?: number; accident?: number; withVehicle: number; withoutVehicle: number;
  hrLinked: number; ownedHere: number; housed: number; unhoused: number;
  byProject: Record<string, number>; byCity: Record<string, number>; byJob: Record<string, number>;
  byContract: Record<string, number>; byRegister: Record<string, number>;
  byVehicleType: Record<string, number>; bySupervisor: Record<string, number>;
  byStatus: Record<string, number>;
}

/** Supervisor account id in a row: populated from the list, bare after save. `populate` returns an object while a local save leaves a string id, so both are read. */
const idOf = (v: unknown): string => {
  if (!v) return '';
  return typeof v === 'string' ? v : String((v as any)._id || '');
};
export const supervisorIdOf = (e?: { supervisorUser?: unknown } | null): string => idOf(e?.supervisorUser);
/** Check supervisor account id: populated from the list, bare after save. */
export const dutySupervisorIdOf = (e?: { dutySupervisorUser?: unknown } | null): string => idOf(e?.dutySupervisorUser);

/** A supervisor available for assignment: a system account with a supervision role in the department. */
export interface LTSupervisor {
  _id: string;
  /** Displayed name: the Arabic name from his file, else his account name. */
  name: string;
  nameEn: string;
  nameAr: string;
  role: string;
  roleAr: string;
  email?: string;
  employeeNumber?: string;
}

export interface LTOptions {
  project: string[]; city: string[]; jobTitle: string[]; contractType: string[];
  register: string[]; vehicleType: string[];
  /** Supervision accounts, not typed names. */
  supervisor: LTSupervisor[];
  /** Supervisor names written in the register that have no account yet; kept for filtering. */
  supervisorsUnlinked?: string[];
  housing: { _id: string; name: string }[];
}

export interface LTRoom { _id?: string; name: string; kind: 'rep' | 'admin' | 'any'; capacity: number; notes?: string; occupied?: number; free?: number }
export interface LTHousing {
  _id: string; name: string; cityAr?: string; addressAr?: string;
  declaredCapacity?: number; rooms: LTRoom[]; isActive?: boolean; notes?: string;
  totalCapacity?: number; occupied?: number; free?: number;
}

export interface LTOrder {
  _id: string; orderNumber: string;
  ltEmployee: string; employeeName: string; employeeIdNumber: string;
  vehicle?: { _id: string; plateNumber?: string; registrationTypeAr?: string } | string | null;
  vehiclePlate?: string; vehicleTypeAr?: string;
  projectAr?: string; cityAr?: string; supervisorName?: string;
  housing?: { _id: string; name?: string } | string | null; housingRoom?: string;
  startDate?: string; endDate?: string | null; status: 'active' | 'hold' | 'ended'; endReasonAr?: string;
  authorizationMoved?: boolean; authorizationNumber?: string;
  authorizationStart?: string | null; authorizationEnd?: string | null;
  notesAr?: string; createdByName?: string; createdAt?: string;
}


/** The card reads what the table shows. Counts used to come from the server computed on its own filters only, while the column filter (Excel-like) is applied in the browser afterwards, so filtering a column shrank the table but left the card unchanged: two numbers for one thing on one screen. */
/** The section is riders plus those who serve them. Most records are riders; the rest are admins, technicians and supervisors. Every card asks about riders only: who has a vehicle, whose operating card expired, who has housing, and so on. */
export function ltTotalsOf(rows: LTEmployee[]): LTTotals {
  // The rider is the default: `staffKind` is derived from the job on the server, and an old row with no kind counts as a rider as the server counts it.
  const reps = rows.filter((r) => (r.staffKind || 'rep') === 'rep');
  const count = (fn: (r: LTEmployee) => boolean) => reps.filter(fn).length;
  const group = (fn: (r: LTEmployee) => string | undefined) => {
    const o: Record<string, number> = {};
    for (const r of reps) { const k = fn(r) || '—'; o[k] = (o[k] || 0) + 1; }
    return o;
  };
  // 'On duty' means status is working, the same filter the card opens (and the server definition in `totalsOf`). It used to be 'not ended and not suspended', which included leave, so the card showed more than the rows it opened.
  const working = (r: LTEmployee) => r.workStatusShown === 'يعمل';
  const gap = (d?: LTDoc) => !!d && ['expired', 'critical'].includes(d.state);
  const soon = (d?: LTDoc) => !!d && ['warning', 'upcoming'].includes(d.state);
  return {
    total: rows.length,
    // Contract kind as the server counts and filters it (`contractKindOf`): the HR file for those who have one, and a user is not sponsorship. The department cell used to be folded here, so the sponsorship card counted users and opened fewer rows.
    sponsored: count((r) => r.contractTypeShown === 'كفالة'),
    freelance: count((r) => r.contractTypeShown === 'فري لانسر'),
    noDutySupervisor: count((r) => !dutySupervisorIdOf(r)),
    cardGap: count((r) => gap(r.operatingCard)),
    cardSoon: count((r) => soon(r.operatingCard)),
    inspectionGap: count((r) => gap(r.inspection)),
    inspectionSoon: count((r) => soon(r.inspection)),
    // These two apply to everyone; they split the overall total.
    reps: reps.length,
    // Admins are not counted by subtraction (rows minus riders, i.e. everyone who is not a rider), which also counted people with no job and drivers as admins. Each kind is counted by its own name.
    admins: rows.filter((r) => r.staffKind === 'admin').length,
    drivers: rows.filter((r) => r.staffKind === 'driver').length,
    unknownKind: rows.filter((r) => r.staffKind === 'unknown' || !String((r as any).jobTitleAr || '').trim()).length,
    working: count(working),
    notWorking: count((r) => !working(r)),
    onLeave: count((r) => ['إجازة', 'اجازه'].includes(String(r.workStatusShown || ''))),
    terminated: count((r) => r.workStatusShown === 'إنهاء خدمة'),
    suspended: count((r) => r.workStatusShown === 'موقوف'),
    accident: count((r) => r.workStatusShown === 'حادث'),
    withVehicle: count((r) => !!r.vehicle),
    withoutVehicle: count((r) => !r.vehicle),
    hrLinked: count((r) => !!r.hrLinked),
    ownedHere: count((r) => !r.hrLinked),
    housed: count((r) => !!r.housing),
    unhoused: count((r) => !r.housing),
    byProject: group((r) => r.projectAr),
    byCity: group((r) => r.cityAr),
    byJob: group((r) => r.jobTitleAr),
    byContract: group((r) => r.contractTypeAr),
    byRegister: group((r) => r.registerNumber),
    byVehicleType: group((r) => r.vehicleTypeShown || r.vehicleTypeAr),
    bySupervisor: group((r) => r.supervisorName),
    byStatus: group((r) => r.workStatusShown),
  };
}

const ENDED = 'إنهاء خدمة';
/** Old spellings of the same status, kept for saved links (backend utils/b2cBoard.normStatus). */
export const normStatus = (v: string) => {
  const x = String(v || '').trim();
  if (x === 'متوقف') return 'موقوف';
  if (x === 'اجازه' || x === 'في إجازة') return 'إجازة';
  return x;
};
/** Whether this is an account id: a supervisor is filtered by account, or by written name when there is no account. */
const looksLikeId = (v: string) => /^[0-9a-f]{24}$/i.test(v);

/**
 * Whether the row passes the card filters, all of them or all except `skip`.
 * Same meaning as the server applies in `listEmployees` (displayed status, contract kind as it counts it, supervisor by account or name), so the card's number is what it opens. 'No job' opens those its card counts (no kind or no written job).
 */
export function ltPasses(r: LTEmployee, f: Record<string, string>, skip?: string): boolean {
  const on = (k: string) => k !== skip && !!f[k];
  if (on('staffKind')) {
    const kind = r.staffKind || 'rep';
    if (f.staffKind === 'unknown' ? !(kind === 'unknown' || !String((r as any).jobTitleAr || '').trim()) : kind !== f.staffKind) return false;
  }
  // Comma-separated values (board filters); the old 'stopped' equals 'suspended'.
  if (on('status') && !f.status.split(',').map(normStatus).includes(String(r.workStatusShown || ''))) return false;
  if (on('hasVehicle') && (f.hasVehicle === 'yes' ? !r.vehicle : f.hasVehicle === 'no' ? !!r.vehicle : false)) return false;
  if (on('housing')) {
    const h = r.housing ? String((r.housing as any)._id || r.housing) : '';
    if (f.housing === 'none' ? !!h : h !== f.housing) return false;
  }
  if (on('contractKind')) {
    const want = ({ sponsored: 'كفالة', freelance: 'فري لانسر', users: 'يوزرات', none: '' } as Record<string, string>)[f.contractKind];
    if (want !== undefined && (r.contractTypeShown || '') !== want) return false;
  }
  if (on('doc')) {
    const [which, band] = f.doc.split('-');
    const st = (which === 'card' ? r.operatingCard : r.inspection)?.state || 'missing';
    if (band === 'gap' && !['expired', 'critical'].includes(st)) return false;
    if (band === 'soon' && !['warning', 'upcoming'].includes(st)) return false;
  }
  if (on('dutySupervisor')) {
    const v = f.dutySupervisor;
    const id = dutySupervisorIdOf(r);
    if (v === 'none' ? !!id : looksLikeId(v) ? id !== v : (r.dutySupervisorName || '') !== v) return false;
  }
  return true;
}

/** Numbers do not move under whoever clicks them. Cards used to be counted over rows after every filter, including the clicked card's own, so clicking riders zeroed admins and drivers. Each group is counted with all filters except its own (the same rule as column filters), while the table applies all. */
export function ltFacetedTotals(rows: LTEmployee[], f: Record<string, string>): LTTotals {
  const base = String(f.status || '').split(',').includes(ENDED) ? rows : rows.filter((r) => r.workStatusShown !== ENDED);
  const pass = (skip?: string) => base.filter((r) => ltPasses(r, f, skip));
  const t = ltTotalsOf(pass()) as any;
  const over = (k: string, keys: string[]) => {
    if (!f[k]) return;
    const o = ltTotalsOf(pass(k)) as any;
    for (const key of keys) t[key] = o[key];
  };
  over('staffKind', ['reps', 'admins', 'drivers', 'unknownKind']);
  over('status', ['working', 'notWorking', 'onLeave', 'suspended', 'accident', 'terminated', 'byStatus']);
  over('hasVehicle', ['withVehicle', 'withoutVehicle']);
  over('housing', ['housed', 'unhoused']);
  over('contractKind', ['sponsored', 'freelance']);
  over('doc', ['cardGap', 'cardSoon', 'inspectionGap', 'inspectionSoon']);
  over('dutySupervisor', ['noDutySupervisor']);
  return t as LTTotals;
}

const qs = (o: Record<string, string>) =>
  Object.entries(o).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** The route is written explicitly, not composed. It used to be built from a constant and a segment, but the page endpoint map is generated by reading string literals in the page file and its imports, so it cannot see composed strings. A single general section route for the pages was written and then dropped on regeneration, so the pages lost access. */

export const getLTEmployees = (q: Record<string, string> = {}) =>
  api.get<{ employees: LTEmployee[]; totals: LTTotals; options: LTOptions }>(`/api/light-transport/employees${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTEmployee = (id: string) =>
  api.get<{ employee: LTEmployee; orders: LTOrder[] }>(`/api/light-transport/employees/${id}`);
// Attachments ride in the body, so a slow phone connection needs more than the default wait.
export const createLTEmployee = (body: any) => api.post<{ employee: LTEmployee }>(`/api/light-transport/employees`, body, { timeoutMs: 180000 });
export const updateLTEmployee = (id: string, body: any) => api.put<{ employee: LTEmployee }>(`/api/light-transport/employees/${id}`, body);
/** Assign a supervisor to several employees at once: operational, check, or both. Fields not sent are untouched, and 'none' clears explicitly. */
export const assignLTSupervisors = (body: {
  ids: string[]; supervisorUser?: string; dutySupervisorUser?: string; note?: string;
}) => api.post<{ updated: number }>('/api/light-transport/employees/assign-supervisors', body);
export const deactivateLTEmployee = (id: string, reason: string) => api.post(`/api/light-transport/employees/${id}/deactivate`, { reason });

export const getLTHousing = () => api.get<{ housing: LTHousing[] }>(`/api/light-transport/housing`);
export const saveLTHousing = (id: string | null, body: any) =>
  (id ? api.put<{ housing: LTHousing }>(`/api/light-transport/housing/${id}`, body) : api.post<{ housing: LTHousing }>(`/api/light-transport/housing`, body));
export const deleteLTHousing = (id: string) => api.delete(`/api/light-transport/housing/${id}`);

export const getLTOrders = (q: Record<string, string> = {}) =>
  api.get<{ orders: LTOrder[]; totals: { total: number; active: number; ended: number; authorizationMoved: number } }>(`/api/light-transport/orders${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTOrderOptions = () => api.get<{
  employees: { _id: string; name: string; idNumber: string; jobTitleAr?: string; staffKind?: string; projectAr?: string; cityAr?: string; vehicle?: string; vehiclePlate?: string; supervisorName?: string; supervisorUser?: string }[];
  vehicles: { _id: string; plateNumber: string; serialNumber?: string; typeAr?: string; brand?: string; authorizedName?: string; authorizedId?: string; driverId?: string; driverName?: string }[];
  housing: { _id: string; name: string; rooms: { name: string; kind: string; capacity: number }[] }[];
  supervisors: LTSupervisor[];
}>(`/api/light-transport/orders/options`);
export const createLTOrder = (body: any) => api.post<{ order: LTOrder }>(`/api/light-transport/orders`, body);
/** Transfer a vehicle's authorization alone, with no new operating order. Used when the vehicle is authorized to one person but actually driven by another, or when authorization moves from one rider to another. An empty `toEmployee` removes it. */
export const moveLTAuthorization = (body: {
  vehicle: string; toEmployee?: string; authorizationNumber?: string;
  startDate?: string; expiryDate?: string; reason?: string;
}) => api.post<{ vehicle: { _id: string; plateNumber: string; authorizedPerson: any } }>(`/api/light-transport/authorization/move`, body);
export const endLTOrder = (id: string, body: any) => api.post<{ order: LTOrder }>(`/api/light-transport/orders/${id}/end`, body);

// Display.
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Status chips with color; 'service ended' and 'suspended' are not neutral. */
export const LT_STATUS: Record<string, { cls: string }> = {
  'يعمل': { cls: 'bg-emerald-100 text-emerald-700' },
  'إجازة': { cls: 'bg-sky-100 text-sky-700' },
  'موقوف': { cls: 'bg-amber-100 text-amber-700' },
  'متوقف': { cls: 'bg-amber-100 text-amber-700' },
  'حادث': { cls: 'bg-rose-100 text-rose-700' },
  'إنهاء خدمة': { cls: 'bg-red-100 text-red-700' },
};
export const statusCls = (s?: string) => LT_STATUS[String(s || '')]?.cls || 'bg-slate-100 text-slate-600';

/** Today's status written by the department: working, leave, suspended, accident. HR leave, HR suspension and service end override them and are not editable here (`statusSource === 'hr'`). */
export const OP_STATUS_OPTIONS: { value: '' | 'leave' | 'suspended' | 'accident'; ar: string; en: string }[] = [
  { value: '', ar: 'يعمل', en: 'Working' },
  { value: 'leave', ar: 'إجازة', en: 'On leave' },
  { value: 'suspended', ar: 'موقوف', en: 'Suspended' },
  { value: 'accident', ar: 'حادث', en: 'Accident' },
];
export const KIND_AR: Record<string, string> = { rep: 'مندوب', admin: 'إداري' };
export const KIND_EN: Record<string, string> = { rep: 'Rep', admin: 'Admin' };

/** Readable reasons for a register entry, so an Arabic screen has no English keys. */
export const HISTORY_KIND: Record<string, { ar: string; en: string }> = {
  created: { ar: 'أُنشئ السجلّ', en: 'Record created' },
  project: { ar: 'نقلٌ بين المشاريع', en: 'Project moved' },
  city: { ar: 'نقلٌ بين الفروع', en: 'Branch moved' },
  supervisor: { ar: 'تغييرُ المشرف', en: 'Supervisor changed' },
  vehicle: { ar: 'تغييرُ المركبة', en: 'Vehicle changed' },
  housing: { ar: 'تغييرُ السكن', en: 'Housing changed' },
  status: { ar: 'تغييرُ الحالة', en: 'Status changed' },
  order: { ar: 'أمرُ تشغيل', en: 'Operating order' },
  authorization: { ar: 'نقلُ تفويض', en: 'Authorisation moved' },
};

/** Table columns: one definition for header, filter funnel and export. Each column states its name and how it is read. The plate and actions are pinned first (see components/vehicles/stickyLead): the table is twenty columns wide, and scrolling right would lose the row being read. */
export type LTCol = { key: string; ar: string; en: string; get: (e: LTEmployee) => any; width?: number; mono?: boolean };

export const LT_COLUMNS: LTCol[] = [
  { key: 'plate', ar: 'رقم اللوحة', en: 'Plate', get: (e) => (e.vehiclePlate ? `${e.vehiclePlate}${e.vehicleHold?.at ? ' — معلّقة' : ''}` : ''), width: 14, mono: true },
  // Whoever is on the vehicle here is its actual driver in the vehicle register; it is written there automatically.
  { key: 'name', ar: 'الاسم (القائد الفعلي)', en: 'Name (actual driver)', get: (e) => e.name, width: 30 },
  { key: 'idNumber', ar: 'رقم الهوية', en: 'ID number', get: (e) => e.idNumber, width: 14, mono: true },
  // Residency and driving-license expiry from his HR file. The value is his status, which filters the column, and the cell draws the date colored by it.
  { key: 'iqamaExp', ar: 'انتهاء الإقامة', en: 'Iqama expiry', get: (e) => docStateLabel(e.iqamaState, true), width: 16 },
  { key: 'licenseExp', ar: 'انتهاء رخصة القيادة', en: 'Licence expiry', get: (e) => docStateLabel(e.licenseState, true), width: 16 },
  { key: 'jobTitleAr', ar: 'الوظيفة', en: 'Job', get: (e) => e.jobTitleAr || '', width: 12 },
  { key: 'staffKind', ar: 'النوع', en: 'Kind', get: (e) => KIND_AR[e.staffKind || ''] || '', width: 10 },
  { key: 'projectAr', ar: 'المشروع', en: 'Project', get: (e) => e.projectAr || '', width: 14 },
  { key: 'cityAr', ar: 'الفرع', en: 'Branch', get: (e) => e.cityAr || '', width: 12 },
  { key: 'supervisorName', ar: 'المشرف التشغيلي', en: 'Ops supervisor', get: (e) => e.supervisorName || '', width: 18 },
  // Check supervisor: whom he reports to in the morning, not necessarily the operational one.
  { key: 'dutySupervisorName', ar: 'مشرف التفقد', en: 'Duty supervisor', get: (e) => e.dutySupervisorName || '', width: 18 },
  { key: 'vehicleTypeAr', ar: 'نوع المركبة', en: 'Vehicle type', get: (e) => e.vehicleTypeAr || '', width: 14 },
  { key: 'contractTypeAr', ar: 'نوع التعاقد', en: 'Contract', get: (e) => e.contractTypeAr || '', width: 12 },
  { key: 'registerNumber', ar: 'رقم السجل', en: 'Register', get: (e) => e.registerNumber || '', width: 16, mono: true },
  { key: 'workStatus', ar: 'حالة العمل', en: 'Status', get: (e) => e.workStatusShown || '', width: 12 },
  { key: 'nationalityAr', ar: 'الجنسية', en: 'Nationality', get: (e) => e.nationalityAr || '', width: 12 },
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date', get: (e) => fmtDate(e.hireDate), width: 13, mono: true },
  { key: 'phone', ar: 'الجوال', en: 'Phone', get: (e) => e.phone || '', width: 13, mono: true },
  { key: 'housing', ar: 'السكن', en: 'Housing', get: (e) => e.housing?.name || '', width: 14 },
  { key: 'housingRoom', ar: 'الغرفة', en: 'Room', get: (e) => e.housingRoom || '', width: 12 },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (e) => e.vehicle?.serialNumber || '', width: 15, mono: true },
  // Authorization paper and actual driver, from the department sheet, on his vehicle.
  { key: 'authorizedName', ar: 'المفوَّض', en: 'Authorised person', get: (e) => e.vehicle?.authorizedPerson?.name || '', width: 24 },
  { key: 'authorizedId', ar: 'هوية المفوَّض', en: 'Authorised ID', get: (e) => e.vehicle?.authorizedPerson?.iqamaNumber || '', width: 14, mono: true },
  { key: 'authorizedPhone', ar: 'جوال المفوَّض', en: 'Authorised phone', get: (e) => e.vehicle?.authorizedPerson?.phone || '', width: 14, mono: true },
  { key: 'authorizationNumber', ar: 'رقم التفويض', en: 'Authorisation no.', get: (e) => e.vehicle?.authorizedPerson?.authorizationNumber || '', width: 20, mono: true },
  { key: 'authorizationStart', ar: 'بداية التفويض', en: 'Auth. start', get: (e) => fmtDate(e.vehicle?.authorizedPerson?.startDate), width: 14, mono: true },
  { key: 'authorizationEnd', ar: 'نهاية التفويض', en: 'Auth. end', get: (e) => fmtDate(e.vehicle?.authorizedPerson?.expiryDate), width: 14, mono: true },
  { key: 'actualDriverName', ar: 'القائد الفعلي', en: 'Actual driver', get: (e) => e.vehicle?.actualDriver?.name || '', width: 24 },
  { key: 'actualDriverId', ar: 'هوية القائد الفعلي', en: 'Actual driver ID', get: (e) => e.vehicle?.actualDriver?.idNumber || '', width: 14, mono: true },
  // The two vehicle documents in table and export. 'Whose operating card expires this month' is read from the rider's row, not the vehicle register, because the person is the one who gets stopped in the morning.
  { key: 'operatingCardNumber', ar: 'رقم كارت التشغيل', en: 'Operating card no.', get: (e) => e.operatingCard?.number || '', width: 16, mono: true },
  { key: 'operatingCardExpiry', ar: 'انتهاء كارت التشغيل', en: 'Operating card expiry', get: (e) => fmtDate(e.operatingCard?.expiryDate), width: 16, mono: true },
  { key: 'inspectionExpiry', ar: 'انتهاء الفحص', en: 'Inspection expiry', get: (e) => fmtDate(e.inspection?.expiryDate), width: 15, mono: true },
  { key: 'hrLinked', ar: 'ملفّ الموارد البشرية', en: 'HR file', get: (e) => (e.hrLinked ? (e.employeeNumber || 'مربوط') : 'لا ملفّ'), width: 16 },
  { key: 'notesAr', ar: 'ملاحظات', en: 'Notes', get: (e) => e.notesAr || '', width: 28 },
];

/** What is pinned at the start of the table; the plate is the first thing asked about in this section. */
export const LT_PINNED = ['plate'];

export const canEditLT = (u?: { role?: string | null; permissions?: Record<string, string> | null } | null) =>
  ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'it_specialist'].includes(String(u?.role || ''))
  || u?.permissions?.B2C === 'edit';

/** Project transfer is the only way to change a rider's project: deputy head of the individuals sector, the department manager, super admin and admin, plus finance as a system manager. The server also decides it (utils/b2cEntry.canTransfer). */
export const canTransferLT = (u?: { role?: string | null } | null) =>
  ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager', 'b2c_deputy', ...FINANCE_FULL_ROLES].includes(String(u?.role || ''));
export const transferLTProject = (id: string, projectAr: string, note: string) =>
  api.post<{ ok: boolean; projectAr: string }>(`/api/light-transport/employees/${id}/transfer-project`, { projectAr, note });

/** A rider's orders split by project month by month, from the orders themselves and not his current project. */
export type LTRepMonth = { month: string; total: number; projects: { project: string; unit: string; total: number; days: number; from: string; to: string }[] };
export const getLTRepOrders = (id: string) => api.get<{ months: LTRepMonth[] }>(`/api/light-transport/employees/${id}/orders`);

/** Department supervisors and project managers, and each one's projects (who sees what in order entry). */
export type B2CManager = { _id: string; name: string; role: string; projects: string[] };
export const getB2CManagers = () =>
  api.get<{ managers: B2CManager[]; projects: string[]; canEdit: boolean }>('/api/b2c/entry/managers');
export const setB2CManagerProjects = (userId: string, projects: string[]) =>
  api.put<{ ok: boolean }>(`/api/b2c/entry/managers/${userId}`, { projects });

/** Who sees the department screens. The guard is on the section, not a hand-written role list: whoever is granted B2C from the permissions page gets in without a code change, as the server promises (`sectionGate`). A role list silently broke that promise. */
export const canSeeLT = (u?: { role?: string | null; permissions?: Record<string, string> | null } | null) =>
  canEditLT(u) || !!u?.permissions?.B2C
  || ['b2c_rep_supervisor', 'operations_manager', 'operations_team_leader', 'moderator'].includes(String(u?.role || ''));
