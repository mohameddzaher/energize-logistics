'use client';
/**
 * The complete customer file (backend services/customerFile): one customer across every section, for top management.
 * Section pages stay scoped to their own data; this page is the only place everything meets, money included.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Building2, Truck, Ship, Wallet, FileSignature, ClipboardList, KeyRound, LayoutDashboard, Phone, Mail, MapPin, ExternalLink, Route,
} from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { Spinner, ErrorNotice } from '@/components/hr/HRKit';
import { KpiTile } from '@/components/system/Scorecard';
import ExportMenu, { type ExportColumn, type ExportSheet } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { customsStageText, type Lang } from '@/lib/portal';

type Row = Record<string, any>;
interface FileData {
  master: Row; names: string[]; places: { reg: string; ar: string; href: string; id: string }[];
  summary: Row; collections: Row | null; contract: Row | null;
  orders: Row[]; platform: Row[]; loads: Row[]; customs: Row[]; invoices: Row[]; requests: Row[]; deals: Row[]; activities: Row[]; accounts: Row[];
}
type Tab = 'overview' | 'shipments' | 'fleet' | 'customs' | 'collections' | 'sales' | 'contract' | 'portal';

const money = (v: any) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const day = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const CUSTOMS_STATE: Record<string, { ar: string; en: string; cls: string }> = {
  open: { ar: 'مفتوحة', en: 'Open', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  upcoming: { ar: 'قادمة', en: 'Upcoming', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  closedInvoiced: { ar: 'مغلقة ومفوترة', en: 'Closed, invoiced', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  closedNotInvoiced: { ar: 'مغلقة لم تُفوتَر', en: 'Closed, not invoiced', cls: 'bg-red-50 text-red-700 ring-red-200' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

function Table({ cols, rows, empty }: { cols: { key: string; label: string; num?: boolean; render?: (r: Row) => ReactNode }[]; rows: Row[]; empty: string }) {
  if (!rows.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{empty}</div>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <ScrollX>
        <table className="w-full text-sm">
          <thead><tr>{cols.map((c) => <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.num ? 'text-center' : 'text-start'}`}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 300).map((r, i) => (
              <tr key={r._id || i} className="hover:bg-slate-50/70">
                {cols.map((c) => <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.num ? 'text-center tabular-nums' : ''}`}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      {rows.length > 300 && <p className="border-t border-slate-100 px-3 py-2 text-[12px] text-slate-500">{rows.length} — 300 shown; export for all</p>}
    </div>
  );
}

export default function CustomerFullFile({ id, reg }: { id: string; reg?: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [d, setD] = useState<FileData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const load = useCallback(async () => {
    try { setD(await api.get<FileData>(`/api/customer-hub/file/${id}${reg ? `?reg=${reg}` : ''}`)); setError(''); }
    catch (e: any) { setError(e?.message || 'Error'); }
  }, [id, reg]);
  useEffect(() => { load(); }, [load]);
  useSocket('customers:changed', load);

  // Every table of the file, once: the tabs and the Excel export read the same definitions.
  const T = useMemo(() => {
    const L = (a: string, e: string) => (ar ? a : e);
    return {
      orders: [
        { key: 'waybillNumber', label: L('رقم البوليصة', 'Waybill'), num: true },
        { key: 'date', label: L('التاريخ', 'Date'), render: (r: Row) => day(r.pickupTime || r.createdAt), x: (r: Row) => day(r.pickupTime || r.createdAt) },
        { key: 'route', label: L('المسار', 'Route'), render: (r: Row) => `${r.fromCity || ''} ← ${r.toCity || ''}`, x: (r: Row) => `${r.fromCity || ''} - ${r.toCity || ''}` },
        { key: 'status', label: L('الحالة', 'Status') },
        { key: 'supplierName', label: L('المورّد', 'Carrier') },
        { key: 'sellPrice', label: L('البيع', 'Sell'), num: true, render: (r: Row) => money(r.sellPrice) },
        { key: 'buyPrice', label: L('الشراء', 'Buy'), num: true, render: (r: Row) => money(r.buyPrice) },
        { key: 'clearance', label: L('معاملة التخليص', 'Clearance'), render: (r: Row) => r.customsLink?.refNumber || '—', x: (r: Row) => r.customsLink?.refNumber || '' },
      ],
      platform: [
        { key: 'reportNumber', label: L('رقم البيان', 'Manifest'), num: true },
        { key: 'reportDate', label: L('التاريخ', 'Date'), render: (r: Row) => day(r.reportDate), x: (r: Row) => day(r.reportDate) },
        { key: 'route', label: L('المسار', 'Route'), render: (r: Row) => `${r.fromLocation || ''} ← ${r.toLocation || ''}`, x: (r: Row) => `${r.fromLocation || ''} - ${r.toLocation || ''}` },
        { key: 'applicationStatus', label: L('الحالة', 'Status') },
        { key: 'sellingValue', label: L('البيع', 'Sell'), num: true, render: (r: Row) => money(r.sellingValue) },
        { key: 'totalInvoice', label: L('الفاتورة', 'Invoice total'), num: true, render: (r: Row) => money(r.totalInvoice) },
        { key: 'invoiceNumber', label: L('رقم الفاتورة', 'Invoice no.') },
        { key: 'collectedAmount', label: L('المُحصَّل', 'Collected'), num: true, render: (r: Row) => money(r.collectedAmount) },
      ],
      loads: [
        { key: 'waybillNumber', label: L('رقم البوليصة', 'Waybill'), num: true },
        { key: 'loadDate', label: L('التاريخ', 'Date'), render: (r: Row) => day(r.loadDate || r.createdAt), x: (r: Row) => day(r.loadDate || r.createdAt) },
        { key: 'route', label: L('المسار', 'Route'), render: (r: Row) => `${r.fromCity || ''} ← ${r.toCity || ''}`, x: (r: Row) => `${r.fromCity || ''} - ${r.toCity || ''}` },
        { key: 'vehiclePlate', label: L('اللوحة', 'Plate') },
        { key: 'driverName', label: L('السائق', 'Driver') },
        { key: 'status', label: L('الحالة', 'Status') },
        { key: 'price', label: L('الدخل', 'Income'), num: true, render: (r: Row) => money(r.price) },
      ],
      customs: [
        { key: 'refNumber', label: L('المرجع', 'Reference') },
        { key: 'blNumber', label: L('البوليصة', 'BL') },
        { key: 'state', label: L('الحالة', 'State'), render: (r: Row) => { const s = CUSTOMS_STATE[r.state] || CUSTOMS_STATE.open; return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${s.cls}`}>{ar ? s.ar : s.en}</span>; }, x: (r: Row) => (CUSTOMS_STATE[r.state] || CUSTOMS_STATE.open).ar },
        { key: 'stage', label: L('المرحلة', 'Stage'), render: (r: Row) => customsStageText(r.stage, lang as Lang), x: (r: Row) => customsStageText(r.stage, 'ar' as Lang) },
        { key: 'containerCount', label: L('الوحدات', 'Units'), num: true },
        { key: 'createdAt', label: L('الفتح', 'Opened'), render: (r: Row) => day(r.createdAt), x: (r: Row) => day(r.createdAt) },
        { key: 'revenue', label: L('الإيراد', 'Revenue'), num: true, render: (r: Row) => money(r.revenue) },
        { key: 'cost', label: L('التكلفة', 'Cost'), num: true, render: (r: Row) => money(r.cost) },
        { key: 'profit', label: L('الربح', 'Profit'), num: true, render: (r: Row) => <span className={r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{money(r.profit)}</span>, x: (r: Row) => r.profit },
      ],
      invoices: [
        { key: 'invoiceNumber', label: L('رقم الفاتورة', 'Invoice') },
        { key: 'invoiceDate', label: L('تاريخ الفاتورة', 'Date'), render: (r: Row) => day(r.invoiceDate), x: (r: Row) => day(r.invoiceDate) },
        { key: 'deliveryDate', label: L('تسليم الفاتورة', 'Delivered'), render: (r: Row) => day(r.deliveryDate), x: (r: Row) => day(r.deliveryDate) },
        { key: 'total', label: L('الإجمالي', 'Total'), num: true, render: (r: Row) => money(r.total) },
        { key: 'collectedAmount', label: L('المُحصَّل', 'Collected'), num: true, render: (r: Row) => money(r.collectedAmount) },
        { key: 'remaining', label: L('المتبقّي', 'Remaining'), num: true, render: (r: Row) => money((r.total || 0) - (r.collectedAmount || 0)), x: (r: Row) => (r.total || 0) - (r.collectedAmount || 0) },
        { key: 'status', label: L('الحالة', 'Status') },
      ],
      requests: [
        { key: 'number', label: L('رقم الطلب', 'Request'), num: true },
        { key: 'createdAt', label: L('التاريخ', 'Date'), render: (r: Row) => day(r.createdAt), x: (r: Row) => day(r.createdAt) },
        { key: 'route', label: L('المسار', 'Route'), render: (r: Row) => `${r.fromCity || ''} ← ${r.toCity || ''}`, x: (r: Row) => `${r.fromCity || ''} - ${r.toCity || ''}` },
        { key: 'trucks', label: L('الشاحنات', 'Trucks'), num: true, render: (r: Row) => `${(r.placed || []).length}/${r.trucks || 0}`, x: (r: Row) => `${(r.placed || []).length}/${r.trucks || 0}` },
        { key: 'status', label: L('الحالة', 'Status') },
        { key: 'salesRepName', label: L('السيلز', 'Sales rep') },
      ],
      deals: [
        { key: 'title', label: L('الصفقة', 'Deal') },
        { key: 'stage', label: L('المرحلة', 'Stage') },
        { key: 'value', label: L('القيمة', 'Value'), num: true, render: (r: Row) => money(r.value) },
        { key: 'expectedCloseDate', label: L('الإغلاق المتوقّع', 'Expected close'), render: (r: Row) => day(r.expectedCloseDate), x: (r: Row) => day(r.expectedCloseDate) },
      ],
    } as Record<string, { key: string; label: string; num?: boolean; render?: (r: Row) => ReactNode; x?: (r: Row) => any }[]>;
  }, [ar, lang]);

  if (error) return <ErrorNotice error={error} lang={ar ? "ar" : "en"} />;
  if (!d) return <Spinner />;
  const m = d.master; const s = d.summary;

  const sheet = (name: string, rows: Row[], key: string): ExportSheet => ({
    name, rows, columns: T[key].map((c): ExportColumn => ({ header: c.label, key: c.key, transform: (_v: any, r: Row) => (c.x ? c.x(r) : r[c.key]), type: c.num ? 'number' : 'text' })),
  });
  const allSheets = [
    { name: t('الملخّص', 'Summary'), rows: [
      [t('العميل', 'Customer'), m.name], [t('الكود', 'Code'), m.code], [t('أوامر النقل', 'Transport orders'), s.orders], [t('بيانات المنصّة', 'Platform manifests'), s.platform],
      [t('حمولات الأسطول', 'Fleet loads'), s.loads], [t('معاملات التخليص', 'Clearances'), s.clearances], [t('المفوتَر', 'Invoiced'), s.invoiced], [t('المُحصَّل', 'Collected'), s.collected], [t('المتبقّي', 'Outstanding'), s.outstanding],
    ].map(([k, v]) => ({ k, v })), columns: [{ header: t('البند', 'Item'), key: 'k', width: 30 }, { header: t('القيمة', 'Value'), key: 'v', width: 30 }] as ExportColumn[] },
    sheet(t('أوامر النقل', 'Orders'), d.orders, 'orders'), sheet(t('بيانات المنصّة', 'Platform'), d.platform, 'platform'),
    sheet(t('الأسطول', 'Fleet'), d.loads, 'loads'), sheet(t('التخليص', 'Customs'), d.customs, 'customs'),
    sheet(t('الفواتير', 'Invoices'), d.invoices, 'invoices'), sheet(t('طلبات الشحن', 'Requests'), d.requests, 'requests'), sheet(t('الصفقات', 'Deals'), d.deals, 'deals'),
  ];

  const TABS: { key: Tab; ar: string; en: string; icon: ReactNode; n?: number }[] = [
    { key: 'overview', ar: 'نظرة عامة', en: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: 'shipments', ar: 'الشحنات', en: 'Shipments', icon: <Route className="h-4 w-4" />, n: s.orders + s.platform },
    { key: 'fleet', ar: 'الأسطول', en: 'Fleet', icon: <Truck className="h-4 w-4" />, n: s.loads },
    { key: 'customs', ar: 'التخليص الجمركي', en: 'Customs', icon: <Ship className="h-4 w-4" />, n: s.clearances },
    { key: 'collections', ar: 'التحصيل', en: 'Collections', icon: <Wallet className="h-4 w-4" />, n: s.invoices },
    { key: 'sales', ar: 'المبيعات', en: 'Sales', icon: <ClipboardList className="h-4 w-4" />, n: s.requests + s.deals },
    { key: 'contract', ar: 'العقد', en: 'Contract', icon: <FileSignature className="h-4 w-4" /> },
    { key: 'portal', ar: 'البوابة', en: 'Portal', icon: <KeyRound className="h-4 w-4" />, n: d.accounts.length },
  ];
  const kv = (k: string, v: ReactNode) => (
    <div className="border-b border-slate-100 pb-1.5"><p className="text-[11px] text-slate-500">{k}</p><p className="text-sm font-semibold text-slate-900 break-words">{v === '' || v == null ? '—' : v}</p></div>
  );

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header: identity, contact and where the customer exists. */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-slate-900 px-5 py-4 text-white">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f37121]"><Building2 className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold leading-tight">{m.name}</h1>
              <p className="mt-0.5 text-[13px] text-slate-300">{[m.code && `${t('الكود', 'Code')} ${m.code}`, m.arabicName, m.city].filter(Boolean).join(' · ')}</p>
              {m.archivedAt && <span className="mt-1 inline-block rounded-full bg-red-500/90 px-2 py-0.5 text-[11.5px] font-bold">{t('في أرشيف العملاء', 'In the customers archive')}</span>}
            </div>
          </div>
          <ExportMenu fileName={`${t('ملف العميل', 'Customer file')} - ${m.name}`} lang={lang} options={[{ key: 'all', label: t('تصدير الملف كاملًا', 'Export the whole file'), sheets: allSheets }]} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-5 py-3 text-[13px] text-slate-700">
          {m.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-slate-400" /><span className="tabular-nums" dir="ltr">{m.phone}</span></span>}
          {(m.emails || []).map((e: string) => <span key={e} className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-slate-400" />{e}</span>)}
          {m.address && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" />{m.address}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-5 py-2.5">
          <span className="text-[12px] font-semibold text-slate-500">{t('موجود في:', 'Present in:')}</span>
          {d.places.map((p) => (
            <Link key={`${p.reg}${p.id}`} href={p.href} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-orange-50 hover:text-[#c2410c]">
              {p.ar}<ExternalLink className="h-3 w-3" />
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => setTab(x.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold ${tab === x.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {x.icon}{ar ? x.ar : x.en}
            {!!x.n && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === x.key ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{x.n}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label={t('الشحنات', 'Shipments')} value={(s.orders + s.platform + s.loads).toLocaleString('en-US')} sub={t(`${s.orders} أمر نقل · ${s.platform} بيان منصّة · ${s.loads} حمولة أسطول`, `${s.orders} orders · ${s.platform} manifests · ${s.loads} fleet loads`)} icon={<Route className="h-4 w-4" />} />
            <KpiTile label={t('إيراد النقل', 'Transport revenue')} value={money(s.ordersSell + s.platformSell + s.loadsIncome)} sub={t('بيع أوامر النقل والمنصّة ودخل الأسطول', 'Orders, platform and fleet')} accent="#0ea5e9" icon={<Truck className="h-4 w-4" />} />
            <KpiTile label={t('التخليص الجمركي', 'Customs')} value={s.clearances} sub={t(`${s.clearancesOpen} مفتوحة · إيراد ${money(s.customsRevenue)} · ربح ${money(s.customsProfit)}`, `${s.clearancesOpen} open · revenue ${money(s.customsRevenue)} · profit ${money(s.customsProfit)}`)} accent="#7c3aed" icon={<Ship className="h-4 w-4" />} />
            <KpiTile label={t('المتبقّي للتحصيل', 'Outstanding')} value={money(s.outstanding)} sub={t(`مفوتَر ${money(s.invoiced)} · مُحصَّل ${money(s.collected)} · ${s.overdue} متأخرة`, `invoiced ${money(s.invoiced)} · collected ${money(s.collected)} · ${s.overdue} overdue`)} accent={s.overdue ? '#dc2626' : '#16a34a'} icon={<Wallet className="h-4 w-4" />} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">{t('بطاقة العميل', 'Customer card')}</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {kv(t('جهة الاتصال', 'Contact'), m.contactPerson)}{kv(t('الرقم الضريبي', 'Tax number'), m.taxNumber)}
                {kv(t('السجل التجاري', 'CR'), m.commercialRegister)}{kv(t('الحالة في إدارة العلاقات', 'CRM status'), m.status)}
                {kv(t('مسؤول التحصيل', 'Collections officer'), d.collections?.officer)}{kv(t('مدة الائتمان', 'Credit days'), d.collections?.creditDays ? `${d.collections.creditDays} ${t('يومًا', 'days')}` : '')}
                {kv(t('آخر نشاط', 'Last activity'), day(s.lastActivity))}{kv(t('عميل منذ', 'Customer since'), day(m.createdAt))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">{t('المبيعات والعقد', 'Sales & contract')}</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {kv(t('طلبات الشحن', 'Shipment requests'), `${s.requests} (${s.openRequests} ${t('مفتوحة', 'open')})`)}
                {kv(t('الصفقات', 'Deals'), `${s.deals} (${s.openDeals} ${t('مفتوحة', 'open')})`)}
                {kv(t('قيمة الصفقات', 'Deals value'), money(s.dealsValue))}
                {kv(t('العقد', 'Contract'), d.contract ? (d.contract.customerSideContract && d.contract.ourSideContract ? t('موقَّع من الطرفين', 'Signed by both') : t('غير مكتمل التوقيع', 'Not fully signed')) : '')}
                {kv(t('نهاية العقد', 'Contract end'), d.contract?.endDate ? day(d.contract.endDate) : '')}
                {kv(t('حساب البوابة', 'Portal account'), d.accounts.length ? d.accounts.map((a) => a.email).join('، ') : t('لا يوجد', 'None'))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'shipments' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900">{t(`أوامر النقل (${d.orders.length})`, `Transport orders (${d.orders.length})`)}</h3>
          <Table cols={T.orders} rows={d.orders} empty={t('لا أوامر نقل', 'No transport orders')} />
          <h3 className="text-sm font-bold text-slate-900">{t(`بيانات المنصّة (${d.platform.length})`, `Platform manifests (${d.platform.length})`)}</h3>
          <Table cols={T.platform} rows={d.platform} empty={t('لا بيانات', 'No manifests')} />
        </div>
      )}
      {tab === 'fleet' && <Table cols={T.loads} rows={d.loads} empty={t('لا حمولات أسطول', 'No fleet loads')} />}
      {tab === 'customs' && <Table cols={T.customs} rows={d.customs} empty={t('لا معاملات تخليص', 'No clearances')} />}
      {tab === 'collections' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label={t('المفوتَر', 'Invoiced')} value={money(s.invoiced)} />
            <KpiTile label={t('المُحصَّل', 'Collected')} value={money(s.collected)} accent="#16a34a" />
            <KpiTile label={t('المتبقّي', 'Outstanding')} value={money(s.outstanding)} accent="#dc2626" />
            <KpiTile label={t('فواتير متأخرة', 'Overdue invoices')} value={s.overdue} accent="#f59e0b" />
          </div>
          <Table cols={T.invoices} rows={d.invoices} empty={t('لا فواتير', 'No invoices')} />
        </div>
      )}
      {tab === 'sales' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900">{t('طلبات الشحن', 'Shipment requests')}</h3>
          <Table cols={T.requests} rows={d.requests} empty={t('لا طلبات', 'No requests')} />
          <h3 className="text-sm font-bold text-slate-900">{t('صفقات إدارة العلاقات', 'CRM deals')}</h3>
          <Table cols={T.deals} rows={d.deals} empty={t('لا صفقات', 'No deals')} />
        </div>
      )}
      {tab === 'contract' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {d.contract ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
              {kv(t('توقيع العميل', 'Customer signed'), d.contract.customerSideContract ? t('نعم', 'Yes') : t('لا', 'No'))}
              {kv(t('توقيعنا', 'We signed'), d.contract.ourSideContract ? t('نعم', 'Yes') : t('لا', 'No'))}
              {kv(t('تاريخ العقد', 'Contract date'), day(d.contract.contractDate))}{kv(t('البداية', 'Start'), day(d.contract.startDate))}
              {kv(t('النهاية', 'End'), day(d.contract.endDate))}{kv(t('مدة السداد', 'Payment term'), d.contract.paymentTermDays ? `${d.contract.paymentTermDays} ${t('يومًا', 'days')}` : '')}
              {kv(t('التجديد', 'Renewal'), d.contract.renewalPolicy)}{kv(t('مندوبنا', 'Our rep'), d.contract.energizeRep)}
            </div>
          ) : <p className="text-sm text-slate-500">{t('لا سجلّ عقد', 'No contract record')}</p>}
        </div>
      )}
      {tab === 'portal' && (
        <Table cols={[
          { key: 'email', label: t('البريد', 'Email') },
          { key: 'isActive', label: t('الحالة', 'State'), render: (r) => (r.isActive === false ? t('معطَّل', 'Disabled') : t('مفعَّل', 'Active')) },
          { key: 'lastLogin', label: t('آخر دخول', 'Last login'), render: (r) => day(r.lastLogin) },
          { key: 'createdAt', label: t('أُنشئ', 'Created'), render: (r) => day(r.createdAt) },
        ]} rows={d.accounts} empty={t('لا حساب بوابة لهذا العميل؛ يُنشأ من صفحة العميل في أيّ قسم أو من صفحة المستخدمين.', 'No portal account; create one from the customer page in any section or from the users page.')} />
      )}
    </div>
  );
}
