'use client';
/**
 * Billing requests from the clearance section as Finance sees them.
 * Clearance does not issue the customer invoice: it writes the items and requests it. Finance invoices in its own system, then marks it invoiced here with the invoice number and the final invoice (optional), so the transaction becomes invoiced and the invoice shows in the clearance transaction. Or it returns it for correction, or rejects it, with a reason clearance reads.
 * Distinct from payment requests (CustomsPaymentRequests): those are what we pay, these are what we invoice. Both counts make the number beside customs finance in the sidebar.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Receipt, Loader2, Check, Undo2, Ban, X, Paperclip, FileCheck2, ChevronDown, Wallet, FileText } from 'lucide-react';

type Status = 'pending' | 'invoiced' | 'returned' | 'rejected';
type Tab = Status | 'all';
interface Line { key?: string; label: string; amount: number; vat: number; total: number; from: 'stage' | 'sale'; note?: string; fileUrl?: string; fileName?: string; count?: number; pending?: number }
interface Req {
  clearanceId: string; refNumber?: string; blNumber?: string; customerName?: string; branch?: string; port?: string;
  isCompleted?: boolean; status: Status; requestedAt?: string; requestedByName?: string; note?: string;
  decidedAt?: string; decidedByName?: string; decisionNote?: string; fileUrl?: string; fileName?: string;
  invoiceNumber?: string; total: number; vat: number; net?: number; expenses?: number; items?: number; itemsTotal?: number; lines: Line[];
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
    if (f.size > MAX_UPLOAD) { notify(t('الملفّ أكبر من 20 ميجا', 'File over 20MB'), 'error'); return; }
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
                  {/* The whole row opens the invoice breakdown under it; links and actions inside keep their own click. */}
                  <tr onClick={() => setOpenRow(openRow === r.clearanceId ? null : r.clearanceId)}
                    className={`align-top cursor-pointer transition ${openRow === r.clearanceId ? 'bg-orange-50/50' : 'hover:bg-slate-50/60'}`}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => onOpen(r.clearanceId)} className="font-bold text-[#b4471a] hover:underline">{r.refNumber || '—'}</button>
                      <p className="text-[11.5px] text-slate-500"><bdi>{r.blNumber || ''}</bdi>{r.isCompleted ? ` · ${t('مغلقة', 'Closed')}` : ''}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{r.customerName || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 font-bold tabular-nums text-slate-900">{money(r.total)}
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${openRow === r.clearanceId ? 'rotate-180 text-[#f37121]' : ''}`} /></span>
                      <p className="text-[11px] text-slate-400">{t('مصروفات', 'Expenses')} {money(r.expenses || 0)} + {t('بنود', 'lines')} {money(r.itemsTotal ?? 0)} {t('شامل الضريبة', 'incl. VAT')}</p>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-slate-600">{r.requestedByName || '—'}<p className="text-[11px] text-slate-400">{when(r.requestedAt)}</p>{r.note && <p className="text-[11.5px] text-slate-500">«{r.note}»</p>}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${BADGE[r.status]}`}>{STATUS_WORD[r.status]}</span>
                      {r.invoiceNumber && <p className="mt-1 text-[11.5px] tabular-nums text-slate-600">{r.invoiceNumber}</p>}
                      {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-sky-700 hover:underline"><FileCheck2 className="h-3 w-3" />{t('الفاتورة النهائية', 'Final invoice')}</a>}
                      {r.decisionNote && <p className="text-[11.5px] text-slate-500">«{r.decisionNote}»</p>}
                      {r.decidedByName && <p className="text-[11px] text-slate-400">{r.decidedByName} · {when(r.decidedAt)}</p>}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
                        {/* Two parts: expenses paid through payment stages (at cost, no VAT, repeated payments summed) and the request's own lines, which carry VAT. */}
                        {(() => {
                          const exp = r.lines.filter((l) => l.from === 'stage');
                          const items = r.lines.filter((l) => l.from !== 'stage');
                          const itemsTotal = r.itemsTotal ?? ((r.items || 0) + r.vat);
                          const Row = ({ l, vat }: { l: Line; vat: boolean }) => (
                            <li className="flex items-start justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800 flex items-center gap-1.5">{l.label}
                                  {l.fileUrl && <a href={l.fileUrl} target="_blank" rel="noreferrer" title={l.fileName || ''} className="text-sky-700"><Paperclip className="h-3.5 w-3.5" /></a>}</p>
                                <p className="text-[11.5px] text-slate-500">
                                  {(l.count || 1) > 1 && <span className="me-2 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{t(`مجموع ${l.count} دفعات`, `${l.count} payments`)}</span>}
                                  {!!l.pending && <span className="me-2 text-amber-700">{t(`منها ${money(l.pending)} لم تُدفع بعد`, `${money(l.pending)} not yet paid`)}</span>}
                                  {l.note}
                                </p>
                              </div>
                              <div className="shrink-0 text-end tabular-nums">
                                <p className="font-bold text-slate-900">{money(l.total)}</p>
                                {vat && <p className="text-[11px] text-slate-500">{money(l.amount)} + {t('ضريبة', 'VAT')} {money(l.vat)}</p>}
                              </div>
                            </li>
                          );
                          // One sheet per transaction: both parts, their subtotals and the invoice total, as finance sees them here.
                          const xRows = [
                            ...exp.map((l) => ({ part: t('مصروفات (بدون ضريبة)', 'Expenses (no VAT)'), label: l.label, count: l.count || 1, amount: l.amount, vat: 0, total: l.total, note: l.note || '' })),
                            { part: '', label: t('إجمالي المصروفات', 'Expenses total'), count: '', amount: r.expenses || 0, vat: 0, total: r.expenses || 0, note: '' },
                            ...items.map((l) => ({ part: t('بنود الفوترة (ضريبة 15%)', 'Invoicing lines (VAT 15%)'), label: l.label, count: 1, amount: l.amount, vat: l.vat, total: l.total, note: l.note || '' })),
                            { part: '', label: t('إجمالي البنود', 'Lines total'), count: '', amount: r.items || 0, vat: r.vat, total: itemsTotal, note: '' },
                            { part: '', label: t('إجمالي الفاتورة', 'Invoice total'), count: '', amount: (r.expenses || 0) + (r.items || 0), vat: r.vat, total: r.total, note: '' },
                          ];
                          const xCols: ExportColumn[] = [
                            { header: t('الجزء', 'Part'), key: 'part', width: 24 },
                            { header: t('البند', 'Line'), key: 'label', width: 36 },
                            { header: t('عدد الدفعات', 'Payments'), key: 'count', width: 11 },
                            { header: t('المبلغ', 'Amount'), key: 'amount', width: 14 },
                            { header: t('الضريبة', 'VAT'), key: 'vat', width: 12 },
                            { header: t('الإجمالي', 'Total'), key: 'total', width: 14 },
                            { header: t('ملاحظة', 'Note'), key: 'note', width: 30 },
                          ];
                          return (
                            <div className="space-y-3 py-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[13px] font-bold text-slate-800">{t('تفاصيل فاتورة', 'Invoice breakdown')} {r.refNumber} <span className="font-normal text-slate-500">· {r.customerName}</span></p>
                                <ExportMenu fileName={`invoice-${r.refNumber || r.clearanceId}`} lang={ar ? 'ar' : 'en'} variant="subtle"
                                  options={[{ key: 'one', label: t('هذه المعاملة', 'This transaction'), sheets: [{ name: r.refNumber || t('الفاتورة', 'Invoice'), rows: xRows, columns: xCols }] }]} />
                              </div>
                              <div className="grid gap-3 lg:grid-cols-2">
                                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                                  <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                                    <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800"><Wallet className="h-4 w-4 text-slate-500" />{t('المصروفات — مراحل السداد وطلبات الصرف', 'Expenses — payment stages')}</h4>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{t('بدون ضريبة', 'No VAT')}</span>
                                  </header>
                                  <ul className="divide-y divide-slate-100 px-4 text-[13px]">
                                    {exp.length ? exp.map((l, i) => <Row key={i} l={l} vat={false} />) : <li className="py-3 text-center text-slate-400">{t('لا مصروفات مسجّلة', 'No expenses recorded')}</li>}
                                  </ul>
                                  <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[13px] font-bold"><span>{t('إجمالي المصروفات', 'Expenses total')}</span><span className="tabular-nums">{money(r.expenses || 0)}</span></footer>
                                </section>
                                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                                  <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                                    <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800"><FileText className="h-4 w-4 text-slate-500" />{t('بنود طلب الفوترة', 'Invoicing lines')}</h4>
                                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-[#b4471a]">{t('ضريبة 15%', 'VAT 15%')}</span>
                                  </header>
                                  <ul className="divide-y divide-slate-100 px-4 text-[13px]">
                                    {items.length ? items.map((l, i) => <Row key={i} l={l} vat />) : <li className="py-3 text-center text-slate-400">{t('لا بنود', 'No lines')}</li>}
                                  </ul>
                                  <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[13px] font-bold"><span>{t('إجمالي البنود شامل الضريبة', 'Lines incl. VAT')}</span><span className="tabular-nums">{money(itemsTotal)}</span></footer>
                                </section>
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {[
                                  [t('المصروفات', 'Expenses'), r.expenses || 0, 'text-slate-900'],
                                  [t('البنود قبل الضريبة', 'Lines before VAT'), r.items || 0, 'text-slate-900'],
                                  [t('الضريبة', 'VAT'), r.vat, 'text-slate-900'],
                                  [t('إجمالي الفاتورة', 'Invoice total'), r.total, 'text-[#f37121]'],
                                ].map(([k, v, cls]: any) => (
                                  <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-[11px] font-semibold text-slate-500">{k}</p>
                                    <p className={`text-[15px] font-black tabular-nums ${cls}`}>{money(v)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        {r.note && <p className="mt-1.5 text-[12px] text-slate-600">{t('ملاحظة الطلب:', 'Request note:')} {r.note}</p>}
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
