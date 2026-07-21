'use client';
// LS2 Drivers — who drove what, and how far. Each day's distance for a truck is
// credited to whoever was assigned to it that day, so a driver's km stays honest
// even when they switch trucks. Each row downloads a full PDF driver report.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { UserSquare, Search, FileDown, Loader2, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import RangePicker from '@/components/ls2/RangePicker';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ls2Text, isLs2Staff, fmtNum, thisMonthToDate, type Lang, type DateRange } from '@/lib/ls2';
import { downloadDriverReport } from '@/lib/driverReport';

interface DriverRow {
  driver: string;
  km: number;
  activeDays: number;
  vehicleCount: number;
  vehicles: { unitId: number; plate: string; km: number }[];
  currentVehicle: { unitId: number; plate: string } | null;
}

export default function Ls2DriversPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [items, setItems] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(thisMonthToDate());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pdfBusy, setPdfBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: DriverRow[] }>(`/api/ls2/drivers?from=${range.from}&to=${range.to}`);
      setItems(r.items || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((d) => `${d.driver} ${d.currentVehicle?.plate || ''}`.toLowerCase().includes(s));
  }, [items, q]);

  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const downloadPdf = async (name: string) => {
    setPdfBusy(name);
    try { await downloadDriverReport(name, range.from, range.to, lang as Lang); }
    catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setPdfBusy('');
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const totalKm = filtered.reduce((s, d) => s + (d.km || 0), 0);

  const exportColumns: ExportColumn[] = [
    { header: tx('Driver', 'السائق'), key: 'driver', width: 26 },
    { header: tx('Distance in period (km)', 'المسافة في الفترة (كم)'), key: 'km', transform: (v) => Math.round(v || 0), width: 20 },
    { header: tx('Active days', 'أيام نشطة'), key: 'activeDays', transform: (v) => v || 0, width: 12 },
    { header: tx('Trucks driven', 'عدد المركبات'), key: 'vehicleCount', transform: (v) => v || 0, width: 14 },
    { header: tx('Current truck', 'المركبة الحالية'), key: 'currentVehicle', transform: (v) => v?.plate || '—', width: 16 },
    { header: tx('Trucks (km each)', 'المركبات (كم لكل مركبة)'), key: 'vehicles', transform: (v: DriverRow['vehicles']) => (v || []).map((x) => `${x.plate || x.unitId}: ${Math.round(x.km || 0)}`).join(' | ') || '—', width: 50 },
  ];
  const exportSheet = (rows: DriverRow[]) => [{ name: `${range.from} → ${range.to}`, rows: rows as unknown as Record<string, any>[], columns: exportColumns }];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<UserSquare className="w-5 h-5" />}
        title={tx('Drivers', 'السواقين')}
        subtitle={`${filtered.length} ${tx('drivers', 'سائق')} · ${fmtNum(Math.round(totalKm))} ${t.km}`}
      >
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {t.refresh}
        </button>
        <ExportMenu
          fileName="ls2-drivers"
          lang={lang as Lang}
          options={[
            { key: 'all', label: tx('All drivers', 'كل السواقين'), sheets: exportSheet(items) },
            { key: 'filtered', label: tx('Current filtered results', 'النتائج الحالية (بعد الفلتر)'), sheets: exportSheet(filtered) },
          ]}
        />
      </PageHeader>

      <RangePicker value={range} onChange={setRange} lang={lang as Lang} labelFrom={t.from} labelTo={t.to} />

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div className="relative">
          <Search className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400`} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search driver or plate…', 'بحث بالسائق أو اللوحة…')}
            className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2 rounded-lg border border-slate-200 text-sm`} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="px-3 py-3 w-8" />
                <th className="text-start font-semibold px-4 py-3">{tx('Driver', 'السائق')}</th>
                <th className="text-start font-semibold px-4 py-3">{tx('Current Truck', 'المركبة الحالية')}</th>
                <th className="text-end font-semibold px-4 py-3 text-[#f9a06b]">{tx('Distance in period', 'المسافة في الفترة')}</th>
                <th className="text-center font-semibold px-4 py-3">{tx('Trucks', 'عدد المركبات')}</th>
                <th className="text-end font-semibold px-4 py-3">{tx('Report', 'التقرير')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const isOpen = open.has(d.driver);
                return (
                  <Fragment key={d.driver}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(d.driver)}>
                      <td className="px-3 py-3 text-slate-700">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{d.driver}</td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                        {d.currentVehicle ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/system/ls2/${d.currentVehicle!.unitId}`); }} className="text-[#f37121] hover:underline">
                            {d.currentVehicle.plate}
                          </button>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums font-semibold text-slate-800">{fmtNum(Math.round(d.km))}</td>
                      <td className="px-4 py-3 text-center text-slate-800">{d.vehicleCount || '—'}</td>
                      <td className="px-4 py-3 text-end">
                        <button type="button" onClick={(e) => { e.stopPropagation(); downloadPdf(d.driver); }} disabled={pdfBusy === d.driver}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-slate-600 text-xs disabled:opacity-60">
                          {pdfBusy === d.driver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60 border-b border-slate-100">
                        <td colSpan={6} className="px-6 py-3">
                          {d.vehicles.length ? (
                            <div className="flex flex-wrap gap-2">
                              {d.vehicles.map((v) => (
                                <span key={v.unitId} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs">
                                  <span className="font-medium text-slate-700">{v.plate || v.unitId}</span>
                                  <span className="text-slate-700"> · {fmtNum(Math.round(v.km))} {t.km}</span>
                                </span>
                              ))}
                            </div>
                          ) : <p className="text-xs text-slate-700">{tx('No distance in this period.', 'لا توجد مسافة في هذه الفترة.')}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={6} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
