'use client';
/**
 * دفترُ الفواتير — كلُّ فاتورةٍ وما جرى لها.
 *
 * ── ولماذا ثلاثةُ أعمدةٍ للأيّام ───────────────────────────────────────────
 * الفاتورةُ تمرّ بثلاث محطّات: تُفوتَر، ثمّ تُسلَّم للعميل، ثمّ تُحصَّل. والسؤالُ
 * الذي يُدير القسمَ هو **أين تضيع الأيّام**: أفي تجهيز الفاتورة وتسليمها، أم
 * عند العميل بعد أن استلمها؟
 *
 * فالعمودان يفصلان: «من الفوترة إلى التسليم» عملُنا نحن، و«من التسليم إلى
 * التحصيل» مهلةُ العميل. وجمعُهما في رقمٍ واحد يخفي أيَّهما المتأخّر.
 *
 * ولا يُخزَّن أيٌّ منها: فروقُ تواريخَ تُحسب عند القراءة، فلا يبقى رقمٌ يشيخ.
 */
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { money, dt, dueWords, type LedgerInvoice, type AgeBand } from '@/lib/collections';
import { Search, FilterX, Loader2, ChevronLeft, ChevronRight, Link2 } from 'lucide-react';

export default function LedgerInvoicesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const L = exportScopeLabels(ar);

  const [rows, setRows] = useState<LedgerInvoice[]>([]);
  const [bands, setBands] = useState<AgeBand[]>([]);
  const [opts, setOpts] = useState<{ statuses: string[]; kinds: string[]; officers: string[] }>({ statuses: [], kinds: [], officers: [] });
  const [sum, setSum] = useState(0);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [officer, setOfficer] = useState('');
  const [band, setBand] = useState('');
  const [open, setOpen] = useState('');
  const [dateField, setDateField] = useState('invoiceDate');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(input); setPage(1); }, 300); return () => clearTimeout(t); }, [input]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.append('search', search);
    if (status) p.append('status', status);
    if (kind) p.append('kind', kind);
    if (officer) p.append('officer', officer);
    if (band) p.append('band', band);
    if (open) p.append('open', open);
    if (from) p.append('from', from);
    if (to) p.append('to', to);
    if (from || to) p.append('dateField', dateField);
    return p;
  }, [search, status, kind, officer, band, open, from, to, dateField]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const p = params(); p.append('page', String(page)); p.append('limit', '50');
      const d = await api.get<any>(`/api/collections-dept/ledger/invoices?${p.toString()}`);
      setRows(d.rows || []); setTotal(d.total || 0); setPages(d.pages || 1); setSum(d.sum || 0); setBands(d.bands || []);
    } catch { /* keep last known */ }
    finally { setBusy(false); setLoading(false); }
  }, [params, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<any>('/api/collections-dept/ledger/invoices/filters').then(setOpts).catch(() => {}); }, []);

  const active = !!(search || status || kind || officer || band || open || from || to);
  const clear = () => { setInput(''); setSearch(''); setStatus(''); setKind(''); setOfficer(''); setBand(''); setOpen(''); setFrom(''); setTo(''); setPage(1); };

  const cols: ExportColumn[] = [
    { header: ar ? 'رقم الفاتورة' : 'Invoice no', key: 'invoiceNumber', width: 16 },
    { header: ar ? 'الكود' : 'Code', key: 'partyCode', width: 14 },
    { header: ar ? 'العميل' : 'Customer', key: 'partyName', width: 38 },
    { header: ar ? 'المبلغ' : 'Amount', key: 'total', width: 16 },
    { header: ar ? 'تاريخ الفاتورة' : 'Invoice date', key: 'invoiceDate', width: 14, transform: (v: any) => dt(v) },
    { header: ar ? 'أيام حتى التسليم' : 'Days to delivery', key: 'daysInvoiceToDelivery', width: 16 },
    { header: ar ? 'تاريخ التسليم للعميل' : 'Delivered to customer', key: 'deliveryDate', width: 14, transform: (v: any) => dt(v) },
    { header: ar ? 'أيام حتى التحصيل' : 'Days to collection', key: 'daysDeliveryToCollection', width: 16 },
    { header: ar ? 'تاريخ التحصيل' : 'Collection date', key: 'collectionDate', width: 14, transform: (v: any) => dt(v) },
    { header: ar ? 'إجمالي الأيام' : 'Total days', key: 'daysTotal', width: 12 },
    { header: ar ? 'العمر' : 'Age', key: 'ageDays', width: 10 },
    { header: ar ? 'الشريحة' : 'Band', key: 'band', width: 10 },
    { header: ar ? 'مهلة السداد' : 'Terms', key: 'creditDays', width: 12 },
    { header: ar ? 'تاريخ الاستحقاق' : 'Due date', key: 'dueDate', width: 14, transform: (v: any) => dt(v) },
    { header: ar ? 'الحالة' : 'Status', key: 'status', width: 12 },
    { header: ar ? 'كشوف التشغيل' : 'Reports', key: 'reportNumbers', width: 22, transform: (v: any) => (v || []).join(', ') },
    { header: ar ? 'ملاحظات' : 'Comments', key: 'comments', width: 32 },
  ];

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>;
  const th = 'px-3 py-3 text-start text-xs text-slate-300 font-semibold whitespace-nowrap';

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{ar ? 'دفتر الفواتير' : 'Invoice ledger'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {ar ? 'كل فاتورة: متى فُوتِرت، ومتى وصلت العميل، ومتى حُصِّلت — وأين ضاعت الأيام بينها.'
              : 'Every invoice: when it was raised, when it reached the customer, when it was collected — and where the days went.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[11px] text-slate-500">{ar ? 'فواتير' : 'Invoices'}</p>
          <p className="text-xl font-bold mt-1 text-slate-900">{total.toLocaleString('en-US')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[11px] text-slate-500">{ar ? 'إجمالي المبالغ' : 'Total value'}</p>
          <p className="text-xl font-bold mt-1 text-slate-900">{money(sum)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-[11px] text-slate-500">{ar ? 'متأخرة عن الاستحقاق' : 'Past due'}</p>
          <p className="text-xl font-bold mt-1 text-red-600">{rows.filter((r) => r.overdue).length}<span className="text-xs font-normal text-slate-400 ms-1">{ar ? 'في هذه الصفحة' : 'on this page'}</span></p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={ar ? 'رقم فاتورة أو عميل أو كود…' : 'Invoice no, customer, code…'}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-1 focus:ring-[#f37121] focus:outline-none" />
          </div>
          <select title={ar ? 'الحالة' : 'Status'} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">{ar ? 'الحالة' : 'Status'}</option>
            {opts.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select title={ar ? 'النوع' : 'Kind'} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">{ar ? 'النوع' : 'Kind'}</option>
            <option value="tax">{ar ? 'ضريبي' : 'Tax'}</option>
            <option value="cash">{ar ? 'كاش' : 'Cash'}</option>
          </select>
          <select title={ar ? 'موظف التحصيل' : 'Officer'} value={officer} onChange={(e) => { setOfficer(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">{ar ? 'موظف التحصيل' : 'Officer'}</option>
            {opts.officers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select title={ar ? 'الشريحة' : 'Band'} value={band} onChange={(e) => { setBand(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">{ar ? 'شريحة العمر' : 'Age band'}</option>
            {bands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <select title={ar ? 'محصَّلة؟' : 'Collected?'} value={open} onChange={(e) => { setOpen(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="">{ar ? 'الكل' : 'All'}</option>
            <option value="true">{ar ? 'غير محصَّلة' : 'Uncollected'}</option>
            <option value="false">{ar ? 'محصَّلة' : 'Collected'}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* الفترةُ تُقاس بأيّ تاريخٍ يريده السائل: «فُوتِر في أغسطس» غيرُ
              «حُصِّل في أغسطس»، والخلطُ بينهما يقلب أيَّ تقرير. */}
          <select title={ar ? 'الفترة محسوبة بـ' : 'Period measured by'} value={dateField} onChange={(e) => { setDateField(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            <option value="invoiceDate">{ar ? 'تاريخ الفوترة' : 'Invoice date'}</option>
            <option value="deliveryDate">{ar ? 'تاريخ التسليم للعميل' : 'Delivered to customer'}</option>
            <option value="collectionDate">{ar ? 'تاريخ التحصيل' : 'Collection date'}</option>
          </select>
          <input type="date" title={ar ? 'من' : 'From'} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          <input type="date" title={ar ? 'إلى' : 'To'} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          {active && (
            <button type="button" onClick={clear}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:border-red-300 hover:text-red-600 flex items-center gap-1.5">
              <FilterX className="w-4 h-4" />{ar ? 'مسح' : 'Clear'}
            </button>
          )}
          <ExportMenu fileName={ar ? 'دفتر-الفواتير' : 'invoice-ledger'} lang={lang as 'ar' | 'en'}
            options={[
              { key: 'page', label: L.page, sheets: [{ name: ar ? 'الفواتير' : 'Invoices', rows, columns: cols }] },
              { key: 'matching', label: L.matching, hint: String(total),
                resolve: async () => {
                  const p = params(); p.append('page', '1'); p.append('limit', '5000');
                  const d = await api.get<any>(`/api/collections-dept/ledger/invoices?${p.toString()}`);
                  return [{ name: ar ? 'الفواتير' : 'Invoices', rows: d.rows || [], columns: cols }];
                } },
            ]} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {busy && <div className="refresh-bar" aria-hidden="true" />}
        <div className="overflow-x-auto" aria-busy={busy}>
          <table className="w-full min-w-[1500px]">
            <thead>
              <tr className="table-head border-b border-slate-200">
                <th className={th}>{ar ? 'رقم الفاتورة' : 'Invoice'}</th>
                <th className={th}>{ar ? 'العميل' : 'Customer'}</th>
                <th className={`${th} text-end`}>{ar ? 'المبلغ' : 'Amount'}</th>
                <th className={th}>{ar ? 'الفوترة' : 'Invoiced'}</th>
                <th className={`${th} text-center`} title={ar ? 'من الفوترة إلى التسليم — عملُنا' : 'Invoice → delivery (our side)'}>{ar ? '← أيام' : 'days →'}</th>
                <th className={th}>{ar ? 'التسليم' : 'Delivered'}</th>
                <th className={`${th} text-center`} title={ar ? 'من التسليم إلى التحصيل — مهلةُ العميل' : 'Delivery → collection (customer side)'}>{ar ? '← أيام' : 'days →'}</th>
                <th className={th}>{ar ? 'التحصيل' : 'Collected'}</th>
                <th className={`${th} text-center`}>{ar ? 'العمر' : 'Age'}</th>
                <th className={th}>{ar ? 'الاستحقاق' : 'Due'}</th>
                <th className={th}>{ar ? 'الحالة' : 'Status'}</th>
                <th className={th}>{ar ? 'كشوف' : 'Reports'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-slate-500 text-sm">{ar ? 'لا فواتير' : 'No invoices'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r._id} className={`hover:bg-slate-50 ${r.overdue ? 'bg-red-50/40' : ''}`}>
                  <td className="px-3 py-2.5 text-sm font-mono text-slate-900 whitespace-nowrap">{r.invoiceNumber}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-800 max-w-[260px] truncate" title={`${r.partyCode || ''} ${r.partyName || ''}`}>
                    <span className="text-[11px] text-slate-400 font-mono me-1">{r.partyCode}</span>{r.partyName || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums font-semibold text-slate-900 whitespace-nowrap">{money(r.total)}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{dt(r.invoiceDate)}</td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums text-slate-500">{r.daysInvoiceToDelivery ?? '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{dt(r.deliveryDate)}</td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums text-slate-500">{r.daysDeliveryToCollection ?? '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{dt(r.collectionDate)}</td>
                  <td className="px-3 py-2.5 text-xs text-center whitespace-nowrap">
                    {r.ageDays == null ? <span className="text-slate-300">—</span> : (
                      <span className="text-slate-600">{r.ageDays}<span className="text-slate-400 ms-1">{r.band}</span></span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${r.overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                    {dueWords(r.daysToDue, ar)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                      r.status === 'Collected' ? 'bg-emerald-50 text-emerald-700'
                        : r.status === 'Delivered' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.status || (ar ? 'مفتوحة' : 'Open')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {r.reportNumbers?.length
                      ? <span className="inline-flex items-center gap-1" title={r.reportNumbers.join(', ')}><Link2 className="w-3 h-3" />{r.reportNumbers.length}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
            <span className="text-slate-500">{ar ? `صفحة ${page} من ${pages} · ${total} فاتورة` : `Page ${page} of ${pages} · ${total} invoices`}</span>
            <div className="flex gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title={ar ? 'السابق' : 'Previous'}
                className="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:border-[#f37121]"><ChevronRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /></button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} title={ar ? 'التالي' : 'Next'}
                className="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:border-[#f37121]"><ChevronLeft className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
