'use client';
// عملاء الأسطول — سجلٌّ لا معرضُ بطاقات.
//
// كانت الصفحة بطاقتين في الصفّ، وهو تصميمٌ يصلح لعشرة عملاء لا لمئتين
// وعشرين: لا يُقارَن فيه صفٌّ بصفّ، ولا يُفرز، ولا يُقرأ منه من الأكثر
// تعاملًا. فصارت جدولًا: كلُّ عميلٍ سطر، ومعه أرقامُه — رحلاته ودخله وآخر
// تعاملٍ معه — وفوقه فلترٌ وبحث. والضغط على السطر يفتح ملفَّه الكامل.
//
// وأرقامُ الصفوف تأتي محسوبةً من الخادم مع القائمة نفسها، لا باستعلامٍ لكلّ
// صفّ: مئتا استعلامٍ عند كلّ فتحةٍ للصفحة ثمنٌ لا يشتري شيئًا.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Users, Plus, Pencil, Trash2, Check, Loader2, X, Route, ChevronLeft, ChevronRight,
  Link2, RotateCcw, ArrowUpDown,
} from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, ErrorNotice, StatCard,
} from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import { FleetCustomer, canEditFleet, canAdminFleet } from '@/lib/fleet';

const PAY_AR: Record<string, string> = { tax: 'ضريبي', cash: 'كاش' };
const PAY_EN: Record<string, string> = { tax: 'Tax invoice', cash: 'Cash' };

// المسارات المتفق عليها تُصدَّر مسطّحةً في خليةٍ واحدة: العميل صفٌّ واحد في
// الملف، وتفريقُه على صفوفٍ بعدد مساراته يُفسد كل جمعٍ يُبنى فوقه لاحقًا.
const CUSTOMER_COLUMNS = [
  { header: 'العميل', key: 'name', width: 30 },
  { header: 'نوع الدفع', key: 'paymentType', transform: (v: any) => PAY_AR[v] || '', width: 12 },
  { header: 'الجوال', key: 'phone', width: 16 },
  { header: 'البريد', key: 'email', width: 24 },
  { header: 'الرقم الضريبي', key: 'taxNumber', width: 18 },
  { header: 'الفئة', key: 'customerType', transform: (v: any) => (v === 'heavy' ? 'نقل ثقيل' : v === 'branch' ? 'فروع' : ''), width: 12 },
  { header: 'الحمولات', key: 'trips', width: 10 },
  { header: 'الجارية', key: 'openTrips', width: 10 },
  { header: 'الدخل', key: 'income', width: 14 },
  { header: 'متوسط الحمولة', key: 'avgTrip', width: 14 },
  { header: 'آخر حمولة', key: 'lastTrip', transform: (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : ''), width: 14 },
  { header: 'شركة الـCRM', key: 'crm', transform: (v: any) => v?.name || '', width: 26 },
  { header: 'التقييم', key: 'rating', width: 10 },
  { header: 'أسعار المسارات', key: 'routes', transform: (v: any) => (v || []).map((r: any) => `${r.fromCity || ''}→${r.toCity || ''}${r.price != null ? ` (${r.price})` : ''}`).join(' | '), width: 44 },
  { header: 'عدد المسارات', key: 'routes', transform: (v: any) => (v || []).length, width: 12 },
  { header: 'الحالة', key: 'isActive', transform: (v: any) => (v === false ? 'معطَّل' : 'نشط'), width: 10 },
  { header: 'ملاحظات', key: 'notes', width: 28 },
];

const EMPTY = {
  name: '', phone: '', email: '', notes: '', paymentType: '', taxNumber: '', address: '',
  customerType: 'heavy', rating: 0,
  routes: [] as { fromCity: string; toCity: string; price: number | string | null }[],
};

const money = (v: any) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'));
const date = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

type SortKey = 'name' | 'trips' | 'income' | 'lastTrip' | 'avgTrip';

export default function FleetCustomersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { confirm, notify } = useDialog();
  const editor = canEditFleet(user);
  const admin = canAdminFleet(user);

  const [customers, setCustomers] = useState<FleetCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);
  const PER = 25;

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FleetCustomer | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // البحث يُرسَل إلى الخادم مع الفلاتر — فيبحث في اسم شركة الـCRM أيضًا، وهو
  // ما لا يستطيعه بحثٌ يعمل على الصفحة المعروضة وحدها.
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [filters, search]);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ customers: FleetCustomer[]; total: number }>(`/api/fleet/customers${qs ? `?${qs}` : ''}`);
      setCustomers(d.customers || []);
      setTotal(d.total || 0);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [qs]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [qs, sort, dir]);
  useSocket('fleet:customers', useCallback(() => load(), [load]));

  const sorted = useMemo(() => {
    const rows = [...customers];
    rows.sort((a, b) => {
      let x: any; let y: any;
      if (sort === 'name') { x = a.name || ''; y = b.name || ''; return x.localeCompare(y, 'ar') * dir; }
      if (sort === 'lastTrip') { x = a.lastTrip ? +new Date(a.lastTrip) : 0; y = b.lastTrip ? +new Date(b.lastTrip) : 0; }
      else { x = (a as any)[sort] || 0; y = (b as any)[sort] || 0; }
      return (x - y) * dir;
    });
    return rows;
  }, [customers, sort, dir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PER));
  const shown = sorted.slice((page - 1) * PER, page * PER);

  const totals = useMemo(() => ({
    trips: customers.reduce((a, c) => a + (c.trips || 0), 0),
    income: customers.reduce((a, c) => a + (c.income || 0), 0),
    open: customers.reduce((a, c) => a + (c.openTrips || 0), 0),
    dealt: customers.filter((c) => (c.trips || 0) > 0).length,
  }), [customers]);

  const openCreate = () => { setEditing(null); setForm(JSON.parse(JSON.stringify(EMPTY))); setShowModal(true); };
  const openEdit = (c: FleetCustomer) => {
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '',
      paymentType: c.paymentType || '', taxNumber: c.taxNumber || '', address: c.address || '',
      customerType: c.customerType || 'heavy', rating: c.rating || 0,
      routes: (c.routes || []).map((r) => ({ ...r })),
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        rating: Number(form.rating) || 0,
        routes: form.routes
          .filter((r: any) => String(r.fromCity || '').trim() && String(r.toCity || '').trim())
          .map((r: any) => ({ ...r, price: r.price === '' || r.price == null ? null : Number(r.price) })),
      };
      if (editing) await api.put(`/api/fleet/customers/${editing._id}`, payload);
      else await api.post('/api/fleet/customers', payload);
      setShowModal(false); load();
      notify(t('حُفظ.', 'Saved.'), 'success');
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (c: FleetCustomer) => {
    // بلا حمولاتٍ يُحذف نهائيًّا؛ ومع حمولاتٍ يُعطَّل فقط، لأنّ حذفه يترك
    // بوليصاتٍ تشير إلى عميلٍ لا وجود له.
    const hard = (c.trips || 0) === 0;
    if (!(await confirm(hard
      ? t(`حذف «${c.name}» نهائيًّا؟ لا حمولة له.`, `Delete “${c.name}” permanently? No shipments.`)
      : t(`تعطيل «${c.name}»؟ حمولاته الـ${c.trips} تبقى كما هي.`, `Disable “${c.name}”? Their ${c.trips} shipments stay.`)))) return;
    try { await api.delete(`/api/fleet/customers/${c._id}${hard ? '?purge=1' : ''}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const restore = async (c: FleetCustomer) => {
    try { await api.post(`/api/fleet/customers/${c._id}/restore`, {}); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={`px-3 py-2.5 font-semibold whitespace-nowrap ${num ? 'text-center' : 'text-start'}`}>
      <button type="button" onClick={() => { if (sort === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(k === 'name' ? 1 : -1); } }}
        className={`inline-flex items-center gap-1 hover:text-[#f37121] ${sort === k ? 'text-[#f37121]' : ''}`}>
        {label}<ArrowUpDown className="w-3 h-3 opacity-60" />
      </button>
    </th>
  );

  if (loading) return <Spinner />;

  const setRoute = (i: number, k: string, v: any) =>
    setForm((f: any) => ({ ...f, routes: f.routes.map((r: any, x: number) => (x === i ? { ...r, [k]: v } : r)) }));

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={t('عملاؤنا', 'Our customers')}
        subtitle={t(
          `${total} عميلًا — نوع الدفع المتفق عليه يُملأ تلقائيًّا في الحمولة عند اختيار العميل`,
          `${total} customers — the agreed payment type prefills each new shipment`)}>
        <ExportMenu lang={ar ? 'ar' : 'en'} fileName="fleet-customers"
          options={[
            { key: 'page', label: t(`الصفحة المعروضة (${shown.length})`, `This page (${shown.length})`), sheets: [{ name: 'Customers', rows: shown as any[], columns: CUSTOMER_COLUMNS }] },
            { key: 'view', label: t(`نتيجة الفلتر (${sorted.length})`, `Filtered (${sorted.length})`), sheets: [{ name: 'Customers', rows: sorted as any[], columns: CUSTOMER_COLUMNS }] },
            { key: 'all', label: t(`كل العملاء (${total})`, `All customers (${total})`), sheets: [{ name: 'Customers', rows: customers as any[], columns: CUSTOMER_COLUMNS }] },
          ]} />
        {editor && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {t('إضافة عميل', 'Add customer')}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t('العملاء المعروضون', 'Customers shown')} value={sorted.length} />
        <StatCard label={t('تعامَلنا معهم', 'With shipments')} value={totals.dealt} accent="#0ea5e9" />
        <StatCard label={t('حمولاتٌ جارية', 'Open shipments')} value={totals.open} accent="#f59e0b" />
        <StatCard label={t('الدخل من المعروضين', 'Income shown')} value={money(totals.income)} accent="#16a34a" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterPanel optionsUrl="/api/fleet/customers/filters" value={filters} onChange={setFilters}
          resultCount={sorted.length} resultLabel={t('العملاء المطابقون', 'Matching customers')} />
        <div className="min-w-[240px] flex-1 max-w-md">
          <SearchInput value={search} onChange={setSearch}
            placeholder={t('بحث بالاسم أو الجوال أو الرقم الضريبي أو اسم الشركة في الـCRM…', 'Search name, phone, tax no. or CRM company…')} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <Th k="name" label={t('العميل', 'Customer')} />
                <th className="px-3 py-2.5 font-semibold text-start whitespace-nowrap">{t('نوع الدفع', 'Payment')}</th>
                <th className="px-3 py-2.5 font-semibold text-start whitespace-nowrap">{t('التواصل', 'Contact')}</th>
                <Th k="trips" label={t('حمولات', 'Trips')} num />
                <Th k="income" label={t('الدخل', 'Income')} num />
                <Th k="avgTrip" label={t('متوسط الحمولة', 'Avg / trip')} num />
                <Th k="lastTrip" label={t('آخر حمولة', 'Last trip')} num />
                <th className="px-3 py-2.5 font-semibold text-start whitespace-nowrap">{t('الـCRM', 'CRM')}</th>
                <th className="px-3 py-2.5 font-semibold text-center whitespace-nowrap">{t('المسارات', 'Routes')}</th>
                {(editor || admin) && <th className="px-3 py-2.5 w-20" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-slate-500">
                  {total === 0 ? t('لا يوجد عملاء بعد.', 'No customers yet.') : t('لا نتائج مطابقة.', 'No matches.')}
                </td></tr>
              ) : shown.map((c) => (
                <tr key={c._id} onClick={() => router.push(`/system/fleet/customers/${c._id}`)}
                  className={`cursor-pointer hover:bg-orange-50/40 ${c.isActive === false ? 'opacity-55' : ''}`}>
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {c.isActive === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{t('معطَّل', 'Disabled')}</span>}
                      {!!c.openTrips && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{t(`${c.openTrips} جارية`, `${c.openTrips} open`)}</span>}
                      {!!c.rating && <span className="text-[10px] text-amber-500">{'★'.repeat(c.rating)}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {c.paymentType
                      ? <span className={`text-[11px] px-2 py-1 rounded-lg font-semibold ${c.paymentType === 'tax' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {ar ? PAY_AR[c.paymentType] || c.paymentType : PAY_EN[c.paymentType] || c.paymentType}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-xs">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{c.trips || 0}</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-emerald-700">{money(c.income)}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{money(c.avgTrip)}</td>
                  <td className="px-3 py-2.5 text-center text-slate-600 whitespace-nowrap">{date(c.lastTrip)}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {c.crm
                      ? <span className="inline-flex items-center gap-1 text-slate-600" title={c.crm.name}><Link2 className="w-3 h-3 text-sky-500" />{(c.crm.arabicName || c.crm.name).slice(0, 22)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{(c.routes || []).length || '—'}</td>
                  {(editor || admin) && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {editor && <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100" title={t('تعديل', 'Edit')}><Pencil className="w-3.5 h-3.5" /></button>}
                        {admin && (c.isActive === false
                          ? <button type="button" onClick={() => restore(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100" title={t('إعادة تفعيل', 'Restore')}><RotateCcw className="w-3.5 h-3.5" /></button>
                          : <button type="button" onClick={() => remove(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100" title={t('إزالة', 'Remove')}><Trash2 className="w-3.5 h-3.5" /></button>)}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm">
            <span className="text-slate-500">{t(`${(page - 1) * PER + 1}–${Math.min(page * PER, sorted.length)} من ${sorted.length}`, `${(page - 1) * PER + 1}–${Math.min(page * PER, sorted.length)} of ${sorted.length}`)}</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30" aria-label="prev">{isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}</button>
              <span className="px-2 text-slate-600">{page} / {pages}</span>
              <button type="button" disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30" aria-label="next">{isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? t('تعديل عميل', 'Edit customer') : t('إضافة عميل', 'Add customer')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t('حفظ', 'Save')}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('الاسم *', 'Name *')} span2><TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={t('نوع الدفع المتفق عليه', 'Agreed payment type')}>
            <SearchableManagedSelect type="fleet_payment_type" value={form.paymentType || ''}
              onChange={(v: string) => setForm((f: any) => ({ ...f, paymentType: v }))}
              placeholder={t('اختر…', 'Choose…')} />
          </Field>
          <Field label={t('الفئة', 'Category')}>
            <select value={form.customerType} onChange={(e) => setForm((f: any) => ({ ...f, customerType: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm">
              <option value="heavy">{t('نقل ثقيل', 'Heavy transport')}</option>
              <option value="branch">{t('فروع', 'Branch')}</option>
            </select>
          </Field>
          <Field label={t('الجوال', 'Phone')}><TextInput value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label={t('البريد', 'Email')}><TextInput value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} /></Field>
          <Field label={t('الرقم الضريبي', 'Tax number')}><TextInput value={form.taxNumber} onChange={(e) => setForm((f: any) => ({ ...f, taxNumber: e.target.value }))} /></Field>
          <Field label={t('التقييم (0–5)', 'Rating (0–5)')}>
            <TextInput type="number" min={0} max={5} value={form.rating} onChange={(e) => setForm((f: any) => ({ ...f, rating: e.target.value }))} />
          </Field>
          <Field label={t('العنوان', 'Address')} span2><TextInput value={form.address} onChange={(e) => setForm((f: any) => ({ ...f, address: e.target.value }))} /></Field>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-600 flex items-center gap-1"><Route className="w-3.5 h-3.5" /> {t('أسعار المسارات (من → إلى → السعر)', 'Route prices (from → to → price)')}</p>
            <button type="button"
              onClick={() => setForm((f: any) => ({ ...f, routes: [...f.routes, { fromCity: '', toCity: '', price: '' }] }))}
              className="text-xs text-[#f37121] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> {t('إضافة مسار', 'Add route')}</button>
          </div>
          {form.routes.length === 0 && <p className="text-xs text-slate-400">{t('لا توجد مسارات.', 'No routes.')}</p>}
          <div className="space-y-2">
            {form.routes.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput value={r.fromCity} onChange={(e) => setRoute(i, 'fromCity', e.target.value)} placeholder={t('من…', 'From…')} />
                <TextInput value={r.toCity} onChange={(e) => setRoute(i, 'toCity', e.target.value)} placeholder={t('إلى…', 'To…')} />
                <TextInput type="number" value={r.price ?? ''} onChange={(e) => setRoute(i, 'price', e.target.value)} placeholder={t('السعر', 'Price')} />
                <button type="button" onClick={() => setForm((f: any) => ({ ...f, routes: f.routes.filter((_: any, x: number) => x !== i) }))}
                  className="p-2 text-slate-400 hover:text-red-600 shrink-0" aria-label="remove"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>

        <Field label={t('ملاحظات', 'Notes')}>
          <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </Modal>
    </div>
  );
}
