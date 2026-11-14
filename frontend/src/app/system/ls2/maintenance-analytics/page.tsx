'use client';
// Heavy-transport maintenance analytics on /api/ls2/maintenance/analytics, which reads the whole maintenance ledger:
// records, older service logs and repairs, and parts issued from the heavy store to a truck. Every figure is a sum of
// entries the vehicle drill-down lists, and every block exports to Excel.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, RefreshCw, Package, Wrench, Truck, Wallet, CircleDot, Receipt, Gauge, Users, ListChecks, AlertTriangle, X, ExternalLink, Layers, CalendarRange,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import SearchSelect from '@/components/ls2/SearchSelect';
import ExportMenu, { type ExportColumn, type ExportSheet } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { EntryCard } from '@/components/ls2/MaintenanceRecords';
import { isLs2Staff, lastNDays, MAINTENANCE_TYPES, MAINTENANCE_SOURCE_LABEL, maintenanceTypeLabel, type DateRange, type Lang, type MaintenanceEntry, type MaintenanceEntryPart, type MaintenanceSource } from '@/lib/ls2';

type Bucket = { count: number; parts: number; labour: number; towing: number; unsplit: number; total: number };
type VehicleRow = Bucket & {
  unitId: number; plate: string; driver: string; byType: Record<string, number>; countByType: Record<string, number>;
  km: number; costPer1000Km: number | null; per10kKm: number | null; visitDays: number; firstDate: string; lastDate: string; avgDaysBetween: number | null;
};
type PartRow = { item: string; name: string; code: string; unit: string; isTire: boolean; quantity: number; cost: number; entries: number; vehicles: number };
type Analytics = {
  filters: { from: string; to: string };
  totals: Bucket & { vehicles: number; avgPerVehicle: number; km: number; kmVehicles: number; costPer1000Km: number | null; tireQty: number };
  byType: (Bucket & { type: string; typeAr: string; lastDate: string })[];
  bySource: { source: MaintenanceSource; count: number; total: number }[];
  byVehicle: VehicleRow[];
  trend: ({ bucket: string; total: number; count: number } & Record<string, number | string>)[];
  granularity: 'day' | 'month';
  topPartsByCost: PartRow[]; topPartsByQty: PartRow[]; partsCount: number;
  tires: { storeQty: number; storeCost: number; fitted: number; removed: number; scrapped: number; byVehicle: { unitId: number; plate: string; storeQty: number; storeCost: number; fitted: number; removed: number; scrapped: number }[] };
  services: { overdue: number; due: number; vehiclesOverdue: number; vehiclesDue: number; rows: { unitId: number; plate: string; service: string; status: string; remaining: number | null; unit: string; lastServiceAt: string | null; lastServiceKm: number | null }[] };
  unmatchedIssues: { count: number; cost: number; rows: { date: string; vehiclePlate: string; ref: string; name: string; quantity: number; unitPrice: number; total: number }[] };
  priceBasis: Record<string, number>;
  vehicles: { unitId: number; plate: string }[];
};

// Cost buckets; validated as a categorical set on the light surface.
const COST = { parts: '#0369a1', labour: '#7c3aed', towing: '#d97706', unsplit: '#64748b' };
const money = (n?: number | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money2 = (n?: number | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const ymd = (d: Date) => new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

function presets(ar: boolean): { key: string; label: string; range: () => DateRange }[] {
  const yearStart = () => ({ from: `${ymd(new Date()).slice(0, 4)}-01-01`, to: ymd(new Date()) });
  return [
    { key: '30', label: ar ? 'آخر 30 يومًا' : 'Last 30 days', range: () => lastNDays(30) },
    { key: '90', label: ar ? 'آخر 3 أشهر' : 'Last 3 months', range: () => lastNDays(90) },
    { key: '180', label: ar ? 'آخر 6 أشهر' : 'Last 6 months', range: () => lastNDays(180) },
    { key: '365', label: ar ? 'آخر سنة' : 'Last 12 months', range: () => lastNDays(365) },
    { key: 'ytd', label: ar ? 'هذه السنة' : 'This year', range: yearStart },
  ];
}

function Kpi({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-w-0">
      <div className="flex items-center gap-2 text-slate-600 text-xs font-medium">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums mt-2 truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Card({ title, icon, children, right, className = '' }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl shadow-sm min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function BlockExport({ name, sheets, ar }: { name: string; sheets: ExportSheet[]; ar: boolean }) {
  return <ExportMenu fileName={`ls2-maintenance-${name}`} lang={ar ? 'ar' : 'en'} label={ar ? 'Excel' : 'Excel'} options={[{ key: name, label: ar ? 'تصدير هذا الجزء' : 'Export this block', sheets }]} />;
}

function Empty({ ar, text }: { ar: boolean; text?: string }) {
  return <p className="text-sm text-slate-500 text-center py-8">{text || (ar ? 'لا توجد بيانات في هذه الفترة' : 'No data in this period')}</p>;
}

/** Every entry behind one vehicle's ranking row, for the same period and type. */
function VehicleDrill({ row, range, type, ar, onClose, onOpenProfile }: { row: VehicleRow; range: DateRange; type: string; ar: boolean; onClose: () => void; onOpenProfile: () => void }) {
  const [entries, setEntries] = useState<MaintenanceEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ unitId: String(row.unitId), from: range.from, to: range.to, ...(type ? { type } : {}) });
    api.get<{ entries: MaintenanceEntry[] }>(`/api/ls2/maintenance/entries?${qs.toString()}`)
      .then((r) => { if (alive) setEntries(r.entries || []); }).catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [row.unitId, range.from, range.to, type]);
  const sum = (entries || []).reduce((a, e) => a + e.totalCost, 0);
  const lines: { e: MaintenanceEntry; p: MaintenanceEntryPart | null }[] = (entries || []).flatMap((e) => (e.parts.length ? e.parts.map((p) => ({ e, p: p as MaintenanceEntryPart | null })) : [{ e, p: null }]));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-4xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">{row.plate} · {ar ? 'سجلات الصيانة' : 'Maintenance entries'}</h3>
            <p className="text-xs text-slate-600 tabular-nums">{range.from} → {range.to} · {entries?.length ?? '…'} {ar ? 'سجل' : 'entries'} · {money2(sum)} {ar ? 'ر.س' : 'SAR'}</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu fileName={`ls2-maintenance-${row.plate}`} lang={ar ? 'ar' : 'en'} options={[{
              key: 'v', label: ar ? 'سجلات المركبة' : 'Vehicle entries',
              sheets: [{
                name: row.plate, rows: lines.map(({ e, p }) => ({
                  date: e.date, type: maintenanceTypeLabel(e.type, ar ? 'ar' : 'en'), source: MAINTENANCE_SOURCE_LABEL[e.source][ar ? 'ar' : 'en'], title: e.title,
                  part: p?.name || '', qty: p?.quantity ?? '', unitPrice: p?.unitPrice ?? '', lineTotal: p?.total ?? '',
                  labour: e.labourCost, towing: e.towingCost, unsplit: e.unsplitCost, total: e.totalCost, by: e.by || '', notes: e.notes || '',
                })),
                columns: [
                  { header: ar ? 'التاريخ' : 'Date', key: 'date', width: 12 }, { header: ar ? 'النوع' : 'Type', key: 'type', width: 16 },
                  { header: ar ? 'المصدر' : 'Source', key: 'source', width: 16 }, { header: ar ? 'الوصف' : 'Title', key: 'title', width: 28 },
                  { header: ar ? 'القطعة' : 'Part', key: 'part', width: 24 }, { header: ar ? 'الكمية' : 'Qty', key: 'qty', width: 8 },
                  { header: ar ? 'سعر الوحدة' : 'Unit price', key: 'unitPrice', width: 11 }, { header: ar ? 'قيمة السطر' : 'Line total', key: 'lineTotal', width: 11 },
                  { header: ar ? 'العمالة' : 'Labour', key: 'labour', width: 10 }, { header: ar ? 'السحب' : 'Towing', key: 'towing', width: 10 },
                  { header: ar ? 'غير مفصّلة' : 'Unitemised', key: 'unsplit', width: 11 }, { header: ar ? 'إجمالي السجل' : 'Entry total', key: 'total', width: 12 },
                  { header: ar ? 'سجّله' : 'By', key: 'by', width: 16 }, { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
                ],
              }],
            }]} />
            <button type="button" onClick={onOpenProfile} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 hover:border-[#f37121] text-xs font-medium text-slate-700"><ExternalLink className="w-3.5 h-3.5 text-[#f37121]" /> {ar ? 'ملف المركبة' : 'Vehicle profile'}</button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/60">
          {entries == null ? <p className="text-center text-slate-500 py-10">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
            : entries.length === 0 ? <Empty ar={ar} />
              : <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{entries.map((e) => <EntryCard key={e.key} e={e} ar={ar} admin={false} />)}</div>}
        </div>
      </div>
    </div>
  );
}

export default function MaintenanceAnalyticsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const L = lang as Lang;
  const [range, setRange] = useState<DateRange>(lastNDays(180));
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState('');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<VehicleRow | null>(null);
  const [allVehicles, setAllVehicles] = useState(false);
  const [partsBy, setPartsBy] = useState<'cost' | 'qty'>('cost');
  const latest = useLatestRequest();

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ from: range.from, to: range.to, ...(unitId ? { unitId } : {}), ...(type ? { type } : {}) });
    const mine = latest.begin();
    try {
      const r = await api.get<Analytics>(`/api/ls2/maintenance/analytics?${qs.toString()}`);
      if (latest.isCurrent(mine)) setData(r);
    } catch { /* keep */ }
    if (latest.isCurrent(mine)) setLoading(false);
  }, [range, unitId, type, latest]);
  useEffect(() => { load(); }, [load]);
  // Real writes only: the poller's pulse carries `vehicles`.
  useSocket('ls2:updated', useCallback((d: any) => { if (!d?.vehicles) load(); }, [load]));
  useSocket('ls2:store', useCallback(() => load(), [load]));

  const typeRows = useMemo(() => (data?.byType || []).map((b) => ({ ...b, label: maintenanceTypeLabel(b.type, L) })), [data, L]);
  const trendRows = useMemo(() => (data?.trend || []).map((t) => ({ ...t, label: data?.granularity === 'month' ? String(t.bucket) : String(t.bucket).slice(5) })), [data]);

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح' : 'Not authorized'}</div>;
  if (loading && !data) return <Spinner />;

  const t = data?.totals;
  const share = (n?: number) => (t && t.total > 0 ? `${Math.round(((n || 0) / t.total) * 100)}%` : '—');
  const SAR = ar ? 'ر.س' : 'SAR';
  const tooltipFmt = (v: any) => `${money(Number(v))} ${SAR}`;
  const ranking = (data?.byVehicle || []).slice(0, allVehicles ? undefined : 15);
  const maxV = data?.byVehicle[0]?.total || 1;
  const parts = partsBy === 'cost' ? data?.topPartsByCost || [] : data?.topPartsByQty || [];
  const typeLabel = (k: string) => maintenanceTypeLabel(k, L);

  // Excel columns per block.
  const vehicleCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 }, { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 18 },
    { header: ar ? 'عدد السجلات' : 'Entries', key: 'count', width: 9 },
    ...MAINTENANCE_TYPES.map((m) => ({ header: ar ? m.ar : m.en, key: `t_${m.key}`, width: 13 })),
    { header: ar ? 'قطع الغيار' : 'Parts', key: 'parts', width: 12 }, { header: ar ? 'العمالة' : 'Labour', key: 'labour', width: 11 },
    { header: ar ? 'السحب' : 'Towing', key: 'towing', width: 11 }, { header: ar ? 'غير مفصّلة' : 'Unitemised', key: 'unsplit', width: 12 },
    { header: ar ? 'الإجمالي' : 'Total', key: 'total', width: 12 }, { header: ar ? 'المسافة (كم)' : 'Distance (km)', key: 'km', width: 12 },
    { header: ar ? 'التكلفة لكل 1000 كم' : 'Cost / 1,000 km', key: 'costPer1000Km', width: 14 },
    { header: ar ? 'أيام الزيارات' : 'Visit days', key: 'visitDays', width: 10 }, { header: ar ? 'متوسط الأيام بين الزيارات' : 'Avg days between', key: 'avgDaysBetween', width: 14 },
    { header: ar ? 'سجلات لكل 10,000 كم' : 'Entries / 10,000 km', key: 'per10kKm', width: 14 },
    { header: ar ? 'أول سجل' : 'First', key: 'firstDate', width: 12 }, { header: ar ? 'آخر سجل' : 'Last', key: 'lastDate', width: 12 },
  ];
  const vehicleSheetRows = (data?.byVehicle || []).map((v) => ({ ...v, ...Object.fromEntries(MAINTENANCE_TYPES.map((m) => [`t_${m.key}`, v.byType[m.key] || 0])) }));
  const typeCols: ExportColumn[] = [
    { header: ar ? 'النوع' : 'Type', key: 'label', width: 20 }, { header: ar ? 'عدد السجلات' : 'Entries', key: 'count', width: 10 },
    { header: ar ? 'قطع الغيار' : 'Parts', key: 'parts', width: 12 }, { header: ar ? 'العمالة' : 'Labour', key: 'labour', width: 12 },
    { header: ar ? 'السحب' : 'Towing', key: 'towing', width: 12 }, { header: ar ? 'غير مفصّلة' : 'Unitemised', key: 'unsplit', width: 12 },
    { header: ar ? 'الإجمالي' : 'Total', key: 'total', width: 12 }, { header: ar ? 'آخر سجل' : 'Last entry', key: 'lastDate', width: 12 },
  ];
  const trendCols: ExportColumn[] = [
    { header: ar ? 'الفترة' : 'Period', key: 'bucket', width: 12 },
    ...MAINTENANCE_TYPES.flatMap((m) => [{ header: `${ar ? m.ar : m.en} — ${ar ? 'التكلفة' : 'cost'}`, key: m.key, width: 14 }, { header: `${ar ? m.ar : m.en} — ${ar ? 'العدد' : 'count'}`, key: `${m.key}Count`, width: 10 }]),
    { header: ar ? 'الإجمالي' : 'Total', key: 'total', width: 12 }, { header: ar ? 'عدد السجلات' : 'Entries', key: 'count', width: 10 },
  ];
  const partCols: ExportColumn[] = [
    { header: ar ? 'الصنف' : 'Item', key: 'name', width: 28 }, { header: ar ? 'الكود' : 'Code', key: 'code', width: 12 },
    { header: ar ? 'الكمية' : 'Qty', key: 'quantity', width: 9 }, { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 9 },
    { header: ar ? 'التكلفة' : 'Cost', key: 'cost', width: 12 }, { header: ar ? 'عدد السجلات' : 'Entries', key: 'entries', width: 9 },
    { header: ar ? 'عدد المركبات' : 'Vehicles', key: 'vehicles', width: 9 }, { header: ar ? 'كاوتش' : 'Tyre', key: 'isTire', transform: (v) => (v ? (ar ? 'نعم' : 'yes') : ''), width: 7 },
  ];
  const tireCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 }, { header: ar ? 'مصروف من المخزن' : 'Issued from store', key: 'storeQty', width: 14 },
    { header: ar ? 'قيمة المصروف' : 'Issued value', key: 'storeCost', width: 13 }, { header: ar ? 'مركّبة' : 'Fitted', key: 'fitted', width: 9 },
    { header: ar ? 'منزّلة' : 'Removed', key: 'removed', width: 9 }, { header: ar ? 'تالفة/سكراب' : 'Scrapped', key: 'scrapped', width: 11 },
  ];
  const serviceCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 }, { header: ar ? 'الخدمة' : 'Service', key: 'service', width: 26 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (v === 'overdue' ? (ar ? 'متأخرة' : 'overdue') : (ar ? 'قريبة' : 'due')), width: 10 },
    { header: ar ? 'المتبقي/المتأخر' : 'Remaining', key: 'remaining', width: 12 }, { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 7 },
    { header: ar ? 'آخر صيانة' : 'Last service', key: 'lastServiceAt', transform: (v) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 13 },
    { header: ar ? 'عداد آخر صيانة' : 'Last service km', key: 'lastServiceKm', width: 13 },
  ];
  const kpiRows = t ? [
    { k: ar ? 'إجمالي التكلفة' : 'Total cost', v: t.total }, { k: ar ? 'قطع الغيار' : 'Parts', v: t.parts }, { k: ar ? 'العمالة' : 'Labour', v: t.labour },
    { k: ar ? 'السحب' : 'Towing', v: t.towing }, { k: ar ? 'تكلفة غير مفصّلة' : 'Unitemised', v: t.unsplit }, { k: ar ? 'عدد السجلات' : 'Entries', v: t.count },
    { k: ar ? 'المركبات المخدومة' : 'Vehicles serviced', v: t.vehicles }, { k: ar ? 'متوسط التكلفة لكل مركبة' : 'Avg cost per vehicle', v: t.avgPerVehicle },
    { k: ar ? 'المسافة المقطوعة (كم)' : 'Distance (km)', v: t.km }, { k: ar ? 'التكلفة لكل 1000 كم' : 'Cost per 1,000 km', v: t.costPer1000Km ?? '' },
    { k: ar ? 'خدمات دورية متأخرة' : 'Overdue services', v: data!.services.overdue }, { k: ar ? 'خدمات دورية قريبة' : 'Due services', v: data!.services.due },
  ] : [];
  const kpiCols: ExportColumn[] = [{ header: ar ? 'المؤشر' : 'Indicator', key: 'k', width: 28 }, { header: ar ? 'القيمة' : 'Value', key: 'v', width: 16 }];
  const allSheets: ExportSheet[] = data ? [
    { name: ar ? 'المؤشرات' : 'KPIs', rows: kpiRows, columns: kpiCols, title: `${range.from} → ${range.to}` },
    { name: ar ? 'حسب النوع' : 'By type', rows: typeRows, columns: typeCols },
    { name: ar ? 'الاتجاه' : 'Trend', rows: data.trend, columns: trendCols },
    { name: ar ? 'حسب المركبة' : 'By vehicle', rows: vehicleSheetRows, columns: vehicleCols },
    { name: ar ? 'القطع حسب التكلفة' : 'Parts by cost', rows: data.topPartsByCost, columns: partCols },
    { name: ar ? 'القطع حسب الكمية' : 'Parts by qty', rows: data.topPartsByQty, columns: partCols },
    { name: ar ? 'الكاوتشات' : 'Tyres', rows: data.tires.byVehicle, columns: tireCols },
    { name: ar ? 'الخدمات المستحقة' : 'Services due', rows: data.services.rows, columns: serviceCols },
  ] : [];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'} data-dash>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={ar ? 'تحليلات الصيانة' : 'Maintenance analytics'}
        subtitle={ar ? 'كل تكاليف صيانة أسطول النقل الثقيل: السجلات، والخدمات والإصلاحات السابقة، وقطع الغيار المصروفة من المخزن' : 'All heavy-fleet maintenance cost: records, earlier services and repairs, and parts issued from the store'}>
        <ExportMenu fileName="ls2-maintenance-analytics" lang={L} options={[{ key: 'all', label: ar ? 'كل الأجزاء' : 'All blocks', sheets: allSheets }]} />
        <button type="button" onClick={() => router.push('/system/ls2/maintenance')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-sm font-medium">
          <Wrench className="w-4 h-4 text-[#f37121]" /> {ar ? 'صفحة الصيانة' : 'Maintenance page'}
        </button>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      {/* Filters: period presets or a custom range, vehicle, type */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange className="w-4 h-4 text-[#f37121] mx-1" />
          {presets(ar).map((p) => {
            const r = p.range();
            const active = r.from === range.from && r.to === range.to;
            return (
              <button key={p.key} type="button" onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>{p.label}</button>
            );
          })}
          <div className="flex items-center gap-1.5 ms-auto">
            <label className="text-xs text-slate-600">{ar ? 'من' : 'From'}</label>
            <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ from: e.target.value, to: range.to })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800" />
            <label className="text-xs text-slate-600">{ar ? 'إلى' : 'To'}</label>
            <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ from: range.from, to: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-100">
          <SearchSelect
            value={unitId} onChange={setUnitId} ar={ar} isRTL={isRTL} className="w-full sm:w-56"
            options={(data?.vehicles || []).map((v) => ({ value: String(v.unitId), label: v.plate }))}
            placeholder={ar ? 'كل المركبات' : 'All vehicles'} emptyLabel={ar ? 'كل المركبات' : 'All vehicles'}
            searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setType('')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!type ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>{ar ? 'كل الأنواع' : 'All types'}</button>
            {MAINTENANCE_TYPES.map((m) => (
              <button key={m.key} type="button" onClick={() => setType(m.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${type === m.key ? 'bg-slate-900 text-white border-slate-900' : m.cls}`}>{ar ? m.ar : m.en}</button>
            ))}
          </div>
          <span className="ms-auto text-xs text-slate-600 tabular-nums">{data?.filters.from} → {data?.filters.to}</span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={<Wallet className="w-4 h-4" />} color="#f37121" label={ar ? 'إجمالي تكلفة الصيانة' : 'Total maintenance cost'} value={`${money(t?.total)} ${SAR}`} sub={`${t?.count || 0} ${ar ? 'سجل' : 'entries'}`} />
        <Kpi icon={<Package className="w-4 h-4" />} color={COST.parts} label={ar ? 'قطع الغيار' : 'Spare parts'} value={money(t?.parts)} sub={`${share(t?.parts)} ${ar ? 'من الإجمالي' : 'of total'}`} />
        <Kpi icon={<Wrench className="w-4 h-4" />} color={COST.labour} label={ar ? 'العمالة' : 'Labour'} value={money(t?.labour)} sub={`${share(t?.labour)} ${ar ? 'من الإجمالي' : 'of total'}`} />
        <Kpi icon={<Truck className="w-4 h-4" />} color={COST.towing} label={ar ? 'السحب' : 'Towing'} value={money(t?.towing)} sub={`${share(t?.towing)} ${ar ? 'من الإجمالي' : 'of total'}`} />
        <Kpi icon={<Receipt className="w-4 h-4" />} color={COST.unsplit} label={ar ? 'تكلفة غير مفصّلة' : 'Unitemised cost'} value={money(t?.unsplit)} sub={ar ? 'خدمات وإصلاحات سابقة بمبلغ واحد' : 'Earlier services/repairs, one amount'} />
        <Kpi icon={<Users className="w-4 h-4" />} color="#0f766e" label={ar ? 'المركبات المخدومة' : 'Vehicles serviced'} value={String(t?.vehicles || 0)} sub={`${ar ? 'المتوسط' : 'Avg'} ${money(t?.avgPerVehicle)} ${SAR} ${ar ? 'لكل مركبة' : 'per vehicle'}`} />
        <Kpi icon={<Gauge className="w-4 h-4" />} color="#12325c" label={ar ? 'التكلفة لكل 1000 كم' : 'Cost per 1,000 km'} value={t?.costPer1000Km != null ? `${money2(t.costPer1000Km)} ${SAR}` : '—'} sub={`${money(t?.km)} ${ar ? 'كم من' : 'km over'} ${t?.kmVehicles || 0} ${ar ? 'مركبة لها عدّاد' : 'vehicles with odometer'}`} />
        <Kpi icon={<CircleDot className="w-4 h-4" />} color="#b45309" label={ar ? 'كاوتشات مصروفة' : 'Tyres issued'} value={String(data?.tires.storeQty || 0)} sub={`${money(data?.tires.storeCost)} ${SAR} · ${ar ? 'مركّبة' : 'fitted'} ${data?.tires.fitted || 0}`} />
        <Kpi icon={<AlertTriangle className="w-4 h-4" />} color="#dc2626" label={ar ? 'خدمات دورية متأخرة' : 'Overdue services'} value={String(data?.services.overdue || 0)} sub={`${data?.services.vehiclesOverdue || 0} ${ar ? 'مركبة' : 'vehicles'} · ${ar ? 'الآن' : 'now'}`} />
        <Kpi icon={<ListChecks className="w-4 h-4" />} color="#d97706" label={ar ? 'خدمات دورية قريبة' : 'Services due soon'} value={String(data?.services.due || 0)} sub={`${data?.services.vehiclesDue || 0} ${ar ? 'مركبة' : 'vehicles'} · ${ar ? 'الآن' : 'now'}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" icon={<Layers className="w-4 h-4 text-[#f37121]" />} title={ar ? 'التكلفة حسب نوع الصيانة' : 'Cost by maintenance type'} right={<BlockExport name="by-type" ar={ar} sheets={[{ name: ar ? 'حسب النوع' : 'By type', rows: typeRows, columns: typeCols }]} />}>
          <div className="space-y-3">
            {typeRows.map((b) => {
              const m = MAINTENANCE_TYPES.find((x) => x.key === b.type)!;
              const pct = t && t.total > 0 ? (b.total / t.total) * 100 : 0;
              return (
                <button key={b.type} type="button" onClick={() => setType(type === b.type ? '' : b.type)} className="w-full text-start group">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800 group-hover:text-slate-950">{b.label}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{money(b.total)} <span className="text-[10px] font-normal text-slate-500">{SAR}</span></span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.bar }} /></div>
                  <p className="text-[11px] text-slate-600 mt-0.5 tabular-nums">{Math.round(pct)}% · {b.count} {ar ? 'سجل' : 'entries'}{b.lastDate ? ` · ${ar ? 'آخرها' : 'last'} ${b.lastDate}` : ''}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="xl:col-span-3" icon={<BarChart3 className="w-4 h-4 text-[#f37121]" />} title={ar ? `الاتجاه حسب النوع (${data?.granularity === 'day' ? 'يومي' : 'شهري'})` : `Trend by type (${data?.granularity === 'day' ? 'daily' : 'monthly'})`}
          right={<BlockExport name="trend" ar={ar} sheets={[{ name: ar ? 'الاتجاه' : 'Trend', rows: data?.trend || [], columns: trendCols }]} />}>
          <div className="h-72" dir="ltr">
            {!(data?.trend || []).some((x) => x.total > 0) ? <Empty ar={ar} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendRows} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} minTickGap={8} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={56} />
                  <Tooltip formatter={tooltipFmt} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {MAINTENANCE_TYPES.map((m, i) => (
                    <Bar key={m.key} dataKey={m.key} stackId="t" name={ar ? m.ar : m.en} fill={m.bar} stroke="#fff" strokeWidth={1}
                      radius={i === MAINTENANCE_TYPES.length - 1 ? [4, 4, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card icon={<Truck className="w-4 h-4 text-[#f37121]" />} title={ar ? 'ترتيب المركبات وتكرار الصيانة' : 'Vehicle ranking and maintenance frequency'}
        right={<div className="flex items-center gap-2"><span className="text-[11px] text-slate-600">{ar ? 'اضغط على مركبة لعرض سجلاتها' : 'Click a vehicle for its entries'}</span><BlockExport name="vehicles" ar={ar} sheets={[{ name: ar ? 'حسب المركبة' : 'By vehicle', rows: vehicleSheetRows, columns: vehicleCols }]} /></div>}>
        {!ranking.length ? <Empty ar={ar} /> : (
          <>
            <ScrollX>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-900 text-slate-300">
                  <th className="text-start font-semibold px-3 py-2">#</th>
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'اللوحة' : 'Plate'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'السجلات' : 'Entries'}</th>
                  {MAINTENANCE_TYPES.map((m) => <th key={m.key} className="text-end font-semibold px-3 py-2 whitespace-nowrap">{ar ? m.ar.replace('الصيانة ', '') : m.en}</th>)}
                  <th className="text-start font-semibold px-3 py-2 min-w-[180px]">{ar ? 'الإجمالي' : 'Total'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'كم' : 'km'}</th>
                  <th className="text-end font-semibold px-3 py-2 whitespace-nowrap">{ar ? 'لكل 1000 كم' : '/1,000 km'}</th>
                  <th className="text-end font-semibold px-3 py-2 whitespace-nowrap">{ar ? 'كل كم يوم' : 'Every n days'}</th>
                  <th className="text-end font-semibold px-3 py-2 whitespace-nowrap">{ar ? 'آخر سجل' : 'Last'}</th>
                </tr></thead>
                <tbody>
                  {ranking.map((v, i) => (
                    <tr key={v.unitId} className="border-b border-slate-100 hover:bg-orange-50/40 cursor-pointer" onClick={() => setDrill(v)}>
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900 whitespace-nowrap">{v.plate}{v.driver && <p className="text-[10px] font-normal text-slate-500">{v.driver}</p>}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-800">{v.count}</td>
                      {MAINTENANCE_TYPES.map((m) => <td key={m.key} className="px-3 py-2 text-end tabular-nums text-slate-700">{v.byType[m.key] ? money(v.byType[m.key]) : <span className="text-slate-300">—</span>}</td>)}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden flex" title={`${ar ? 'قطع' : 'parts'} ${money(v.parts)} · ${ar ? 'عمالة' : 'labour'} ${money(v.labour)} · ${ar ? 'سحب' : 'towing'} ${money(v.towing)} · ${ar ? 'غير مفصّلة' : 'unitemised'} ${money(v.unsplit)}`}>
                            {(['parts', 'labour', 'towing', 'unsplit'] as const).map((k) => <div key={k} style={{ width: `${(v[k] / maxV) * 100}%`, background: COST[k] }} />)}
                          </div>
                          <span className="font-bold tabular-nums text-slate-900 w-16 text-end">{money(v.total)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-700">{v.km ? money(v.km) : '—'}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-700">{v.costPer1000Km != null ? money(v.costPer1000Km) : '—'}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-700">{v.avgDaysBetween != null ? Math.round(v.avgDaysBetween) : '—'}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-700 whitespace-nowrap">{v.lastDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
                {(['parts', 'labour', 'towing', 'unsplit'] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COST[k] }} />{k === 'parts' ? (ar ? 'قطع' : 'Parts') : k === 'labour' ? (ar ? 'عمالة' : 'Labour') : k === 'towing' ? (ar ? 'سحب' : 'Towing') : (ar ? 'غير مفصّلة' : 'Unitemised')}</span>
                ))}
              </div>
              {(data?.byVehicle.length || 0) > 15 && (
                <button type="button" onClick={() => setAllVehicles((x) => !x)} className="text-xs font-medium text-slate-700 hover:text-slate-950">
                  {allVehicles ? (ar ? 'عرض أعلى 15' : 'Show top 15') : (ar ? `عرض كل المركبات (${data?.byVehicle.length})` : `Show all (${data?.byVehicle.length})`)}
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" icon={<Package className="w-4 h-4 text-[#f37121]" />} title={ar ? 'قطع الغيار الأكثر استهلاكًا' : 'Most consumed spare parts'}
          right={(
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {(['cost', 'qty'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setPartsBy(k)} className={`px-2.5 py-1 font-medium ${partsBy === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>{k === 'cost' ? (ar ? 'بالتكلفة' : 'By cost') : (ar ? 'بالكمية' : 'By quantity')}</button>
                ))}
              </div>
              <BlockExport name="parts" ar={ar} sheets={[
                { name: ar ? 'حسب التكلفة' : 'By cost', rows: data?.topPartsByCost || [], columns: partCols },
                { name: ar ? 'حسب الكمية' : 'By quantity', rows: data?.topPartsByQty || [], columns: partCols },
              ]} />
            </div>
          )}>
          {!parts.length ? <Empty ar={ar} text={ar ? 'لا توجد قطع مصروفة في هذه الفترة' : 'No parts issued in this period'} /> : (
            <ScrollX>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-900 text-slate-300">
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'الصنف' : 'Item'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'الكمية' : 'Qty'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'السجلات' : 'Entries'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'المركبات' : 'Vehicles'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'التكلفة' : 'Cost'}</th>
                </tr></thead>
                <tbody>
                  {parts.slice(0, 15).map((p) => (
                    <tr key={p.item} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-800">{p.name}{p.code && <span className="ms-1 text-[10px] text-slate-500">{p.code}</span>}{p.isTire && <span className="ms-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px]">{ar ? 'كاوتش' : 'tyre'}</span>}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money2(p.quantity)} {p.unit}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{p.entries}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{p.vehicles}</td>
                      <td className="px-3 py-2 text-end tabular-nums font-semibold">{money(p.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
        </Card>

        <Card icon={<CircleDot className="w-4 h-4 text-[#f37121]" />} title={ar ? 'استهلاك الكاوتشات لكل مركبة' : 'Tyre consumption per vehicle'}
          right={<BlockExport name="tyres" ar={ar} sheets={[{ name: ar ? 'الكاوتشات' : 'Tyres', rows: data?.tires.byVehicle || [], columns: tireCols }]} />}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { k: ar ? 'من المخزن' : 'Issued', v: data?.tires.storeQty || 0, s: `${money(data?.tires.storeCost)} ${SAR}` },
              { k: ar ? 'مركّبة' : 'Fitted', v: data?.tires.fitted || 0, s: `${ar ? 'منزّلة' : 'removed'} ${data?.tires.removed || 0}` },
              { k: ar ? 'تالفة/سكراب' : 'Scrapped', v: data?.tires.scrapped || 0, s: ar ? 'سجل الكاوتشات' : 'tyre registry' },
            ].map((x) => (
              <div key={x.k} className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                <p className="text-[11px] text-slate-600">{x.k}</p>
                <p className="text-lg font-bold tabular-nums text-slate-900">{x.v}</p>
                <p className="text-[10px] text-slate-600 truncate">{x.s}</p>
              </div>
            ))}
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white"><tr className="text-slate-600 border-b border-slate-200">
                <th className="text-start font-semibold py-1.5">{ar ? 'اللوحة' : 'Plate'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'مخزن' : 'Store'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'قيمة' : 'Value'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'مركّبة' : 'Fitted'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'تالفة' : 'Scrap'}</th>
              </tr></thead>
              <tbody>
                {(data?.tires.byVehicle || []).map((r) => (
                  <tr key={r.unitId} className="border-b border-slate-50">
                    <td className="py-1.5 text-slate-800">{r.plate}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.storeQty}</td>
                    <td className="py-1.5 text-end tabular-nums">{money(r.storeCost)}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.fitted}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.scrapped}</td>
                  </tr>
                ))}
                {(data?.tires.byVehicle || []).length === 0 && <tr><td colSpan={5}><Empty ar={ar} text={ar ? 'لا يوجد استهلاك في هذه الفترة' : 'No consumption in this period'} /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" icon={<AlertTriangle className="w-4 h-4 text-red-600" />} title={ar ? 'الخدمات الدورية المستحقة الآن' : 'Periodic services due now'}
          right={<BlockExport name="services-due" ar={ar} sheets={[{ name: ar ? 'الخدمات المستحقة' : 'Services due', rows: data?.services.rows || [], columns: serviceCols }]} />}>
          {!(data?.services.rows || []).length ? <Empty ar={ar} text={ar ? 'لا توجد خدمات متأخرة أو قريبة' : 'No overdue or due services'} /> : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0"><tr className="bg-slate-900 text-slate-300">
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'اللوحة' : 'Plate'}</th>
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'الخدمة' : 'Service'}</th>
                  <th className="text-end font-semibold px-3 py-2">{ar ? 'المتبقي' : 'Remaining'}</th>
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'آخر صيانة' : 'Last service'}</th>
                </tr></thead>
                <tbody>
                  {data!.services.rows.map((s, i) => (
                    <tr key={`${s.unitId}-${i}`} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/ls2/${s.unitId}`)}>
                      <td className="px-3 py-2 font-medium text-slate-900">{s.plate}</td>
                      <td className="px-3 py-2 text-slate-800">{s.service}</td>
                      <td className={`px-3 py-2 text-end tabular-nums font-bold ${s.status === 'overdue' ? 'text-red-600' : 'text-amber-600'}`}>
                        {s.remaining != null ? (s.remaining < 0 ? `−${money(Math.abs(s.remaining))}` : money(s.remaining)) : '—'} <span className="text-[10px] font-normal text-slate-600">{s.unit === 'km' ? (ar ? 'كم' : 'km') : s.unit === 'days' ? (ar ? 'يوم' : 'd') : (ar ? 'س' : 'h')}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 tabular-nums">{s.lastServiceAt ? new Date(s.lastServiceAt).toLocaleDateString('en-GB') : '—'}{s.lastServiceKm != null ? ` · ${money(s.lastServiceKm)} ${ar ? 'كم' : 'km'}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Where every figure comes from */}
        <Card icon={<ListChecks className="w-4 h-4 text-[#f37121]" />} title={ar ? 'مصادر الأرقام' : 'Where the figures come from'}>
          <ul className="space-y-2 text-xs">
            {(data?.bySource || []).map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-2">
                <span className="text-slate-800">{MAINTENANCE_SOURCE_LABEL[s.source]?.[ar ? 'ar' : 'en'] || s.source} <span className="text-slate-500">({s.count})</span></span>
                <span className="font-semibold tabular-nums text-slate-900">{money(s.total)} {SAR}</span>
              </li>
            ))}
            {!(data?.bySource || []).length && <li className="text-slate-500">{ar ? 'لا توجد سجلات في هذه الفترة' : 'No entries in this period'}</li>}
          </ul>
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
            <p>{ar ? 'قطع المخزن مسعّرة بسعر الوحدة وقت الصرف: آخر سعر شراء مسجّل قبله، أو سعر الصنف إن لم يوجد شراء.' : 'Store parts are priced at the store unit price when issued: the last purchase recorded before, or the item price when none.'}</p>
            <p className="tabular-nums">{ar ? 'أسطر القطع' : 'Part lines'}: {ar ? 'من السجل' : 'record'} {data?.priceBasis.issue || 0} · {ar ? 'سعر شراء' : 'purchase'} {data?.priceBasis.purchase || 0} · {ar ? 'سعر الصنف' : 'item price'} {data?.priceBasis.item || 0}</p>
            <p>{ar ? 'كل سجل يُحسب مرة واحدة: السجل الدوري يغني عن سجل خدمته وطلب صرفه، والإصلاح المنقول يُقرأ من سجله.' : 'Each event counts once: a periodic record stands for its service log and issue request, a migrated repair for its record.'}</p>
            {(data?.unmatchedIssues.count || 0) > 0 && (
              <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                {ar ? `${data!.unmatchedIssues.count} سطر صرف بقيمة ${money(data!.unmatchedIssues.cost)} ر.س إلى لوحات ليست من الأسطول — غير محسوبة أعلاه.` : `${data!.unmatchedIssues.count} issue lines worth ${money(data!.unmatchedIssues.cost)} SAR went to plates outside the fleet — not counted above.`}
              </p>
            )}
          </div>
        </Card>
      </div>

      {drill && (
        <VehicleDrill row={drill} range={range} type={type} ar={ar} onClose={() => setDrill(null)} onOpenProfile={() => router.push(`/system/ls2/${drill.unitId}`)} />
      )}
    </div>
  );
}
