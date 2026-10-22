'use client';
/**
 * طلباتُ الفوترة من قسم التخليص كما تراها الإدارةُ الماليّة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢).
 *
 * التخليصُ لا يُصدر فاتورةَ العميل: يكتب بنودَها ويطلبها. والماليّةُ تفوترها في
 * نظامها ثمّ تقول هنا «تمّت الفوترة» — ومعها رقمُ الفاتورة والفاتورةُ النهائيّة
 * (اختياريّة) — فتصير المعاملةُ مفوترةً وتظهر الفاتورةُ في معاملة التخليص. أو
 * تعيده للتصحيح، أو ترفضه، بسببٍ يقرؤه التخليص.
 *
 * وهي غيرُ طلبات الصرف (CustomsPaymentRequests): تلك ما ندفعه، وهذه ما نفوتره.
 * والعددان معًا هما الرقمُ بجانب «ماليات التخليص الجمركي» في الشريط الجانبيّ.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Receipt, Loader2, Check, Undo2, Ban, X, Paperclip, FileCheck2 } from 'lucide-react';

type Status = 'pending' | 'invoiced' | 'returned' | 'rejected';
type Tab = Status | 'all';
interface Line { label: string; amount: number; vat: number; total: number; from: 'stage' | 'sale'; fileUrl?: string }
interface Req {
  clearanceId: string; refNumber?: string; blNumber?: string; customerName?: string; branch?: string; port?: string;
  isCompleted?: boolean; status: Status; requestedAt?: string; requestedByName?: string; note?: string;
  decidedAt?: string; decidedByName?: string; decisionNote?: string; fileUrl?: string; fileName?: string;
  invoiceNumber?: string; total: number; vat: number; lines: Line[];
}

const MAX_UPLOAD = 20 * 1024 * 1024;
const money = (v?: number | null) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const when = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');
const BADGE: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-800', invoiced: 'bg-emerald-100 text-emerald-700',
  returned: 'bg-sky-100 text-sky-800', rejected: 'bg-red-100 text-red-700',
};

export default function CustomsInvoiceRequests({ ar, onOpen }: { ar: boolean; onOpen: (clearanceId: string) => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<Req[] | null>(null);
  const [counts, setCounts] = useState<Record<Status, number>>({ pending: 0, invoiced: 0, returned: 0, rejected: 0 });
  const [act, setAct] = useState<{ req: Req; decision: 'invoiced' | 'returned' | 'rejected' } | null>(null);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const guard = useLatestRequest();
  const STATUS_WORD: Record<Status, string> = {
    pending: t('بانتظار الفوترة', 'Awaiting invoicing'), invoiced: t('تمّت الفوترة', 'Invoiced'),
    returned: t('أُعيد للتصحيح', 'Returned'), rejected: t('مرفوض', 'Rejected'),
  };

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ counts: Record<Status, number>; requests: Req[] }>(`/api/customs-clearance/invoice-requests?status=${tab}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.requests || []); setCounts(d.counts);
    } catch { if (guard.isCurrent(mine)) setRows([]); }
  }, [tab, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('customs:updated', load);

  const start = (req: Req, decision: 'invoiced' | 'returned' | 'rejected') => {
    setAct({ req, decision }); setNumber(''); setNote(''); setFile(null);
  };
  const pick = async (f?: File | null) => {
    if (!f) return;
    if (f.size > MAX_UPLOAD) { notify(t('الملفّ أكبر من ٢٠ ميجا', 'File over 20MB'), 'error'); return; }
    const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
    setFile({ dataUrl, fileName: f.name });
  };
  const submit = async () => {
    if (!act) return;
    if (act.decision !== 'invoiced' && !note.trim()) { notify(t('اكتب السبب', 'Write the reason'), 'error'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/customs-clearance/${act.req.clearanceId}/invoice-request/decision`, {
        decision: act.decision, note: note.trim(), ...(act.decision === 'invoiced' ? { invoiceNumber: number.trim(), file } : {}),
      });
      notify(act.decision === 'invoiced' ? t('سُجّلت الفوترة', 'Marked invoiced') : t('سُجّل القرار', 'Decision saved'), 'success');
      setRows((r) => (r || []).filter((x) => x.clearanceId !== act.req.clearanceId || tab === 'all'));
      setAct(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error'); }
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Receipt className="h-4 w-4 text-[#f37121]" />
        <h2 className="text-[15px] font-bold text-slate-900">{t('طلبات الفوترة', 'Invoice requests')}</h2>
        {counts.pending > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">{counts.pending}</span>}
        <p className="w-full text-[12px] text-slate-500 sm:w-auto sm:flex-1">{t('يطلبها التخليصُ عند الإقفال — فوتِرها في نظامك ثمّ «تمّت الفوترة» هنا.', 'Customs requests them on closing — invoice in your system, then mark it here.')}</p>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[12px] font-semibold">
          {(['pending', 'invoiced', 'returned', 'rejected', 'all'] as Tab[]).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-2.5 py-1.5 ${tab === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {k === 'all' ? t('الكلّ', 'All') : STATUS_WORD[k as Status]}{k !== 'all' && counts[k as Status] ? ` (${counts[k as Status]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {!rows ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : !rows.length ? (
        <p className="py-8 text-center text-[13px] text-slate-400">{tab === 'pending' ? t('لا طلبات فوترة تنتظر', 'Nothing awaiting invoicing') : t('لا شيء هنا', 'Nothing here')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-slate-50 text-[12px] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">{t('المعاملة', 'Transaction')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('العميل', 'Customer')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('إجمالي الفاتورة', 'Invoice total')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('طلبها', 'Requested by')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('الحالة', 'Status')}</th>
                <th className="px-3 py-2 text-start font-semibold">{t('الإجراء', 'Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Fragment key={r.clearanceId}>
                  <tr className="align-top hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onOpen(r.clearanceId)} className="font-bold text-[#b4471a] hover:underline">{r.refNumber || '—'}</button>
                      <p className="text-[11.5px] text-slate-500"><bdi>{r.blNumber || ''}</bdi>{r.isCompleted ? ` · ${t('مغلقة', 'Closed')}` : ''}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{r.customerName || '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpenRow(openRow === r.clearanceId ? null : r.clearanceId)} className="font-bold tabular-nums text-slate-900 hover:underline">{money(r.total)}</button>
                      <p className="text-[11px] text-slate-400">{t('شامل الضريبة', 'incl. VAT')} {money(r.vat)} · {r.lines.length} {t('بند', 'lines')}</p>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-slate-600">{r.requestedByName || '—'}<p className="text-[11px] text-slate-400">{when(r.requestedAt)}</p>{r.note && <p className="text-[11.5px] text-slate-500">«{r.note}»</p>}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${BADGE[r.status]}`}>{STATUS_WORD[r.status]}</span>
                      {r.invoiceNumber && <p className="mt-1 text-[11.5px] tabular-nums text-slate-600">{r.invoiceNumber}</p>}
                      {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-sky-700 hover:underline"><FileCheck2 className="h-3 w-3" />{t('الفاتورة النهائية', 'Final invoice')}</a>}
                      {r.decisionNote && <p className="text-[11.5px] text-slate-500">«{r.decisionNote}»</p>}
                      {r.decidedByName && <p className="text-[11px] text-slate-400">{r.decidedByName} · {when(r.decidedAt)}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'pending' ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => start(r, 'invoiced')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />{t('تمّت الفوترة', 'Invoiced')}</button>
                          <button type="button" onClick={() => start(r, 'returned')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"><Undo2 className="h-3.5 w-3.5" />{t('إعادة', 'Return')}</button>
                          <button type="button" onClick={() => start(r, 'rejected')} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50"><Ban className="h-3.5 w-3.5" />{t('رفض', 'Reject')}</button>
                        </div>
                      ) : <span className="text-[12px] text-slate-300">—</span>}
                    </td>
                  </tr>
                  {openRow === r.clearanceId && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50/70 px-3 py-2">
                        <table className="w-full max-w-2xl text-[12.5px]">
                          <tbody>
                            {r.lines.map((l, i) => (
                              <tr key={i} className="border-b border-slate-100 last:border-0">
                                <td className="py-1 text-slate-700">{l.label}{l.from === 'stage' ? <span className="ms-1 text-[11px] text-slate-400">({t('مرحلة سداد', 'payment stage')})</span> : null}
                                  {l.fileUrl && <a href={l.fileUrl} target="_blank" rel="noreferrer" className="ms-1 inline-flex text-sky-700"><Paperclip className="h-3 w-3" /></a>}</td>
                                <td className="py-1 text-end tabular-nums">{money(l.amount)}</td>
                                <td className="py-1 text-end tabular-nums text-slate-400">{l.vat ? `+${money(l.vat)}` : ''}</td>
                                <td className="py-1 text-end font-semibold tabular-nums">{money(l.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {act && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setAct(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {act.decision === 'invoiced' ? t('تمّت الفوترة', 'Mark invoiced') : act.decision === 'returned' ? t('إعادة للتصحيح', 'Return for correction') : t('رفض طلب الفوترة', 'Reject request')}
                <span className="ms-1 text-slate-500">· {act.req.refNumber}</span>
              </h3>
              <button type="button" onClick={() => setAct(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            {act.decision === 'invoiced' && (
              <>
                <label className="mb-1 block text-[12px] text-slate-500">{t('رقم الفاتورة في نظامكم (اختياري — وإلّا يُعطى رقمٌ متسلسل)', 'Invoice number in your system (optional)')}</label>
                <input value={number} onChange={(e) => setNumber(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <label className="mb-1 block text-[12px] text-slate-500">{t('الفاتورة النهائية (اختياري)', 'Final invoice (optional)')}</label>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => pick(e.target.files?.[0])} className="mb-1 block w-full text-[12.5px]" />
                {file && <p className="mb-2 text-[12px] text-emerald-700">{file.fileName}</p>}
              </>
            )}
            <label className="mb-1 mt-2 block text-[12px] text-slate-500">{act.decision === 'invoiced' ? t('ملاحظة (اختياري)', 'Note (optional)') : t('السبب *', 'Reason *')}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setAct(null)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{t('إلغاء', 'Cancel')}</button>
              <button type="button" onClick={submit} disabled={busy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white ${act.decision === 'rejected' ? 'bg-red-600 hover:bg-red-700' : act.decision === 'returned' ? 'bg-slate-800 hover:bg-slate-900' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('تأكيد', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
