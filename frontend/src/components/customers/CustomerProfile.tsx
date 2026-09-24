'use client';
/**
 * ملفُّ العميل — كلُّ ما يُعرَف عنه في شاشةٍ واحدة.
 *
 * رحلاتُه (كشوفُ التشغيل) وتحليلُه الشهريُّ والمساراتُ التي **يعمل** عليها
 * فعلًا موصولةً بالسعر المتّفق عليه، ثمّ قائمةُ الأسعار المتّفق عليها نفسُها —
 * وهي وحدَها القابلةُ للتعديل. والفرقُ بين الجدولين هو الفائدة: مسارٌ يُشتغَل
 * عليه خمسين مرّةً بلا سعرٍ متّفقٍ عليه سؤالٌ يُرى بالعين.
 *
 * وهو مكوّنٌ واحدٌ تفتحه صفحتان (طلبات الشحنات والتشغيل) — راجع رأسَ
 * CustomersRegister.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Spinner, PageHeader, StatCard, ErrorNotice, PrimaryButton, Modal, Tabs,
} from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import PortalAccountCard from '@/components/system/PortalAccountCard';
import CustomerEditDialog from '@/components/customers/CustomerEditDialog';
import { canEditOrders, Lang } from '@/lib/shipmentOrders';
import {
  ProfilePayload, RunRoute, AgreedRoute, foldAr, fmtDay, fmtNum, priceSourceLabel,
} from '@/lib/customerRegistry';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  UserRound, ArrowRight, ArrowLeft, Pencil, KeyRound, Phone, Mail, Search, ChevronLeft, ChevronRight, Route,
} from 'lucide-react';

const SHEET_LIMIT = 50;

const runRouteCols = (ar: boolean, money: boolean) => ([
  { key: 'from', ar: 'من', en: 'From' },
  { key: 'to', ar: 'إلى', en: 'To' },
  { key: 'sheets', ar: 'الرحلات', en: 'Trips', num: true },
  ...(money ? [{ key: 'purchase', ar: 'قيمة الشراء', en: 'Purchase', num: true }] : []),
  { key: 'lastAt', ar: 'آخر رحلة', en: 'Last trip', date: true },
  { key: 'price', ar: 'السعر المتّفق', en: 'Agreed price', num: true },
  { key: 'priceAt', ar: 'تاريخ السعر', en: 'Price date', date: true },
  { key: 'priceSource', ar: 'مصدر السعر', en: 'Price source' },
] as { key: string; ar: string; en: string; num?: boolean; date?: boolean }[]);

const runCell = (r: RunRoute, key: string, ar: boolean): string => {
  const v: any = (r as any)[key];
  if (key === 'lastAt' || key === 'priceAt') return fmtDay(v);
  if (key === 'sheets' || key === 'purchase' || key === 'price') return fmtNum(v);
  if (key === 'priceSource') return priceSourceLabel(v, ar);
  return v == null || v === '' ? '' : String(v);
};

const SHEET_COLS: { key: string; ar: string; en: string; date?: boolean; num?: boolean; money?: boolean }[] = [
  { key: 'reportNumber', ar: 'رقم الكشف', en: 'Report #' },
  { key: 'reportDate', ar: 'التاريخ', en: 'Date', date: true },
  { key: 'fromLocation', ar: 'من', en: 'From' },
  { key: 'toLocation', ar: 'إلى', en: 'To' },
  { key: 'branch', ar: 'الفرع', en: 'Branch' },
  { key: 'carOwner', ar: 'المالك', en: 'Owner' },
  { key: 'carNumber', ar: 'المركبة', en: 'Vehicle' },
  { key: 'driverName', ar: 'السائق', en: 'Driver' },
  { key: 'applicationStatus', ar: 'حالة الطلب', en: 'Application' },
  { key: 'executionStatus', ar: 'حالة التنفيذ', en: 'Execution' },
  { key: 'paymentMethod', ar: 'طريقة الدفع', en: 'Payment' },
  { key: 'purchaseValue', ar: 'قيمة الشراء', en: 'Purchase', num: true, money: true },
];

export default function CustomerProfile({ id, basePath }: { id: string; basePath: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify } = useDialog();
  const guard = useLatestRequest();
  const cf = useColumnFilters<RunRoute>();

  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('routes');
  const [routeQ, setRouteQ] = useState('');
  const [agreedQ, setAgreedQ] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<ProfilePayload>(`/api/customer-registry/${id}?page=${page}&limit=${SHEET_LIMIT}`);
      if (!guard.isCurrent(mine)) return;
      setData(d);
      setError('');
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, [id, page, guard]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:customers', useCallback(() => load(), [load]));

  const money = !!data && data.analysis.purchaseTotal !== undefined;
  const editor = canEditOrders(user);

  const rcols = useMemo(() => runRouteCols(ar, money), [ar, money]);
  const rgetters = useMemo(
    () => Object.fromEntries(rcols.map((c) => [c.key, (r: RunRoute) => runCell(r, c.key, ar)])),
    [rcols, ar],
  );
  const runSearched = useMemo(() => {
    const rows = data?.routes || [];
    const s = foldAr(routeQ);
    if (!s) return rows;
    return rows.filter((r) => foldAr(`${r.from} ${r.to}`).includes(s));
  }, [data, routeQ]);
  const runShown = useMemo(() => cf.apply(runSearched, rgetters), [cf, runSearched, rgetters]);

  const agreedShown = useMemo(() => {
    const rows = [...(data?.customer.routes || [])]
      .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
    const s = foldAr(agreedQ);
    if (!s) return rows;
    return rows.filter((r) => foldAr(`${r.fromCity} ${r.toCity}`).includes(s));
  }, [data, agreedQ]);

  const monthly = useMemo(() => (data?.analysis.monthly || []).map((m) => ({
    month: m.month, sheets: m.sheets, purchase: m.purchase ?? 0,
  })), [data]);

  const runExportCols: ExportColumn[] = useMemo(() => rcols.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key,
    type: c.num ? 'number' : c.date ? 'date' : 'text',
    transform: c.key === 'priceSource' ? (v: any) => priceSourceLabel(v, ar) : undefined,
  })), [rcols, ar]);

  const agreedExportCols: ExportColumn[] = useMemo(() => ([
    { header: ar ? 'من' : 'From', key: 'fromCity', width: 22 },
    { header: ar ? 'إلى' : 'To', key: 'toCity', width: 22 },
    { header: ar ? 'السعر' : 'Price', key: 'price', type: 'number' },
    { header: ar ? 'تاريخ السعر' : 'Price date', key: 'at', type: 'date' },
    { header: ar ? 'المصدر' : 'Source', key: 'source', transform: (v: any) => priceSourceLabel(v, ar) },
  ]), [ar]);

  const sheetCols = useMemo(() => SHEET_COLS.filter((c) => !c.money || money), [money]);
  const sheetExportCols: ExportColumn[] = useMemo(() => sheetCols.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key, type: c.num ? 'number' : c.date ? 'date' : 'text',
  })), [sheetCols, ar]);

  const scope = exportScopeLabels(ar);

  if (loading) return <Spinner />;
  if (error) return <div className="p-6"><ErrorNotice error={error} lang={lang} onRetry={load} /></div>;
  if (!data) return <div className="text-slate-500 p-8">{ar ? 'العميل غير موجود' : 'Not found'}</div>;

  const c = data.customer;
  const a = data.analysis;
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const th = 'px-3 py-2.5 font-semibold whitespace-nowrap';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link href={basePath} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#f37121]">
        <Back className="w-4 h-4" /> {ar ? 'سجلّ العملاء' : 'Customer register'}
      </Link>

      <PageHeader icon={<UserRound className="w-5 h-5" />} title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {c.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{c.phone}</span>}
            {c.email && <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{c.email}</span>}
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {c.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}
            </span>
            {a.branches.length > 0 && <span className="text-slate-400">{ar ? 'الفروع: ' : 'Branches: '}{a.branches.join(' · ')}</span>}
          </span>
        }>
        <button type="button" onClick={() => setPortalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <KeyRound className="w-4 h-4" /> {ar ? 'حساب البوابة' : 'Portal login'}
        </button>
        {editor && <PrimaryButton onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4" /> {ar ? 'تعديل' : 'Edit'}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard label={ar ? 'الرحلات (كشوف)' : 'Trips (sheets)'} value={a.sheets.toLocaleString('en-US')} accent="text-[#f37121]" />
        {money && <StatCard label={ar ? 'قيمة الشراء' : 'Purchase total'} value={fmtNum(a.purchaseTotal)} accent="text-violet-600" />}
        {money && <StatCard label={ar ? 'متوسّط الرحلة' : 'Avg per trip'} value={fmtNum(a.avgPerSheet)} />}
        <StatCard label={ar ? 'المسارات المتّفق عليها' : 'Agreed routes'} value={a.routesCount.toLocaleString('en-US')} accent="text-blue-600" />
        <StatCard label={ar ? 'منها مُسعَّرة' : 'Priced'} value={a.pricedRoutes.toLocaleString('en-US')}
          accent={a.pricedRoutes < a.routesCount ? 'text-amber-600' : 'text-emerald-600'} />
        {/* التاريخُ أضيقُ من الرقم في البطاقة — بخطّ البطاقة نفسِه يُلَفّ سطرين. */}
        <StatCard label={ar ? 'أوّل عمل' : 'First work'} value={<span className="text-lg">{fmtDay(a.firstAt)}</span>} />
        <StatCard label={ar ? 'آخر عمل' : 'Last work'} value={<span className="text-lg">{fmtDay(a.lastAt)}</span>} />
      </div>

      {monthly.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
          <p className="font-extrabold text-slate-900 text-[14.5px] mb-3">{ar ? 'العمل شهرًا بشهر' : 'Month by month'}</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                {money && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} stroke="#94a3b8" />}
                <Tooltip />
                <Legend />
                <Bar yAxisId="l" dataKey="sheets" name={ar ? 'الرحلات' : 'Trips'} fill="#f37121" radius={[4, 4, 0, 0]} />
                {money && <Line yAxisId="r" type="monotone" dataKey="purchase" name={ar ? 'قيمة الشراء' : 'Purchase'} stroke="#7c3aed" dot={false} strokeWidth={2} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'routes', label: ar ? 'المسارات التي يعمل عليها' : 'Routes they run', badge: data.routes.length },
        { key: 'agreed', label: ar ? 'أسعار المسارات المتّفق عليها' : 'Agreed prices', badge: c.routes.length },
        { key: 'sheets', label: ar ? 'الرحلات' : 'Trips', badge: data.sheets.total },
        ...(data.orders.length ? [{ key: 'orders', label: ar ? 'طلباتنا' : 'Our orders', badge: data.orders.length }] : []),
      ]} />

      {tab === 'routes' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <p className="font-extrabold text-slate-900 text-[14.5px]">
              {ar ? 'المسارات التي يعمل عليها فعلًا' : 'Routes they actually run'}
              <span className="ms-2 text-[11.5px] font-semibold text-slate-400 tabular-nums">({runShown.length})</span>
            </p>
            <div className="flex items-center gap-2">
              <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                <input value={routeQ} onChange={(e) => setRouteQ(e.target.value)} placeholder={ar ? 'بحث…' : 'Search…'}
                  className="w-44 ps-8 pe-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
              </div>
              <ExportMenu fileName={`customer-routes-${c.name}`} lang={ar ? 'ar' : 'en'}
                options={[
                  { key: 'shown', label: scope.shown, sheets: [{ name: ar ? 'المسارات' : 'Routes', rows: runShown as any[], columns: runExportCols }] },
                  { key: 'all', label: scope.all, sheets: [{ name: ar ? 'المسارات' : 'Routes', rows: data.routes as any[], columns: runExportCols }] },
                ]} />
            </div>
          </div>
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                  {rcols.map((col) => (
                    <th key={col.key} className={`${th} ${col.num ? 'text-end' : 'text-start'}`}>
                      <span className="inline-flex items-center gap-1">
                        {ar ? col.ar : col.en}
                        {cf.header(col.key, runSearched, rgetters[col.key], ar)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runShown.map((r, i) => (
                  <tr key={`${r.from}|${r.to}|${i}`} className={`hover:bg-slate-50 ${r.price == null ? 'bg-amber-50/40' : ''}`}>
                    {rcols.map((col) => (
                      <td key={col.key} className={`px-3 py-2 whitespace-nowrap ${col.num ? 'text-end tabular-nums' : 'text-slate-700'}`}>
                        {runCell(r, col.key, ar) || (col.key === 'price' ? <span className="text-amber-600 font-semibold">{ar ? 'بلا سعر' : 'no price'}</span> : '—')}
                      </td>
                    ))}
                  </tr>
                ))}
                {!runShown.length && <tr><td colSpan={rcols.length} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا مسارات.' : 'No routes.'}</td></tr>}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {tab === 'agreed' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
              <Route className="w-4 h-4 text-[#f37121]" />
              {ar ? 'قائمة الأسعار المتّفق عليها' : 'Agreed price list'}
              <span className="text-[11.5px] font-semibold text-slate-400 tabular-nums">({agreedShown.length})</span>
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                <input value={agreedQ} onChange={(e) => setAgreedQ(e.target.value)} placeholder={ar ? 'بحث…' : 'Search…'}
                  className="w-44 ps-8 pe-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
              </div>
              <ExportMenu fileName={`customer-prices-${c.name}`} lang={ar ? 'ar' : 'en'}
                options={[{ key: 'all', label: scope.all, sheets: [{ name: ar ? 'الأسعار' : 'Prices', rows: c.routes as any[], columns: agreedExportCols }] }]} />
              {editor && <PrimaryButton onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4" /> {ar ? 'تعديل الأسعار' : 'Edit prices'}</PrimaryButton>}
            </div>
          </div>
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                  <th className={`${th} text-start`}>{ar ? 'من' : 'From'}</th>
                  <th className={`${th} text-start`}>{ar ? 'إلى' : 'To'}</th>
                  <th className={`${th} text-end`}>{ar ? 'السعر' : 'Price'}</th>
                  <th className={`${th} text-start`}>{ar ? 'تاريخ السعر' : 'Price date'}</th>
                  <th className={`${th} text-start`}>{ar ? 'المصدر' : 'Source'}</th>
                  <th className={`${th} text-end`}>{ar ? 'تكرار' : 'Seen'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agreedShown.map((r: AgreedRoute, i: number) => (
                  <tr key={r._id || `${r.fromCity}|${r.toCity}|${i}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">{r.fromCity || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">{r.toCity || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-end tabular-nums">
                      {r.price == null ? <span className="text-amber-600 font-semibold">{ar ? 'بلا سعر' : 'no price'}</span> : fmtNum(r.price)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(r.at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{priceSourceLabel(r.source, ar) || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-end tabular-nums text-slate-500">{r.hits || 1}</td>
                  </tr>
                ))}
                {!agreedShown.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا أسعار متّفق عليها بعد.' : 'No agreed prices yet.'}</td></tr>}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {tab === 'sheets' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <p className="font-extrabold text-slate-900 text-[14.5px]">
              {ar ? 'الرحلات' : 'Trips'}
              <span className="ms-2 text-[11.5px] font-semibold text-slate-400 tabular-nums">({data.sheets.total.toLocaleString('en-US')})</span>
            </p>
            <ExportMenu fileName={`customer-trips-${c.name}`} lang={ar ? 'ar' : 'en'}
              options={[{ key: 'page', label: scope.page, sheets: [{ name: ar ? 'الرحلات' : 'Trips', rows: data.sheets.rows, columns: sheetExportCols }] }]} />
          </div>
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                  {sheetCols.map((col) => (
                    <th key={col.key} className={`${th} ${col.num ? 'text-end' : 'text-start'}`}>{ar ? col.ar : col.en}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sheets.rows.map((s: any) => (
                  <tr key={s._id} className="hover:bg-slate-50">
                    {sheetCols.map((col) => (
                      <td key={col.key} className={`px-3 py-2 whitespace-nowrap ${col.num ? 'text-end tabular-nums' : 'text-slate-700'}`}>
                        {col.date ? fmtDay(s[col.key]) : col.num ? fmtNum(s[col.key]) : (s[col.key] || '—')}
                      </td>
                    ))}
                  </tr>
                ))}
                {!data.sheets.rows.length && <tr><td colSpan={sheetCols.length} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا رحلات.' : 'No trips.'}</td></tr>}
              </tbody>
            </table>
          </ScrollX>
          <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-[12.5px]">
            <button type="button" disabled={data.sheets.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
              {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <span className="text-slate-600 tabular-nums">{ar ? `صفحة ${data.sheets.page} من ${data.sheets.pages}` : `Page ${data.sheets.page} of ${data.sheets.pages}`}</span>
            <button type="button" disabled={data.sheets.page >= data.sheets.pages} onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
              {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                  <th className={`${th} text-start`}>{ar ? 'الرقم' : 'Number'}</th>
                  <th className={`${th} text-start`}>{ar ? 'التاريخ' : 'Date'}</th>
                  <th className={`${th} text-start`}>{ar ? 'من' : 'From'}</th>
                  <th className={`${th} text-start`}>{ar ? 'إلى' : 'To'}</th>
                  <th className={`${th} text-start`}>{ar ? 'المورد' : 'Supplier'}</th>
                  <th className={`${th} text-start`}>{ar ? 'المركبة' : 'Vehicle'}</th>
                  <th className={`${th} text-start`}>{ar ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.orders.map((o: any) => (
                  <tr key={o._id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">{o.orderNumber || o.waybillNumber || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(o.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{o.fromCity || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{o.toCity || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{o.supplierName || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{o.vehiclePlate || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">{o.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {c.notes && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">{ar ? 'ملاحظات' : 'Notes'}</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.notes}</p>
        </div>
      )}

      <Modal open={portalOpen} onClose={() => setPortalOpen(false)} title={`${ar ? 'حساب البوابة' : 'Portal login'} — ${c.name}`}>
        <PortalAccountCard source="shipment_order_customer" refId={c._id} name={c.name} />
      </Modal>

      <CustomerEditDialog open={editOpen} customer={c} lang={lang as Lang}
        onClose={() => setEditOpen(false)}
        onSaved={() => { notify(ar ? 'تم الحفظ' : 'Saved', 'success'); load(); }} />
    </div>
  );
}
