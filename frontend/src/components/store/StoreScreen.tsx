'use client';
/**
 * شاشةُ المخزن — قطعُ الغيار: أصنافٌ برصيدٍ وسعر، حركاتُ وارد/صادر، وسجلُّ
 * حركاتٍ لا يُعدَّل بل يُعكَس.
 *
 * ── ولماذا مكوّنٌ لا صفحة ───────────────────────────────────────────────────
 * المخزنُ مخزنان: النقلُ الثقيل والنقلُ الخفيف. وآليّتُهما واحدةٌ حرفًا بحرف
 * — وارد وصادر، رصيدٌ بعد كلّ حركة، عتبةُ نقص، وتراجعٌ بحركةٍ معاكسةٍ لا
 * بمسحٍ — وأصنافُهما وأرصدتُهما مختلفة. فنسخُ الشاشةِ لمخزنٍ ثانٍ يعني شاشتين
 * تفترقان أوّلَ إصلاحٍ يُجرى على إحداهما.
 *
 * فالنطاقُ يُمرَّر: `base` مسارُ النقاط، و`plateSource` مصدرُ لوحات المركبات
 * التي يُصرَف عليها، و`canEditOf` حارسُ الصلاحيّة — فلكلّ قسمٍ حارسُه.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import SelectionBar from '@/components/ls2/SelectionBar';
import { SearchableSelect } from '@/components/hr/HRKit';
import { formatPlate } from '@/lib/flexMatch';

/** مركبةٌ يُصرَف عليها: لوحتُها وما يُعرَف عنها. */
export interface PlateRow {
  plate: string;
  /** المشروعُ الذي تعمل فيه — يُعرَض في القائمة وتحت الخانة. */
  project?: string;
  /** راكبُها الآن. */
  rider?: string;
  /** الفرع/المدينة. */
  city?: string;
  /** وصفٌ حرٌّ (النوعُ والماركة) لمن لا مشروعَ له. */
  detail?: string;
}

/** مفتاحُ المطابقة: اللوحةُ تُكتب بصيغٍ مختلفةٍ في سجلّين. */
const plateKeyOf = (v: unknown) => String(v ?? '').replace(/[^0-9A-Za-z\u0621-\u064A]/g, '').toUpperCase();
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { ListPlus, Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, Edit, Trash2, X, Save, History, Search, Undo2, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { type Lang } from '@/lib/ls2';
import ScrollX from '@/components/system/ScrollX';
import PeriodFilter from '@/components/system/PeriodFilter';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';

/** موردٌ كما يردّه `/suppliers`. */
export type Supplier = { _id: string; name: string; phone?: string; city?: string; taxNumber?: string; notes?: string; items?: number; purchases?: number; units?: number; total?: number; lastPurchase?: string };
const dmy = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

/**
 * خانةُ المورد: يُختار من القائمة، أو يُكتب اسمٌ جديدٌ فيُضاف مع الحفظ نفسِه.
 * القيمةُ معرّفُ المورد أو الاسمُ المكتوب — والخادمُ يميّز بينهما.
 */
function SupplierSelect({ suppliers, value, onChange, ar }: { suppliers: Supplier[]; value: string; onChange: (v: string) => void; ar: boolean }) {
  return (
    <SearchableSelect value={value} onChange={onChange} searchAfter={0}
      placeholder={ar ? 'اختر المورد أو اكتب اسمًا جديدًا' : 'Pick a supplier or type a new one'}
      searchPlaceholder={ar ? 'ابحث أو اكتب اسمَ موردٍ جديد…' : 'Search or type a new supplier…'}
      emptyLabel={ar ? '— بلا مورد —' : '— none —'}
      options={[
        ...(value && !suppliers.some((x) => x._id === value) ? [{ value, label: `${value} ${ar ? '(جديد)' : '(new)'}` }] : []),
        ...suppliers.map((x) => ({ value: x._id, label: x.name })),
      ]}
      allowCustom customHint={(typed) => (ar ? `إضافة «${typed}» موردًا جديدًا` : `Add “${typed}” as a new supplier`)} />
  );
}
const supplierBody = (v: string) => (/^[0-9a-f]{24}$/i.test(v) ? { supplier: v } : { supplier: '', supplierName: v });

type Item = { _id: string; supplier?: string | null; supplierName?: string; purchaseDate?: string; createdAt?: string; code?: string; name: string; category?: string; categoryAr?: string; groupAr?: string; quantity: number; unit: string; unitPrice: number; minQuantity?: number; compatibleModels?: string[]; notes?: string; status: 'ok' | 'low' | 'out'; value: number };
type Cat = { key: string; ar: string; count: number };
type Movement = {
  _id: string; item: string; itemName: string; type: 'in' | 'out'; quantity: number;
  vehiclePlate?: string; vehicleRegistryPlate?: string; reason?: string; balanceAfter: number; performedByName?: string; createdAt: string;
  date?: string; supplierName?: string; unitPrice?: number | null; total?: number | null; unit?: string;
  // التراجع — السيرفر هو اللي بيقرر الحركة دي ينفع يترجع فيها ولا لأ، فالواجهة
  // ما تعيدش بناء القاعدة دي عندها.
  reversed?: boolean; reversedByName?: string; reversalReason?: string;
  canReverse?: boolean; isReversal?: boolean;
};

const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  ok: { ar: 'متوفر', en: 'In stock', cls: 'bg-emerald-100 text-emerald-700' },
  low: { ar: 'منخفض', en: 'Low', cls: 'bg-amber-100 text-amber-700' },
  out: { ar: 'نافد', en: 'Out', cls: 'bg-red-100 text-red-700' },
};

export type StoreScope = {
  /** مسارُ نقاط المخزن — «/api/ls2/store» أو «/api/light-transport/store». */
  base: string;
  /**
   * مسارُ نقاط الموردين — يُكتب نصًّا صريحًا في صفحة كلّ مخزن: خريطةُ «صفحة ← نقاط»
   * تُبنى من النصوص المكتوبة، ومسارٌ يُشتقّ بالحساب لا تراه فيُرفَض لمن فُتحت له
   * الصفحةُ وحدَها (راجع page-api-map).
   */
  suppliersBase: string;
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  /** من أين تُجلَب لوحاتُ المركبات التي يُصرَف عليها. */
  /**
   * ── مصدرُ المركبات التي يُصرَف عليها ──────────────────────────────────────
   * كان يردّ لوحاتٍ عاريةً تُعرَض في `datalist`. واللوحةُ وحدَها لا تكفي
   * من يصرف: الصنفُ يُصرَف على مركبةٍ، والمركبةُ تعمل في **مشروع** — والمصروفُ
   * يُحمَّل على ذلك المشروع. فمن يصرف يسأل «هذه المركبةُ تبع أيّ مشروع؟» ولا
   * يجد الجوابَ إلّا بفتح شاشةٍ أخرى والعودة.
   *
   * فصار المصدرُ يردّ صفوفًا: اللوحةُ ومشروعُها وراكبُها وفرعُها — تُعرَض في
   * القائمة وتحت الخانة بعد الاختيار.
   */
  plateSource: { url: string; rows: (data: any) => PlateRow[] };
  /** حارسا القسم: من يرى الشاشة، ومن يكتب فيها. */
  canSee: (user: any) => boolean;
  canEdit: (user: any) => boolean;
  /** اسمُ ملفّ التصدير. */
  fileName: string;
  /**
   * «لوحاتٌ غير معروفة» — لوحاتٌ كُتبت على حركاتٍ ولا مركبةَ لها في سجلّ
   * المركبات. اختياريّ: يُعرض مع سجلّ الحركات حيث يُمرَّر.
   */
  unknownPlatesUrl?: string;
};

export default function StoreScreen({ scope }: { scope: StoreScope }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  // Gate on the SECTION, not on a hand-written role list. A role the super admin
  // grants «تعديل» on Location Solutions gets وارد/صادر/تعديل/حذف here without a
  // code change — which is what the permissions page promises and what the API
  // already honours (rbac lets a section grant through). The old list silently
  // broke that promise: the section opened, the actions stayed hidden.
  const canEdit = scope.canEdit(user);

  const [items, setItems] = useState<Item[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [plates, setPlates] = useState<PlateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [catF, setCatF] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [move, setMove] = useState<{ item: Item; type: 'in' | 'out' } | null>(null);
  // تحديد أكتر من صنف وصادر واحد عليهم — الصنف بينزل منه قطعة واحدة.
  // الاختيار بالـ _id مش بالصف، عشان يفضل شغّال لو الفلتر اتغيّر بعد الاختيار.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // الحركة الجماعية: 'out' صادر · 'in' وارد · null مغلقة
  const [bulkKind, setBulkKind] = useState<null | 'in' | 'out'>(null);
  const togglePick = (id: string) => setPicked((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [addNew, setAddNew] = useState(false);
  const [addMany, setAddMany] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  // يومُ الشراء (يومٌ / شهرٌ / فترة) والمورد — يُفلتَران في الخادم.
  const [period, setPeriod] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [supplierF, setSupplierF] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const supBase = scope.suppliersBase;
  const loadSuppliers = useCallback(() => {
    api.get<{ suppliers: Supplier[] }>(supBase).then((d) => setSuppliers(d.suppliers || [])).catch(() => {});
  }, [supBase]);
  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);
  useSocket('ls2:store', loadSuppliers);
  // فلاترُ سجلّ الحركات — في الخادم كذلك، فالسجلُّ أطولُ من أن يُجلَب كلُّه.
  const [logF, setLogF] = useState<{ type: string; from: string; to: string; q: string; supplier: string }>({ type: '', from: '', to: '', q: '', supplier: '' });
  const itemsReq = useLatestRequest();
  const logReq = useLatestRequest();

  const load = useCallback(async () => {
    // الطلبُ الأوسعُ أبطأ، فيصل بعد الأضيق ويكتب فوقه — راجع useLatestRequest.
    const token = itemsReq.begin();
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (period.from) qs.set('from', period.from);
    if (period.to) qs.set('to', period.to);
    if (supplierF) qs.set('supplier', supplierF);
    try {
      const [d, dash] = await Promise.all([
        api.get<{ items: Item[] }>(`${scope.base}${qs.toString() ? `?${qs}` : ''}`),
        api.get<{ totals: any }>(`${scope.base}/dashboard`),
      ]);
      if (!itemsReq.isCurrent(token)) return;
      setItems(d.items || []); setTotals(dash.totals); setCats((dash as any).byCategory || []);
    } catch (e: any) { if (itemsReq.isCurrent(token)) notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, period.from, period.to, supplierF, notify]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useSocket('ls2:store', useCallback(() => load(), [load]));
  // `/api/ls2/vehicles` يردّ `items` لا `vehicles` — فقائمةُ اللوحات هنا كانت
  // فارغةً دائمًا منذ أوّل يوم، ولا خطأَ يظهر: مفتاحٌ غيرُ موجودٍ يعطي قائمةً فارغة.
  // لوحاتُ المركبات التي يُصرَف عليها — من سجلّ القسم نفسِه لا من سجلٍّ آخر.
  const loadPlates = useCallback(() => {
    api.get<any>(scope.plateSource.url)
      .then((d) => setPlates(scope.plateSource.rows(d) || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.plateSource.url]);
  useEffect(() => { loadPlates(); }, [loadPlates]);

  const loadLog = useCallback(async () => {
    const token = logReq.begin();
    const qs = new URLSearchParams({ limit: '1000' });
    Object.entries(logF).forEach(([k, v]) => { if (v) qs.set(k, v); });
    try {
      const d = await api.get<{ movements: Movement[] }>(`${scope.base}/movements?${qs}`);
      if (logReq.isCurrent(token)) setMovements(d.movements || []);
    } catch { /* keep */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logF]);
  useEffect(() => { if (showLog) loadLog(); }, [showLog, loadLog]);
  useSocket('ls2:store', useCallback(() => { if (showLog) loadLog(); }, [showLog, loadLog]));
  // المركبةُ سجلٌّ واحد: لوحتُها في سجلّ المركبات تُقرأ مع كلّ حركة، فتعديلٌ هناك
  // يظهر في قائمة اللوحات وفي السجلّ في الحال.
  useSocket('vreg:updated', useCallback(() => { loadPlates(); if (showLog) loadLog(); }, [loadPlates, showLog, loadLog]));

  const shown = useMemo(() => items.filter((i) =>
    (!statusF || i.status === statusF)
    && (!catF || i.category === catF)
    && (!priceMin || (i.unitPrice || 0) >= Number(priceMin))
    && (!priceMax || (i.unitPrice || 0) <= Number(priceMax))
  ), [items, statusF, catF, priceMin, priceMax]);
  const anyFilter = statusF || catF || priceMin || priceMax || q || period.from || period.to || supplierF;
  const resetFilters = () => { setStatusF(''); setCatF(''); setPriceMin(''); setPriceMax(''); setQ(''); setPeriod({ from: '', to: '' }); setSupplierF(''); };

  const del = async (it: Item) => {
    if (!(await confirm(ar ? `حذف الصنف «${it.name}»؟` : `Delete "${it.name}"?`))) return;
    try { await api.delete(`${scope.base}/${it._id}`); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); load(); } catch (e: any) { notify(e?.message, 'error'); }
  };

  // Same Excel export every other Location Solutions page offers — the store was
  // the only one without one.
  const itemCols: ExportColumn[] = [
    { header: ar ? 'الكود' : 'Code', key: 'code', width: 14 },
    { header: ar ? 'الصنف' : 'Item', key: 'name', width: 34 },
    { header: ar ? 'التصنيف' : 'Category', key: 'categoryAr', transform: (v, r) => v || r.category || '', width: 18 },
    { header: ar ? 'تاريخ الشراء' : 'Purchase date', key: 'purchaseDate', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: ar ? 'المورد' : 'Supplier', key: 'supplierName', width: 24 },
    { header: ar ? 'العدد' : 'Qty', key: 'quantity', width: 10 },
    { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 10 },
    { header: ar ? 'الحد الأدنى' : 'Min qty', key: 'minQuantity', width: 11 },
    { header: ar ? 'سعر القطعة الواحدة' : 'Unit price', key: 'unitPrice', width: 16 },
    { header: ar ? 'الإجمالي (العدد × السعر)' : 'Total (qty × price)', key: 'value', width: 20 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (ar ? STATUS[v]?.ar : STATUS[v]?.en) || v, width: 12 },
    { header: ar ? 'الموديلات المتوافقة' : 'Compatible models', key: 'compatibleModels', transform: (v) => (v || []).join('، '), width: 30 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];
  const movementCols: ExportColumn[] = [
    { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: ar ? 'سُجِّلت في' : 'Recorded at', key: 'createdAt', transform: (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''), width: 18 },
    { header: ar ? 'الصنف' : 'Item', key: 'itemName', width: 34 },
    { header: ar ? 'الحركة' : 'Type', key: 'type', transform: (v) => (ar ? (v === 'in' ? 'وارد' : 'صادر') : (v === 'in' ? 'In' : 'Out')), width: 10 },
    { header: ar ? 'الكمية' : 'Qty', key: 'quantity', width: 10 },
    { header: ar ? 'الوحدة' : 'Unit', key: 'unit', width: 10 },
    { header: ar ? 'المورد' : 'Supplier', key: 'supplierName', width: 24 },
    { header: ar ? 'سعر القطعة' : 'Unit price', key: 'unitPrice', transform: (v) => (v == null ? '' : v), width: 13 },
    { header: ar ? 'الإجمالي' : 'Total', key: 'total', transform: (v) => (v == null ? '' : v), width: 13 },
    { header: ar ? 'المركبة' : 'Vehicle', key: 'vehiclePlate', width: 14 },
    { header: ar ? 'السبب' : 'Reason', key: 'reason', width: 30 },
    { header: ar ? 'الرصيد بعدها' : 'Balance after', key: 'balanceAfter', width: 14 },
    { header: ar ? 'بواسطة' : 'By', key: 'performedByName', width: 20 },
  ];

  if (!scope.canSee(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح' : 'Not authorized'}</div>;
  if (loading && !items.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />} title={ar ? scope.titleAr : scope.titleEn} subtitle={ar ? scope.subtitleAr : scope.subtitleEn}>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLog((s) => !s)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${showLog ? 'bg-[#12325c] text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}><History className="w-4 h-4" /> {ar ? 'سجل الحركات' : 'Movements'}</button>
          <ExportMenu
            fileName={scope.fileName} lang={lang as Lang}
            options={[
              { key: 'shown', label: ar ? 'المعروض حاليًا (بعد الفلتر)' : 'Current view (filtered)', sheets: [{ name: ar ? 'المخزن' : 'Store', rows: shown, columns: itemCols }] },
              { key: 'all', label: ar ? 'كل الأصناف' : 'All items', sheets: [{ name: ar ? 'المخزن' : 'Store', rows: items, columns: itemCols }] },
              { key: 'movements', label: ar ? 'سجل الحركات' : 'Movements log', sheets: [{ name: ar ? 'الحركات' : 'Movements', rows: movements, columns: movementCols }], disabled: !movements.length },
            ]}
          />
          {canEdit && <button onClick={() => setAddNew(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" /> {ar ? 'صنف جديد' : 'Add item'}</button>}
          {canEdit && <button onClick={() => setAddMany(true)} title={ar ? 'فاتورةُ شراءٍ واحدةٌ فيها عدّةُ أصناف' : 'One purchase with several items'} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12325c] hover:bg-[#0d2646] text-white text-sm"><ListPlus className="w-4 h-4" /> {ar ? 'إضافة عدّة أصناف' : 'Add several items'}</button>}
        </div>
      </PageHeader>

      {/* بطاقات — قابلة للفلترة */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <button onClick={() => setStatusF('')} className="text-start"><StatCard label={ar ? 'عدد الأصناف' : 'Items'} value={totals?.items ?? items.length} accent="text-[#f37121]" /></button>
        <StatCard label={ar ? 'إجمالي القطع' : 'Total units'} value={money(totals?.totalUnits)} />
        <StatCard label={ar ? 'قيمة المخزون (ر.س)' : 'Stock value'} value={money(totals?.totalValue)} accent="text-emerald-600" />
        <button onClick={() => setStatusF(statusF === 'low' ? '' : 'low')} className="text-start"><StatCard label={ar ? 'منخفض' : 'Low stock'} value={totals?.lowStock ?? 0} accent="text-amber-600" /></button>
        <button onClick={() => setStatusF(statusF === 'out' ? '' : 'out')} className="text-start"><StatCard label={ar ? 'نافد' : 'Out of stock'} value={totals?.outOfStock ?? 0} accent="text-red-600" /></button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالاسم / الكود / الموديل…' : 'name / code / model…'} className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-64 max-w-full" />
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="ok">{ar ? 'متوفر' : 'In stock'}</option>
            <option value="low">{ar ? 'منخفض' : 'Low'}</option>
            <option value="out">{ar ? 'نافد' : 'Out'}</option>
          </select>
          <select value={catF} onChange={(e) => setCatF(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white max-w-[190px]">
            <option value="">{ar ? 'كل التصنيفات' : 'All categories'}</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{(ar ? c.ar : c.key)} ({c.count})</option>)}
          </select>
          <div className="flex items-center gap-1">
            <input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder={ar ? 'سعر من' : '≥'} className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm" />
            <span className="text-slate-300">—</span>
            <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder={ar ? 'إلى' : '≤'} className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          <select value={supplierF} onChange={(e) => setSupplierF(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white max-w-[190px]">
            <option value="">{ar ? 'كل الموردين' : 'All suppliers'}</option>
            {suppliers.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
          </select>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">{ar ? 'تاريخ الشراء' : 'Purchase date'}
            <PeriodFilter ar={ar} from={period.from} to={period.to} onChange={(a, b) => setPeriod({ from: a, to: b })} />
          </span>
          {anyFilter && <button onClick={resetFilters} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs">{ar ? 'مسح' : 'Reset'} <X className="w-3 h-3" /></button>}
          <span className="text-xs text-slate-400 ms-auto">{shown.length} {ar ? 'صنف' : 'items'}</span>
        </div>
      </div>

      {showLog && scope.unknownPlatesUrl && <UnknownPlates url={scope.unknownPlatesUrl} ar={ar} onPick={(plate) => setLogF((f) => ({ ...f, q: plate }))} />}

      {showLog && <MovementsLog movements={movements} ar={ar} canEdit={!!canEdit} plates={plates} base={scope.base} onChanged={() => { loadLog(); load(); }}
        f={logF} setF={setLogF} suppliers={suppliers} />}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>
                {canEdit && (
                  <th className="px-3 py-2.5 w-9">
                    <input type="checkbox" className="accent-[#f37121]"
                      title={ar ? 'اختيار كل المعروض' : 'Select all shown'}
                      checked={shown.length > 0 && shown.every((x) => picked.has(x._id))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        shown.forEach((x) => (e.target.checked ? n.add(x._id) : n.delete(x._id)));
                        return n;
                      })} />
                  </th>
                )}
                {[ar ? 'الصنف' : 'Item', ar ? 'التصنيف' : 'Category', ar ? 'تاريخ الشراء' : 'Purchased', ar ? 'المورد' : 'Supplier', ar ? 'العدد' : 'Qty', ar ? 'سعر القطعة' : 'Unit price', ar ? 'الإجمالي' : 'Total', ar ? 'الحالة' : 'Status', ar ? 'حركة' : 'Move', ''].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((it) => (
                <tr key={it._id} className={picked.has(it._id) ? 'bg-orange-50/70' : 'hover:bg-slate-50'}>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <input type="checkbox" className="accent-[#f37121]"
                        title={it.quantity < 1 ? (ar ? 'الرصيد صفر — يصلح للوارد' : 'No stock — can still receive') : ''}
                        checked={picked.has(it._id)} onChange={() => togglePick(it._id)} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <p className="font-semibold text-slate-800">{it.name}</p>
                    {(it.compatibleModels?.length || it.code) ? <p className="text-[11px] text-slate-400">{it.code}{it.compatibleModels?.length ? ` · ${it.compatibleModels.join('، ')}` : ''}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{it.categoryAr || it.category || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{it.purchaseDate ? dmy(it.purchaseDate) : '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{it.supplierName || '—'}</td>
                  <td className="px-3 py-2 font-bold text-slate-800">{it.quantity} <span className="text-[10px] font-normal text-slate-400">{it.unit}</span></td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{money(it.unitPrice)}</td>
                  <td className="px-3 py-2 text-emerald-700 font-semibold whitespace-nowrap">{money(it.value)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[it.status].cls}`}>{ar ? STATUS[it.status].ar : STATUS[it.status].en}</span></td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setMove({ item: it, type: 'in' })} title={ar ? 'وارد' : 'Stock in'} className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold inline-flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5" />{ar ? 'وارد' : 'In'}</button>
                        <button onClick={() => setMove({ item: it, type: 'out' })} title={ar ? 'صادر' : 'Stock out'} className="px-2 py-1 rounded-md bg-orange-50 hover:bg-orange-100 text-[#f37121] text-[11px] font-semibold inline-flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5" />{ar ? 'صادر' : 'Out'}</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditItem(it)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => del(it)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-400">{ar ? 'لا توجد أصناف مطابقة' : 'No items'}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* شريط الإجراء الجماعي — ثابت أسفل الشاشة، يظهر فور اختيار أول صنف.
          الصادر والوارد جنبًا إلى جنب: كلاهما يقبل كمية مختلفة لكل صنف. */}
      {canEdit && (
        <SelectionBar
          count={picked.size} ar={ar}
          label={ar ? `${picked.size} صنف محدَّد` : `${picked.size} selected`}
          hint={ar ? 'الكمية الافتراضية ١ لكل صنف، وتُعدَّل لكل صنف على حدة'
                   : 'Default is 1 each — set any item’s quantity separately'}
          actionLabel={ar ? `صادر (${picked.size})` : `Issue (${picked.size})`}
          onAction={() => setBulkKind('out')}
          onClear={() => setPicked(new Set())}>
          <button type="button" onClick={() => setBulkKind('in')}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap">
            {ar ? `وارد (${picked.size})` : `Receive (${picked.size})`}
          </button>
        </SelectionBar>
      )}

      {move && <MovementModal suppliers={suppliers} move={move} plates={plates} ar={ar} base={scope.base} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
      {bulkKind && (
        <BulkOutModal
          suppliers={suppliers}
          base={scope.base}
          items={items.filter((x) => picked.has(x._id))} plates={plates} ar={ar} kind={bulkKind}
          onClose={() => setBulkKind(null)}
          onDone={() => { setBulkKind(null); setPicked(new Set()); load(); }}
        />
      )}
      {(addNew || editItem) && <ItemFormModal suppliers={suppliers} item={editItem} ar={ar} base={scope.base} onClose={() => { setAddNew(false); setEditItem(null); }} onSaved={() => { setAddNew(false); setEditItem(null); load(); loadSuppliers(); }} />}
      {addMany && <BulkCreateModal suppliers={suppliers} ar={ar} base={scope.base} onClose={() => setAddMany(false)} onSaved={() => { setAddMany(false); load(); loadSuppliers(); }} />}
    </div>
  );
}

// سجل الحركات — ومن هنا بالظبط بيتم التراجع أو التصحيح.
//
// الحركة الملغية بتفضل ظاهرة ومشطوبة، مش بتختفي: الرصيد اتغيّر فعلاً وقتها،
// وإخفاء السطر معناه إن اللي بيراجع المخزن مش هيفهم الرقم جه منين.
function MovementsLog({ movements, ar, canEdit, onChanged, base, f, setF, suppliers }: {
  movements: Movement[]; ar: boolean; canEdit: boolean; plates: PlateRow[]; onChanged: () => void; base: string;
  f: { type: string; from: string; to: string; q: string; supplier: string };
  setF: (fn: (p: any) => any) => void; suppliers: Supplier[];
}) {
  const [undoing, setUndoing] = useState<Movement | null>(null);
  // فلاترُ الأعمدة على طريقة إكسل — آخرُ ما يُطبَّق، بعد فلاتر الخادم.
  const cf = useColumnFilters<Movement>();
  const getters: Record<string, (m: Movement) => any> = {
    month: (m) => String(m.date || '').slice(0, 7),
    item: (m) => m.itemName,
    type: (m) => (m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')),
    supplier: (m) => m.supplierName || '',
    vehicle: (m) => m.vehiclePlate || '',
    by: (m) => m.performedByName || '',
  };
  const rows = cf.apply(movements, getters);
  const active = [f.type, f.from, f.to, f.q, f.supplier].filter(Boolean).length;
  const th = (k: string | null, label: string) => (
    <th key={label} className="px-3 py-2 text-start font-semibold whitespace-nowrap">
      <span className="inline-flex items-center gap-1">{label}{k ? cf.header(k, movements, getters[k], ar) : null}</span>
    </th>
  );
  const live = rows.filter((m) => !m.reversed && !m.isReversal);
  const sum = (type: 'in' | 'out') => live.filter((m) => m.type === type).reduce((a, m) => a + (Number(m.total) || 0), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 font-bold text-sm text-slate-800 flex items-center justify-between gap-2">
        <span>{ar ? 'سجل الحركات' : 'Movement log'} ({rows.length})
          <span className="ms-3 text-[12px] font-semibold text-emerald-700">{ar ? 'قيمة الوارد' : 'In value'}: {money(sum('in'))}</span>
        </span>
        {canEdit && <span className="text-[11px] font-normal text-slate-400">{ar ? 'الحركة المسجّلة لا تُعدَّل — الغلط يتصحّح بتراجع مسجَّل باسمك' : 'A recorded movement is never edited — mistakes are reversed, on the record'}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder={ar ? 'الصنف / المورد / المركبة / السبب…' : 'item / supplier / vehicle / reason…'} className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-60 max-w-full" />
        </div>
        <select value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value }))} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{ar ? 'وارد وصادر' : 'In & out'}</option>
          <option value="in">{ar ? 'وارد' : 'In'}</option>
          <option value="out">{ar ? 'صادر' : 'Out'}</option>
        </select>
        <select value={f.supplier} onChange={(e) => setF((p) => ({ ...p, supplier: e.target.value }))} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white max-w-[190px]">
          <option value="">{ar ? 'كل الموردين' : 'All suppliers'}</option>
          {suppliers.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
        </select>
        <PeriodFilter ar={ar} from={f.from} to={f.to} onChange={(a, b) => setF((p) => ({ ...p, from: a, to: b }))} />
        {active > 0 && <button type="button" onClick={() => setF(() => ({ type: '', from: '', to: '', q: '', supplier: '' }))} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs">{ar ? `مسح (${active})` : `Reset (${active})`} <X className="w-3 h-3" /></button>}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
      </div>
      <ScrollX className="max-h-[28rem] overflow-y-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-100 text-slate-500 text-xs sticky top-0 z-10"><tr>
            {th('month', ar ? 'التاريخ' : 'Date')}
            {th('item', ar ? 'الصنف' : 'Item')}
            {th('type', ar ? 'الحركة' : 'Type')}
            {th(null, ar ? 'الكمية' : 'Qty')}
            {th('supplier', ar ? 'المورد' : 'Supplier')}
            {th(null, ar ? 'سعر القطعة' : 'Unit price')}
            {th(null, ar ? 'الإجمالي' : 'Total')}
            {th('vehicle', ar ? 'المركبة' : 'Vehicle')}
            {th(null, ar ? 'الرصيد بعدها' : 'Balance')}
            {th('by', ar ? 'بواسطة' : 'By')}
            <th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => (
              <tr key={m._id} className={`hover:bg-slate-50 ${m.reversed ? 'bg-slate-50/60 text-slate-400' : ''}`}>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap text-xs">{dmy(m.date)}</td>
                <td className="px-3 py-1.5 font-medium text-slate-700">
                  <span className={m.reversed ? 'line-through' : ''}>{m.itemName}</span>
                  <span className="block text-[10px] leading-tight">
                    {m.reversed && <span className="text-red-500">{ar ? 'مُلغاة' : 'reversed'}{m.reversedByName ? ` · ${m.reversedByName}` : ''}</span>}
                    {m.isReversal && <span className="text-amber-600">{ar ? 'حركة تراجع' : 'reversal entry'}</span>}
                    {m.reversed && m.reversalReason && <span className="block text-slate-400">{m.reversalReason}</span>}
                    {!m.reversed && !m.isReversal && m.reason ? <span className="text-slate-400">{m.reason}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.reversed ? 'bg-slate-200 text-slate-500' : m.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-[#f37121]'}`}>{m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')}</span></td>
                <td className={`px-3 py-1.5 font-bold whitespace-nowrap ${m.reversed ? 'line-through' : ''}`} style={{ color: m.reversed ? '#94a3b8' : m.type === 'in' ? '#059669' : '#f37121' }}>{m.type === 'in' ? '+' : '−'}{m.quantity} <span className="text-[10px] font-normal text-slate-400">{m.unit}</span></td>
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{m.supplierName || '—'}</td>
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{m.unitPrice != null ? money(m.unitPrice) : '—'}</td>
                <td className="px-3 py-1.5 font-semibold text-emerald-700 whitespace-nowrap">{m.total != null ? money(m.total) : '—'}</td>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                  {m.vehiclePlate || '—'}
                  {/* ولوحتُها في سجلّ المركبات حين تختلف كتابتُها */}
                  {m.vehicleRegistryPlate && m.vehicleRegistryPlate !== m.vehiclePlate ? <span className="block text-[10px] text-slate-400">{m.vehicleRegistryPlate}</span> : null}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{m.balanceAfter}</td>
                <td className="px-3 py-1.5 text-slate-400 text-xs whitespace-nowrap">{m.performedByName || '—'}</td>
                <td className="px-3 py-1.5">
                  {canEdit && m.canReverse && (
                    <button type="button" onClick={() => setUndoing(m)}
                      title={ar ? 'التراجع عن الحركة' : 'Reverse'}
                      className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold inline-flex items-center gap-1">
                      <Undo2 className="w-3.5 h-3.5" />{ar ? 'تراجع' : 'Undo'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">{ar ? 'لا حركاتَ في هذا العرض' : 'No movements in this view'}</td></tr>}
          </tbody>
        </table>
      </ScrollX>
      {undoing && <ReverseModal m={undoing} ar={ar} base={base} onClose={() => setUndoing(null)} onDone={() => { setUndoing(null); onChanged(); }} />}
    </div>
  );
}

// التراجع عن حركة. مفيش حقول تتعدّل هنا عن قصد — السبب بس، وهو إجباري.
// لو الكمية الصح مختلفة، بيتراجع عن الغلط وبعدين يسجّل حركة جديدة عادية؛
// الاتنين بيبانوا باسم صاحبهم بدل ما رقم واحد يتغيّر في الخفا.
function ReverseModal({ m, ar, onClose, onDone, base }: { m: Movement; ar: boolean; onClose: () => void; onDone: () => void; base: string }) {
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 3) { notify(ar ? 'اكتب سبب التراجع' : 'A reason is required', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`${base}/movements/${m._id}/reverse`, { reason: reason.trim() });
      notify(ar ? 'تم التراجع ورجع الرصيد' : 'Reversed', 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-red-600">{ar ? 'التراجع عن الحركة' : 'Reverse movement'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {m.itemName} · <b>{m.type === 'in' ? (ar ? 'وارد' : 'In') : (ar ? 'صادر' : 'Out')} {m.quantity}</b>
          {m.vehiclePlate ? ` · ${m.vehiclePlate}` : ''} · {new Date(m.createdAt).toLocaleDateString('en-GB')}
          {m.performedByName ? ` · ${m.performedByName}` : ''}
        </p>

        <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'سبب التراجع' : 'Reason'} *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder={ar ? 'مثال: اتسجّلت على العربية الغلط' : 'e.g. recorded against the wrong vehicle'}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />

        <p className="mt-3 text-[11px] leading-relaxed rounded-lg px-3 py-2 bg-slate-50 text-slate-500">
          {ar
            ? 'الحركة الأصلية لا تُعدَّل ولا تُحذَف — تبقى في السجل مشطوبة، وتُسجَّل بجوارها حركة معاكسة باسمك وبسببك، ويعود الرصيد كما كان. وإذا كانت الكمية الصحيحة مختلفة، سجِّل حركة جديدة بعد التراجع.'
            : 'The original is neither edited nor deleted — it stays in the log, struck through, with an opposite entry recorded under your name and reason. If the right quantity differs, record a fresh movement afterwards.'}
        </p>

        <button onClick={submit} disabled={busy || reason.trim().length < 3}
          className="w-full mt-3 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? (ar ? 'جارٍ التنفيذ…' : 'Working…') : (ar ? 'تأكيد التراجع' : 'Confirm reversal')}
        </button>
      </div>
    </div>
  );
}

// صادر لأكتر من صنف مرة واحدة — **نفس** إنبوتس الصادر المفرد (العربية والسبب)،
// بس بتتطبّق على كل اللي اتحدّد. الصنف بينزل منه قطعة واحدة؛ اللي عايز كميات
// مختلفة بيستعمل الصادر المفرد، والحركتين بيدخلوا نفس السجل بنفس الشكل.
// حركة جماعية لعدة أصناف — صادر أو وارد.
//
// الكمية بجوار كل صنف، وافتراضها ١ لأن هذا هو الغالب؛ ومن يحتاج أكثر يكتبه على
// صنفه وحده دون أن يمسّ الباقي. ونفس الشاشة تخدم الوارد، لأن التوريد أيضًا قد
// يحمل كميات مختلفة لكل صنف.
//
// الرصيد المتوقَّع بعد الحركة يظهر بجانب كل سطر قبل التأكيد — فلا يُفاجأ أحد
// بالنتيجة بعد الحفظ. والصنف الذي لا يكفي رصيده يُعلَّم بالأحمر، والعملية كلها
// ترفض إن بقي واحد منها ناقصًا.
function BulkOutModal({ items, plates, ar, kind = 'out', onClose, onDone, base, suppliers }: {
  suppliers: Supplier[];
  items: Item[]; plates: PlateRow[]; ar: boolean; kind?: 'in' | 'out';
  onClose: () => void; onDone: () => void; base: string;
}) {
  const { notify } = useDialog();
  const isIn = kind === 'in';
  const t = (a: string, e: string) => (ar ? a : e);
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [qty, setQty] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i._id, '1'])));
  // الواردُ بسعر قطعته — يبدأ بسعر كلّ صنفٍ المسجَّل.
  const [price, setPrice] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i._id, i.unitPrice ? String(i.unitPrice) : ''])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const n = (id: string) => Math.max(1, Number(qty[id]) || 1);
  const unpriced = isIn ? items.filter((i) => !(Number(price[i._id]) > 0)) : [];
  const short = isIn ? [] : items.filter((i) => i.quantity < n(i._id));
  const totalQty = items.reduce((a, i) => a + n(i._id), 0);

  const submit = async () => {
    setErrors({}); setBusy(true);
    try {
      const r = await api.post<any>(`${base}/bulk-movement`, {
        type: kind,
        lines: items.map((i) => ({ item: i._id, quantity: n(i._id), ...(isIn ? { unitPrice: Number(price[i._id]) } : {}) })),
        vehiclePlate: plate.trim(), reason: reason.trim(),
        ...(isIn ? { date, ...(supplier ? supplierBody(supplier) : {}) } : {}),
      });
      notify(t(
        `${isIn ? 'سُجِّل وارد' : 'سُجِّل صادر'} ${r?.summary?.items ?? items.length} صنف · ${r?.summary?.totalQty ?? totalQty} قطعة`,
        `${isIn ? 'Received' : 'Issued'} ${r?.summary?.items ?? items.length} items · ${r?.summary?.totalQty ?? totalQty} units`), 'success');
      onDone();
    } catch (e: any) {
      const errs = e?.data?.errors || e?.errors;
      if (Array.isArray(errs) && errs.length) {
        const map: Record<string, string> = {};
        errs.forEach((x: any) => { if (x.id) map[String(x.id)] = x.message; });
        setErrors(map);
        notify(t('رُفضت العملية بالكامل — لم يتغيّر أي رصيد', 'Rejected in full — no balance changed'), 'error');
      } else notify(e?.message || 'Failed', 'error');
    } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const accent = isIn ? '#059669' : '#f37121';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h3 className="font-bold text-lg" style={{ color: accent }}>
            {isIn ? t('وارد لعدة أصناف', 'Receive multiple items') : t('صادر لعدة أصناف', 'Issue multiple items')}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="px-5 text-sm text-slate-600 mb-3">
          {t(`${items.length} صنف محدَّد · ${totalQty} قطعة`, `${items.length} items · ${totalQty} units`)}
        </p>

        <div className="px-5 space-y-3">
          {isIn && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'المورد' : 'Supplier'}</label>
                <SupplierSelect suppliers={suppliers} value={supplier} onChange={setSupplier} ar={ar} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'تاريخ الشراء' : 'Purchase date'}</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
              </div>
            </div>
          )}
          <PlatePicker plates={plates} value={plate} onChange={setPlate} ar={ar}
            label={isIn ? t('واردة من مركبة (اختياري)', 'In from vehicle (optional)') : t('صادرة على مركبة', 'Out to vehicle')} />
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">{t('ملاحظة / سبب', 'Reason')}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} />
          </div>
        </div>

        <div className="px-5 mt-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-700">{t('الكمية لكل صنف', 'Quantity per item')}</p>
            <button onClick={() => setQty(Object.fromEntries(items.map((i) => [i._id, '1'])))}
              className="text-[11.5px] text-slate-600 hover:text-slate-900 underline">
              {t('إرجاع الكل إلى ١', 'Reset all to 1')}
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {items.map((i) => {
              const bad = errors[i._id] || (!isIn && i.quantity < n(i._id)
                ? t(`الرصيد ${i.quantity} والمطلوب ${n(i._id)}`, `Stock ${i.quantity}, need ${n(i._id)}`) : '');
              const after = isIn ? i.quantity + n(i._id) : i.quantity - n(i._id);
              return (
                <div key={i._id} className={`px-3 py-2 ${bad ? 'bg-rose-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[13px] text-slate-900 truncate">{i.name}</span>
                    <span className="text-[11.5px] text-slate-600 tabular-nums whitespace-nowrap">
                      {i.quantity} {i.unit}
                    </span>
                    <input type="number" min={1} value={qty[i._id] ?? '1'}
                      onChange={(e) => setQty((q) => ({ ...q, [i._id]: e.target.value }))}
                      className="w-20 px-2 py-1 rounded-lg border border-slate-300 text-[13px] text-center tabular-nums" />
                    {isIn && (
                      <input type="number" min={0} step="0.01" value={price[i._id] ?? ''} placeholder={t('سعر القطعة', 'Unit price')}
                        title={t('سعر القطعة الواحدة', 'Unit price')}
                        onChange={(e) => setPrice((p) => ({ ...p, [i._id]: e.target.value }))}
                        className={`w-24 px-2 py-1 rounded-lg border text-[13px] text-center tabular-nums ${Number(price[i._id]) > 0 ? 'border-slate-300' : 'border-rose-400 bg-rose-50'}`} />
                    )}
                    <span className={`text-[11.5px] font-bold tabular-nums whitespace-nowrap ${bad ? 'text-rose-700' : 'text-slate-700'}`}>
                      → {Math.max(0, after)}
                    </span>
                  </div>
                  {bad && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">{bad}</p>}
                </div>
              );
            })}
          </div>
          {short.length > 0 && (
            <p className="text-[12px] text-rose-700 font-semibold mt-2">
              {t(`${short.length} صنف رصيده غير كافٍ — سترفض العملية بالكامل`, `${short.length} items short — the whole issue will be rejected`)}
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          {unpriced.length > 0 && (
            <p className="text-[12px] text-rose-700 font-semibold mb-2">
              {t(`اكتب سعر القطعة الواحدة لـ ${unpriced.length} صنف`, `Enter the unit price for ${unpriced.length} item(s)`)}
            </p>
          )}
          <button onClick={submit} disabled={busy || !items.length || short.length > 0 || unpriced.length > 0}
            className="w-full py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: accent }}>
            {busy ? t('جارٍ التسجيل…', 'Recording…')
              : short.length > 0 ? t('توجد أصناف رصيدها غير كافٍ', 'Some items are short')
              : t(`تسجيل ${isIn ? 'الوارد' : 'الصادر'} (${items.length} صنف · ${totalQty} قطعة)`,
                  `Record ${isIn ? 'receipt' : 'issue'} (${items.length} items · ${totalQty} units)`)}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * ── منتقي المركبة: قائمةٌ تُبحَث، وتحتها مشروعُها ─────────────────────────────
 *
 * كان `<input list>` — و`datalist` في المتصفّحات ليس قائمةً منسدلة: لا يُفتَح
 * بضغطةٍ موثوقة، ولا يُظهر إلّا اللوحةَ عاريةً، ويُقصّ بعد خمسةٍ أو ستّة في
 * بعضها. وقائمةُ مئتي مركبةٍ بلا بحثٍ لا تُستعمَل أصلًا.
 *
 * فصارت `SearchableSelect`: تُبحَث باللوحة أو بالمشروع أو باسم الراكب،
 * و`allowCustom` يبقي بابَ كتابةِ لوحةٍ ليست في السجلّ مفتوحًا (مركبةٌ أُدخلت
 * اليومَ ولم تُسجَّل بعد) — ومن كتبها يُقال له صريحًا إنّها ليست في السجلّ.
 *
 * وتحت الخانة سطرٌ يقول مشروعَ المركبة المختارة وراكبَها وفرعَها: السؤالُ الذي
 * يُسأل بعد الاختيار مباشرةً — «على حساب أيّ مشروع؟» — فيُجاب في موضعه.
 */
function PlatePicker({ plates, value, onChange, ar, label }: {
  plates: PlateRow[]; value: string; onChange: (v: string) => void; ar: boolean; label: string;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  // المختارةُ تُطابَق بمفتاح اللوحة: «١٢٣٤ ا ب ج» و«1234 ABC» لوحةٌ واحدة.
  const hit = plates.find((p) => plateKeyOf(p.plate) === plateKeyOf(value)) || null;
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <SearchableSelect
        value={value}
        onChange={(v) => onChange(formatPlate(v) || v)}
        allowCustom
        searchAfter={0}
        customHint={(x) => t(`استعمل «${x}» — لوحةٌ ليست في سجلّ القسم`, `Use “${x}” — not in the register`)}
        placeholder={t('اختر المركبة — اكتب للبحث…', 'Pick the vehicle — type to search…')}
        searchPlaceholder={t('اللوحة أو المشروع أو اسم الراكب…', 'Plate, project or rider…')}
        emptyLabel={t('لا نتائج — اكتب اللوحة كما هي', 'No match — type the plate')}
        footer={t(`${plates.length} مركبة في سجلّ القسم`, `${plates.length} vehicles on file`)}
        options={plates.map((p) => ({
          value: p.plate,
          label: p.plate,
          hint: [p.project && `${t('مشروع', 'project')}: ${p.project}`, p.rider, p.city, p.detail]
            .filter(Boolean).join(' · '),
        }))}
      />
      {/* ومشروعُها يُقال في مكانه — لا يُبحَث عنه في شاشةٍ أخرى. */}
      {value.trim() ? (
        hit ? (
          <p className="mt-1.5 text-[11.5px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            {hit.project
              ? <>{t('هذه المركبة تبع مشروع', 'This vehicle is on project')} <b className="text-[#f37121]">{hit.project}</b></>
              : t('لا مشروعَ مسجَّلًا لهذه المركبة', 'No project recorded for this vehicle')}
            {hit.rider ? <> · {t('الراكب', 'rider')}: {hit.rider}</> : null}
            {hit.city ? <> · {hit.city}</> : null}
            {hit.detail ? <> · {hit.detail}</> : null}
          </p>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            {t('هذه اللوحة ليست في سجلّ مركبات القسم — ستُسجَّل الحركةُ عليها كما كُتبت.',
               'This plate is not in the section register — the movement will be recorded as typed.')}
          </p>
        )
      ) : null}
    </div>
  );
}

function MovementModal({ move, plates, ar, onClose, onDone, base, suppliers }: { suppliers: Supplier[]; move: { item: Item; type: 'in' | 'out' }; plates: PlateRow[]; ar: boolean; onClose: () => void; onDone: () => void; base: string }) {
  const { notify } = useDialog();
  const isIn = move.type === 'in';
  const [qty, setQty] = useState('1');
  // سعرُ القطعة في هذا الوارد — يبدأ بسعر الصنف المسجَّل ويُصحَّح إن تغيّر.
  const [price, setPrice] = useState(move.item.unitPrice ? String(move.item.unitPrice) : '');
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [supplier, setSupplier] = useState(move.item.supplier || '');
  const [date, setDate] = useState(todayYmd());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const q = Number(qty);
    if (!q || q <= 0) { notify(ar ? 'أدخل كمية صحيحة' : 'Enter a quantity', 'error'); return; }
    if (isIn && !(Number(price) > 0)) { notify(ar ? 'اكتب سعر القطعة الواحدة' : 'Enter the unit price', 'error'); return; }
    setBusy(true);
    try { await api.post(`${base}/${move.item._id}/movement`, { type: move.type, quantity: q, vehiclePlate: plate, reason, ...(isIn ? { unitPrice: Number(price), date, ...(supplier ? supplierBody(supplier) : {}) } : {}) }); notify(ar ? 'تم التسجيل' : 'Recorded', 'success'); onDone(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg" style={{ color: isIn ? '#059669' : '#f37121' }}>{isIn ? (ar ? 'وارد للمخزن' : 'Stock in') : (ar ? 'صادر من المخزن' : 'Stock out')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">{move.item.name} · {ar ? 'الرصيد الحالي' : 'current'}: <b>{move.item.quantity}</b> {move.item.unit}</p>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'الكمية' : 'Quantity'} *</label><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={inp} autoFocus /></div>
          {isIn && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'سعر القطعة الواحدة (ر.س)' : 'Unit price (SAR)'} *</label>
              <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inp} />
              {Number(price) > 0 && Number(qty) > 0 && (
                <p className="mt-1 text-[11.5px] text-slate-500">{ar ? 'قيمة الوارد' : 'Total'}: <b>{(Number(price) * Number(qty)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></p>
              )}
            </div>
          )}
          {isIn && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'المورد' : 'Supplier'}</label>
                <SupplierSelect suppliers={suppliers} value={supplier} onChange={setSupplier} ar={ar} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'تاريخ الشراء' : 'Purchase date'}</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
              </div>
            </div>
          )}
          <PlatePicker plates={plates} value={plate} onChange={setPlate} ar={ar}
            label={isIn ? (ar ? 'واردة من مركبة (اختياري)' : 'In from vehicle (optional)') : (ar ? 'صادرة على مركبة' : 'Out to vehicle')} />
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{ar ? 'ملاحظة / سبب' : 'Reason'}</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} /></div>
        </div>
        <button onClick={submit} disabled={busy} className="w-full mt-5 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: isIn ? '#059669' : '#f37121' }}>{ar ? 'تسجيل الحركة' : 'Record'}</button>
      </div>
    </div>
  );
}

const formLabel = 'block text-xs font-semibold text-slate-600 mb-1';
const formInput = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';

function ItemFormModal({ item, ar, onClose, onSaved, base, suppliers }: { item: Item | null; ar: boolean; onClose: () => void; onSaved: () => void; base: string; suppliers: Supplier[] }) {
  const { notify } = useDialog();
  const [f, setF] = useState<any>(item
    ? { ...item, supplier: item.supplier || '', purchaseDate: item.purchaseDate || '' }
    : { name: '', category: '', quantity: 1, unit: 'قطعة', unitPrice: 0, minQuantity: 0, code: '', notes: '', supplier: '', purchaseDate: todayYmd() });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name?.trim()) { notify(ar ? 'اسم الصنف مطلوب' : 'Name required', 'error'); return; }
    if (!item && !(Number(f.unitPrice) > 0)) { notify(ar ? 'اكتب سعر القطعة الواحدة' : 'Enter the unit price', 'error'); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name, category: f.category, code: f.code, unit: f.unit, unitPrice: f.unitPrice, minQuantity: f.minQuantity, notes: f.notes,
        purchaseDate: f.purchaseDate, ...(f.supplier ? supplierBody(String(f.supplier)) : { supplier: '', supplierName: '' }),
        ...(item ? {} : { quantity: f.quantity }),
      };
      if (item) await api.put(`${base}/${item._id}`, body);
      else await api.post(base, body);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success'); onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  const total = (Number(f.quantity) || 0) * (Number(f.unitPrice) || 0);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-lg">{item ? (ar ? 'تعديل صنف' : 'Edit item') : (ar ? 'صنف جديد' : 'New item')}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className={formLabel}>{ar ? 'اسم الصنف' : 'Name'} *</label><input className={formInput} value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
          <div><label className={formLabel}>{ar ? 'التصنيف' : 'Category'}</label><input className={formInput} value={f.category || ''} onChange={(e) => set('category', e.target.value)} /></div>
          <div><label className={formLabel}>{ar ? 'الكود' : 'Code'}</label><input className={formInput} value={f.code || ''} onChange={(e) => set('code', e.target.value)} /></div>
          <div className="md:col-span-2">
            <label className={formLabel}>{ar ? 'المورد' : 'Supplier'}</label>
            <SupplierSelect suppliers={suppliers} value={String(f.supplier || '')} onChange={(v) => set('supplier', v)} ar={ar} />
          </div>
          <div><label className={formLabel}>{ar ? 'تاريخ الشراء' : 'Purchase date'}</label><input type="date" className={formInput} value={f.purchaseDate || ''} onChange={(e) => set('purchaseDate', e.target.value)} /></div>
          <div><label className={formLabel}>{ar ? 'الوحدة' : 'Unit'}</label><ManagedSelect type="ls2_store_unit" storeLabel value={f.unit || ''} onChange={(v) => set('unit', v)} placeholder={ar ? 'قطعة / لتر…' : 'Piece / litre…'} /></div>
          {!item && <div><label className={formLabel}>{ar ? 'العدد' : 'Quantity'}</label><input type="number" min={0} className={formInput} value={f.quantity} onChange={(e) => set('quantity', e.target.value === '' ? '' : Number(e.target.value))} /></div>}
          <div><label className={formLabel}>{ar ? 'سعر القطعة الواحدة (ر.س) *' : 'Unit price (SAR) *'}</label><input type="number" min={0} step="0.01" className={formInput} value={f.unitPrice || ''} onChange={(e) => set('unitPrice', e.target.value === '' ? 0 : Number(e.target.value))} /></div>
          <div><label className={formLabel}>{ar ? 'حد التنبيه (نقص)' : 'Min qty (low alert)'}</label><input type="number" className={formInput} value={f.minQuantity || 0} onChange={(e) => set('minQuantity', Number(e.target.value))} /></div>
          {!item && total > 0 && <p className="md:col-span-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{ar ? 'الإجمالي' : 'Total'}: <b>{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> {ar ? 'ر.س' : 'SAR'}</p>}
          <div className="md:col-span-2"><label className={formLabel}>{ar ? 'ملاحظات' : 'Notes'}</label><textarea className={formInput} rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button><button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-50"><Save className="w-4 h-4" />{ar ? 'حفظ' : 'Save'}</button></div>
      </div>
    </div>
  );
}

/**
 * إضافةُ عدّة أصنافٍ دفعةً واحدة — فاتورةُ شراءٍ فيها عشرةُ أصنافٍ تُكتب في جدولٍ
 * واحد: الموردُ ويومُ الشراء مرّةً فوقه، ولكلّ صنفٍ سطر. والخادمُ يقبل الدفعةَ
 * كلَّها أو يرفضها كلَّها بأرقام الأسطر الناقصة.
 */
type NewRow = { id: number; name: string; category: string; code: string; quantity: string; unit: string; unitPrice: string };
let rowSeq = 1;
const blankRow = (): NewRow => ({ id: rowSeq++, name: '', category: '', code: '', quantity: '1', unit: 'قطعة', unitPrice: '' });

function BulkCreateModal({ ar, onClose, onSaved, base, suppliers }: { ar: boolean; onClose: () => void; onSaved: () => void; base: string; suppliers: Supplier[] }) {
  const { notify } = useDialog();
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [rows, setRows] = useState<NewRow[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState<string[]>(['قطعة', 'لتر']);
  useEffect(() => {
    api.get<{ items: { nameAr: string }[] }>('/api/lookups?type=ls2_store_unit&active=true')
      .then((d) => { const u = (d.items || []).map((x) => x.nameAr).filter(Boolean); if (u.length) setUnits(u); }).catch(() => {});
  }, []);
  const setRow = (id: number, k: keyof NewRow, v: string) => setRows((p) => p.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  // السطرُ الفارغُ تمامًا لا يُرسَل: ثلاثةُ أسطرٍ تُفتَح جاهزةً ولا يُلزَم بملئها.
  const filled = rows.filter((r) => r.name.trim() || r.unitPrice || r.code.trim());
  const total = filled.reduce((a, r) => a + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  const save = async () => {
    if (!filled.length) { notify(ar ? 'اكتب صنفًا واحدًا على الأقل' : 'Enter at least one item', 'error'); return; }
    setBusy(true); setErrors({});
    try {
      const r = await api.post<any>(`${base}/bulk-create`, {
        purchaseDate: date, ...(supplier ? supplierBody(supplier) : {}),
        items: filled.map((x) => ({ name: x.name.trim(), category: x.category.trim(), code: x.code.trim(), quantity: Number(x.quantity) || 0, unit: x.unit, unitPrice: Number(x.unitPrice) || 0 })),
      });
      notify(ar ? `أُضيف ${r?.summary?.count ?? filled.length} صنفًا` : `Added ${r?.summary?.count ?? filled.length} items`, 'success');
      onSaved();
    } catch (e: any) {
      const list: { line: number; message: string }[] = e?.data?.errors || e?.errors || [];
      if (list.length) setErrors(Object.fromEntries(list.map((x) => [filled[x.line - 1]?.id, x.message])));
      notify(e?.message || 'Failed', 'error');
    } finally { setBusy(false); }
  };
  const cell = 'w-full px-2 py-1.5 rounded-md border border-slate-200 text-[13px]';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-5xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-lg">{ar ? 'إضافة عدّة أصناف' : 'Add several items'}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        <p className="mb-4 text-[12.5px] text-slate-500">{ar ? 'الموردُ وتاريخُ الشراء يُكتبان مرّةً ويُطبَّقان على كلّ الأسطر. تُحفَظ الدفعةُ كلُّها أو لا يُحفَظ منها شيء.' : 'Supplier and date apply to every row. The batch is saved whole or not at all.'}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={formLabel}>{ar ? 'المورد' : 'Supplier'}</label><SupplierSelect suppliers={suppliers} value={supplier} onChange={setSupplier} ar={ar} /></div>
          <div><label className={formLabel}>{ar ? 'تاريخ الشراء' : 'Purchase date'}</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={formInput} /></div>
        </div>
        <ScrollX className="mt-4">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="bg-slate-900 text-slate-300 text-xs">
              {['#', ar ? 'اسم الصنف *' : 'Name *', ar ? 'التصنيف' : 'Category', ar ? 'الكود' : 'Code', ar ? 'العدد' : 'Qty', ar ? 'الوحدة' : 'Unit', ar ? 'سعر القطعة *' : 'Unit price *', ar ? 'الإجمالي' : 'Total', ''].map((h) => <th key={h} className="px-2 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.id} className={errors[r.id] ? 'bg-red-50' : ''}>
                  <td className="px-2 py-1.5 text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1.5 min-w-[14rem]">
                    <input className={cell} value={r.name} onChange={(e) => setRow(r.id, 'name', e.target.value)} />
                    {errors[r.id] && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{errors[r.id]}</p>}
                  </td>
                  <td className="px-2 py-1.5"><input className={cell} value={r.category} onChange={(e) => setRow(r.id, 'category', e.target.value)} /></td>
                  <td className="px-2 py-1.5 w-28"><input className={cell} value={r.code} onChange={(e) => setRow(r.id, 'code', e.target.value)} /></td>
                  <td className="px-2 py-1.5 w-20"><input type="number" min={0} className={cell} value={r.quantity} onChange={(e) => setRow(r.id, 'quantity', e.target.value)} /></td>
                  <td className="px-2 py-1.5 w-24">
                    <select className={cell} value={r.unit} onChange={(e) => setRow(r.id, 'unit', e.target.value)}>
                      {[...new Set([r.unit, ...units])].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 w-28"><input type="number" min={0} step="0.01" className={cell} value={r.unitPrice} onChange={(e) => setRow(r.id, 'unitPrice', e.target.value)} /></td>
                  <td className="px-2 py-1.5 w-24 font-semibold text-emerald-700 tabular-nums">{((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  <td className="px-2 py-1.5">{rows.length > 1 && <button type="button" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))} className="p-1 text-slate-300 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setRows((p) => [...p, blankRow()])} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"><Plus className="w-4 h-4" />{ar ? 'سطر آخر' : 'Another row'}</button>
          <span className="text-[13px] text-slate-600">{filled.length} {ar ? 'صنف' : 'items'} · {ar ? 'الإجمالي' : 'Total'}: <b className="text-emerald-700">{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></span>
          <span className="ms-auto flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
            <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-50"><Save className="w-4 h-4" />{ar ? `حفظ (${filled.length})` : `Save (${filled.length})`}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * ── لوحاتٌ غير معروفة ────────────────────────────────────────────────────────
 * كلُّ ما كُتب في خانة المركبة ولا مركبةَ له في سجلّ المركبات: لوحةٌ بكتابةٍ
 * لا تُطابَق، أو اسمُ موردٍ أو ورشةٍ كُتب مكانَ اللوحة. تُحلّ في الخادم عند كلّ
 * طلب، فما يُصحَّح في السجلّ يخرج من القائمة في الحال. والضغطُ على لوحةٍ يفلتر
 * السجلَّ بها ليُرى أين كُتبت.
 */
function UnknownPlates({ url, ar, onPick }: { url: string; ar: boolean; onPick: (plate: string) => void }) {
  const [data, setData] = useState<{ plates: { plate: string; movements: number; last: string }[]; total: number; movements: number } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api.get<any>(url).then(setData).catch(() => {}); }, [url]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:store', load);
  useSocket('vreg:updated', load);
  if (!data || !data.total) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-white shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-amber-50 text-amber-900 text-sm">
        <span className="flex items-center gap-2 font-semibold"><HelpCircle className="w-4 h-4" />{ar ? 'لوحات غير معروفة' : 'Unknown plates'}</span>
        <span className="flex items-center gap-2 text-xs">{data.total} {ar ? 'لوحة' : 'plates'} · {data.movements} {ar ? 'حركة' : 'movements'}{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && (
        <div className="p-3">
          <p className="text-xs text-slate-500 mb-2">{ar ? 'ما كُتب في خانة المركبة ولا مركبةَ له في سجلّ المركبات — لوحةٌ بكتابةٍ أخرى، أو اسمُ موردٍ أو ورشةٍ كُتب مكانَها. اضغط لوحةً لترى حركاتها.' : 'Text in the vehicle field that matches no vehicle in the registry. Click one to filter the log by it.'}</p>
          <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
            {data.plates.map((p) => (
              <button key={p.plate} type="button" onClick={() => onPick(p.plate)} title={p.last ? `${ar ? 'آخر حركة' : 'Last'}: ${p.last}` : ''}
                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 text-xs text-slate-700">
                {p.plate} <span className="text-slate-400">×{p.movements}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
