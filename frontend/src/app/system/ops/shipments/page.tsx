'use client';
// Shipments — the core of the Operations Platform. Rich multi-select status
// filter + quick stat cards, precise search (graduation statement number is the
// important unique id), the full status workflow, and a comprehensive detail
// view that surfaces ALL the nested data UPL returns (driver, vehicle, owner,
// customer, delegate, pricing, timeline). Live via `ops:shipments:changed`.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Truck, MapPin, RefreshCw, ChevronLeft, ChevronRight, Check, Loader2, Clock, X } from 'lucide-react';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, Select, TextInput } from '@/components/hr/HRKit';
import {
  SHIPMENT_STATUSES, PAYMENT_METHODS, statusStyle, locName, fmtDateTime, fmtMoney, fmtNum,
  timelineMeta, isOpsStaff, isOpsAdmin, opsText, type Paginated,
} from '@/lib/ops';

const LIMIT = 25;
type Row = Record<string, any>;

// UPL splits shipment search across many params. The generic `search` is fuzzy
// (matches several fields at once), so for the unique numbers we search + filter
// to the EXACT field client-side to avoid cross-field collisions.
const SEARCH_FIELDS = [
  { value: '', en: 'Anything', ar: 'الكل' },
  { value: 'graduation', en: 'Graduation statement #', ar: 'رقم كشف التخريج' },
  { value: 'reference', en: 'Reference #', ar: 'رقم المرجع' },
  { value: 'driver_name', en: 'Driver name', ar: 'اسم السائق' },
  { value: 'driver_phone', en: 'Driver phone', ar: 'هاتف السائق' },
  { value: 'car_number', en: 'Car number', ar: 'رقم السيارة' },
  { value: 'car_name', en: 'Car name', ar: 'اسم السيارة' },
  { value: 'user_name', en: 'Customer name', ar: 'اسم العميل' },
  { value: 'user_phone', en: 'Customer phone', ar: 'هاتف العميل' },
  { value: 'truck_type_name', en: 'Truck type', ar: 'نوع الشاحنة' },
  { value: 'load_type_name', en: 'Load type', ar: 'نوع الحمولة' },
];

// Nested-field extractors (driver name lives on driver.admin, not driver).
const driverName = (s: Row, lang: 'en' | 'ar') => locName(s?.driver?.admin?.name, lang) || locName(s?.driver?.name, lang) || '—';
const driverPhone = (s: Row) => s?.driver?.admin?.phone || s?.driver?.phone || '';
const carOwnerName = (s: Row, lang: 'en' | 'ar') => s?.car?.owner?.owner_name || locName(s?.car?.owner?.owner?.name, lang) || '—';

export default function OpsShipmentsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = opsText(lang);
  const admin = isOpsAdmin(user?.role);
  const searchParams = useSearchParams();

  const [items, setItems] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Paginated<unknown>['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchField, setSearchField] = useState('');
  const [statuses, setStatuses] = useState<string[]>(searchParams?.get('status') ? [searchParams.get('status') as string] : []);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [branches, setBranches] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [detail, setDetail] = useState<Row | null>(null);
  const [timeline, setTimeline] = useState<any[] | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, searchField, statuses, dateFrom, dateTo, branchFilter]);
  useEffect(() => { api.get<Paginated<Row>>('/api/ops/branches?limit=100').then((d) => setBranches(d.items || [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page)); qs.set('limit', String(LIMIT)); qs.set('lang', lang);
      qs.set('sort[updated_at]', 'desc');
      if (debounced) {
        if (searchField === 'graduation' || searchField === 'reference' || searchField === '') qs.set('search', debounced);
        else qs.set(searchField, debounced);
      }
      statuses.forEach((s) => qs.append('status', s));
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      if (branchFilter) qs.set('branches', branchFilter);
      const d = await api.get<Paginated<Row>>(`/api/ops/shipments?${qs.toString()}`);
      let list = d.items || [];
      // Exact client-side match for the unique numbers (the fuzzy `search` can
      // surface a different shipment whose other field contains the digits).
      if (debounced && searchField === 'graduation') list = list.filter((s) => String(s.graduation_statement_num) === debounced);
      if (debounced && searchField === 'reference') list = list.filter((s) => String(s.reference_num) === debounced);
      setItems(list);
      setMeta(d.meta || null);
      setStale(false);
    } catch { setStale(true); /* keep last data on API hiccup */ }
    setLoading(false); setLoaded(true);
  }, [page, debounced, searchField, statuses, dateFrom, dateTo, branchFilter, lang]);

  useEffect(() => { load(); }, [load]);
  // Quick status counts strip — scoped to the active branch/date filters, live.
  const loadCounts = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ lang });
      if (branchFilter) qs.set('branches', branchFilter);
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      const dash = await api.get<any>(`/api/ops/dashboard?${qs.toString()}`);
      const filtered = !!(branchFilter || dateFrom || dateTo);
      const src = filtered
        ? (dash?.stats?.statusesShipmentsChart || [])
        : (dash?.home?.stats?.length ? dash.home.stats : (dash?.stats?.statusesShipmentsChart || []));
      const map: Record<string, number> = {};
      src.forEach((s: any) => { map[s.status] = Number(s.count); });
      setCounts(map);
    } catch { /* ignore */ }
  }, [lang, branchFilter, dateFrom, dateTo]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  useSocket('ops:shipments:changed', useCallback(() => { load(); loadCounts(); }, [load, loadCounts]));
  useSocket('ops:stats', useCallback((stats: any) => {
    if (branchFilter || dateFrom || dateTo) return; // keep the scoped counts when filtered
    const map: Record<string, number> = {};
    (stats?.statusesShipmentsChart || []).forEach((s: any) => { map[s.status] = Number(s.count); });
    if (Object.keys(map).length) setCounts((p) => ({ ...p, ...map }));
  }, [branchFilter, dateFrom, dateTo]));

  const toggleStatus = (k: string) => setStatuses((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const openDetail = async (row: Row) => {
    setDetail(row); setTimeline(null); setNewStatus(row.status || '');
    try { const t = await api.get<any>(`/api/ops/shipments/timeline/${row.id}`); setTimeline(Array.isArray(t) ? t : (t?.items || t?.timeline || [])); }
    catch { setTimeline([]); }
  };

  const applyStatus = async () => {
    if (!detail || !newStatus || newStatus === detail.status) return;
    setSavingStatus(true);
    try {
      await api.patch('/api/ops/shipments/status', { status: newStatus, ids: [detail.id] });
      setDetail((d) => d ? { ...d, status: newStatus } : d);
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    setSavingStatus(false);
  };

  const totalPages = meta?.totalPages || 1;
  const selectedTotal = statuses.length ? statuses.reduce((a, s) => a + (counts[s] || 0), 0) : (counts.all ?? Object.values(counts).reduce((a, b) => a + b, 0));
  if (!isOpsStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (!loaded) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={lang === 'ar' ? 'الشحنات' : 'Shipments'} subtitle={`${fmtNum(meta?.totalItems ?? items.length)} ${tx.total} · ${tx.live}`}>
        <button type="button" onClick={() => { load(); loadCounts(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {tx.refresh}</button>
      </PageHeader>

      {stale && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> {lang === 'ar' ? 'تعذّر تحديث البيانات — معروض آخر نسخة محفوظة، وجاري إعادة المحاولة…' : 'Could not refresh — showing last known data, retrying…'}
        </div>
      )}

      {/* Quick analysis cards — per-status counts, multi-selectable (live) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button type="button" onClick={() => setStatuses([])}
          className={`text-start rounded-xl p-3 border transition-all ${statuses.length === 0 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
          <p className="text-xl font-bold">{fmtNum(counts.all ?? Object.values(counts).reduce((a, b) => a + b, 0))}</p>
          <p className="text-[11px] mt-0.5">{tx.all}</p>
        </button>
        {SHIPMENT_STATUSES.map((s) => {
          const on = statuses.includes(s.key);
          return (
            <button key={s.key} type="button" onClick={() => toggleStatus(s.key)}
              className={`text-start rounded-xl p-3 border transition-all ${on ? `${s.bg} ${s.text} border-current ring-2 ring-offset-1 ring-current` : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
              <p className="text-xl font-bold">{fmtNum(counts[s.key] ?? 0)}</p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{lang === 'ar' ? s.ar : s.en}</p>
            </button>
          );
        })}
      </div>
      {statuses.length > 0 && (
        <div className="text-xs text-slate-500">
          {lang === 'ar' ? 'محدد' : 'Selected'}: {statuses.length} · {lang === 'ar' ? 'إجمالي' : 'total'} {fmtNum(selectedTotal)}
          <button type="button" onClick={() => setStatuses([])} className="ms-2 text-[#f37121] hover:underline">{lang === 'ar' ? 'مسح' : 'clear'}</button>
        </div>
      )}

      {/* Search + filters — one consistent inline card (like the dashboard bar) */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="sm:w-44">
          <Select value={searchField} onChange={(e) => setSearchField(e.target.value)} aria-label={lang === 'ar' ? 'تبحث بإيه' : 'Search by'}>
            {SEARCH_FIELDS.map((f) => <option key={f.value} value={f.value}>{lang === 'ar' ? f.ar : f.en}</option>)}
          </Select>
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <SearchInput value={search} onChange={setSearch} placeholder={lang === 'ar' ? (SEARCH_FIELDS.find((f) => f.value === searchField)?.ar || 'بحث…') : (SEARCH_FIELDS.find((f) => f.value === searchField)?.en || 'Search…')} />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear search'}><X className="w-4 h-4" /></button>}
        </div>
        <span className="hidden sm:block w-px h-6 bg-slate-200" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'الفرع' : 'Branch'}</label>
        <div className="sm:w-44">
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label={lang === 'ar' ? 'الفرع' : 'Branch'}>
            <option value="">{lang === 'ar' ? 'كل الفروع' : 'All branches'}</option>
            {branches.map((b) => <option key={String(b.id)} value={String(b.id)}>{locName(b.name, lang)}</option>)}
          </Select>
        </div>
        <span className="hidden sm:block w-px h-6 bg-slate-200" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'من' : 'From'}</label>
        <input type="date" aria-label={lang === 'ar' ? 'من تاريخ' : 'From'} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'إلى' : 'To'}</label>
        <input type="date" aria-label={lang === 'ar' ? 'إلى تاريخ' : 'To'} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        {(dateFrom || dateTo || branchFilter) && <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); setBranchFilter(''); }} className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 text-xs whitespace-nowrap"><X className="w-3.5 h-3.5" /> {lang === 'ar' ? 'مسح' : 'Clear'}</button>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-300">
              {[lang === 'ar' ? 'كشف التخريج' : 'Statement #', lang === 'ar' ? 'الحالة' : 'Status', lang === 'ar' ? 'من' : 'From', lang === 'ar' ? 'إلى' : 'To', lang === 'ar' ? 'السائق' : 'Driver', lang === 'ar' ? 'رقم السيارة' : 'Car #', lang === 'ar' ? 'العميل' : 'Customer', lang === 'ar' ? 'الفرع' : 'Branch', lang === 'ar' ? 'البيع' : 'Selling', lang === 'ar' ? 'الدفع' : 'Pay', lang === 'ar' ? 'الإنشاء' : 'Created'].map((h) => <th key={h} className="text-start font-semibold px-3 py-3 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={11} className="text-center text-slate-800 py-12">{tx.noData}</td></tr>
            ) : items.map((r) => {
              const s = statusStyle(r.status);
              return (
                <tr key={r.id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(r)}>
                  <td className="px-3 py-3 font-bold text-slate-900 whitespace-nowrap">{r.graduation_statement_num ?? '—'}</td>
                  <td className="px-3 py-3">{s ? <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{lang === 'ar' ? s.ar : s.en}</span> : r.status}</td>
                  <td className="px-3 py-3 max-w-[140px] truncate text-slate-800">{r.address_from}</td>
                  <td className="px-3 py-3 max-w-[140px] truncate text-slate-800">{r.address_to}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{driverName(r, lang)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.car?.car_number || '—'}</td>
                  <td className="px-3 py-3 max-w-[150px] truncate">{locName(r.user?.name, lang) || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{locName(r.branch?.name, lang) || '—'}</td>
                  <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">{fmtMoney(r.selling_price)}</td>
                  <td className="px-3 py-3 text-slate-800">{PAYMENT_METHODS.find((p) => p.value === r.payment_method) ? (lang === 'ar' ? PAYMENT_METHODS.find((p) => p.value === r.payment_method)!.ar : PAYMENT_METHODS.find((p) => p.value === r.payment_method)!.en) : (r.payment_method || '—')}</td>
                  <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{fmtDateTime(r.created_at, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{tx.page} {meta?.currentPage || page} {tx.of} {totalPages}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {tx.prev}</button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center gap-1">{tx.next} <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Comprehensive detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={`${lang === 'ar' ? 'شحنة · كشف' : 'Shipment · Statement'} ${detail?.graduation_statement_num ?? ''}`}>
        {detail && (
          <div className="space-y-5">
            {admin && (
              <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <Field label={tx.updateStatus}>
                  <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    {SHIPMENT_STATUSES.map((s) => <option key={s.key} value={s.key}>{lang === 'ar' ? s.ar : s.en}</option>)}
                  </Select>
                </Field>
                <PrimaryButton onClick={applyStatus} disabled={savingStatus || newStatus === detail.status}>
                  {savingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.save}
                </PrimaryButton>
              </div>
            )}

            <Section title={lang === 'ar' ? 'بيانات الشحنة' : 'Shipment'}>
              <Info label={lang === 'ar' ? 'رقم كشف التخريج' : 'Statement #'}><b>{detail.graduation_statement_num ?? '—'}</b></Info>
              <Info label={lang === 'ar' ? 'رقم المرجع' : 'Reference #'}>{detail.reference_num ?? '—'}</Info>
              <Info label={lang === 'ar' ? 'الحالة' : 'Status'}>{(() => { const st = statusStyle(detail.status); return st ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{lang === 'ar' ? st.ar : st.en}</span> : detail.status; })()}</Info>
              <Info label={lang === 'ar' ? 'نوع المُنشئ' : 'Creator type'}>{detail.creator_type || '—'}</Info>
              <Info label={lang === 'ar' ? 'الكمية' : 'Qty'}>{fmtNum(detail.qty)}</Info>
              <Info label={lang === 'ar' ? 'قيمة البضائع' : 'Goods value'}>{fmtMoney(detail.goods_value_price)}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'المسار والتوقيت' : 'Route & timing'}>
              <Info label={lang === 'ar' ? 'من' : 'From'}><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{detail.address_from || '—'}</span></Info>
              <Info label={lang === 'ar' ? 'إلى' : 'To'}><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{detail.address_to || '—'}</span></Info>
              <Info label={lang === 'ar' ? 'الفرع' : 'Branch'}>{locName(detail.branch?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'وقت التحميل' : 'Pick time'}>{fmtDateTime(detail.pick_time, lang)}</Info>
              <Info label={lang === 'ar' ? 'وقت البدء' : 'Start time'}>{fmtDateTime(detail.starting_time, lang)}</Info>
              <Info label={lang === 'ar' ? 'وقت الوصول' : 'Access time'}>{fmtDateTime(detail.access_time, lang)}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'الأسعار' : 'Pricing'}>
              <Info label={lang === 'ar' ? 'سعر البيع' : 'Selling'}>{fmtMoney(detail.selling_price)}</Info>
              <Info label={lang === 'ar' ? 'سعر الشراء' : 'Purchase'}>{fmtMoney(detail.purchase_price)}</Info>
              <Info label={lang === 'ar' ? 'الدفعة المقدمة' : 'Advance'}>{fmtMoney(detail.advance)}</Info>
              <Info label={lang === 'ar' ? 'طريقة الدفع' : 'Payment'}>{detail.payment_method || '—'}</Info>
              <Info label={lang === 'ar' ? 'أجرة السائق' : 'Driver rental'}>{fmtMoney(detail.driver_rental_price)} {detail.driver_rental_type ? `(${detail.driver_rental_type})` : ''}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'السائق' : 'Driver'}>
              <Info label={lang === 'ar' ? 'الاسم' : 'Name'}>{driverName(detail, lang)}</Info>
              <Info label={lang === 'ar' ? 'الهاتف' : 'Phone'}>{driverPhone(detail) ? <a href={`tel:${driverPhone(detail)}`} className="text-[#f37121]" dir="ltr">{driverPhone(detail)}</a> : '—'}</Info>
              <Info label={lang === 'ar' ? 'الجنسية' : 'Nationality'}>{detail.driver?.nationality || '—'}</Info>
              <Info label={lang === 'ar' ? 'رقم الإقامة' : 'Residence #'}>{detail.driver?.residence_number || '—'}</Info>
              <Info label={lang === 'ar' ? 'رقم بطاقة السائق' : 'Driver card #'}>{detail.driver?.driver_card_number || '—'}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'المركبة' : 'Vehicle'}>
              <Info label={lang === 'ar' ? 'اسم المركبة' : 'Car name'}>{locName(detail.car?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'رقم السيارة' : 'Car number'}>{detail.car?.car_number || '—'}</Info>
              <Info label={lang === 'ar' ? 'رقم اللوحة' : 'Plate'}>{detail.car?.plate_number || '—'}</Info>
              <Info label={lang === 'ar' ? 'موديل' : 'Model year'}>{detail.car?.car_model_year || '—'}</Info>
              <Info label={lang === 'ar' ? 'نوع الشاحنة' : 'Truck type'}>{locName(detail.truck_type?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'حجم الشاحنة' : 'Truck size'}>{locName(detail.truck_size?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'نوع الحمولة' : 'Load type'}>{locName(detail.load_type?.name, lang) || '—'}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'مالك المركبة' : 'Car owner'}>
              <Info label={lang === 'ar' ? 'الاسم' : 'Name'}>{carOwnerName(detail, lang)}</Info>
              <Info label={lang === 'ar' ? 'الهاتف' : 'Phone'}>{detail.car?.owner?.owner_phone || '—'}</Info>
              <Info label={lang === 'ar' ? 'المدير' : 'Manager'}>{detail.car?.owner?.manager_name || '—'}</Info>
              <Info label={lang === 'ar' ? 'شروط الدفع' : 'Payment terms'}>{detail.car?.owner?.payment_terms || '—'}</Info>
            </Section>

            <Section title={lang === 'ar' ? 'العميل والمندوب' : 'Customer & delegate'}>
              <Info label={lang === 'ar' ? 'العميل' : 'Customer'}>{locName(detail.user?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'هاتف العميل' : 'Customer phone'}>{detail.user?.phone ? <a href={`tel:${detail.user.phone}`} className="text-[#f37121]" dir="ltr">{detail.user.phone}</a> : '—'}</Info>
              <Info label={lang === 'ar' ? 'نوع العميل' : 'Customer type'}>{detail.user?.user_type || '—'}</Info>
              <Info label={lang === 'ar' ? 'المندوب' : 'Delegate'}>{locName(detail.delegate?.name, lang) || '—'}</Info>
              <Info label={lang === 'ar' ? 'هاتف المندوب' : 'Delegate phone'}>{detail.delegate?.phone || '—'}</Info>
            </Section>

            {detail.notes ? <Section title={lang === 'ar' ? 'ملاحظات' : 'Notes'}><div className="sm:col-span-2"><Info label="">{detail.notes}</Info></div></Section> : null}

            <Section title={lang === 'ar' ? 'التواريخ' : 'Timestamps'}>
              <Info label={lang === 'ar' ? 'الإنشاء' : 'Created'}>{fmtDateTime(detail.created_at, lang)}</Info>
              <Info label={lang === 'ar' ? 'آخر تحديث' : 'Updated'}>{fmtDateTime(detail.updated_at, lang)}</Info>
            </Section>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2"><Clock className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'سجل الحالة' : 'Status Timeline'}</h3>
              {timeline === null ? <p className="text-slate-400 text-sm">{tx.loading}</p>
                : timeline.length === 0 ? <p className="text-slate-400 text-sm">—</p>
                : (
                  <ol className="relative border-s-2 border-slate-200 ms-2 space-y-3">
                    {timeline.map((ev, i) => {
                      const st = statusStyle(ev.status);
                      const when = ev.created_at || ev.date || ev.time;
                      const done = !!when;
                      const { who, note } = timelineMeta(ev, lang);
                      return (
                        <li key={i} className="ms-4">
                          <span className={`absolute -start-[7px] w-3 h-3 rounded-full ${done ? (st?.dot || 'bg-slate-400') : 'bg-slate-200'}`} />
                          <p className={`text-sm ${done ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{st ? (lang === 'ar' ? st.ar : st.en) : (ev.label || ev.status)}</p>
                          {done ? (
                            <p className="text-xs text-slate-500">
                              {fmtDateTime(when, lang)}
                              {note ? <> · {note}</> : null}
                              {who ? <> · <span className="text-slate-700 font-medium">{who}</span></> : null}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-300">{lang === 'ar' ? 'لم تتم بعد' : 'not yet'}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-200/70 pt-4">
      <h3 className="text-xs font-semibold text-[#f37121] uppercase tracking-wide mb-2.5">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2.5">{children}</div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 pb-1.5">
      {label ? <p className="text-slate-400 text-[11px] uppercase tracking-wide">{label}</p> : null}
      <p className="text-slate-800 text-sm break-words">{children}</p>
    </div>
  );
}
