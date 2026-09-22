'use client';
/**
 * «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها، بسعر بيعنا الحقيقيّ.
 *
 * سعرُ البيع في سير عمل التشغيل يأتي من منصّةٍ ليست لنا وهو مساوٍ لسعر الشراء
 * دائمًا — فريقُ العمليّات هناك لا يعرف هامشَنا. فهذه الصفحةُ تقرأ الكشوفَ من
 * موضعها حرفًا بحرف (فكلُّ ما يحدث هناك يظهر هنا في اللحظة) ولا تملك منها إلّا
 * عمودًا واحدًا: سعرَ البيع، محفوظًا عندنا ولا يُرسَل إلى أحد.
 *
 * والسعرُ يُملأ وحدَه من ملفّ العميل (آخرُ سعرٍ على هذا المسار)، ويُصحَّح هنا —
 * والتصحيحُ يصير هو الأحدثَ في الملفّ، فيرثه ما بعده وتقترحه شاشةُ الإنشاء.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Lock, Search, Loader2, Check, X, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { SHIPMENT_STATUSES } from '@/lib/ops';

const LIMIT = 50;
const ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'cfo', 'accounting_manager', 'accountant'];

interface Row {
  _id: string; reportNumber?: string; reportDate?: string;
  fromLocation?: string; toLocation?: string; branch?: string; username?: string;
  applicationStatus?: string; purchaseValue?: number;
  platformSellingValue?: number; sellingValue?: number;
  priceSource?: string; priceSaved?: boolean; profit?: number | null;
  driverName?: string; truckType?: string; carNumber?: string;
}

const money = (v?: number | null) => (v == null ? '—'
  : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

export default function OperationsPrivatePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();

  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const allowed = ROLES.includes(String(user?.role || ''));

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, dateFrom, dateTo]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('search', debounced);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p;
  }, [debounced, dateFrom, dateTo]);

  // ── والردُّ القديم لا يكتب فوق الأحدث ──────────────────────────────────────
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    setLoading(true);
    try {
      const p = params();
      p.set('page', String(page));
      p.set('limit', String(LIMIT));
      const d = await api.get<any>(`/api/operations-private?${p.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.workflows || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, page]);

  const statsGuard = useLatestRequest();
  const loadStats = useCallback(async () => {
    const mine = statsGuard.begin();
    try {
      const d = await api.get<any>(`/api/operations-private/stats?${params().toString()}`);
      if (statsGuard.isCurrent(mine)) setStats(d);
    } catch { /* الأرقامُ تحسينٌ لا شرط */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => { if (allowed) load(); }, [load, allowed]);
  useEffect(() => { if (allowed) loadStats(); }, [loadStats, allowed]);

  // كلُّ ما يحدث في التشغيل يظهر هنا في اللحظة — نفسُ الأحداث التي تسمعها تلك الصفحة.
  const refresh = useCallback(() => { load(); loadStats(); }, [load, loadStats]);
  useSocket('workflow:bulkImported', refresh);
  useSocket('workflow:created', refresh);
  useSocket('workflow:updated', refresh);
  useSocket('operationsPrivate:updated', refresh);

  const shown = useMemo(() => (unpricedOnly ? rows.filter((r) => !r.sellingValue) : rows), [rows, unpricedOnly]);

  const save = async (r: Row) => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) { notify(ar ? 'سعرٌ غير صالح' : 'Invalid price', 'error'); return; }
    setSaving(true);
    try {
      const d = await api.put<any>(`/api/operations-private/${r._id}`, { sellingValue: value });
      setRows((p) => p.map((x) => (x._id === r._id
        ? { ...x, sellingValue: value, priceSource: 'manual', priceSaved: true, profit: d.profit } : x)));
      setEditing(null);
      loadStats();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setSaving(false);
  };

  const statusLabel = (k?: string) => {
    const s = SHIPMENT_STATUSES.find((x) => x.key === k);
    return s ? (ar ? s.ar : s.en) : (k || '—');
  };

  const columns: ExportColumn[] = [
    { header: ar ? 'رقم الكشف' : 'Sheet #', key: 'reportNumber', width: 14 },
    { header: ar ? 'التاريخ' : 'Date', key: 'reportDate', width: 14, transform: (v) => fmtDate(v) },
    { header: ar ? 'العميل' : 'Customer', key: 'username', width: 28 },
    { header: ar ? 'من' : 'From', key: 'fromLocation', width: 18 },
    { header: ar ? 'إلى' : 'To', key: 'toLocation', width: 18 },
    { header: ar ? 'سعر الشراء' : 'Purchase', key: 'purchaseValue', width: 14 },
    { header: ar ? 'سعر البيع (الحقيقي)' : 'Selling (real)', key: 'sellingValue', width: 16 },
    { header: ar ? 'الربح' : 'Profit', key: 'profit', width: 14 },
    { header: ar ? 'مصدر السعر' : 'Price source', key: 'priceSource', width: 14 },
    { header: ar ? 'الحالة' : 'Status', key: 'applicationStatus', width: 14, transform: (v) => statusLabel(v) },
  ];

  const sourceLabel = (s?: string) => (
    s === 'sheet' ? (ar ? 'تقرير الفروع' : 'branches report')
      : s === 'route' ? (ar ? 'ملفّ العميل' : 'customer profile')
        : s === 'manual' ? (ar ? 'يدويّ' : 'manual') : '—');

  if (!allowed) {
    return <div className="p-8 text-slate-500">{ar ? 'هذه الصفحة للإدارة فقط.' : 'Management only.'}</div>;
  }
  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Lock className="w-5 h-5 text-[#f37121]" />}
        title={ar ? 'التشغيل — خاصّ' : 'Operations — private'}
        subtitle={ar
          ? 'نفس كشوف سير عمل التشغيل، بسعر بيعنا الحقيقيّ — لا يُرسَل إلى منصّة التشغيل ولا يراه أحدٌ خارجها'
          : 'The same operations sheets with our real selling price — never sent to the platform'}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="operations-private"
          options={[{ key: 'view', label: ar ? 'المعروض' : 'Shown', sheets: [{ name: 'Private', rows: shown as any[], columns }] }]} />
      </PageHeader>

      {/* ── الأرقامُ على الفلتر كلِّه لا على الصفحة المعروضة ───────────────── */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            [ar ? 'كشوف' : 'Sheets', stats.total, 'text-slate-900'],
            [ar ? 'إجمالي البيع' : 'Selling', money(stats.sumSelling), 'text-emerald-700'],
            [ar ? 'إجمالي الشراء' : 'Purchase', money(stats.sumPurchase), 'text-slate-700'],
            [ar ? 'الربح' : 'Profit', money(stats.profit), 'text-[#f37121]'],
            [ar ? 'الهامش' : 'Margin', `${stats.margin}%`, 'text-violet-700'],
          ].map(([k, v, tone]) => (
            <div key={String(k)} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] text-slate-500">{k as string}</p>
              <p className={`mt-1 text-lg font-bold tabular-nums ${tone as string}`}>{v as any}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── وما لم يُسعَّر يُقال ولا يُخفى ─────────────────────────────────────
          الربحُ أعلاه محسوبٌ على ما له سعرُ بيعٍ وحدَه. وعددُ ما ينقصه سعرُه
          وقيمةُ شرائه يُقالان هنا، وإلّا قُرئ الهامشُ على أنّه هامشُ الكلّ. */}
      {stats && stats.unpriced > 0 && (
        <button type="button" onClick={() => setUnpricedOnly((v) => !v)}
          className={`w-full rounded-xl border px-4 py-3 text-start text-[13px] transition-colors ${
            unpricedOnly ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}>
          <b className="tabular-nums">{stats.unpriced}</b>{' '}
          {ar ? `كشفًا بلا سعر بيع (شراؤها ${money(stats.sumPurchaseUnpriced)} ر.س) — الربح أعلاه محسوبٌ على المسعَّر وحدَه.`
            : `sheets without a selling price (their purchase ${money(stats.sumPurchaseUnpriced)}) — the profit above counts priced rows only.`}
          <span className="ms-2 font-semibold underline">{unpricedOnly ? (ar ? 'إظهار الكل' : 'show all') : (ar ? 'أرِني إيّاها' : 'show them')}</span>
        </button>
      )}

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={ar ? 'رقم الكشف أو العميل أو المدينة…' : 'Sheet no., customer or city…'}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-sm" />
      </div>

      <ScrollX>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-200">
              <tr>
                {[ar ? 'رقم الكشف' : 'Sheet #', ar ? 'التاريخ' : 'Date', ar ? 'العميل' : 'Customer',
                  ar ? 'من' : 'From', ar ? 'إلى' : 'To', ar ? 'الحالة' : 'Status',
                  ar ? 'الشراء' : 'Purchase', ar ? 'البيع (الحقيقي)' : 'Selling (real)',
                  ar ? 'الربح' : 'Profit', ar ? 'المصدر' : 'Source'].map((h) => (
                    <th key={h} className="px-3 py-3 text-start text-xs font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={10} className="py-14 text-center text-slate-500">
                  {ar ? 'لا كشوف.' : 'No sheets.'}
                </td></tr>
              )}
              {shown.map((r) => (
                <tr key={r._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono font-bold text-[#f37121] whitespace-nowrap">{r.reportNumber || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.reportDate)}</td>
                  <td className="px-3 py-2.5 text-slate-900">{r.username || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.fromLocation || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{r.toLocation || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{statusLabel(r.applicationStatus)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700 whitespace-nowrap">{money(r.purchaseValue)}</td>

                  {/* ── العمودُ الوحيدُ الذي نملكه ──────────────────────────── */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {editing === r._id ? (
                      <span className="inline-flex items-center gap-1">
                        <input autoFocus type="number" value={draft} onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') save(r); if (e.key === 'Escape') setEditing(null); }}
                          className="w-28 px-2 py-1 rounded border border-[#f37121] text-sm tabular-nums focus:outline-none" />
                        <button type="button" onClick={() => save(r)} disabled={saving}
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50">
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="p-1 rounded text-slate-400 hover:bg-slate-100">
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    ) : (
                      <button type="button"
                        onClick={() => { setEditing(r._id); setDraft(String(r.sellingValue || '')); }}
                        className={`rounded px-2 py-1 font-bold tabular-nums transition-colors hover:bg-[#f37121]/10 ${
                          r.sellingValue ? 'text-slate-900' : 'text-amber-600'}`}
                        title={ar ? 'اضغط للتعديل — ويصير هذا آخرَ سعرٍ في ملفّ العميل' : 'Click to edit — becomes the latest price in the customer profile'}>
                        {r.sellingValue ? money(r.sellingValue) : (ar ? 'بلا سعر' : 'not priced')}
                      </button>
                    )}
                  </td>

                  <td className={`px-3 py-2.5 tabular-nums font-semibold whitespace-nowrap ${
                    r.profit == null ? 'text-slate-300' : (r.profit >= 0 ? 'text-emerald-700' : 'text-red-600')}`}>
                    {r.profit == null ? '—' : money(r.profit)}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{sourceLabel(r.priceSource)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollX>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          <TrendingUp className="inline w-3.5 h-3.5 me-1 text-[#f37121]" />
          {ar ? `${total} كشفًا · صفحة ${page} من ${pages}` : `${total} sheets · page ${page} of ${pages}`}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
