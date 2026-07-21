'use client';
// Reusable "shipment history + analytics" block, scoped to one entity via a
// filter param (e.g. user_id for a customer, driver_id for a driver). Shows the
// per-status counts, a scoped search, the paginated shipment list and a full
// detail modal — all live via the ops socket events.
import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { Truck, Search, RefreshCw, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { Modal, Select } from '@/components/hr/HRKit';
import {
  SHIPMENT_STATUSES, statusStyle, locName, fmtDateTime, fmtMoney, fmtNum, timelineMeta, opsText, type Paginated,
} from '@/lib/ops';

type Row = Record<string, any>;
const driverName = (s: Row, lang: 'en' | 'ar') => locName(s?.driver?.admin?.name, lang) || locName(s?.driver?.name, lang) || '—';

const SEARCH_FIELDS = [
  { value: '', en: 'Anything', ar: 'الكل' },
  { value: 'graduation', en: 'Graduation #', ar: 'كشف التخريج' },
  { value: 'reference', en: 'Reference #', ar: 'رقم المرجع' },
  { value: 'driver_name', en: 'Driver name', ar: 'اسم السائق' },
  { value: 'driver_phone', en: 'Driver phone', ar: 'هاتف السائق' },
  { value: 'car_number', en: 'Car number', ar: 'رقم السيارة' },
  { value: 'user_name', en: 'Customer name', ar: 'اسم العميل' },
];

export default function OpsShipmentHistory({ filterKey, filterValue }: { filterKey: 'user_id' | 'driver_id'; filterValue: string }) {
  const { lang } = useLanguage();
  const tx = opsText(lang);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ships, setShips] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Paginated<unknown>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchField, setSearchField] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [timeline, setTimeline] = useState<any[] | null>(null);

  const base = `${filterKey}=${filterValue}`;

  const loadStats = useCallback(async () => {
    try {
      const reqs = [
        api.get<Paginated<Row>>(`/api/ops/shipments?${base}&limit=1`),
        ...SHIPMENT_STATUSES.map((s) => api.get<Paginated<Row>>(`/api/ops/shipments?${base}&status=${s.key}&limit=1`)),
      ];
      const [totalRes, ...statusRes] = await Promise.all(reqs);
      const c: Record<string, number> = { all: totalRes.meta?.totalItems || 0 };
      SHIPMENT_STATUSES.forEach((s, i) => { c[s.key] = statusRes[i].meta?.totalItems || 0; });
      setCounts(c);
    } catch { /* keep */ }
  }, [base]);

  const loadShips = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ [filterKey]: filterValue, page: String(page), limit: '15', lang });
      qs.set('sort[updated_at]', 'desc');
      if (statusFilter) qs.set('status', statusFilter);
      if (debounced) {
        if (searchField === 'graduation' || searchField === 'reference' || searchField === '') qs.set('search', debounced);
        else qs.set(searchField, debounced);
      }
      const d = await api.get<Paginated<Row>>(`/api/ops/shipments?${qs.toString()}`);
      let list = d.items || [];
      if (debounced && searchField === 'graduation') list = list.filter((s) => String(s.graduation_statement_num) === debounced);
      if (debounced && searchField === 'reference') list = list.filter((s) => String(s.reference_num) === debounced);
      setShips(list); setMeta(d.meta || null);
    } catch { /* keep */ }
  }, [filterKey, filterValue, page, statusFilter, debounced, searchField, lang]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadShips(); }, [loadShips]);
  useEffect(() => { const x = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(x); }, [search]);
  useEffect(() => { setPage(1); }, [statusFilter, debounced, searchField]);

  const reload = useCallback(() => { loadShips(); loadStats(); }, [loadShips, loadStats]);
  useSocket('ops:shipments:changed', reload);
  useSocket('ops:stats', useCallback(() => loadStats(), [loadStats]));

  const openDetail = async (s: Row) => {
    setDetail(s); setTimeline(null);
    // Hand the backend the creator we already have → no extra shipment fetch.
    const qs = new URLSearchParams();
    if (s.created_by) qs.set('created_by', String(s.created_by));
    if (s.creator_type) qs.set('creator_type', String(s.creator_type));
    try { const t = await api.get<any>(`/api/ops/shipments/timeline/${s.id}${qs.toString() ? `?${qs}` : ''}`); setTimeline(Array.isArray(t) ? t : (t?.items || [])); }
    catch { setTimeline([]); }
  };

  const totalPages = meta?.totalPages || 1;
  const activeStatuses = SHIPMENT_STATUSES.filter((s) => (counts[s.key] || 0) > 0);

  return (
    <div className="space-y-4">
      {/* analytics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <button type="button" onClick={() => setStatusFilter('')} className={`text-start rounded-xl p-4 border shadow-sm transition-all ${statusFilter === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]/40'}`}>
          <Truck className="w-5 h-5 text-[#f37121]" />
          <p className="text-2xl font-bold mt-1">{fmtNum(counts.all || 0)}</p>
          <p className="text-[11px] mt-0.5 opacity-80">{lang === 'ar' ? 'إجمالي الشحنات' : 'Total shipments'}</p>
        </button>
        {activeStatuses.map((s) => {
          const on = statusFilter === s.key;
          return (
            <button key={s.key} type="button" onClick={() => setStatusFilter(s.key)} className={`text-start rounded-xl p-4 border shadow-sm transition-all ${on ? `${s.bg} ${s.text} border-current ring-2 ring-offset-1 ring-current` : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'}`}>
              <p className="text-2xl font-bold">{fmtNum(counts[s.key] || 0)}</p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{lang === 'ar' ? s.ar : s.en}</p>
            </button>
          );
        })}
      </div>

      {/* header + search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 whitespace-nowrap"><Truck className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'سجل الشحنات' : 'Shipment History'} {(statusFilter || debounced) && <span className="text-slate-400">· {fmtNum(meta?.totalItems)} </span>}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40"><Select value={searchField} onChange={(e) => setSearchField(e.target.value)} aria-label={lang === 'ar' ? 'تبحث بإيه' : 'Search by'}>{SEARCH_FIELDS.map((f) => <option key={f.value} value={f.value}>{lang === 'ar' ? f.ar : f.en}</option>)}</Select></div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={lang === 'ar' ? 'بحث في الشحنات…' : 'Search shipments…'} className="w-full ps-9 pe-8 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            {search && <button type="button" aria-label={lang === 'ar' ? 'مسح' : 'Clear'} onClick={() => setSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>}
          </div>
          <button type="button" onClick={reload} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {tx.refresh}</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-300">
              {[lang === 'ar' ? 'كشف التخريج' : 'Statement #', lang === 'ar' ? 'الحالة' : 'Status', lang === 'ar' ? 'من' : 'From', lang === 'ar' ? 'إلى' : 'To', filterKey === 'driver_id' ? (lang === 'ar' ? 'العميل' : 'Customer') : (lang === 'ar' ? 'السائق' : 'Driver'), lang === 'ar' ? 'البيع' : 'Selling', lang === 'ar' ? 'التاريخ' : 'Date'].map((h) => <th key={h} className="text-start font-semibold px-3 py-3 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ships.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{lang === 'ar' ? 'لا توجد شحنات' : 'No shipments'}</td></tr>
            ) : ships.map((r) => {
              const st = statusStyle(r.status);
              return (
                <tr key={r.id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(r)}>
                  <td className="px-3 py-3 font-bold text-slate-900 whitespace-nowrap">{r.graduation_statement_num ?? '—'}</td>
                  <td className="px-3 py-3">{st ? <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span> : r.status}</td>
                  <td className="px-3 py-3 max-w-[150px] truncate text-slate-800">{r.address_from}</td>
                  <td className="px-3 py-3 max-w-[150px] truncate text-slate-800">{r.address_to}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{filterKey === 'driver_id' ? (locName(r.user?.name, lang) || '—') : driverName(r, lang)}</td>
                  <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">{fmtMoney(r.selling_price)}</td>
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

      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={`${lang === 'ar' ? 'شحنة · كشف' : 'Shipment · Statement'} ${detail?.graduation_statement_num ?? ''}`}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2.5">
              {[
                [lang === 'ar' ? 'الحالة' : 'Status', (() => { const s = statusStyle(detail.status); return s ? (lang === 'ar' ? s.ar : s.en) : detail.status; })()],
                [lang === 'ar' ? 'من' : 'From', detail.address_from],
                [lang === 'ar' ? 'إلى' : 'To', detail.address_to],
                [lang === 'ar' ? 'العميل' : 'Customer', locName(detail.user?.name, lang)],
                [lang === 'ar' ? 'السائق' : 'Driver', driverName(detail, lang)],
                [lang === 'ar' ? 'هاتف السائق' : 'Driver phone', detail.driver?.admin?.phone],
                [lang === 'ar' ? 'المركبة' : 'Car', locName(detail.car?.name, lang) || detail.car?.plate_number],
                [lang === 'ar' ? 'رقم السيارة' : 'Car number', detail.car?.car_number],
                [lang === 'ar' ? 'نوع الشاحنة' : 'Truck type', locName(detail.truck_type?.name, lang)],
                [lang === 'ar' ? 'الحمولة' : 'Load type', locName(detail.load_type?.name, lang)],
                [lang === 'ar' ? 'الكمية' : 'Qty', fmtNum(detail.qty)],
                [lang === 'ar' ? 'سعر البيع' : 'Selling', fmtMoney(detail.selling_price)],
                [lang === 'ar' ? 'سعر الشراء' : 'Purchase', fmtMoney(detail.purchase_price)],
                [lang === 'ar' ? 'الدفع' : 'Payment', detail.payment_method],
                [lang === 'ar' ? 'الفرع' : 'Branch', locName(detail.branch?.name, lang)],
                [lang === 'ar' ? 'الإنشاء' : 'Created', fmtDateTime(detail.created_at, lang)],
              ].map(([k, v]) => (
                <div key={k as string} className="border-b border-slate-100 pb-1.5">
                  <p className="text-slate-400 text-[11px] uppercase tracking-wide">{k}</p>
                  <p className="text-slate-800 text-sm break-words">{v === null || v === undefined || v === '' ? '—' : String(v)}</p>
                </div>
              ))}
            </div>
            {detail.notes && <div><p className="text-slate-400 text-[11px] uppercase tracking-wide mb-1">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</p><p className="text-slate-800 text-sm bg-slate-50 rounded-lg p-3">{detail.notes}</p></div>}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2"><Clock className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'سجل الحالة' : 'Status Timeline'}</h3>
              {timeline === null ? <p className="text-slate-400 text-sm">{tx.loading}</p>
                : timeline.length === 0 ? <p className="text-slate-400 text-sm">—</p>
                : (
                  <ol className="relative border-s-2 border-slate-200 ms-2 space-y-3">
                    {timeline.map((ev, i) => {
                      const s = statusStyle(ev.status);
                      const when = ev.created_at || ev.date;
                      const done = !!when;
                      const { who, note } = timelineMeta(ev, lang);
                      return (
                        <li key={i} className="ms-4">
                          <span className={`absolute -start-[7px] w-3 h-3 rounded-full ${done ? (s?.dot || 'bg-slate-400') : 'bg-slate-200'}`} />
                          <p className={`text-sm ${done ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{s ? (lang === 'ar' ? s.ar : s.en) : (ev.label || ev.status)}</p>
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
