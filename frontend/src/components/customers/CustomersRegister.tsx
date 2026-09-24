'use client';
/**
 * سجلُّ العملاء — شاشةٌ واحدةٌ تُعرَض في قسمين.
 *
 * ── لماذا مكوّنٌ لا صفحتان ──────────────────────────────────────────────────
 * الشاشةُ نفسُها مطلوبةٌ في «طلبات الشحنات» و«التشغيل». ولو نُسخت لافترقتا بعد
 * أوّل تعديل: عمودٌ يُضاف هنا ولا يُضاف هناك، وبطاقةٌ تُصلَح في واحدةٍ وتبقى
 * مكسورةً في الأخرى. فالصفحتان غلافان، والشاشةُ هنا.
 *
 * ── وبطاقاتٌ تُضغَط ────────────────────────────────────────────────────────
 * «كم عميلًا يعمل معنا؟» رقمٌ لا يكفي: من يقرؤه يريد أسماءَهم. فكلُّ بطاقةٍ
 * شريحةٌ تُطبَّق على الجدول وتبقى ظاهرةً أنّها المختارة.
 *
 * ── والمالُ يُخفى لا يُفرَّغ ───────────────────────────────────────────────
 * الخادمُ يحذف `purchaseTotal` عمّن لا يرى المال. فالعمودُ والبطاقةُ يُخفيان
 * كلّيًّا — عمودٌ مرسومٌ بشرطاتٍ يُقرأ «لا شراءَ له» لا «ليس لك أن تراه».
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Users, Plus, Pencil, Trash2, KeyRound, Search, ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  Spinner, PageHeader, PrimaryButton, Modal, ErrorNotice, StatCard, Pick,
} from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import PortalAccountCard from '@/components/system/PortalAccountCard';
import CustomerEditDialog, { type EditableCustomer } from '@/components/customers/CustomerEditDialog';
import { canEditOrders, canAdminOrders, Lang } from '@/lib/shipmentOrders';
import {
  RegistryRow, RegistrySummary, REGISTRY_COLS, cellOf, foldAr, fmtDay, KpiKey, kpiMatches,
} from '@/lib/customerRegistry';

const PAGE_SIZES = [50, 100, 200, 500];

/** البطاقاتُ بترتيب قراءتها: الكلُّ، ثمّ من يعمل، ثمّ ما ينقص. */
const KPIS: { key: KpiKey; ar: string; en: string; accent?: string; money?: boolean }[] = [
  { key: 'all', ar: 'كلّ العملاء', en: 'All customers' },
  { key: 'working', ar: 'يعملون معنا', en: 'Working', accent: 'text-emerald-600' },
  { key: 'idle', ar: 'بلا عمل', en: 'Idle', accent: 'text-slate-400' },
  { key: 'withRoutes', ar: 'لهم مسارات', en: 'With routes', accent: 'text-blue-600' },
  { key: 'withoutRoutes', ar: 'بلا مسارات', en: 'Without routes', accent: 'text-amber-600' },
  { key: 'unpriced', ar: 'مسارات بلا سعر', en: 'Routes missing a price', accent: 'text-red-600' },
  { key: 'sheets', ar: 'إجمالي الكشوف', en: 'Total sheets', accent: 'text-[#f37121]' },
  { key: 'purchase', ar: 'إجمالي الشراء', en: 'Total purchase', accent: 'text-violet-600', money: true },
];

const kpiValue = (k: KpiKey, s: RegistrySummary): number | undefined => {
  switch (k) {
    case 'all': return s.total;
    case 'working': return s.working;
    case 'idle': return s.idle;
    case 'withRoutes': return s.withRoutes;
    case 'withoutRoutes': return s.withoutRoutes;
    case 'unpriced': return s.unpricedRoutes;
    case 'sheets': return s.sheets;
    case 'purchase': return s.purchaseTotal;
    default: return undefined;
  }
};

export default function CustomersRegister({ basePath }: { basePath: string }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const { confirm, notify } = useDialog();
  const guard = useLatestRequest();
  const cf = useColumnFilters<RegistryRow>();

  const editor = canEditOrders(user);
  const admin = canAdminOrders(user);

  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [summary, setSummary] = useState<RegistrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [kpi, setKpi] = useState<KpiKey>('all');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'sheets', dir: -1 });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  const [editing, setEditing] = useState<EditableCustomer | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [portalFor, setPortalFor] = useState<RegistryRow | null>(null);
  /** قوائمُ المسارات تُجلَب مرّةً عند أوّل تعديلٍ أو تصدير — لا مع كلّ فتحة. */
  const [fullById, setFullById] = useState<Record<string, EditableCustomer> | null>(null);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ customers: RegistryRow[]; summary: RegistrySummary }>('/api/customer-registry');
      if (!guard.isCurrent(mine)) return;
      setRows(d.customers || []);
      setSummary(d.summary || null);
      setError('');
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, [guard]);

  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:customers', useCallback(() => { setFullById(null); load(); }, [load]));

  const money = !!summary && summary.purchaseTotal !== undefined;
  const cols = useMemo(() => REGISTRY_COLS.filter((c) => !c.money || money), [money]);

  const getters = useMemo(
    () => Object.fromEntries(cols.map((c) => [c.key as string, (r: RegistryRow) => cellOf(r, c, ar)])),
    [cols, ar],
  );

  const sliced = useMemo(() => rows.filter((r) => kpiMatches(kpi, r)), [rows, kpi]);

  const searched = useMemo(() => {
    const s = foldAr(q);
    if (!s) return sliced;
    return sliced.filter((r) => cols.some((c) => foldAr(cellOf(r, c, ar)).includes(s)));
  }, [sliced, q, cols, ar]);

  const filtered = useMemo(() => cf.apply(searched, getters), [cf, searched, getters]);

  const shown = useMemo(() => {
    const col = cols.find((c) => (c.key as string) === sort.key);
    const num = !!col?.num;
    const date = !!col?.date;
    return [...filtered].sort((a, b) => {
      const x: any = (a as any)[sort.key];
      const y: any = (b as any)[sort.key];
      if (num) return ((Number(x) || 0) - (Number(y) || 0)) * sort.dir;
      if (date) return ((x ? new Date(x).getTime() : 0) - (y ? new Date(y).getTime() : 0)) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? ''), 'ar') * sort.dir;
    });
  }, [filtered, sort, cols]);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const current = page > pages ? 1 : page;
  const pageRows = useMemo(() => shown.slice((current - 1) * size, current * size), [shown, current, size]);

  // كلُّ ما يغيّر مجموعةَ الصفوف يعيدنا إلى الصفحة الأولى — وإلّا وقف القارئُ
  // على صفحةٍ رقم ٧ من نتيجةٍ صفحتُها واحدة فرأى جدولًا فارغًا.
  useEffect(() => { setPage(1); }, [q, kpi, size, cf.count]);

  const ensureFull = useCallback(async (): Promise<Record<string, EditableCustomer>> => {
    if (fullById) return fullById;
    const d = await api.get<{ customers: any[] }>('/api/customer-registry/full?limit=5000');
    const map: Record<string, EditableCustomer> = {};
    for (const c of d.customers || []) map[String(c._id)] = c;
    setFullById(map);
    return map;
  }, [fullById]);

  const openEdit = useCallback(async (r: RegistryRow) => {
    try {
      const map = await ensureFull();
      let c = map[r._id];
      // العميلُ الموقوف ليس في قائمة الشحنات — يُقرأ ملفُّه وحدَه.
      if (!c) {
        const d = await api.get<{ customer: EditableCustomer }>(`/api/customer-registry/${r._id}`);
        c = d.customer;
      }
      setEditing(c);
      setEditOpen(true);
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  }, [ensureFull, notify]);

  const openCreate = () => { setEditing(null); setEditOpen(true); };

  const remove = useCallback(async (r: RegistryRow) => {
    if (!(await confirm(ar
      ? `إزالة العميل «${r.name}»؟ شحناته السابقة تحتفظ باسمه.`
      : `Remove “${r.name}”? Their past shipments keep the name.`))) return;
    try { await api.delete(`/api/customer-registry/${r._id}`); setFullById(null); load(); }
    catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  }, [ar, confirm, notify, load]);

  const exportCols: ExportColumn[] = useMemo(() => cols.map((c) => ({
    header: ar ? c.ar : c.en,
    key: c.key as string,
    width: c.width,
    type: c.num ? 'number' : c.date ? 'date' : 'text',
    transform: c.key === 'isActive'
      ? (v: any) => (v === false ? (ar ? 'موقوف' : 'Inactive') : (ar ? 'نشط' : 'Active'))
      : undefined,
  })), [cols, ar]);

  const routePriceCols: ExportColumn[] = useMemo(() => ([
    { header: ar ? 'العميل' : 'Customer', key: 'customer', width: 28 },
    { header: ar ? 'من' : 'From', key: 'from', width: 22 },
    { header: ar ? 'إلى' : 'To', key: 'to', width: 22 },
    { header: ar ? 'السعر' : 'Price', key: 'price', type: 'number' },
    { header: ar ? 'تاريخ السعر' : 'Price date', key: 'at', type: 'date' },
    { header: ar ? 'المصدر' : 'Source', key: 'source' },
  ]), [ar]);

  const scope = exportScopeLabels(ar);
  const sheetName = ar ? 'العملاء' : 'Customers';

  if (loading) return <Spinner />;

  const th = 'px-3 py-2.5 font-semibold whitespace-nowrap';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={ar ? 'سجلّ العملاء' : 'Customer register'}
        subtitle={ar
          ? `${(summary?.total || 0).toLocaleString('en-US')} عميل — الأرقامُ تُضغَط، والصفُّ يُفتح على ملفّ العميل`
          : `${(summary?.total || 0).toLocaleString('en-US')} customers — cards filter, a row opens the full file`}>
        {editor && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة عميل' : 'Add customer'}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {KPIS.filter((k) => !k.money || money).map((k) => {
            const v = kpiValue(k.key, summary);
            return (
              <Pick key={k.key} on={kpi === k.key} onClick={() => setKpi((cur) => (cur === k.key && k.key !== 'all' ? 'all' : k.key))}>
                {/* الرقمُ الطويل (٦٠ مليونًا) يُلَفّ سطرين في بطاقةٍ من ثمانٍ — يصغر قليلًا فيبقى سطرًا. */}
                <StatCard label={ar ? k.ar : k.en} accent={k.accent}
                  value={<span className={(v ?? 0).toLocaleString('en-US').length > 9 ? 'text-lg' : ''}>{(v ?? 0).toLocaleString('en-US')}</span>} />
              </Pick>
            );
          })}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="font-extrabold text-slate-900 text-[14.5px]">
            {ar ? 'العملاء' : 'Customers'}
            <span className="ms-2 text-[11.5px] font-semibold text-slate-400 tabular-nums">
              ({shown.length.toLocaleString('en-US')}{shown.length !== rows.length ? ` / ${rows.length.toLocaleString('en-US')}` : ''})
            </span>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {kpi !== 'all' && (
              <button type="button" onClick={() => setKpi('all')}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200">
                {ar ? 'إلغاء الشريحة' : 'Clear card filter'}
              </button>
            )}
            <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={ar ? 'بحث بالاسم أو الجوال أو الفرع…' : 'Search name, phone, branch…'}
                className="w-56 ps-8 pe-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
            </div>
            <ExportMenu fileName="customers" lang={ar ? 'ar' : 'en'}
              options={[
                { key: 'page', label: scope.page, sheets: [{ name: sheetName, rows: pageRows, columns: exportCols }] },
                { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: shown, columns: exportCols }] },
                { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows, columns: exportCols }] },
                {
                  key: 'routes',
                  label: ar ? 'أسعار المسارات' : 'Route prices',
                  hint: ar ? 'كلّ المسارات' : 'every route',
                  resolve: async () => {
                    const map = await ensureFull();
                    const flat: Record<string, any>[] = [];
                    for (const c of Object.values(map)) {
                      for (const r of c.routes || []) {
                        flat.push({
                          customer: c.name, from: r.fromCity, to: r.toCity,
                          price: r.price ?? null, at: r.at || null, source: r.source || '',
                        });
                      }
                    }
                    return [{ name: ar ? 'أسعار المسارات' : 'Route prices', rows: flat, columns: routePriceCols }];
                  },
                },
              ]} />
          </div>
        </div>

        <ScrollX>
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                {cols.map((c) => (
                  <th key={c.key as string} className={`${th} ${c.num ? 'text-end' : 'text-start'}`}>
                    <span className="inline-flex items-center gap-1">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-white"
                        onClick={() => setSort((s) => (s.key === c.key
                          ? { key: c.key as string, dir: (s.dir * -1) as 1 | -1 }
                          : { key: c.key as string, dir: c.num || c.date ? -1 : 1 }))}>
                        {ar ? c.ar : c.en}
                        <ArrowUpDown className={`w-3 h-3 ${sort.key === c.key ? 'text-[#f37121]' : 'opacity-40'}`} />
                      </button>
                      {cf.header(c.key as string, searched, getters[c.key as string], ar)}
                    </span>
                  </th>
                ))}
                <th className={`${th} text-center`}>{ar ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((r) => (
                <tr key={r._id} className="hover:bg-orange-50/40 cursor-pointer"
                  onClick={() => router.push(`${basePath}/${r._id}`)}>
                  {cols.map((c, ci) => {
                    if (c.key === 'name') {
                      return (
                        <td key="name" className="px-3 py-2 whitespace-nowrap font-semibold text-slate-900">
                          <Link href={`${basePath}/${r._id}`} onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 hover:text-[#f37121]">
                            {r.name}<ExternalLink className="w-3 h-3 text-slate-300" />
                          </Link>
                        </td>
                      );
                    }
                    if (c.key === 'isActive') {
                      return (
                        <td key="isActive" className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {r.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}
                          </span>
                        </td>
                      );
                    }
                    const text = cellOf(r, c, ar);
                    return (
                      <td key={c.key as string}
                        className={`px-3 py-2 whitespace-nowrap ${c.num ? 'text-end tabular-nums' : ''} ${ci === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                        {text || '—'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-0.5">
                      <button type="button" onClick={() => setPortalFor(r)} title={ar ? 'حساب البوابة' : 'Portal login'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100"><KeyRound className="w-4 h-4" /></button>
                      {editor && (
                        <button type="button" onClick={() => openEdit(r)} title={ar ? 'تعديل' : 'Edit'}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                      )}
                      {admin && (
                        <button type="button" onClick={() => remove(r)} title={ar ? 'إزالة' : 'Remove'}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!pageRows.length && (
                <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا يوجد عملاء بهذه الشريحة.' : 'No customers match.'}</td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-[12.5px]">
          <div className="flex items-center gap-2 text-slate-500">
            <span>{ar ? 'لكلّ صفحة' : 'Per page'}</span>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
              {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <span className="text-slate-600 tabular-nums">{ar ? `صفحة ${current} من ${pages}` : `Page ${current} of ${pages}`}</span>
            <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
              {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <Modal open={!!portalFor} onClose={() => setPortalFor(null)} title={`${ar ? 'حساب البوابة' : 'Portal login'} — ${portalFor?.name || ''}`}>
        {portalFor && <PortalAccountCard source="shipment_order_customer" refId={String(portalFor._id)} name={portalFor.name} />}
      </Modal>

      <CustomerEditDialog open={editOpen} customer={editing} lang={lang as Lang}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setFullById(null); load(); }} />

      <p className="text-[11px] text-slate-400">
        {ar
          ? `آخر تحديث للأسعار في السجلّ: ${fmtDay(rows.reduce((a: string | null, r) => (r.lastPriceAt && (!a || r.lastPriceAt > a) ? r.lastPriceAt : a), null))}`
          : `Latest price recorded: ${fmtDay(rows.reduce((a: string | null, r) => (r.lastPriceAt && (!a || r.lastPriceAt > a) ? r.lastPriceAt : a), null))}`}
      </p>
    </div>
  );
}
