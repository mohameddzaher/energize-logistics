'use client';
// مؤشرات أداء الموردين — CRM.
//
// Judged on whether we can actually hand them work: كام حمولة شالوا، ومستغلين
// منهم قد إيه، والعقد والأوراق مكتملة ولا لأ، وعندهم كام سيارة، وآخر مرة
// شغّلناهم إمتى.
//
// Volume comes from the Contracts section's monthly utilisation ledger (the
// company's real record of orders given to each carrier) PLUS the shipment-
// orders trial, joined on the Arabic-folded vendor name. Contract state comes
// from the CRM vendor register and the contracts register together.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Store, Search, ChevronDown, ChevronRight, TrendingUp, RefreshCw, Loader2,
  FileCheck, Truck, AlertTriangle, Wallet,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ScoreBadge, ScoreBar, ScoreBreakdown, BandLegend, KpiTile, FlagPill, type ScoreBand, type ScoreBreakdownItem } from '@/components/system/Scorecard';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import DateRangeFilter from '@/components/system/DateRangeFilter';

interface Flag { key: string; ar: string; en: string }
interface VendorKpi {
  _id: string | null; supplierId: string | null; name: string; inCrm: boolean;
  isNewVendor: boolean; energizeRep: string; vendorType: string; representative: string;
  mobile: string; email: string; headOffice: string; destinations: string;
  carsCount: number | null; followUpStatus: string; contractDate: string;
  checks: { hasPapers: boolean; vendorSigned: boolean; ourSigned: boolean; contractDated: boolean };
  contractScore: number;
  loads: number; ledgerLoads: number; trialLoads: number; prevLoads: number; loadGrowthPct: number | null;
  activeMonths: number; monthlyCapacity: number; utilisationPct: number | null; sharePct: number;
  inContracts: boolean;
  cost: number; revenue: number; margin: number; marginPct: number | null;
  avgCostPerLoad: number; routes: string[];
  lastLoad: string | null; daysSinceLastLoad: number | null; loadsPerMonth: number;
  score: number; band: string; bandAr: string; bandEn: string; bandColor: string;
  breakdown: ScoreBreakdownItem[];
  flags: Flag[];
}

interface Payload {
  period: { from: string; to: string; months: number };
  bands: ScoreBand[];
  medianMarginPct: number;
  summary: {
    vendors: number; working: number; idle: number; contractComplete: number;
    totalLoads: number; totalCost: number; totalMargin: number; averageScore: number; totalCars: number;
    underUsed: number;
  };
  items: VendorKpi[];
}

const CRM_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_staff'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CrmVendorKpisPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [q, setQ] = useState('');
  const [band, setBand] = useState('');
  const [onlyWorking, setOnlyWorking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Payload>(`/api/crm/kpis/vendors?from=${from}&to=${to}`));
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    let list = data?.items || [];
    if (band) list = list.filter((v) => v.band === band);
    if (onlyWorking) list = list.filter((v) => v.loads > 0);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((v) => `${v.name} ${v.headOffice} ${v.energizeRep} ${v.mobile} ${v.destinations}`.toLowerCase().includes(s));
    return list;
  }, [data, q, band, onlyWorking]);

  const allowed = user && (CRM_ROLES.includes(user.role) || ['view', 'edit'].includes(user.permissions?.CRM || ''));
  if (!allowed) return <div className="text-slate-500 p-8">{tx('Not authorized', 'غير مصرّح')}</div>;
  if (loading && !data) return <Spinner />;

  const exportColumns: ExportColumn[] = [
    { header: tx('Vendor', 'المورد'), key: 'name', width: 30 },
    { header: tx('Score', 'التقييم'), key: 'score', width: 10 },
    { header: tx('Band', 'التصنيف'), key: ar ? 'bandAr' : 'bandEn', width: 16 },
    { header: tx('Loads', 'الحمولات'), key: 'loads', width: 10 },
    { header: tx('Utilisation %', 'التشغيل من الطاقة %'), key: 'utilisationPct', transform: (v: number | null) => v ?? '—', width: 18 },
    { header: tx('Share %', 'الحصة %'), key: 'sharePct', width: 12 },
    { header: tx('Cost', 'التكلفة'), key: 'cost', transform: (v: number) => v?.toLocaleString(), width: 16 },
    { header: tx('Margin %', 'الهامش %'), key: 'marginPct', transform: (v: number | null) => v ?? '—', width: 12 },
    { header: tx('Contract %', 'اكتمال العقد %'), key: 'contractScore', width: 14 },
    { header: tx('Cars', 'عدد السيارات'), key: 'carsCount', transform: (v: number | null) => v ?? '—', width: 12 },
    { header: tx('Days since last load', 'أيام منذ آخر تشغيل'), key: 'daysSinceLastLoad', transform: (v: number | null) => v ?? '—', width: 20 },
    { header: tx('Rep', 'مندوب تنشيط'), key: 'energizeRep', width: 20 },
    { header: tx('Head office', 'المقر'), key: 'headOffice', width: 18 },
    { header: tx('Mobile', 'الجوال'), key: 'mobile', width: 16 },
  ];
  // التصنيف و«العاملون فقط» والبحث تُصفّي الجدول في المتصفّح بعد جلب الفترة
  // كاملةً، فكان الزرُّ الواحد يصدّر شريحةً مصفّاةً باسم مؤشّرات الموردين كلِّهم.
  const scope = exportScopeLabels(ar);
  const sheetName = tx('Vendor KPIs', 'مؤشرات الموردين');
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: items as unknown as Record<string, unknown>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: (data?.items || []) as unknown as Record<string, unknown>[], columns: exportColumns }] },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Store className="w-5 h-5 text-[#f37121]" />}
        title={tx('Vendor KPIs', 'مؤشرات أداء الموردين')}
        subtitle={tx(
          'Loads carried, capacity utilisation, contract completeness, fleet size and how recently we used them — volume from the contracts monthly ledger plus the shipment-orders trial.',
          'الحمولات المنفَّذة، نسبة التشغيل من الطاقة، اكتمال العقد، حجم الأسطول، وآخر تشغيل — الحجم من سجل التشغيل الشهري في العقود بالإضافة لتجربة طلبات الشحنات.'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter ar={ar} from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-slate-600 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {tx('Refresh', 'تحديث')}
          </button>
          <ExportMenu fileName={`crm-vendor-kpis-${from}_${to}`} lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')} options={exportOptions} />
        </div>
      </PageHeader>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <KpiTile label={tx('Vendors', 'الموردون')} value={data.summary.vendors} icon={<Store className="w-4 h-4" />} />
            <KpiTile label={tx('Working', 'يعملون معنا')} value={data.summary.working} accent="#22c55e" sub={`${data.summary.idle} ${tx('idle', 'متوقف')}`} icon={<Truck className="w-4 h-4" />} />
            <KpiTile label={tx('Contract complete', 'عقد مكتمل')} value={data.summary.contractComplete} accent="#0ea5e9" icon={<FileCheck className="w-4 h-4" />} />
            <KpiTile label={tx('Loads', 'الحمولات')} value={data.summary.totalLoads.toLocaleString()} />
            <KpiTile label={tx('Under-used', 'مستغَل أقل من طاقته')} value={data.summary.underUsed} accent="#f97316" sub={`${tx('cost', 'التكلفة')}: ${data.summary.totalCost.toLocaleString()}`} icon={<Wallet className="w-4 h-4" />} />
            <KpiTile label={tx('Average score', 'متوسط التقييم')} value={data.summary.averageScore} accent="#16a34a" sub={`${data.summary.totalCars.toLocaleString()} ${tx('cars', 'سيارة')}`} icon={<TrendingUp className="w-4 h-4" />} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3">
            <BandLegend bands={data.bands} lang={ar ? 'ar' : 'en'} />
            <span className="text-[11px] text-slate-400">
              {tx('Median margin', 'وسيط الهامش')}: {data.medianMarginPct}%
            </span>
            <div className="flex items-center gap-2 ms-auto">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={onlyWorking} onChange={(e) => setOnlyWorking(e.target.checked)} className="accent-[#f37121]" />
                {tx('Only vendors with loads', 'الموردون الذين نفّذوا حمولات فقط')}
              </label>
              <select value={band} onChange={(e) => setBand(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700">
                <option value="">{tx('All bands', 'كل التصنيفات')}</option>
                {data.bands.map((b) => <option key={b.key} value={b.key}>{ar ? b.ar : b.en}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx('Search vendor…', 'ابحث عن مورد…')}
          className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Vendor', 'المورد')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase w-52">{tx('Score', 'التقييم')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Loads', 'الحمولات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Utilisation', 'التشغيل من الطاقة')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Share', 'الحصة')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Contract', 'العقد')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Cars', 'السيارات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Last load', 'آخر تشغيل')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((v) => {
                const key = v._id || v.supplierId || v.name;
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(isOpen ? null : key)}>
                      <td className="px-3 py-2 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm text-slate-900 font-medium">{v.name}</p>
                        <p className="text-[11px] text-slate-400">{[v.headOffice, v.vendorType, v.energizeRep].filter(Boolean).join(' · ') || '—'}</p>
                        {!!v.flags.length && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {v.flags.map((f) => (
                              <FlagPill key={f.key} label={ar ? f.ar : f.en} tone={f.key === 'contract_gap' ? 'danger' : 'warn'} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ScoreBadge score={v.score} band={ar ? v.bandAr : v.bandEn} color={v.bandColor} size="sm" />
                        <div className="mt-1"><ScoreBar value={v.score} color={v.bandColor} height={4} /></div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">
                        {v.loads}
                        {v.loadGrowthPct != null && (
                          <span className={`text-[10px] ms-1 ${v.loadGrowthPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {v.loadGrowthPct >= 0 ? '+' : ''}{v.loadGrowthPct}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {v.utilisationPct == null ? <span className="text-slate-400">—</span>
                          : <span className={v.utilisationPct >= 60 ? 'text-green-600' : v.utilisationPct >= 25 ? 'text-amber-600' : 'text-red-600'}>{v.utilisationPct}%</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{v.sharePct}%</td>
                      <td className="px-3 py-2 w-24">
                        <span className="text-[11px] text-slate-600 tabular-nums">{v.contractScore}%</span>
                        <ScoreBar value={v.contractScore} color={v.contractScore === 100 ? '#16a34a' : '#f97316'} height={4} />
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{v.carsCount ?? '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-500 tabular-nums">
                        {v.daysSinceLastLoad == null ? '—' : `${v.daysSinceLastLoad} ${tx('d ago', 'يوم')}`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={9} className="px-5 py-4 space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            <Mini label={tx('Loads / month', 'حمولات/شهر')} value={v.loadsPerMonth} />
                            <Mini label={tx('Active months', 'أشهر التشغيل')} value={v.activeMonths} />
                            <Mini label={tx('Monthly capacity', 'الطاقة في الفترة')} value={v.monthlyCapacity.toLocaleString()} />
                            <Mini label={tx('Share of 3PL volume', 'حصته من الحجم')} value={`${v.sharePct}%`} />
                            <Mini label={tx('Avg cost / load', 'متوسط تكلفة الحمولة')} value={v.avgCostPerLoad.toLocaleString()} />
                            <Mini label={tx('Margin', 'الهامش')} value={v.margin.toLocaleString()} />
                            <Mini label={tx('Follow-up', 'حالة المتابعة')} value={v.followUpStatus || '—'} />
                            <Mini label={tx('Contract date', 'تاريخ العقد')} value={v.contractDate || '—'} />
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Check ok={v.checks.hasPapers} label={tx('Papers on file', 'الأوراق متوفرة')} />
                            <Check ok={v.checks.vendorSigned} label={tx('Vendor signed', 'موقّع من المورد')} />
                            <Check ok={v.checks.ourSigned} label={tx('We signed', 'موقّع من طرفنا')} />
                            <Check ok={v.checks.contractDated} label={tx('Contract dated', 'تاريخ العقد مسجّل')} />
                          </div>

                          <ScoreBreakdown items={v.breakdown} lang={ar ? 'ar' : 'en'} color={v.bandColor} />

                          {!!v.routes.length && (
                            <div>
                              <p className="text-slate-700 text-xs font-semibold mb-1.5">{tx('Routes served in period', 'الخطوط المنفَّذة في الفترة')}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {v.routes.map((r, i) => (
                                  <span key={i} className="text-[11px] bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-600">{r}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="text-[11px] text-slate-400">
                            {v.representative && <>{tx('Contact', 'ممثل المورد')}: {v.representative} · </>}
                            {v.mobile && <>{v.mobile} · </>}
                            {v.destinations && <>{tx('Coverage', 'التغطية')}: {v.destinations}</>}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('No vendors match', 'لا يوجد موردون مطابقون')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{label}</p>
      <p className="text-slate-900 text-sm font-bold tabular-nums">{value ?? '—'}</p>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border ${ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {ok ? <FileCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}
