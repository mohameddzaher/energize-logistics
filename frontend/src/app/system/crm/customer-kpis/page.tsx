'use client';
// مؤشرات أداء العملاء — CRM.
//
// One row per CRM company, but the numbers come from five sections at once:
// invoices and payments from finance, loads from إدارة الأسطول, orders from
// طلبات الشحنات, files from التخليص الجمركي, and deals/activities from the CRM
// itself. The backend joins them by the Arabic-folded company name, because
// nothing links those registers by id.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Users, Search, ChevronDown, ChevronRight, TrendingUp, TrendingDown,
  Wallet, AlertTriangle, Package, RefreshCw, Loader2, Ship, Truck, FileText,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ScoreBadge, ScoreBar, ScoreBreakdown, BandLegend, KpiTile, FlagPill, type ScoreBand, type ScoreBreakdownItem } from '@/components/system/Scorecard';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import DateRangeFilter from '@/components/system/DateRangeFilter';

interface Flag { key: string; ar: string; en: string }
interface CustomerKpi {
  _id: string; name: string; arabicName: string; type: string; status: string;
  industry: string; city: string; country: string; phone: string; email: string;
  rating: number; owner: string; tags: string[]; fromOperations: boolean;
  linkedCustomer: string | null; customerNumber: string;
  creditTerm: number | null; creditLimit: number | null;
  grade: string; clientStatus: string; riskLevel: string; isStopped: boolean;
  revenue: number; invoiced: number; collected: number; outstanding: number;
  overdueAmount: number; overdueInvoices: number; invoiceCount: number;
  avgDaysLate: number | null; onTimePaymentRate: number | null; disputes: number;
  shipments: number; fleetTrips: number; shipmentOrders: number; customsJobs: number; containers: number;
  services: string[];
  openDeals: number; openPipeline: number; wonDeals: number; wonValue: number; lostDeals: number; winRate: number | null;
  activities: number; openTasks: number;
  lastTouch: string | null; daysSinceLastTouch: number | null;
  prevRevenue: number; revenueGrowthPct: number | null; shipmentGrowthPct: number | null;
  score: number; band: string; bandAr: string; bandEn: string; bandColor: string;
  breakdown: ScoreBreakdownItem[];
  flags: Flag[];
}

interface Payload {
  period: { from: string; to: string; months: number };
  bands: ScoreBand[];
  summary: {
    customers: number; active: number; dormant: number; averageScore: number;
    totalRevenue: number; totalOutstanding: number; totalOverdue: number;
    totalShipments: number; atRisk: number;
  };
  items: CustomerKpi[];
}

const SERVICE_ICON: Record<string, any> = {
  heavy_transport: Truck,
  shipment_orders: Package,
  customs: Ship,
  finance: FileText,
};
const SERVICE_LABEL: Record<string, { ar: string; en: string }> = {
  heavy_transport: { ar: 'نقل ثقيل', en: 'Heavy transport' },
  shipment_orders: { ar: 'طلبات شحن', en: 'Shipment orders' },
  customs: { ar: 'تخليص جمركي', en: 'Customs' },
  finance: { ar: 'فواتير', en: 'Invoices' },
};

const CRM_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_staff'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CrmCustomerKpisPage() {
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
  const [service, setService] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Payload>(`/api/crm/kpis/customers?from=${from}&to=${to}`));
    } catch { /* keep the last good view */ }
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    let list = data?.items || [];
    if (band) list = list.filter((c) => c.band === band);
    if (service) list = list.filter((c) => c.services.includes(service));
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((c) => `${c.name} ${c.arabicName} ${c.customerNumber} ${c.city} ${c.owner}`.toLowerCase().includes(s));
    return list;
  }, [data, q, band, service]);

  const allowed = user && (CRM_ROLES.includes(user.role) || ['view', 'edit'].includes(user.permissions?.CRM || ''));
  if (!allowed) return <div className="text-slate-500 p-8">{tx('Not authorized', 'غير مصرّح')}</div>;
  if (loading && !data) return <Spinner />;

  const exportColumns: ExportColumn[] = [
    { header: tx('Customer', 'العميل'), key: 'name', width: 30 },
    { header: tx('Score', 'التقييم'), key: 'score', width: 10 },
    { header: tx('Band', 'التصنيف'), key: ar ? 'bandAr' : 'bandEn', width: 16 },
    { header: tx('Revenue', 'الإيرادات'), key: 'revenue', transform: (v: number) => v?.toLocaleString(), width: 16 },
    { header: tx('Outstanding', 'المستحق'), key: 'outstanding', transform: (v: number) => v?.toLocaleString(), width: 16 },
    { header: tx('Overdue', 'المتأخر'), key: 'overdueAmount', transform: (v: number) => v?.toLocaleString(), width: 16 },
    { header: tx('Avg days late', 'متوسط التأخير'), key: 'avgDaysLate', transform: (v: number | null) => v ?? '—', width: 14 },
    { header: tx('Shipments', 'الشحنات'), key: 'shipments', width: 12 },
    { header: tx('Heavy transport', 'نقل ثقيل'), key: 'fleetTrips', width: 12 },
    { header: tx('Shipment orders', 'طلبات شحن'), key: 'shipmentOrders', width: 12 },
    { header: tx('Customs files', 'معاملات تخليص'), key: 'customsJobs', width: 14 },
    { header: tx('Growth %', 'النمو %'), key: 'revenueGrowthPct', transform: (v: number | null) => v ?? '—', width: 12 },
    { header: tx('Days since contact', 'أيام منذ آخر تواصل'), key: 'daysSinceLastTouch', transform: (v: number | null) => v ?? '—', width: 18 },
    { header: tx('Owner', 'المسؤول'), key: 'owner', width: 20 },
  ];
  // التصنيف والخدمة والبحث تُصفّي الجدول في المتصفّح بعد جلب الفترة كاملةً،
  // فكان الزرُّ الواحد يصدّر شريحةً مصفّاةً باسم «مؤشّرات العملاء» بلا تمييز.
  const scope = exportScopeLabels(ar);
  const sheetName = tx('Customer KPIs', 'مؤشرات العملاء');
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: items as unknown as Record<string, unknown>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: (data?.items || []) as unknown as Record<string, unknown>[], columns: exportColumns }] },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Users className="w-5 h-5 text-[#f37121]" />}
        title={tx('Customer KPIs', 'مؤشرات أداء العملاء')}
        subtitle={tx(
          'Revenue, shipping volume, payment discipline, engagement and growth — joined across finance, fleet, shipment orders and customs.',
          'الإيرادات وحجم الشحن وانضباط السداد والتواصل والنمو — مجمّعة من المالية والأسطول وطلبات الشحن والتخليص الجمركي.'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter ar={ar} from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-slate-600 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {tx('Refresh', 'تحديث')}
          </button>
          <ExportMenu fileName={`crm-customer-kpis-${from}_${to}`} lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')} options={exportOptions} />
        </div>
      </PageHeader>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <KpiTile label={tx('Customers', 'العملاء')} value={data.summary.customers} icon={<Users className="w-4 h-4" />} />
            <KpiTile label={tx('Active', 'نشط')} value={data.summary.active} accent="#22c55e" sub={`${data.summary.dormant} ${tx('dormant', 'خامل')}`} />
            <KpiTile label={tx('Average score', 'متوسط التقييم')} value={data.summary.averageScore} accent="#0ea5e9" icon={<TrendingUp className="w-4 h-4" />} />
            <KpiTile label={tx('Revenue', 'الإيرادات')} value={data.summary.totalRevenue.toLocaleString()} accent="#16a34a" icon={<Wallet className="w-4 h-4" />} />
            <KpiTile label={tx('Overdue', 'المتأخرات')} value={data.summary.totalOverdue.toLocaleString()} accent="#ef4444" sub={`${tx('outstanding', 'المستحق')}: ${data.summary.totalOutstanding.toLocaleString()}`} icon={<AlertTriangle className="w-4 h-4" />} />
            <KpiTile label={tx('Need attention', 'يحتاج متابعة')} value={data.summary.atRisk} accent="#f97316" sub={`${data.summary.totalShipments.toLocaleString()} ${tx('shipments', 'شحنة')}`} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3">
            <BandLegend bands={data.bands} lang={ar ? 'ar' : 'en'} />
            <div className="flex items-center gap-2 ms-auto">
              <select value={band} onChange={(e) => setBand(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700">
                <option value="">{tx('All bands', 'كل التصنيفات')}</option>
                {data.bands.map((b) => <option key={b.key} value={b.key}>{ar ? b.ar : b.en}</option>)}
              </select>
              <select value={service} onChange={(e) => setService(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700">
                <option value="">{tx('All services', 'كل الخدمات')}</option>
                {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
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
          placeholder={tx('Search customer…', 'ابحث عن عميل…')}
          className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Customer', 'العميل')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase w-52">{tx('Score', 'التقييم')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Services', 'الخدمات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Revenue', 'الإيرادات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Shipments', 'الشحنات')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Payment', 'السداد')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Growth', 'النمو')}</th>
                <th className="px-3 py-2 text-start text-[11px] text-slate-300 uppercase">{tx('Last contact', 'آخر تواصل')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => {
                const isOpen = open === c._id;
                return (
                  <Fragment key={c._id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(isOpen ? null : c._id)}>
                      <td className="px-3 py-2 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm text-slate-900 font-medium">{c.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {[c.city, c.customerNumber, c.owner].filter(Boolean).join(' · ') || '—'}
                        </p>
                        {!!c.flags.length && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.flags.map((f) => (
                              <FlagPill key={f.key} label={ar ? f.ar : f.en} tone={f.key === 'stopped' || f.key === 'overdue' ? 'danger' : 'warn'} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ScoreBadge score={c.score} band={ar ? c.bandAr : c.bandEn} color={c.bandColor} size="sm" />
                        <div className="mt-1"><ScoreBar value={c.score} color={c.bandColor} height={4} /></div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {c.services.map((s) => {
                            const Icon = SERVICE_ICON[s];
                            if (!Icon) return null;
                            return (
                              <span key={s} title={ar ? SERVICE_LABEL[s]?.ar : SERVICE_LABEL[s]?.en} className="w-6 h-6 rounded bg-slate-100 text-slate-600 flex items-center justify-center">
                                <Icon className="w-3.5 h-3.5" />
                              </span>
                            );
                          })}
                          {!c.services.length && <span className="text-slate-300 text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{c.revenue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 tabular-nums">{c.shipments}</td>
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {c.avgDaysLate == null ? <span className="text-slate-400">—</span>
                          : <span className={c.avgDaysLate <= 0 ? 'text-green-600' : c.avgDaysLate <= 15 ? 'text-amber-600' : 'text-red-600'}>
                            {c.avgDaysLate > 0 ? `+${c.avgDaysLate}` : c.avgDaysLate} {tx('d', 'يوم')}
                          </span>}
                      </td>
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {c.revenueGrowthPct == null ? <span className="text-slate-400">—</span>
                          : <span className={`inline-flex items-center gap-0.5 ${c.revenueGrowthPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {c.revenueGrowthPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {c.revenueGrowthPct}%
                          </span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-500 tabular-nums">
                        {c.daysSinceLastTouch == null ? '—' : `${c.daysSinceLastTouch} ${tx('d ago', 'يوم')}`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={9} className="px-5 py-4 space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                            <Mini label={tx('Invoiced', 'مفوتر')} value={c.invoiced.toLocaleString()} />
                            <Mini label={tx('Collected', 'محصّل')} value={c.collected.toLocaleString()} />
                            <Mini label={tx('Outstanding', 'مستحق')} value={c.outstanding.toLocaleString()} />
                            <Mini label={tx('Overdue', 'متأخر')} value={c.overdueAmount.toLocaleString()} />
                            <Mini label={tx('Heavy transport', 'نقل ثقيل')} value={c.fleetTrips} />
                            <Mini label={tx('Shipment orders', 'طلبات شحن')} value={c.shipmentOrders} />
                            <Mini label={tx('Customs', 'تخليص')} value={`${c.customsJobs} (${c.containers})`} />
                            <Mini label={tx('Open deals', 'صفقات مفتوحة')} value={`${c.openDeals} · ${c.openPipeline.toLocaleString()}`} />
                          </div>
                          <ScoreBreakdown items={c.breakdown} lang={ar ? 'ar' : 'en'} color={c.bandColor} />
                          <p className="text-[11px] text-slate-400">
                            {c.creditTerm != null && <>{tx('Credit term', 'مدة الائتمان')}: {c.creditTerm} {tx('days', 'يوم')} · </>}
                            {c.grade && <>{tx('Grade', 'الفئة')}: {c.grade} · </>}
                            {c.winRate != null && <>{tx('Win rate', 'نسبة الفوز')}: {c.winRate}% · </>}
                            {tx('Activities', 'أنشطة')}: {c.activities} · {tx('Open tasks', 'مهام مفتوحة')}: {c.openTasks}
                            {c.disputes > 0 && <> · {tx('Disputes', 'نزاعات')}: {c.disputes}</>}
                          </p>
                          <a href={`/system/crm/companies/${c._id}`} className="inline-block text-[#f37121] text-xs hover:underline">
                            {tx('Open company profile →', 'فتح ملف الشركة ←')}
                          </a>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!items.length && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">{tx('No customers match', 'لا يوجد عملاء مطابقون')}</td></tr>
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
