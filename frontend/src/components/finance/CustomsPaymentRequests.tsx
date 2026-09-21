'use client';
/**
 * طلباتُ صرفِ التخليص كما تراها الإدارةُ الماليّة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * حين يرفق موظّفُ التخليص فاتورةً في مرحلةٍ من مراحل السداد فهو يقول «هذا ما
 * يجب أن يُدفَع». وكان ذلك يُقال بالهاتف أو الواتساب: لا يُعرَف كم طلبٌ معلَّق،
 * ولا منذ متى، ولا مَن ردّ. والمحاسبُ يفتح معاملةً معاملةً ليعرف.
 *
 * فصارت في شاشةٍ واحدة: كلُّ طلبٍ بمعاملته ومرحلته ومبلغه ومرفقه، وثلاثةُ
 * أجوبةٍ لا واحد — دُفع (ومعه إثباتُه)، أو يُعاد لتصحيحٍ (ومعه سببُه)، أو
 * يُرفَض. والجوابُ يظهر في شاشة التخليص بجانب الطلب نفسِه في اللحظة.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Paperclip, Loader2, Check, Undo2, Ban, X, Wallet } from 'lucide-react';
import { PAY_BADGE } from '@/components/customs/PaymentStages';

interface Req {
  clearanceId: string; entryId: string; refNumber?: string; blNumber?: string;
  customerName?: string; shippingAgent?: string; port?: string; branch?: string;
  key: string; label?: string; date?: string; amount?: number | null; note?: string;
  fileUrl?: string; fileName?: string; addedByName?: string; addedAt?: string;
  payStatus: 'pending' | 'paid' | 'returned' | 'rejected';
  decisionNote?: string; decidedByName?: string; decidedAt?: string;
  proofFiles?: { fileUrl: string; fileName?: string }[];
}

const MAX_UPLOAD = 20 * 1024 * 1024;
const fmtDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : (d || '—'));
const money = (v?: number | null) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

export default function CustomsPaymentRequests() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [tab, setTab] = useState<'pending' | 'paid' | 'returned' | 'rejected' | 'all'>('pending');
  const [rows, setRows] = useState<Req[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [act, setAct] = useState<{ row: Req; decision: 'paid' | 'returned' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<{ dataUrl: string; fileName: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>(`/api/customs-clearance/payment-requests?status=${tab}`);
      setRows(d.requests || []);
      setCounts(d.counts || {});
    } catch { /* */ }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useSocket('customs:updated', useCallback(() => load(), [load]));

  const submit = async () => {
    if (!act) return;
    setBusy(true);
    try {
      await api.patch(`/api/customs-clearance/${act.row.clearanceId}/payment-stages/${act.row.entryId}/decision`, {
        decision: act.decision, note: note.trim(), files,
      });
      setAct(null); setNote(''); setFiles([]);
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  const TABS: [typeof tab, string, string][] = [
    ['pending', 'بانتظار الدفع', 'Awaiting'],
    ['paid', 'مدفوعة', 'Paid'],
    ['returned', 'مُعادة', 'Returned'],
    ['rejected', 'مرفوضة', 'Rejected'],
    ['all', 'الكل', 'All'],
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f37121]/15">
            <Wallet className="h-4 w-4 text-[#f37121]" />
          </div>
          <div>
            <p className="font-bold text-slate-900">{ar ? 'طلبات صرف التخليص' : 'Customs payment requests'}</p>
            <p className="text-xs text-slate-500">
              {ar ? 'ما طلب قسمُ التخليص دفعَه — بمرفقه' : 'What customs asked to be paid — with its file'}
            </p>
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {TABS.map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setLoading(true); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {ar ? a : e}
              {k !== 'all' && counts[k] != null && <span className="ms-1.5 opacity-70">{counts[k]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* الأرقامُ التي تُسأل أوّلًا: كم طلبًا ينتظر، وبكم. */}
      <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
        {[
          [ar ? 'بانتظار الدفع' : 'Awaiting', counts.pending ?? 0, 'text-amber-600'],
          [ar ? 'مبالغ منتظِرة' : 'Amount awaiting', money(counts.amountPending), 'text-amber-700'],
          [ar ? 'مدفوعة' : 'Paid', counts.paid ?? 0, 'text-emerald-700'],
          [ar ? 'مبالغ مدفوعة' : 'Amount paid', money(counts.amountPaid), 'text-emerald-700'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-[11px] text-slate-500">{label as string}</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${tone as string}`}>{value as any}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {[
                ar ? 'المعاملة' : 'Transaction', ar ? 'العميل' : 'Customer', ar ? 'البند' : 'Item',
                ar ? 'التاريخ' : 'Date', ar ? 'المبلغ' : 'Amount', ar ? 'المرفق' : 'File',
                ar ? 'طلبها' : 'Requested by', ar ? 'الحالة' : 'Status', '',
              ].map((h, i) => (
                <th key={i} className="whitespace-nowrap px-4 py-2.5 text-start text-xs font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="py-10 text-center text-slate-400">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-slate-500">
                {ar ? 'لا طلبات في هذه القائمة.' : 'Nothing here.'}
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.entryId} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Link href={`/system/customs/${r.clearanceId}`} className="font-mono font-bold text-[#f37121] hover:underline">
                    {r.refNumber || '—'}
                  </Link>
                  {r.blNumber ? <span className="ms-1.5 text-xs text-slate-400">{r.blNumber}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-slate-800">{r.customerName || '—'}</td>
                <td className="px-4 py-2.5 text-slate-800">
                  {r.label || r.key}
                  {r.note ? <span className="block text-xs text-slate-500">{r.note}</span> : null}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-600">{fmtDate(r.date)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular-nums text-slate-900">{money(r.amount)}</td>
                <td className="px-4 py-2.5">
                  {r.fileUrl ? (
                    <a href={r.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                      <Paperclip className="h-3 w-3" />{r.fileName || (ar ? 'المرفق' : 'file')}
                    </a>
                  ) : <span className="text-xs text-amber-600">{ar ? 'بلا مرفق' : 'no file'}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{r.addedByName || '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${PAY_BADGE[r.payStatus].cls}`}>
                    {ar ? PAY_BADGE[r.payStatus].ar : PAY_BADGE[r.payStatus].en}
                  </span>
                  {r.decisionNote ? <span className="block text-[11px] text-slate-500">{r.decisionNote}</span> : null}
                  {(r.proofFiles || []).map((f, i) => (
                    <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 hover:underline">
                      <Paperclip className="h-3 w-3" />{f.fileName || (ar ? 'إثبات' : 'proof')}
                    </a>
                  ))}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => { setAct({ row: r, decision: 'paid' }); setNote(''); setFiles([]); }}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700" title={ar ? 'تم الدفع' : 'Mark paid'}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => { setAct({ row: r, decision: 'returned' }); setNote(''); setFiles([]); }}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700" title={ar ? 'إرجاع الطلب' : 'Return'}>
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => { setAct({ row: r, decision: 'rejected' }); setNote(''); setFiles([]); }}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700" title={ar ? 'رفض الطلب' : 'Reject'}>
                      <Ban className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* نافذةُ القرار — الإثباتُ والسببُ كلاهما اختياريّ، والقرارُ ليس كذلك. */}
      {act && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setAct(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="font-bold text-slate-900">
                  {act.decision === 'paid' ? (ar ? 'تأكيد الدفع' : 'Confirm payment')
                    : act.decision === 'returned' ? (ar ? 'إرجاع الطلب' : 'Return the request')
                      : (ar ? 'رفض الطلب' : 'Reject the request')}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {act.row.refNumber} · {act.row.label || act.row.key} · {money(act.row.amount)}
                </p>
              </div>
              <button type="button" onClick={() => setAct(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  {ar ? 'ملاحظة' : 'Note'}
                  <span className="ms-1.5 text-xs font-normal text-slate-400">{ar ? '(اختياري)' : '(optional)'}</span>
                </label>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder={act.decision === 'returned'
                    ? (ar ? 'ما الذي يُصحَّح؟ «السعر مرتفع»…' : 'What should be corrected?')
                    : (ar ? 'سببٌ إن كان له سبب…' : 'A reason, if there is one…')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              </div>

              {act.decision === 'paid' && (
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    {ar ? 'إثبات الدفع' : 'Payment proof'}
                    <span className="ms-1.5 text-xs font-normal text-slate-400">{ar ? '(اختياري · ملف أو أكثر)' : '(optional · one or more)'}</span>
                  </label>
                  <input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    onChange={async (e) => {
                      const list = Array.from(e.target.files || []);
                      const out: { dataUrl: string; fileName: string }[] = [];
                      for (const f of list) {
                        if (f.size > MAX_UPLOAD) { notify(ar ? `${f.name}: أكبر من ٢٠ ميجابايت` : `${f.name}: over 20MB`, 'error'); continue; }
                        // eslint-disable-next-line no-await-in-loop
                        const dataUrl: string = await new Promise((res, rej) => {
                          const r = new FileReader();
                          r.onload = () => res(String(r.result || ''));
                          r.onerror = () => rej(new Error('read failed'));
                          r.readAsDataURL(f);
                        });
                        out.push({ dataUrl, fileName: f.name });
                      }
                      setFiles(out);
                    }}
                    className="block w-full text-xs text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />
                  {files.length > 0 && (
                    <p className="mt-1 text-[11px] text-slate-500">{files.map((f) => f.fileName).join('، ')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setAct(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={submit} disabled={busy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  act.decision === 'paid' ? 'bg-emerald-600 hover:bg-emerald-700'
                    : act.decision === 'returned' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {ar ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
