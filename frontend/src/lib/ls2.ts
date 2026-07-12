// Location Solutions (قسم لوكيشن سوليوشن) — shared config + helpers.
//
// This section is a LIVE mirror of our Location Solutions (Wialon) GPS/telemetry
// account: 57 heavy trucks streaming per-axle tire pressure/temperature, engine
// coolant, fuel, weight, odometer and engine hours. Our backend polls Wialon,
// decodes the sensors, evaluates alerts (hot tire/engine, low fuel, overload,
// speeding, service-due) and mirrors the latest snapshot into Mongo, kept live
// over socket.io — pages read /api/ls2/* and refresh on `ls2:updated`.

export type Lang = 'en' | 'ar';

// Mirror of backend LS2_*_ROLES (config/constants.js).
export const LS2_STAFF_ROLES = [
  'super_admin', 'admin', 'it_manager', 'moderator', 'employee', 'operations_manager', 'operations',
  'workshop_manager', 'workshop_employee', 'purchasing',
];
export const LS2_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'workshop_manager'];
// Roles that see the section pinned in their sidebar.
export const LS2_SECTION_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'operations', 'workshop_manager', 'moderator'];
export const isLs2Staff = (role?: string | null) => !!role && LS2_STAFF_ROLES.includes(role);
export const isLs2Admin = (role?: string | null) => !!role && LS2_ADMIN_ROLES.includes(role);

// ---- Types (light shapes matching the API) --------------------------------
export interface Tire { axle: number; position: number; tempC: number | null; pressurePsi: number | null; fault: boolean }
// One Wialon service interval (Group A/B/C, TR Wheels…), mirrored + computed.
export interface ServiceInterval {
  id: number; name: string; description: string; kind: 'mileage' | 'time' | 'engineHours';
  intervalKm: number; intervalDays: number; intervalEngineHrs: number;
  lastServiceKm: number | null; lastServiceEngineHrs: number | null; lastServiceAt: string | null;
  serviceCount: number;
  nextServiceKm?: number | null; remainingKm?: number | null;
  nextServiceAt?: string | null; remainingDays?: number | null;
  nextServiceValue?: number | null; remaining?: number | null;
  statusLevel: 'ok' | 'due' | 'overdue';
}
export interface Maintenance {
  statusLevel: 'ok' | 'due' | 'overdue';
  kmToService: number | null; nextServiceKm: number | null; nextServiceName: string;
  upcomingKm: number | null; upcomingServiceKm: number | null; upcomingServiceName: string;
  overdueCount: number; dueCount: number; intervals: ServiceInterval[];
}
export interface Vehicle {
  unitId: number; name: string; plate: string; driver: string;
  position: { lat: number; lng: number; speed: number; course: number | null } | null;
  lastMessageAt: string | null; ignition: boolean | null; moving: boolean | null;
  speed: number | null; rpm: number | null; coolantC: number | null; fuelPct: number | null;
  totalFuelUsedL: number | null; weightKg: number | null; mainPowerV: number | null; backupBatteryV: number | null;
  gsmSignal: number | null; odometerKm: number | null; engineHours: number | null;
  tires: Tire[]; tireCount: number; maxTireTempC: number | null; minTireTempC: number | null; maxTirePressurePsi: number | null; minTirePressurePsi: number | null; tireFaults: number;
  tireBrand?: string; // manual: tire brand/type (e.g. Continental)
  status: string; alertLevel: string | null; activeAlertCount: number;
  serviceIntervals: ServiceInterval[];
  maintenanceStatus: 'ok' | 'due' | 'overdue';
  kmToService: number | null; nextServiceKm: number | null; nextServiceName: string;
  upcomingKm: number | null; upcomingServiceKm: number | null; upcomingServiceName: string;
  maintenance: Maintenance | null;
  periodKm?: number; // attached when the list is queried with a from/to range
  profile?: VehicleProfile;
}
// Fleet distance over a period (from /api/ls2/mileage).
export interface MileageRow { unitId: number; plate: string; driver: string; name: string; odometerKm: number | null; km: number; odoStart: number | null; odoEnd: number | null; activeDays: number; clipped: boolean }

// Vehicle identity (mirrored from Wialon profile + custom fields).
export interface VehicleProfile {
  vin: string; brand: string; modelYear: string; vehicleType: string; registrationPlate: string;
  simIccid: string; installDate: string; lsUnitId: string;
  extra: { label: string; value: string }[]; syncedAt: string | null;
}
export interface Trip { beginTime: string | null; beginLocation: string; endTime: string | null; endLocation: string; durationSec: number | null; km: number; maxSpeed: number | null; avgSpeed: number | null }
export interface Stop { location: string; from: string | null; to: string | null; durationSec: number }
export interface TripsResult { unitId: number; from: string; to: string; trips: Trip[]; stops: Stop[]; summary: { tripCount: number; stopCount: number; totalKm: number; totalDriveSec: number; maxSpeed: number } }
export interface VehicleFuel { unitId: number; from: string; to: string; brand: string; model: string; engineOnSec: number | null; distanceKm: number | null; fuelL: number | null; efficiencyKmL: number | null }
export interface TrackPoint { lat: number; lng: number; speed: number; t: number }
export interface Alert {
  _id: string; unitId: number; plate: string; driver: string; type: string; key: string;
  severity: 'critical' | 'warning' | 'info'; status: 'open' | 'resolved'; message: string;
  value: number | null; threshold: number | null; unit: string; lastSeenAt: string; firstSeenAt: string;
  acknowledgedAt?: string | null; context?: any;
}

// ---- Severity + status styling --------------------------------------------
export const SEVERITY_STYLES: Record<string, { bg: string; text: string; dot: string; border: string; en: string; ar: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200', en: 'Critical', ar: 'حرِج' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200', en: 'Warning', ar: 'تحذير' },
  info: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', border: 'border-slate-200', en: 'Info', ar: 'معلومة' },
};
export const severityStyle = (s?: string | null) => (s && SEVERITY_STYLES[s]) || SEVERITY_STYLES.info;

export const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; en: string; ar: string }> = {
  moving: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', en: 'Moving', ar: 'يتحرك' },
  idle: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', en: 'Idle', ar: 'خامل' },
  stopped: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', en: 'Stopped', ar: 'متوقف' },
  offline: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', en: 'Offline', ar: 'غير متصل' },
};
export const statusStyle = (s?: string | null) => (s && STATUS_STYLES[s]) || STATUS_STYLES.stopped;

export const MAINT_STYLES: Record<string, { bg: string; text: string; en: string; ar: string }> = {
  ok: { bg: 'bg-emerald-100', text: 'text-emerald-700', en: 'OK', ar: 'سليم' },
  due: { bg: 'bg-amber-100', text: 'text-amber-700', en: 'Service due', ar: 'صيانة قريبة' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', en: 'Overdue', ar: 'متأخرة' },
};
export const maintStyle = (s?: string | null) => (s && MAINT_STYLES[s]) || MAINT_STYLES.ok;

// ---- Alert type labels -----------------------------------------------------
export const ALERT_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  tire_temp: { en: 'Tire temperature', ar: 'حرارة الكاوتش' },
  tire_pressure_low: { en: 'Low tire pressure', ar: 'ضغط كاوتش منخفض' },
  tire_pressure_critical: { en: 'Flat tire risk', ar: 'خطر كاوتش فاضي' },
  tire_pressure_high: { en: 'High tire pressure', ar: 'ضغط كاوتش مرتفع' },
  tire_imbalance: { en: 'Axle pressure imbalance', ar: 'عدم اتزان ضغط المحور' },
  tire_fault: { en: 'Tire sensor fault', ar: 'عطل حساس كاوتش' },
  coolant_temp: { en: 'Engine temperature', ar: 'حرارة الموتور' },
  rpm_high: { en: 'Engine over-rev', ar: 'لفّات موتور عالية' },
  fuel_low: { en: 'Low fuel', ar: 'وقود منخفض' },
  overload: { en: 'Overload', ar: 'حمولة زائدة' },
  speeding: { en: 'Speeding', ar: 'سرعة زائدة' },
  battery_low: { en: 'Low voltage', ar: 'جهد منخفض' },
  idling: { en: 'Excessive idling', ar: 'تشغيل خامل طويل' },
  maintenance_due: { en: 'Service due', ar: 'صيانة قريبة' },
  maintenance_overdue: { en: 'Service overdue', ar: 'صيانة متأخرة' },
  offline: { en: 'Offline', ar: 'غير متصل' },
};
export const alertTypeLabel = (type: string, lang: Lang) => (ALERT_TYPE_LABELS[type] ? ALERT_TYPE_LABELS[type][lang] : type);

// Build a fully-localized alert description from the structured fields, so the
// text switches with the language (the backend `message` is English-only).
export function alertMessage(a: { type: string; key?: string; value: number | null; unit?: string; message?: string }, lang: Lang): string {
  const ar = lang === 'ar';
  const v = a.value;
  const n = (x: number | null) => (x == null ? '' : Number(x).toLocaleString('en-US'));
  const tm = a.key?.match(/axle(\d+)-tire(\d+)/);
  const loc = tm ? (ar ? `محور ${tm[1]} · إطار ${tm[2]}` : `axle ${tm[1]} · tire ${tm[2]}`) : '';
  const am = a.key?.match(/^axle(\d+)$/);
  switch (a.type) {
    case 'tire_temp': return ar ? `حرارة الكاوتشة (${loc}) ${v}°م` : `Tire (${loc}) at ${v}°C`;
    case 'tire_pressure_low': return ar ? `ضغط منخفض بالكاوتشة (${loc}) ${v} psi` : `Under-inflated tire (${loc}) ${v} psi`;
    case 'tire_pressure_critical': return ar ? `كاوتشة شبه فاضية (${loc}) ${v} psi — خطر انفجار` : `Nearly-flat tire (${loc}) ${v} psi — blow-out risk`;
    case 'tire_pressure_high': return ar ? `ضغط مرتفع بالكاوتشة (${loc}) ${v} psi` : `Over-inflated tire (${loc}) ${v} psi`;
    case 'tire_imbalance': return ar ? `فرق ضغط بالمحور ${am ? am[1] : ''} = ${v} psi` : `Axle ${am ? am[1] : ''} pressure spread ${v} psi`;
    case 'tire_fault': return ar ? `${v} حسّاس كاوتش لا يُرسل بيانات` : `${v} tire sensor(s) not reporting`;
    case 'coolant_temp': return ar ? `حرارة الموتور ${v}°م` : `Engine coolant ${v}°C`;
    case 'rpm_high': return ar ? `لفّات موتور عالية ${n(v)}` : `Engine over-revving ${n(v)} rpm`;
    case 'fuel_low': return ar ? `وقود منخفض ${v}%` : `Low fuel ${v}%`;
    case 'overload': return ar ? `حمولة زائدة ${n(v)} كجم` : `Overloaded ${n(v)} kg`;
    case 'speeding': return ar ? `سرعة زائدة ${v} كم/س` : `Speeding ${v} km/h`;
    case 'battery_low': return ar ? `جهد منخفض ${v} فولت` : `Low voltage ${v} V`;
    case 'maintenance_due': return ar ? `الصيانة بعد ${n(v)} كم` : `Service due in ${n(v)} km`;
    case 'maintenance_overdue': return ar ? `الصيانة متأخرة ${n(v)} كم` : `Service overdue by ${n(v)} km`;
    case 'offline': return ar ? `لا توجد إشارة منذ ${v} دقيقة` : `No signal for ${v} min`;
    default: return a.message || '';
  }
}

// ---- Formatters ------------------------------------------------------------
export const fmtNum = (v?: number | null) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US'));
export const fmtKm = (v?: number | null) => (v == null ? '—' : `${Number(v).toLocaleString('en-US')} km`);
export function timeAgo(iso?: string | null, lang: Lang = 'en'): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return lang === 'ar' ? 'الآن' : 'now';
  if (m < 60) return lang === 'ar' ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === 'ar' ? `منذ ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === 'ar' ? `منذ ${d} يوم` : `${d}d ago`;
}
export function fmtDateTime(iso?: string | null, lang: Lang = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
// Human duration from seconds: "13d 19h", "2h 35m", "45m".
export function fmtDuration(sec?: number | null, lang: Lang = 'en'): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ar = lang === 'ar';
  if (d > 0) return ar ? `${d}ي ${h}س` : `${d}d ${h}h`;
  if (h > 0) return ar ? `${h}س ${m}د` : `${h}h ${m}m`;
  return ar ? `${m}د` : `${m}m`;
}

// Wialon last-service date (short, no time — it's a calendar event).
export function fmtDate(iso?: string | null, lang: Lang = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

// ---- Date-range presets for the period filters ----------------------------
export type DateRange = { from: string; to: string };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function monthRange(offset = 0): DateRange {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: ymd(from), to: ymd(to) };
}
export function lastNDays(n: number): DateRange {
  const to = new Date();
  const from = new Date(); from.setUTCDate(from.getUTCDate() - (n - 1));
  return { from: ymd(from), to: ymd(to) };
}
export function thisMonthToDate(): DateRange {
  const now = new Date();
  return { from: ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: ymd(now) };
}
// Bilingual month/preset labels for the range picker.
export function rangePresets(lang: Lang): { key: string; label: string; range: () => DateRange }[] {
  const ar = lang === 'ar';
  return [
    { key: 'mtd', label: ar ? 'الشهر ده' : 'This month', range: () => thisMonthToDate() },
    { key: 'prev', label: ar ? 'الشهر اللي فات' : 'Last month', range: () => monthRange(-1) },
    { key: 'd7', label: ar ? 'آخر ٧ أيام' : 'Last 7 days', range: () => lastNDays(7) },
    { key: 'd30', label: ar ? 'آخر ٣٠ يوم' : 'Last 30 days', range: () => lastNDays(30) },
    { key: 'prev2', label: ar ? 'شهرين فاتوا' : '2 months ago', range: () => monthRange(-2) },
  ];
}

// OpenStreetMap deep link for a coordinate (no map library needed).
export const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
export const osmEmbed = (lat: number, lng: number, d = 0.02) =>
  `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;

// Tire-cell colouring by temperature (uses the same thresholds the backend seeds).
export function tireTempColor(t: number | null, warn = 75, crit = 85): string {
  if (t == null) return 'bg-slate-100 text-slate-400';
  if (t >= crit) return 'bg-red-100 text-red-700';
  if (t >= warn) return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}
export function coolantColor(t: number | null, warn = 100, crit = 110): string {
  if (t == null) return 'text-slate-400';
  if (t >= crit) return 'text-red-600';
  if (t >= warn) return 'text-amber-600';
  return 'text-slate-700';
}

// Bilingual micro-dictionary for the section's page text.
export function ls2Text(lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  return {
    ar,
    section: t('Location Solutions', 'لوكيشن سوليوشن'),
    dashboard: t('Fleet Telemetry Dashboard', 'لوحة تتبّع الأسطول'),
    liveSubtitle: t('Live GPS & sensor telemetry', 'بيانات GPS والحساسات المباشرة'),
    live: t('Live', 'مباشر'),
    refresh: t('Refresh', 'تحديث'),
    notAuthorized: t('You do not have access to this section', 'لا تملك صلاحية لهذا القسم'),
    noData: t('No data', 'لا توجد بيانات'),
    viewAll: t('View all', 'عرض الكل'),
    search: t('Search plate / driver…', 'بحث باللوحة / السائق…'),
    // entities
    liveFleet: t('Live Fleet', 'الأسطول المباشر'),
    tires: t('Tires', 'الكاوتش'),
    temperature: t('Temperature', 'الحرارة'),
    maintenance: t('Maintenance', 'الصيانة'),
    alerts: t('Alerts', 'التنبيهات'),
    settings: t('Settings', 'الإعدادات'),
    vehicle: t('Vehicle', 'المركبة'),
    // fleet
    totalVehicles: t('Total Vehicles', 'إجمالي المركبات'),
    online: t('Online', 'متصلة'),
    moving: t('Moving', 'تتحرك'),
    stopped: t('Stopped', 'متوقفة'),
    offline: t('Offline', 'غير متصلة'),
    // alerts
    criticalAlerts: t('Critical Alerts', 'تنبيهات حرِجة'),
    warnings: t('Warnings', 'تحذيرات'),
    openAlerts: t('Open Alerts', 'تنبيهات مفتوحة'),
    vehiclesWithAlerts: t('Vehicles with alerts', 'مركبات بها تنبيهات'),
    latestAlerts: t('Latest Alerts', 'أحدث التنبيهات'),
    acknowledge: t('Acknowledge', 'إقرار'),
    acknowledged: t('Acknowledged', 'تم الإقرار'),
    severity: t('Severity', 'الخطورة'),
    type: t('Type', 'النوع'),
    status: t('Status', 'الحالة'),
    allTypes: t('All types', 'كل الأنواع'),
    allSeverities: t('All severities', 'كل الدرجات'),
    open: t('Open', 'مفتوح'),
    resolved: t('Resolved', 'مغلق'),
    all: t('All', 'الكل'),
    // temperature
    hotTires: t('Hot Tires', 'كاوتش ساخن'),
    hotEngines: t('Hot Engines', 'موتور ساخن'),
    avgTireTemp: t('Avg Tire Temp', 'متوسط حرارة الكاوتش'),
    maxTireTemp: t('Max Tire Temp', 'أقصى حرارة كاوتش'),
    tireTempMinMax: t('Tire Temp (max/min)', 'حرارة الكاوتش (أقصى/أقل)'),
    tirePressMinMax: t('Tire Pressure (max/min)', 'ضغط الكاوتش (أقصى/أقل)'),
    tireBrand: t('Tire Brand / Type', 'ماركة / نوع الكاوتش'),
    notSet: t('Not set', 'غير محدد'),
    edit: t('Edit', 'تعديل'),
    avgEngineTemp: t('Avg Engine Temp', 'متوسط حرارة الموتور'),
    hottestTires: t('Hottest Tires', 'أسخن الكاوتش'),
    engineCoolant: t('Engine Coolant', 'حرارة الموتور'),
    // maintenance
    serviceDue: t('Service Due', 'صيانة قريبة'),
    serviceOverdue: t('Service Overdue', 'صيانة متأخرة'),
    dueSoon: t('Due Soon', 'قريبة'),
    kmToService: t('KM to Service', 'كم للصيانة'),
    nextService: t('Next Service', 'الصيانة القادمة'),
    odometer: t('Odometer', 'العداد'),
    engineHours: t('Engine Hours', 'ساعات الموتور'),
    markServiced: t('Mark Serviced', 'تسجيل صيانة'),
    serviceHistory: t('Service History', 'سجل الصيانة'),
    nearestService: t('Nearest to Service', 'الأقرب للصيانة'),
    // service intervals (mirrored from Wialon)
    servicePlan: t('Service Plan', 'خطة الصيانة'),
    serviceName: t('Service', 'الخدمة'),
    lastService: t('Last Service', 'آخر صيانة'),
    remaining: t('Remaining', 'المتبقّي'),
    kmLeft: t('km left', 'كم متبقّي'),
    kmOverdue: t('km overdue', 'كم متأخّرة'),
    overdue: t('Overdue', 'متأخّرة'),
    mostOverdue: t('Most overdue', 'الأكتر تأخيرًا'),
    nextUpcoming: t('Next upcoming', 'الأقرب جايّة'),
    services: t('services', 'خدمات'),
    servicedAt: t('serviced at', 'اتعملت عند'),
    fromWialon: t('Synced live from Location Solutions', 'متزامن مباشرة من لوكيشن سوليوشن'),
    // distance / period filters
    distance: t('Distance', 'المسافة'),
    distanceTraveled: t('Distance Travelled', 'المسافة المقطوعة'),
    kmInPeriod: t('KM in period', 'كم في الفترة'),
    period: t('Period', 'الفترة'),
    from: t('From', 'من'),
    to: t('To', 'إلى'),
    apply: t('Apply', 'تطبيق'),
    totalDistance: t('Total Distance', 'إجمالي المسافة'),
    vehiclesMoved: t('Vehicles Moved', 'مركبات تحرّكت'),
    avgPerVehicle: t('Avg / Vehicle', 'المتوسط / مركبة'),
    topMovers: t('Top Distance', 'الأكثر مسافة'),
    dailyDistance: t('Daily Distance', 'المسافة اليومية'),
    exactFromWialon: t('Exact (Wialon report)', 'الرقم الدقيق (تقرير Wialon)'),
    km: t('km', 'كم'),
    partialData: t('Partial — no data before start', 'جزئي — لا توجد بيانات قبل البداية'),
    // identity
    identity: t('Vehicle Identity', 'هوية المركبة'),
    vin: t('VIN', 'رقم الشاسيه'),
    brand: t('Brand', 'الماركة'),
    modelYear: t('Year', 'سنة الصنع'),
    vehicleType: t('Type', 'النوع'),
    simIccid: t('SIM (ICCID)', 'شريحة الاتصال'),
    installDate: t('Install Date', 'تاريخ التركيب'),
    lsUnitId: t('LS Unit ID', 'رقم الوحدة'),
    // trips / stops / fuel / track
    trips: t('Trips', 'الرحلات'),
    stops: t('Stops', 'الوقفات'),
    trip: t('Trip', 'رحلة'),
    stop: t('Stop', 'وقفة'),
    activity: t('Trips & Stops', 'الرحلات والوقفات'),
    tripCount: t('Trips', 'عدد الرحلات'),
    stopCount: t('Stops', 'عدد الوقفات'),
    driveTime: t('Drive Time', 'زمن القيادة'),
    maxSpeed: t('Max Speed', 'أقصى سرعة'),
    avgSpeedL: t('Avg Speed', 'متوسط السرعة'),
    duration: t('Duration', 'المدة'),
    location: t('Location', 'المكان'),
    fuelUsed: t('Fuel Consumed', 'الوقود المستهلك'),
    efficiency: t('Efficiency', 'الكفاءة'),
    engineOn: t('Engine-on Time', 'زمن تشغيل الموتور'),
    fuelSection: t('Fuel', 'الوقود'),
    track: t('Route Track', 'مسار الخط'),
    showTrack: t('Show route on map', 'اعرض المسار على الخريطة'),
    noFuelData: t('No CAN fuel data for this period', 'لا توجد بيانات وقود لهذه الفترة'),
    startLabel: t('Start', 'البداية'),
    endLabel: t('End', 'النهاية'),
    // vehicle detail
    driver: t('Driver', 'السائق'),
    plate: t('Plate', 'اللوحة'),
    speed: t('Speed', 'السرعة'),
    coolant: t('Coolant', 'حرارة الموتور'),
    fuel: t('Fuel', 'الوقود'),
    weight: t('Weight', 'الوزن'),
    rpm: t('RPM', 'اللفّات'),
    voltage: t('System Voltage', 'جهد النظام'),
    backupBattery: t('Device Battery', 'بطارية الجهاز'),
    gsm: t('GSM Signal', 'إشارة الشبكة'),
    totalFuelUsed: t('Total Fuel Used', 'إجمالي الوقود المستهلك'),
    lastSeen: t('Last signal', 'آخر إشارة'),
    ignitionLabel: t('Ignition', 'التشغيل'),
    on: t('On', 'شغّال'),
    off: t('Off', 'مطفي'),
    openInMap: t('Open in map', 'فتح في الخريطة'),
    tireLayout: t('Tire Layout', 'توزيع الكاوتش'),
    axle: t('Axle', 'محور'),
    noTireData: t('No tire sensor data', 'لا توجد بيانات كاوتش'),
    // settings
    alertThresholds: t('Alert Thresholds', 'حدود التنبيهات'),
    maintenancePlan: t('Maintenance Plan', 'خطة الصيانة'),
    save: t('Save', 'حفظ'),
    saved: t('Saved', 'تم الحفظ'),
    saveFailed: t('Save failed', 'فشل الحفظ'),
    reset: t('Reset to defaults', 'استرجاع الافتراضي'),
    // misc
    faults: t('Sensor Faults', 'أعطال حساسات'),
    value: t('Value', 'القيمة'),
    threshold: t('Threshold', 'الحد'),
    notes: t('Notes', 'ملاحظات'),
    serviceType: t('Service Type', 'نوع الصيانة'),
    confirm: t('Confirm', 'تأكيد'),
    cancel: t('Cancel', 'إلغاء'),
  };
}

// Threshold field metadata for the Settings page.
export const THRESHOLD_FIELDS: { key: string; en: string; ar: string; unit: string }[] = [
  { key: 'tireTempC', en: 'Tire temp warning', ar: 'تحذير حرارة الكاوتش', unit: '°C' },
  { key: 'tireTempCriticalC', en: 'Tire temp critical', ar: 'حرارة كاوتش حرِجة', unit: '°C' },
  { key: 'tirePressureMinPsi', en: 'Min tire pressure', ar: 'أقل ضغط كاوتش', unit: 'psi' },
  { key: 'tirePressureCriticalPsi', en: 'Flat-tire pressure', ar: 'ضغط كاوتش فاضي (حرِج)', unit: 'psi' },
  { key: 'tirePressureMaxPsi', en: 'Max tire pressure', ar: 'أقصى ضغط كاوتش', unit: 'psi' },
  { key: 'tirePressureImbalancePsi', en: 'Axle imbalance', ar: 'فرق ضغط المحور', unit: 'psi' },
  { key: 'coolantTempC', en: 'Engine temp warning', ar: 'تحذير حرارة الموتور', unit: '°C' },
  { key: 'coolantTempCriticalC', en: 'Engine temp critical', ar: 'حرارة موتور حرِجة', unit: '°C' },
  { key: 'rpmMax', en: 'Max engine RPM', ar: 'أقصى لفّات موتور', unit: 'rpm' },
  { key: 'fuelLowPct', en: 'Low fuel', ar: 'وقود منخفض', unit: '%' },
  { key: 'fuelCriticalPct', en: 'Critical fuel', ar: 'وقود حرِج', unit: '%' },
  { key: 'weightMaxKg', en: 'Max weight', ar: 'أقصى وزن', unit: 'kg' },
  { key: 'speedMaxKmh', en: 'Max speed', ar: 'أقصى سرعة', unit: 'km/h' },
  { key: 'speedCriticalKmh', en: 'Dangerous speed', ar: 'سرعة خطرة', unit: 'km/h' },
  { key: 'batteryLowV', en: 'Low voltage', ar: 'جهد منخفض', unit: 'V' },
  { key: 'batteryCriticalV', en: 'Critical voltage', ar: 'جهد حرِج', unit: 'V' },
  { key: 'offlineMinutes', en: 'Offline after', ar: 'يعتبر غير متصل بعد', unit: 'min' },
];
export const MAINTENANCE_FIELDS: { key: string; en: string; ar: string; unit: string }[] = [
  { key: 'serviceIntervalKm', en: 'Service every', ar: 'صيانة كل', unit: 'km' },
  { key: 'alertBeforeKm', en: 'Alert before', ar: 'تنبيه قبلها', unit: 'km' },
];
