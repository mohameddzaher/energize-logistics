'use client';
// Maintenance analytics for the heavy-transport fleet: cost split (parts / labour / towing), cost per maintenance type,
// vehicle ranking, tyre consumption and the trend over time, all from /api/ls2/maintenance/analytics with the page filters.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, RefreshCw, Package, Wrench, Truck, Wallet, CircleDot, Info } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import SearchSelect from '@/components/ls2/SearchSelect';
import ExportMenu from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { isLs2Staff, lastNDays, MAINTENANCE_TYPES, maintenanceTypeLabel, type DateRange, type Lang } from '@/lib/ls2';

type Bucket = { count: number; parts: number; labour: number; towing: number; total: number };
type Analytics = {
  totals: Bucket;
  byType: (Bucket & { type: string; typeAr: string })[];
  byVehicle: (Bucket & { unitId: number; plate: string; driver: string; byType: Record<string, number> })[];
  trend: ({ bucket: string; parts: number; labour: number; towing: number; total: number } & Record<string, number | string>)[];
  granularity: 'day' | 'month';
  topParts: { item: string; name: string; unit: string; isTire: boolean; quantity: number; cost: number; records: number }[];
  tires: { storeQty: number; storeCost: number; fitted: number; scrapped: number; byVehicle: { plate: string; storeQty: number; storeCost: number; fitted: number; scrapped: number }[] };
  legacy: { services: { count: number; cost: number }; repairs: { count: number; cost: number } };
  vehicles: { unitId: number; plate: string }[];
};

// Cost buckets; validated as a categorical set (dataviz validator, light surface).
const COST = { parts: '#0369a1', labour: '#7c3aed', towing: '#d97706' };
const money = (n?: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

function Kpi({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}1a`, color }}>{icon}</span>
        {label}
      </div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums mt-2">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function MaintenanceAnalyticsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const [range, setRange] = useState<DateRange>(lastNDays(180));
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState('');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
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
  useSocket('ls2:updated', useCallback((d: any) => { if (!d?.vehicles) load(); }, [load]));

  const t = data?.totals;
  const share = (n?: number) => (t && t.total > 0 ? `${Math.round(((n || 0) / t.total) * 100)}%` : '—');
  const typeRows = useMemo(() => (data?.byType || []).map((b) => ({ ...b, label: maintenanceTypeLabel(b.type, lang as Lang) })), [data, lang]);
  const ranking = (data?.byVehicle || []).slice(0, 15);

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح' : 'Not authorized'}</div>;
  if (loading && !data) return <Spinner />;

  const tooltipFmt = (v: any) => `${money(Number(v))} ${ar ? 'ر.س' : 'SAR'}`;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'} data-dash>
      <PageHeader icon={<BarChart3 className="w-5 h-5" />} title={ar ? 'تحليلات الصيانة' : 'Maintenance analytics'}
        subtitle={ar ? 'تكاليف صيانة أسطول النقل الثقيل حسب النوع والمركبة' : 'Heavy-transport maintenance cost by type and vehicle'}>
        <ExportMenu
          fileName="ls2-maintenance-analytics" lang={lang as Lang}
          options={[{
            key: 'all', label: ar ? 'كل الجداول' : 'All tables',
            sheets: [
              { name: ar ? 'حسب المركبة' : 'By vehicle', rows: data?.byVehicle || [], columns: [
                { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
                { header: ar ? 'عدد السجلات' : 'Records', key: 'count', width: 10 },
                { header: ar ? 'قطع الغيار' : 'Parts', key: 'parts', width: 12 },
                { header: ar ? 'العمالة' : 'Labour', key: 'labour', width: 12 },
                { header: ar ? 'السحب' : 'Towing', key: 'towing', width: 12 },
                { header: ar ? 'الإجمالي' : 'Total', key: 'total', width: 12 },
              ] },
              { name: ar ? 'حسب النوع' : 'By type', rows: typeRows, columns: [
                { header: ar ? 'النوع' : 'Type', key: 'label', width: 20 },
                { header: ar ? 'عدد السجلات' : 'Records', key: 'count', width: 10 },
                { header: ar ? 'قطع الغيار' : 'Parts', key: 'parts', width: 12 },
                { header: ar ? 'العمالة' : 'Labour', key: 'labour', width: 12 },
                { header: ar ? 'السحب' : 'Towing', key: 'towing', width: 12 },
                { header: ar ? 'الإجمالي' : 'Total', key: 'total', width: 12 },
              ] },
              { name: ar ? 'القطع الأكثر استهلاكًا' : 'Top parts', rows: data?.topParts || [], columns: [
                { header: ar ? 'الصنف' : 'Item', key: 'name', width: 26 },
                { header: ar ? 'الكمية' : 'Qty', key: 'quantity', width: 10 },
                { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 10 },
                { header: ar ? 'التكلفة' : 'Cost', key: 'cost', width: 12 },
              ] },
            ],
          }]}
        />
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {ar ? 'تحديث' : 'Refresh'}
        </button>
      </PageHeader>

      {/* Filters in one row above the charts */}
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="flex-1"><RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={ar ? 'من' : 'From'} labelTo={ar ? 'إلى' : 'To'} /></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
          <SearchSelect
            value={unitId} onChange={setUnitId} ar={ar} isRTL={isRTL} className="w-48"
            options={(data?.vehicles || []).map((v) => ({ value: String(v.unitId), label: v.plate }))}
            placeholder={ar ? 'كل المركبات' : 'All vehicles'} emptyLabel={ar ? 'كل المركبات' : 'All vehicles'}
            searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
          />
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {MAINTENANCE_TYPES.map((m) => <option key={m.key} value={m.key}>{ar ? m.ar : m.en}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Wallet className="w-4 h-4" />} color="#f37121" label={ar ? 'إجمالي تكلفة الصيانة' : 'Total maintenance cost'} value={`${money(t?.total)} ${ar ? 'ر.س' : 'SAR'}`} sub={`${t?.count || 0} ${ar ? 'سجل' : 'records'}`} />
        <Kpi icon={<Package className="w-4 h-4" />} color={COST.parts} label={ar ? 'قطع الغيار' : 'Spare parts'} value={money(t?.parts)} sub={`${share(t?.parts)} ${ar ? 'من الإجمالي' : 'of total'}`} />
        <Kpi icon={<Wrench className="w-4 h-4" />} color={COST.labour} label={ar ? 'العمالة' : 'Labour'} value={money(t?.labour)} sub={`${share(t?.labour)} ${ar ? 'من الإجمالي' : 'of total'}`} />
        <Kpi icon={<Truck className="w-4 h-4" />} color={COST.towing} label={ar ? 'السحب' : 'Towing'} value={money(t?.towing)} sub={`${share(t?.towing)} ${ar ? 'من الإجمالي' : 'of total'}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={ar ? 'التكلفة حسب نوع الصيانة' : 'Cost by maintenance type'}>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeRows} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} />
                <Tooltip formatter={tooltipFmt} cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="parts" stackId="c" name={ar ? 'قطع الغيار' : 'Parts'} fill={COST.parts} stroke="#fff" strokeWidth={2} />
                <Bar dataKey="labour" stackId="c" name={ar ? 'العمالة' : 'Labour'} fill={COST.labour} stroke="#fff" strokeWidth={2} />
                <Bar dataKey="towing" stackId="c" name={ar ? 'السحب' : 'Towing'} fill={COST.towing} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {typeRows.map((b) => (
              <div key={b.type} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">{b.label}</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">{money(b.total)}</p>
                <p className="text-[10px] text-slate-500">{b.count} {ar ? 'سجل' : 'records'}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title={ar ? `الاتجاه عبر الزمن (${data?.granularity === 'day' ? 'يومي' : 'شهري'})` : `Trend over time (${data?.granularity === 'day' ? 'daily' : 'monthly'})`}>
          <div className="h-[19rem]" dir="ltr">
            {(data?.trend || []).length === 0 ? (
              <p className="text-sm text-slate-400 text-center pt-24">{ar ? 'لا توجد سجلات في هذه الفترة' : 'No records in this period'}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.trend || []} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} />
                  <Tooltip formatter={tooltipFmt} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {MAINTENANCE_TYPES.map((m, i) => (
                    <Bar key={m.key} dataKey={m.key} stackId="t" name={ar ? m.ar : m.en} fill={m.bar} stroke="#fff" strokeWidth={2}
                      radius={i === MAINTENANCE_TYPES.length - 1 ? [4, 4, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Card title={ar ? 'ترتيب المركبات حسب تكلفة الصيانة' : 'Vehicles ranked by maintenance cost'}>
            {ranking.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">{ar ? 'لا توجد بيانات' : 'No data'}</p> : (
              <ScrollX>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-900 text-slate-300">
                    <th className="text-start font-semibold px-3 py-2">#</th>
                    <th className="text-start font-semibold px-3 py-2">{ar ? 'اللوحة' : 'Plate'}</th>
                    <th className="text-end font-semibold px-3 py-2">{ar ? 'السجلات' : 'Records'}</th>
                    <th className="text-end font-semibold px-3 py-2">{ar ? 'قطع' : 'Parts'}</th>
                    <th className="text-end font-semibold px-3 py-2">{ar ? 'عمالة' : 'Labour'}</th>
                    <th className="text-end font-semibold px-3 py-2">{ar ? 'سحب' : 'Towing'}</th>
                    <th className="text-start font-semibold px-3 py-2 w-1/3">{ar ? 'الإجمالي' : 'Total'}</th>
                  </tr></thead>
                  <tbody>
                    {ranking.map((v, i) => {
                      const max = ranking[0].total || 1;
                      return (
                        <tr key={v.unitId} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/ls2/${v.unitId}`)}>
                          <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{v.plate}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-slate-700">{v.count}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-slate-700">{money(v.parts)}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-slate-700">{money(v.labour)}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-slate-700">{money(v.towing)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden flex" title={`${money(v.total)}`}>
                                <div style={{ width: `${(v.parts / max) * 100}%`, background: COST.parts }} />
                                <div style={{ width: `${(v.labour / max) * 100}%`, background: COST.labour }} />
                                <div style={{ width: `${(v.towing / max) * 100}%`, background: COST.towing }} />
                              </div>
                              <span className="font-bold tabular-nums text-slate-900 w-20 text-end">{money(v.total)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollX>
            )}
          </Card>
        </div>

        <Card title={ar ? 'استهلاك الكاوتشات' : 'Tyre consumption'} right={<CircleDot className="w-4 h-4 text-slate-400" />}>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <p className="text-[11px] text-slate-500">{ar ? 'مصروف من المخزن' : 'Issued from store'}</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{data?.tires.storeQty || 0}</p>
              <p className="text-[10px] text-slate-500">{money(data?.tires.storeCost)} {ar ? 'ر.س' : 'SAR'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <p className="text-[11px] text-slate-500">{ar ? 'مركّبة (سجل الكاوتشات)' : 'Fitted (tyre registry)'}</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{data?.tires.fitted || 0}</p>
              <p className="text-[10px] text-slate-500">{ar ? 'تالفة/مستبعدة' : 'Scrapped'}: {data?.tires.scrapped || 0}</p>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-slate-100">
                <th className="text-start font-semibold py-1.5">{ar ? 'اللوحة' : 'Plate'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'من المخزن' : 'Store'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'مركّبة' : 'Fitted'}</th>
                <th className="text-end font-semibold py-1.5">{ar ? 'تالفة' : 'Scrapped'}</th>
              </tr></thead>
              <tbody>
                {(data?.tires.byVehicle || []).map((r) => (
                  <tr key={r.plate} className="border-b border-slate-50">
                    <td className="py-1.5 text-slate-800">{r.plate}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.storeQty}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.fitted}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.scrapped}</td>
                  </tr>
                ))}
                {(data?.tires.byVehicle || []).length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-6">{ar ? 'لا يوجد استهلاك في هذه الفترة' : 'No consumption in this period'}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title={ar ? 'قطع الغيار الأكثر استهلاكًا' : 'Most consumed spare parts'}>
        {(data?.topParts || []).length === 0 ? <p className="text-sm text-slate-400 text-center py-6">{ar ? 'لا توجد قطع مصروفة في هذه الفترة' : 'No parts issued in this period'}</p> : (
          <ScrollX>
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-900 text-slate-300">
                <th className="text-start font-semibold px-3 py-2">{ar ? 'الصنف' : 'Item'}</th>
                <th className="text-end font-semibold px-3 py-2">{ar ? 'الكمية' : 'Qty'}</th>
                <th className="text-end font-semibold px-3 py-2">{ar ? 'عدد السجلات' : 'Records'}</th>
                <th className="text-end font-semibold px-3 py-2">{ar ? 'التكلفة' : 'Cost'}</th>
              </tr></thead>
              <tbody>
                {(data?.topParts || []).map((p) => (
                  <tr key={p.item} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{p.name}{p.isTire && <span className="ms-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px]">{ar ? 'كاوتش' : 'tyre'}</span>}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.quantity} {p.unit}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{p.records}</td>
                    <td className="px-3 py-2 text-end tabular-nums font-semibold">{money(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
      </Card>

      {data && (data.legacy.services.count > 0 || data.legacy.repairs.count > 0) && (
        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p>
            {ar
              ? `سجلات سابقة بتكلفة إجمالية غير مفصّلة (غير محسوبة أعلاه): ${data.legacy.services.count} صيانة دورية بقيمة ${money(data.legacy.services.cost)} ر.س، و${data.legacy.repairs.count} إصلاح استثنائي بقيمة ${money(data.legacy.repairs.cost)} ر.س.`
              : `Older records with one undivided cost (not counted above): ${data.legacy.services.count} periodic services worth ${money(data.legacy.services.cost)} SAR and ${data.legacy.repairs.count} exceptional repairs worth ${money(data.legacy.repairs.cost)} SAR.`}
          </p>
        </div>
      )}
    </div>
  );
}
