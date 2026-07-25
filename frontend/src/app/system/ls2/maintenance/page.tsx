'use client';
// Maintenance — a live mirror of each truck's REAL service plan from Location
// Solutions (Wialon). Every vehicle carries its own service intervals (Group A/B/C,
// TR Wheels…); each shows when it was last serviced (date + odometer) and how far
// it is from the next one — next = last-service odometer + interval, exactly as
// Wialon computes it. Read-only: services are registered inside Location Solutions
// and reflected here automatically. Expand a row to see every service and register
// one right here; the row also links out to the vehicle's full profile.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Wrench, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Clock, ExternalLink, FileSpreadsheet, X, Search } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, isLs2Admin, maintStyle, fmtNum, fmtKm, fmtDate, checklistLabel, type Lang, type Vehicle, type ServiceInterval } from '@/lib/ls2';
import RegisterServiceModal from '@/components/ls2/RegisterServiceModal';
import DeferralActionModal, { type DeferralLike } from '@/components/ls2/DeferralActionModal';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { exportMultiSheet } from '@/utils/exportExcel';

const FILTERS = ['all', 'due', 'overdue'];

// Remaining amount + unit for one service (mileage / days / engine-hours).
function remainOf(iv: ServiceInterval): { value: number; unit: string; next: string } {
  if (iv.remainingKm != null) return { value: iv.remainingKm, unit: 'km', next: iv.nextServiceKm != null ? `${Number(iv.nextServiceKm).toLocaleString('en-US')} km` : '—' };
  if (iv.remainingDays != null) return { value: iv.remainingDays, unit: 'd', next: iv.nextServiceAt ? new Date(iv.nextServiceAt).toLocaleDateString('en-GB') : '—' };
  return { value: iv.remaining ?? 0, unit: 'h', next: iv.nextServiceValue != null ? `${iv.nextServiceValue} h` : '—' };
}

// One row per (vehicle × service interval) for the workshop Excel reports —
// the level the workshop actually works at: "8200 needs its 40K, it is 1,200 km
// late, last done on … at … km".
function intervalRows(items: Vehicle[], pick: (iv: ServiceInterval) => boolean) {
  const rows: Record<string, any>[] = [];
  for (const v of items) {
    for (const iv of v.serviceIntervals || []) {
      if (!pick(iv)) continue;
      const remaining = iv.remainingKm ?? iv.remainingDays ?? iv.remaining ?? null;
      const unit = iv.remainingKm != null ? 'km' : iv.remainingDays != null ? 'days' : 'h';
      rows.push({
        plate: v.plate || v.name,
        driver: v.driver || '',
        odometerKm: v.odometerKm ?? '',
        odometerAt: v.lastMessageAt || '', // WHEN that odometer was read (live telemetry)
        service: iv.name,
        intervalKm: iv.intervalKm || '',
        lastServiceAt: iv.lastServiceAt,
        lastServiceKm: iv.lastServiceKm ?? '',
        nextDue: iv.nextServiceKm != null ? iv.nextServiceKm : iv.nextServiceAt ? new Date(iv.nextServiceAt).toLocaleDateString('en-GB') : iv.nextServiceValue ?? '',
        remaining,
        overdueBy: remaining != null && remaining < 0 ? Math.abs(remaining) : '',
        unit,
        serviceCount: iv.serviceCount || 0,
        status: iv.statusLevel,
      });
    }
  }
  // Worst first.
  return rows.sort((a, b) => (a.remaining ?? 1e9) - (b.remaining ?? 1e9));
}

// ---- One row per VEHICLE (the sheet the workshop reads) ---------------------
// The per-interval sheet repeats a truck once per service, and two services that
// fall on the same interval (Group C and TR Wheels, both at 80K) come out as two
// near-identical rows that read as duplicates. Here every truck is one row and
// its services become columns, so "what does this truck need" is one glance.

// Trucks number their services "1- …", "2- …"; the same service can carry a
// different number on different trucks (TR Wheels is 4- on 56 and 5- on one), so
// the number is stripped and the rest of the name is what identifies a service.
const serviceKey = (name: string) => (name || '').replace(/^\s*\d+\s*-\s*/, '').trim();
const serviceOrder = (name: string) => {
  const m = /^\s*(\d+)\s*-/.exec(name || '');
  return m ? Number(m[1]) : 99;
};

/** The service columns to build, in a stable fleet-wide order. */
function serviceGroups(items: Vehicle[]) {
  const seen = new Map<string, { key: string; label: string; order: number; km: number }>();
  for (const v of items) {
    for (const iv of v.serviceIntervals || []) {
      const key = serviceKey(iv.name);
      if (!key) continue;
      const g = seen.get(key);
      const order = serviceOrder(iv.name);
      if (!g) seen.set(key, { key, label: key, order, km: iv.intervalKm || 0 });
      else g.order = Math.min(g.order, order); // a truck that numbers it lower wins
    }
  }
  return [...seen.values()].sort((a, b) => a.order - b.order || a.km - b.km || a.label.localeCompare(b.label));
}

const statusText = (s: string | undefined, ar: boolean) =>
  ar ? (s === 'overdue' ? 'متأخرة' : s === 'due' ? 'قريبة' : 'سليمة') : (s || '');

/**
 * One row per vehicle: identity + a summary of what it needs + every service's
 * own last/next/remaining side by side. `pick` keeps a vehicle only if at least
 * one of its services matches (so "overdue only" still exports whole vehicles).
 */
function vehicleRows(items: Vehicle[], ar: boolean, pick: (iv: ServiceInterval) => boolean) {
  const groups = serviceGroups(items);
  const rows: Record<string, any>[] = [];
  for (const v of items) {
    const ivs = v.serviceIntervals || [];
    const matched = ivs.filter(pick);
    if (!matched.length) continue;

    const row: Record<string, any> = {
      plate: v.plate || v.name,
      driver: v.driver || '',
      odometerKm: v.odometerKm ?? '',
      odometerAt: v.lastMessageAt || '', // WHEN that odometer was read (live telemetry)
      status: statusText(v.maintenanceStatus, ar),
    };

    // What this truck actually needs — the whole point of the sheet.
    const needed = matched
      .filter((iv) => iv.statusLevel === 'overdue' || iv.statusLevel === 'due')
      .sort((a, b) => (a.remainingKm ?? 1e9) - (b.remainingKm ?? 1e9));
    row.neededCount = needed.length;
    row.needed = needed.map((iv) => {
      const r = remainOf(iv);
      const late = r.value < 0;
      const amount = `${Math.abs(r.value).toLocaleString('en-US')} ${r.unit}`;
      return `${serviceKey(iv.name)} (${late ? (ar ? `متأخرة ${amount}` : `late ${amount}`) : (ar ? `باقي ${amount}` : `${amount} left`)})`;
    }).join(' | ');

    // Per-service detail, one block of columns per fleet-wide service.
    groups.forEach((g, i) => {
      const iv = ivs.find((x) => serviceKey(x.name) === g.key);
      const r = iv ? remainOf(iv) : null;
      row[`g${i}_last`] = iv?.lastServiceAt ?? '';
      row[`g${i}_lastKm`] = iv?.lastServiceKm ?? '';
      row[`g${i}_due`] = r ? r.next : '';
      row[`g${i}_remain`] = r ? r.value : '';
      row[`g${i}_status`] = iv ? statusText(iv.statusLevel, ar) : '';
    });

    // Worst-first, so whatever needs attention is at the top of the sheet.
    row._worst = matched.reduce((m, iv) => Math.min(m, remainOf(iv).value), 1e9);
    rows.push(row);
  }
  return rows.sort((a, b) => a._worst - b._worst);
}

function vehicleColumns(ar: boolean, items: Vehicle[]): ExportColumn[] {
  const cols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 12 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 22 },
    { header: ar ? 'العداد الحالي (كم)' : 'Odometer (km)', key: 'odometerKm', width: 16 },
    { header: ar ? 'وقت قراءة العداد' : 'Odometer read at', key: 'odometerAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 20 },
    { header: ar ? 'الحالة العامة' : 'Overall status', key: 'status', width: 12 },
    { header: ar ? 'عدد الصيانات المطلوبة' : 'Services needed', key: 'neededCount', width: 12 },
    { header: ar ? 'الصيانات المطلوبة' : 'Which services are needed', key: 'needed', width: 52 },
  ];
  serviceGroups(items).forEach((g, i) => {
    cols.push(
      { header: `${g.label} — ${ar ? 'آخر صيانة' : 'last service'}`, key: `g${i}_last`, transform: (v) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 18 },
      { header: `${g.label} — ${ar ? 'عداد آخرها (كم)' : 'last km'}`, key: `g${i}_lastKm`, width: 16 },
      { header: `${g.label} — ${ar ? 'تستحق عند' : 'due at'}`, key: `g${i}_due`, width: 16 },
      { header: `${g.label} — ${ar ? 'المتبقي' : 'remaining'}`, key: `g${i}_remain`, width: 14 },
      { header: `${g.label} — ${ar ? 'الحالة' : 'status'}`, key: `g${i}_status`, width: 11 },
    );
  });
  return cols;
}

function reportColumns(ar: boolean): ExportColumn[] {
  return [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 12 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 22 },
    { header: ar ? 'العداد الحالي (كم)' : 'Odometer (km)', key: 'odometerKm', width: 16 },
    { header: ar ? 'وقت قراءة العداد' : 'Odometer read at', key: 'odometerAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 20 },
    { header: ar ? 'الخدمة' : 'Service', key: 'service', width: 24 },
    { header: ar ? 'كل (كم)' : 'Interval (km)', key: 'intervalKm', width: 12 },
    { header: ar ? 'آخر صيانة (تاريخ)' : 'Last service (date)', key: 'lastServiceAt', transform: (v) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 16 },
    { header: ar ? 'عداد آخر صيانة (كم)' : 'Last service (km)', key: 'lastServiceKm', width: 17 },
    { header: ar ? 'تستحق عند' : 'Due at', key: 'nextDue', width: 13 },
    { header: ar ? 'المتبقي' : 'Remaining', key: 'remaining', width: 11 },
    { header: ar ? 'متأخرة بـ' : 'Overdue by', key: 'overdueBy', width: 11 },
    { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 7 },
    { header: ar ? 'عدد الصيانات السابقة' : 'Past services', key: 'serviceCount', width: 12 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (ar ? (v === 'overdue' ? 'متأخرة' : v === 'due' ? 'قريبة' : 'سليمة') : v), width: 10 },
  ];
}

// "Send to the workshop" modal: vehicles whose services come due within X km —
// the X is typed by the user each time (default 3000), optionally including the
// already-overdue ones in the same sheet.
function DueSoonModal({ items, ar, onClose }: { items: Vehicle[]; ar: boolean; onClose: () => void }) {
  const [withinKm, setWithinKm] = useState(3000);
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const pick = useCallback((iv: ServiceInterval) => {
    if (iv.remainingKm == null) return false;
    if (iv.remainingKm <= 0) return includeOverdue;
    return iv.remainingKm <= withinKm;
  }, [withinKm, includeOverdue]);
  // Vehicle-level is what goes to the workshop; the per-service lines ride along
  // on a second sheet.
  const vRows = useMemo(() => vehicleRows(items, ar, pick), [items, ar, pick]);
  const rows = useMemo(() => intervalRows(items, pick), [items, pick]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> {ar ? 'تصدير القريبة من الصيانة' : 'Export services due soon'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">{ar ? 'شيت للورشة بكل الخدمات اللي هتستحق خلال المسافة دي — علشان أي عربية منهم تدخل الورشة يعملوا حسابها.' : 'A workshop sheet of every service coming due within this distance.'}</p>
        <label className="block text-sm text-slate-600">
          {ar ? 'الخدمات المتبقّي لها أقل من (كم)' : 'Services with less than (km) remaining'}
          <input
            type="number" min={100} step={100} value={withinKm}
            onChange={(e) => setWithinKm(Math.max(0, Number(e.target.value) || 0))}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-[#f37121]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeOverdue} onChange={(e) => setIncludeOverdue(e.target.checked)} className="accent-[#f37121]" />
          {ar ? 'تضمين المتأخرة أيضًا' : 'Also include overdue ones'}
        </label>
        <div className="text-xs text-slate-500">{ar ? `النتيجة: ${vRows.length} عربية / ${rows.length} خدمة` : `Result: ${vRows.length} vehicles / ${rows.length} services`}</div>
        <button
          type="button" disabled={!rows.length}
          onClick={() => {
            exportMultiSheet([
              { name: ar ? 'العربيات' : 'Vehicles', data: vRows, columns: vehicleColumns(ar, items) },
              { name: ar ? 'تفصيلي' : 'Detailed', data: rows, columns: reportColumns(ar) },
            ], `ls2-due-within-${withinKm}km-${new Date().toISOString().slice(0, 10)}`);
            onClose();
          }}
          className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-40"
        >
          {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>
    </div>
  );
}

// Expand a row → its services inline, each with 'Mark serviced'. The row also links
// out to the one full vehicle profile at /system/ls2/[id].
export default function Ls2MaintenancePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(params?.get('filter') || 'all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const admin = isLs2Admin(user?.role);
  const [svc, setSvc] = useState<{ v: Vehicle; iv: ServiceInterval } | null>(null);
  const [dueSoonOpen, setDueSoonOpen] = useState(false);
  const [deferrals, setDeferrals] = useState<DeferralLike[]>([]);
  const [deferOpen, setDeferOpen] = useState(false); // fleet deferrals panel
  const [settle, setSettle] = useState<DeferralLike | null>(null); // one being settled
  const toggle = (id: number) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const loadDeferrals = useCallback(async () => {
    try { const res = await api.get<{ deferrals: DeferralLike[] }>('/api/ls2/deferrals'); setDeferrals(res.deferrals || []); } catch { /* keep */ }
  }, []);
  const load = useCallback(async () => {
    try { const res = await api.get<{ items: Vehicle[] }>('/api/ls2/vehicles'); setItems(res.items || []); } catch { /* keep */ }
    loadDeferrals();
    setLoading(false);
  }, [loadDeferrals]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  const rows = useMemo(() => {
    let r = items.filter((v) => (v.serviceIntervals?.length || 0) > 0);
    if (filter === 'due') r = r.filter((v) => v.maintenanceStatus === 'due');
    else if (filter === 'overdue') r = r.filter((v) => v.maintenanceStatus === 'overdue');
    // Find a truck by typing — matches plate/name/driver/unit id, Arabic or English.
    const term = q.trim().toLowerCase();
    if (term) r = r.filter((v) => [v.plate, v.name, v.driver, String(v.unitId)].some((x) => (x || '').toLowerCase().includes(term)));
    // Worst first: overdue by how much, then closest to due.
    return r.sort((a, b) => (a.kmToService ?? 1e9) - (b.kmToService ?? 1e9));
  }, [items, filter, q]);


  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const counts = {
    due: items.filter((v) => v.maintenanceStatus === 'due').length,
    overdue: items.filter((v) => v.maintenanceStatus === 'overdue').length,
  };

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wrench className="w-5 h-5" />} title={t.maintenance} subtitle={`${counts.overdue} ${t.serviceOverdue} · ${counts.due} ${t.serviceDue}`}>
        <button
          type="button" onClick={() => setDueSoonOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium"
        >
          <Clock className="w-4 h-4" /> {lang === 'ar' ? 'القريبة من الصيانة' : 'Due soon'}
        </button>
        <button
          type="button" onClick={() => setDeferOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-medium"
        >
          <Clock className="w-4 h-4" /> {t.fleetDeferrals}
          {deferrals.length > 0 && <span className="ms-0.5 min-w-5 px-1.5 h-5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[11px] font-bold">{deferrals.length}</span>}
        </button>
        <ExportMenu
          fileName="ls2-maintenance" lang={lang as Lang}
          options={[
            {
              key: 'overdue', label: lang === 'ar' ? 'تقرير المتأخرات' : 'Overdue report',
              // Sheet 1 = one row per vehicle (what the workshop reads), sheet 2 =
              // the per-service breakdown for anyone who wants the raw lines.
              sheets: [
                { name: lang === 'ar' ? 'العربيات' : 'Vehicles', rows: vehicleRows(items, lang === 'ar', (iv) => iv.statusLevel === 'overdue'), columns: vehicleColumns(lang === 'ar', items) },
                { name: lang === 'ar' ? 'تفصيلي' : 'Detailed', rows: intervalRows(items, (iv) => iv.statusLevel === 'overdue'), columns: reportColumns(lang === 'ar') },
              ],
            },
            {
              key: 'view', label: lang === 'ar' ? 'العرض الحالي (ملخص العربيات)' : 'Current view (vehicle summary)',
              sheets: [{
                name: lang === 'ar' ? 'الصيانة' : 'Maintenance',
                rows: rows.map((v) => ({
                  plate: v.plate || v.name, driver: v.driver || '', odometerKm: v.odometerKm ?? '', odometerAt: v.lastMessageAt || '',
                  status: v.maintenanceStatus, mostOverdue: v.nextServiceName || '', mostOverdueKm: v.kmToService ?? '',
                  upcoming: v.upcomingServiceName || '', upcomingKm: v.upcomingKm ?? '',
                })),
                columns: [
                  { header: lang === 'ar' ? 'اللوحة' : 'Plate', key: 'plate', width: 12 },
                  { header: lang === 'ar' ? 'السائق' : 'Driver', key: 'driver', width: 22 },
                  { header: lang === 'ar' ? 'العداد (كم)' : 'Odometer (km)', key: 'odometerKm', width: 14 },
                  { header: lang === 'ar' ? 'وقت قراءة العداد' : 'Odometer read at', key: 'odometerAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 20 },
                  { header: lang === 'ar' ? 'الحالة' : 'Status', key: 'status', transform: (v) => (lang === 'ar' ? (v === 'overdue' ? 'متأخرة' : v === 'due' ? 'قريبة' : 'سليمة') : v), width: 10 },
                  { header: lang === 'ar' ? 'الأكثر تأخرًا' : 'Most overdue', key: 'mostOverdue', width: 22 },
                  { header: lang === 'ar' ? 'متبقّي/متأخرة (كم)' : 'Remaining (km)', key: 'mostOverdueKm', width: 16 },
                  { header: lang === 'ar' ? 'الأقرب القادمة' : 'Next upcoming', key: 'upcoming', width: 22 },
                  { header: lang === 'ar' ? 'متبقّي لها (كم)' : 'Its remaining (km)', key: 'upcomingKm', width: 16 },
                ],
              }],
            },
            {
              key: 'all', label: lang === 'ar' ? 'كل العربيات وصياناتها' : 'All vehicles & their services',
              sheets: [
                { name: lang === 'ar' ? 'العربيات' : 'Vehicles', rows: vehicleRows(items, lang === 'ar', () => true), columns: vehicleColumns(lang === 'ar', items) },
                { name: lang === 'ar' ? 'تفصيلي' : 'Detailed', rows: intervalRows(items, () => true), columns: reportColumns(lang === 'ar') },
              ],
            },
          ]}
        />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === f ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {f === 'all' ? t.all : f === 'due' ? t.serviceDue : t.serviceOverdue}
          </button>
        ))}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={lang === 'ar' ? 'ابحث برقم اللوحة أو السائق…' : 'Search by plate or driver…'}
            className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <span className="ms-auto text-xs text-slate-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t.fromWialon}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="px-3 py-3 w-8" />
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                <th className="text-end font-semibold px-4 py-3">{t.odometer}</th>
                <th className="text-end font-semibold px-4 py-3 text-red-300">{t.mostOverdue}</th>
                <th className="text-end font-semibold px-4 py-3 text-amber-300">{t.nextUpcoming}</th>
                <th className="text-center font-semibold px-4 py-3">{t.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const ms = maintStyle(v.maintenanceStatus);
                const over = (v.kmToService ?? 0) < 0;
                const isOpen = open.has(v.unitId);
                return (
                  <Fragment key={v.unitId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(v.unitId)}>
                      <td className="px-3 py-3 text-slate-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{v.plate || v.name}</td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{v.driver || '—'}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-slate-800">{fmtKm(v.odometerKm)}</td>
                      {/* Most overdue (or most urgent) service */}
                      <td className="px-4 py-3 text-end">
                        {v.kmToService == null ? <span className="text-slate-300">—</span> : (
                          <div className={`tabular-nums font-bold ${over ? 'text-red-600' : v.maintenanceStatus === 'due' ? 'text-amber-600' : 'text-slate-700'}`}>
                            {over ? `−${fmtNum(Math.abs(v.kmToService))}` : fmtNum(v.kmToService)} <span className="text-[10px] font-normal text-slate-700">{over ? t.kmOverdue : t.kmLeft}</span>
                            <p className="text-[10px] font-normal text-slate-700 truncate max-w-[180px] ms-auto">{v.nextServiceName}</p>
                          </div>
                        )}
                      </td>
                      {/* Nearest upcoming (not-yet-passed) service */}
                      <td className="px-4 py-3 text-end">
                        {v.upcomingKm == null ? <span className="text-slate-300 text-xs">{lang === 'ar' ? 'كلها متأخرة' : 'all overdue'}</span> : (
                          <div className="tabular-nums font-semibold text-slate-700">
                            {fmtNum(v.upcomingKm)} <span className="text-[10px] font-normal text-slate-700">{t.kmLeft}</span>
                            <p className="text-[10px] font-normal text-slate-700 truncate max-w-[180px]">{v.upcomingServiceName}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ms.bg} ${ms.text}`}>{lang === 'ar' ? ms.ar : ms.en}</span></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60 border-b border-slate-100">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-center justify-end mb-2">
                            <button type="button" onClick={() => router.push(`/system/ls2/${v.unitId}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-xs font-medium">
                              <ExternalLink className="w-3.5 h-3.5 text-[#f37121]" /> {lang === 'ar' ? 'ملف المركبة الكامل' : 'Full vehicle profile'}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {[...v.serviceIntervals].sort((a, b) => a.intervalKm - b.intervalKm).map((iv) => {
                              const r = remainOf(iv);
                              const st = maintStyle(iv.statusLevel);
                              const isOver = r.value < 0;
                              const Icon = iv.statusLevel === 'overdue' ? AlertCircle : iv.statusLevel === 'due' ? Clock : CheckCircle2;
                              return (
                                <div key={iv.id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-3">
                                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iv.statusLevel === 'overdue' ? 'text-red-500' : iv.statusLevel === 'due' ? 'text-amber-500' : 'text-emerald-500'}`} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-medium text-slate-800 truncate">{iv.name}</p>
                                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${st.bg} ${st.text}`}>
                                        {isOver ? `−${fmtNum(Math.abs(r.value))}` : fmtNum(r.value)} {r.unit === 'km' ? (isOver ? t.kmOverdue : t.kmLeft) : r.unit}
                                      </span>
                                    </div>
                                    {iv.description && <p className="text-[11px] text-slate-700 mt-0.5 line-clamp-2">{iv.description}</p>}
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11px] text-slate-700">
                                      <span>{t.lastService}: <b className="text-slate-700">{fmtDate(iv.lastServiceAt, lang as Lang)}</b>{iv.lastServiceKm != null && <> · {fmtKm(iv.lastServiceKm)}</>}</span>
                                      <span>{lang === 'ar' ? 'القادمة' : 'Next'}: <b className="text-slate-700">{r.next}</b></span>
                                      {iv.serviceCount > 0 && <span>{iv.serviceCount} {t.services}</span>}
                                    </div>
                                    {admin && (
                                      <button type="button" onClick={() => setSvc({ v, iv })} className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-[11px] font-medium">
                                        <CheckCircle2 className="w-3 h-3" /> {lang === 'ar' ? 'تم عمل الصيانة' : 'Mark serviced'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {dueSoonOpen && <DueSoonModal items={items} ar={lang === 'ar'} onClose={() => setDueSoonOpen(false)} />}

      {/* Fleet-wide deferred tasks — settle any of them right here, no profile visit */}
      {deferOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 pt-[8vh]" onClick={() => setDeferOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh]" dir={isRTL ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100 bg-amber-50 rounded-t-2xl">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /> {t.fleetDeferrals} ({deferrals.length})</h3>
              <button type="button" onClick={() => setDeferOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100">
              {deferrals.length === 0 && <p className="text-sm text-slate-400 text-center py-12">{t.noOpenDeferrals}</p>}
              {deferrals.map((d) => {
                const over = d.remainingKm != null && d.remainingKm < 0;
                return (
                  <div key={`${d.logId}-${d.label}`} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {checklistLabel(d, lang as Lang)}
                        <button type="button" onClick={() => router.push(`/system/ls2/${d.unitId}`)} className="ms-2 text-[#f37121] hover:underline text-xs font-semibold">{d.plate}</button>
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {d.intervalName} · {t.deferredOn} {fmtDate(d.deferredAt, lang as Lang)}
                        {d.deferKm != null && <> · +{fmtNum(d.deferKm)} km</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-end">
                        <p className={`text-sm font-bold tabular-nums ${over ? 'text-red-600' : 'text-amber-700'}`}>
                          {d.remainingKm == null ? '—' : over ? `−${fmtNum(Math.abs(d.remainingKm))} ${t.kmOverdue}` : `${fmtNum(d.remainingKm)} ${t.kmLeft}`}
                        </p>
                        <p className="text-[11px] text-slate-600">{t.dueAt} {fmtKm(d.dueAtOdometerKm)}</p>
                      </div>
                      {admin && (
                        <button type="button" onClick={() => setSettle(d)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-xs font-medium">
                          {t.deferralSettle}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* One deferral's 3-way action dialog (done / defer again / won't do) */}
      {settle && (
        <DeferralActionModal
          deferral={settle} unitId={settle.unitId ?? 0} currentOdo={settle.currentOdometerKm ?? null}
          lang={lang as Lang} isRTL={isRTL}
          onClose={() => setSettle(null)}
          onDone={() => { setSettle(null); load(); }}
        />
      )}

      {/* Register-service dialog — same one the vehicle profile uses (checklist included) */}
      {svc && (
        <RegisterServiceModal
          unitId={svc.v.unitId} interval={svc.iv} currentOdo={svc.v.odometerKm}
          lang={lang as Lang} isRTL={isRTL}
          onClose={() => setSvc(null)}
          onSaved={() => { setSvc(null); load(); }}
        />
      )}
    </div>
  );
}
