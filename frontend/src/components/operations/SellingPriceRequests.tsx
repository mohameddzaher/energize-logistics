'use client';
import { useCallback, useEffect, useState } from 'react';
import { BadgeDollarSign, Check, Loader2, Search, X } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';

// Selling-price change requests from the data team; approvers decide them here.
// The server decides who is an approver (config/sellingPriceRequests); this screen only reads the answer.

export interface SellingRequest {
  _id: string;
  origin: 'workflow' | 'shipment_order';
  reportNumber: string;
  customerName: string;
  fromCity: string;
  toCity: string;
  orderDate?: string | null;
  driverName: string;
  plate: string;
  oldPrice: number;
  requestedPrice: number;
  requestedByName: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedByName?: string;
  decidedAt?: string | null;
  reason?: string;
}

const money = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const when = (d?: string | null, withTime = true) => (d
  ? new Date(d).toLocaleString('en-GB', withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '—');

const STATUS_TABS: { key: string; ar: string; en: string }[] = [
  { key: 'pending', ar: 'بانتظار الاعتماد', en: 'Pending' },
  { key: 'approved', ar: 'معتمدة', en: 'Approved' },
  { key: 'rejected', ar: 'مرفوضة', en: 'Rejected' },
  { key: '', ar: 'الكل', en: 'All' },
];

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
};

/** Pending count for the approver, live; 0 and canApprove false for everyone else. */
export function useSellingRequestCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (!enabled) return;
    api.get<{ pending: number }>('/api/selling-price-requests/count')
      .then((d) => setCount(d?.pending || 0)).catch(() => {});
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  useSocket('sellingRequests:changed', load);
  return count;
}

export default function SellingPriceRequests({ ar }: { ar: boolean }) {
  const { notify, prompt } = useDialog();
  const guard = useLatestRequest();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SellingRequest[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (q.trim()) qs.set('q', q.trim());
      const d = await api.get<{ requests: SellingRequest[]; pending: number }>(`/api/selling-price-requests?${qs.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.requests || []);
      setPending(d.pending || 0);
      setError('');
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || (ar ? 'تعذّر التحميل' : 'Failed to load'));
    } finally {
      if (guard.isCurrent(mine)) setLoading(false);
    }
  }, [status, q, ar, guard]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useSocket('sellingRequests:changed', load);

  const approve = async (r: SellingRequest) => {
    setBusy(r._id);
    try {
      await api.post(`/api/selling-price-requests/${r._id}/approve`, {});
      notify(ar ? `اعتُمد سعر البيع ${money(r.requestedPrice)} لأمر النقل ${r.reportNumber}` : `Selling price ${money(r.requestedPrice)} approved for ${r.reportNumber}`, 'success');
      load();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الاعتماد' : 'Approval failed'), 'error'); }
    setBusy('');
  };

  const reject = async (r: SellingRequest) => {
    const reason = await prompt({
      title: ar ? 'رفض طلب تعديل سعر البيع' : 'Reject selling-price request',
      message: ar ? `أمر النقل ${r.reportNumber} — سبب الرفض (اختياري):` : `Transport order ${r.reportNumber} — reason (optional):`,
      placeholder: ar ? 'اتركه فارغًا إن لم يكن هناك سبب' : 'Leave empty for no reason',
      confirmLabel: ar ? 'رفض' : 'Reject',
    });
    if (reason === null) return;
    setBusy(r._id);
    try {
      await api.post(`/api/selling-price-requests/${r._id}/reject`, { reason });
      notify(ar ? 'رُفض الطلب ولم يتغيّر السعر' : 'Request rejected; price unchanged', 'success');
      load();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الرفض' : 'Reject failed'), 'error'); }
    setBusy('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[13px] font-semibold w-fit">
          {STATUS_TABS.map((t) => (
            <button key={t.key || 'all'} type="button" onClick={() => { setLoading(true); setStatus(t.key); }}
              className={`px-3 py-1.5 ${status === t.key ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {ar ? t.ar : t.en}{t.key === 'pending' && pending ? ` (${pending})` : ''}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'رقم أمر النقل، العميل، مقدّم الطلب…' : 'Order no., customer, requester…'}
            className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/30" />
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>
      ) : !rows.length ? (
        <div className="text-center text-slate-500 py-10 text-sm">{ar ? 'لا توجد طلبات.' : 'No requests.'}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-700 text-xs">
              <tr>
                <th className="px-3 py-2 text-start">{ar ? 'أمر النقل' : 'Transport order'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'العميل' : 'Customer'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'تفاصيل الطلب' : 'Order details'}</th>
                <th className="px-3 py-2 text-end">{ar ? 'السعر الحالي' : 'Current price'}</th>
                <th className="px-3 py-2 text-end">{ar ? 'السعر المطلوب' : 'Requested price'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'مقدّم الطلب' : 'Requested by'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const diff = r.requestedPrice - r.oldPrice;
                return (
                  <tr key={r._id} className="align-top">
                    <td className="px-3 py-2 font-bold text-slate-900 tabular-nums">
                      {r.reportNumber || '—'}
                      <div className="text-[11px] font-normal text-slate-400">{r.origin === 'workflow' ? (ar ? 'من سير العمل' : 'from workflow') : (ar ? 'من الشحنات' : 'from shipments')}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{r.customerName || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 text-xs leading-5">
                      <div>{r.fromCity || '—'} ← {r.toCity || '—'}</div>
                      <div className="text-slate-500 tabular-nums">{when(r.orderDate, false)}</div>
                      <div className="text-slate-500">{[r.driverName, r.plate].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums text-slate-700">{money(r.oldPrice)}</td>
                    <td className="px-3 py-2 text-end tabular-nums font-bold text-slate-900">
                      {money(r.requestedPrice)}
                      <div className={`text-[11px] font-semibold ${diff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{diff >= 0 ? '+' : ''}{money(diff)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      <div className="font-semibold">{r.requestedByName || '—'}</div>
                      <div className="text-slate-500 tabular-nums">{when(r.requestedAt)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${STATUS_CHIP[r.status] || ''}`}>
                        {STATUS_TABS.find((t) => t.key === r.status)?.[ar ? 'ar' : 'en']}
                      </span>
                      {r.status !== 'pending' && (
                        <div className="mt-1 text-slate-500">
                          {r.decidedByName} · <span className="tabular-nums">{when(r.decidedAt)}</span>
                          {r.reason ? <div className="text-slate-600">{ar ? 'السبب: ' : 'Reason: '}{r.reason}</div> : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'pending' && (
                        <div className="flex gap-1.5 justify-end">
                          <button type="button" disabled={busy === r._id} onClick={() => approve(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50">
                            {busy === r._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{ar ? 'اعتماد' : 'Approve'}
                          </button>
                          <button type="button" disabled={busy === r._id} onClick={() => reject(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold disabled:opacity-50">
                            <X className="w-3.5 h-3.5" />{ar ? 'رفض' : 'Reject'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The workflow-page button: opens the list in a panel, with the live pending count. */
export function SellingRequestsButton({ ar }: { ar: boolean }) {
  const [open, setOpen] = useState(false);
  const count = useSellingRequestCount(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-50 text-sm font-semibold transition-colors">
        <BadgeDollarSign className="w-4 h-4" />{ar ? 'طلبات تعديل سعر البيع' : 'Selling-price requests'}
        {count > 0 && (
          <span className="min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-6xl mt-10 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <BadgeDollarSign className="w-5 h-5 text-[#f37121]" />{ar ? 'طلبات تعديل سعر البيع' : 'Selling-price change requests'}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500" title={ar ? 'إغلاق' : 'Close'}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <SellingPriceRequests ar={ar} />
          </div>
        </div>
      )}
    </>
  );
}
