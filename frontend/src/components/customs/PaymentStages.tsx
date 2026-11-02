'use client';
/**
 * Payment stages: entries with their own date and attachment, and a stage can repeat.
 * Before: eight hardcoded rows with one date each, a done flag and no attachment, which ruled out a ninth stage without a release, the payment paper itself, and repeats (fees paid in two installments, returns for two containers overwriting each other). Now: the list is managed from section settings (`customs_payment_stage`), each stage is added repeatedly with the "+" button, and each entry has its date, attachment and amount. Uploads also appear in the transaction attachments: one file listed in two places, not two copies.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { downloadName, AMOUNT_REQUIRED_STAGE_KEYS, TRANSPORT_STAGE_KEYS } from '@/lib/customsPipeline';
import {
  Plus, Paperclip, Trash2, Loader2, Check, CalendarDays, Lock, Unlock, AlertTriangle, Clock3, Receipt,
} from 'lucide-react';

export interface StageEntry {
  _id: string; key: string; label?: string; date?: string; amount?: number | null;
  note?: string; fileUrl?: string; fileName?: string;
  addedByName?: string; addedAt?: string;
  // Finance's decision on this request; see decidePaymentStage on the server.
  payStatus?: 'pending' | 'paid' | 'returned' | 'rejected';
  decisionNote?: string; decidedByName?: string; decidedAt?: string;
  proofFiles?: { fileUrl: string; fileName?: string }[];
}

/** Request status badge; same wording on the clearance and finance screens. */
export const PAY_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  pending: { ar: 'بانتظار الدفع', en: 'Awaiting payment', cls: 'bg-amber-100 text-amber-800' },
  paid: { ar: 'تمّ الدفع', en: 'Paid', cls: 'bg-green-100 text-green-700' },
  returned: { ar: 'أُعيد للتصحيح', en: 'Returned', cls: 'bg-blue-100 text-blue-700' },
  rejected: { ar: 'مرفوض', en: 'Rejected', cls: 'bg-red-100 text-red-700' },
};
interface StageDef { _id: string; key: string; nameAr?: string; nameEn?: string }

const fmtDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)
  ? d.split('-').reverse().join('/') : (d || '—'));

export default function PaymentStages({
  clearanceId, refNumber, entries, completed, completedByName, completedAt, canEdit, ar, onChanged,
  invoiceNumber, awaitingTransport, onIssueInvoice,
}: {
  clearanceId: string;
  /** Waybill or transaction number; it names the file on download. */
  refNumber?: string;
  /** Customer invoice number if issued, and whether the transaction awaits the transport invoice. */
  invoiceNumber?: string;
  awaitingTransport?: boolean;
  /** The invoice-issuing window opens from the page; its button here and in the header is the same one. */
  onIssueInvoice: () => void;
  entries: StageEntry[];
  completed?: boolean;
  completedByName?: string;
  completedAt?: string;
  canEdit: boolean;
  ar: boolean;
  onChanged: (clearance: any) => void;
}) {
  const { notify, confirm } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [defs, setDefs] = useState<StageDef[]>([]);
  const [busy, setBusy] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const loadDefs = useCallback(() => {
    api.get<{ items: StageDef[] }>('/api/lookups?type=customs_payment_stage&active=true')
      .then((d) => setDefs(d.items || [])).catch(() => {});
  }, []);
  useEffect(() => { loadDefs(); }, [loadDefs]);
  // A change in section settings (name, order, new item) shows here immediately.
  useSocket('lookup:changed', useCallback((p: any) => { if (p?.type === 'customs_payment_stage') loadDefs(); }, [loadDefs]));

  // Entries grouped under their stage, in settings order, not insertion order.
  const grouped = useMemo(() => {
    const byKey = new Map<string, StageEntry[]>();
    for (const e of entries || []) {
      if (!byKey.has(e.key)) byKey.set(e.key, []);
      byKey.get(e.key)!.push(e);
    }
    for (const list of byKey.values()) list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const known = defs.map((d) => ({ def: d, list: byKey.get(d.key) || [] }));
    // A stage deleted from settings that still has old entries stays visible; history is not erased.
    const orphans = [...byKey.entries()]
      .filter(([k]) => !defs.some((d) => d.key === k))
      .map(([k, list]) => ({ def: { _id: k, key: k, nameAr: list[0]?.label || k, nameEn: list[0]?.label || k } as StageDef, list }));
    return [...known, ...orphans];
  }, [entries, defs]);

  // The three transport invoices are alternative paths, not combinable; the server enforces it.
  const transportBlock = (key: string) => {
    const has = (k: string) => (entries || []).some((e) => e.key === k);
    if (key === 'transportPortToCustomer' && (has('transportPortToYard') || has('transportYardToCustomer'))) return t('سُجّل النقلُ عبر الساحة', 'Transport via the yard is recorded');
    if (key === 'transportPortToYard' && has('transportPortToCustomer')) return t('سُجّل النقلُ من الميناء إلى العميل', 'Port-to-customer transport is recorded');
    if (key === 'transportYardToCustomer') {
      if (has('transportPortToCustomer')) return t('سُجّل النقلُ من الميناء إلى العميل', 'Port-to-customer transport is recorded');
      if (!has('transportPortToYard')) return t('سجّل النقلَ من الميناء إلى الساحة أوّلًا', 'Record port-to-yard first');
    }
    return '';
  };

  const remove = async (entryId: string) => {
    const e = (entries || []).find((x) => x._id === entryId);
    if (!(await confirm({
      title: t('حذف هذا الإدخال؟', 'Delete this entry?'),
      message: e?.fileUrl
        ? t('يُحذَف الإدخالُ ومعه مرفقُه من «مرفقات المعاملة» — وهما شيءٌ واحد.', 'The entry and its file in the transaction attachments are both removed.')
        : t('يُحذَف الإدخالُ نهائيًّا.', 'The entry is removed permanently.'),
      confirmLabel: t('حذف', 'Delete'), tone: 'danger',
    }))) return;
    setBusy(entryId);
    try {
      const d = await api.delete<any>(`/api/customs-clearance/${clearanceId}/payment-stages/${entryId}`);
      onChanged(d.clearance);
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Failed'), 'error'); }
    setBusy('');
  };

  const setComplete = async (value: boolean) => {
    setBusy('complete');
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${clearanceId}/complete`, { completed: value });
      onChanged(d.clearance);
      notify(value
        ? (invoiceNumber ? t('أُغلقت المعاملة', 'Transaction closed') : t('أُغلقت المعاملة — مغلقة غير مفوترة', 'Closed — not invoiced'))
        : t('أُعيد فتحُ المعاملة', 'Reopened'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setBusy('');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {t('لكلّ مرحلةٍ تاريخٌ ومرفق، والمرحلةُ نفسُها تُضاف أكثر من مرّة بزرّ +. والقائمة تُدار من إعدادات القسم.',
           'Each stage takes a date and a file; add the same stage more than once with +. The list is managed in section settings.')}
      </p>

      <div className="space-y-2">
        {grouped.map(({ def, list }) => {
          const label = ar ? (def.nameAr || def.nameEn || def.key) : (def.nameEn || def.nameAr || def.key);
          // Any transport stage with its attachment finishes the transaction, not only the transport invoice.
          const isRequired = TRANSPORT_STAGE_KEYS.has(def.key);
          return (
            <div key={def.key} className={`rounded-lg border ${isRequired ? 'border-[#f37121]/40 bg-[#f37121]/5' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                {/* The mark means "paid", not "written". It used to turn green on mere entry existence, but an entry is a payment request, not proof of payment. Now it follows Finance's decision: green when all entries of the stage are paid, yellow while any is waiting. */}
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  list.length && list.every((x) => (x.payStatus || 'pending') === 'paid')
                    ? 'border-green-500 bg-green-500 text-white'
                    : (list.length ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-slate-300 bg-white')}`}>
                  {list.length ? (list.every((x) => (x.payStatus || 'pending') === 'paid')
                    ? <Check className="h-3.5 w-3.5" /> : <Clock3 className="h-3 w-3" />) : null}
                </span>
                <span className="flex-1 truncate text-sm font-semibold text-slate-800">
                  {label}
                  {/* Payment stages are independent of closing the transaction; see settleClosure. */}
                  {list.length > 1 && (
                    <span className="ms-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {list.length}
                    </span>
                  )}
                  {/* A repeated item reads as a sum, which is what is written to its costs on payment. */}
                  {list.length > 1 && list.some((e) => Number(e.amount) > 0) && (
                    <span className="ms-1.5 text-[11px] font-bold tabular-nums text-slate-600">
                      {t('المجموع', 'Total')}: {list.reduce((a, e) => a + (Number(e.amount) || 0), 0).toLocaleString('en-US')}
                    </span>
                  )}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => setOpenKey(openKey === def.key ? null : def.key)}
                    disabled={!!transportBlock(def.key)}
                    title={transportBlock(def.key) || t('إضافة إدخال', 'Add an entry')}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-[#f37121] ring-1 ring-slate-200 hover:ring-[#f37121]/50 disabled:cursor-not-allowed disabled:opacity-40">
                    <Plus className="h-3.5 w-3.5" />{t('إضافة', 'Add')}
                  </button>
                )}
              </div>

              {!!list.length && (
                <ul className="space-y-1 border-t border-slate-200/70 px-3 py-2">
                  {list.map((e, n) => (
                    <li key={e._id} className="flex flex-wrap items-center gap-2 text-xs">
                      {/* A stage can repeat, so the label says which occurrence this is. */}
                      {list.length > 1 && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-700">
                          {t(`الدفعة ${n + 1}`, `#${n + 1}`)}
                        </span>
                      )}
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="font-mono font-semibold text-slate-700">{fmtDate(e.date)}</span>
                      {e.amount != null && (
                        <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-200">
                          {Number(e.amount).toLocaleString()}
                        </span>
                      )}
                      {e.fileUrl ? (
                        <a href={e.fileUrl} target="_blank" rel="noreferrer"
                          download={downloadName(refNumber, label, list.length > 1 ? n + 1 : 0, e.fileName, e.fileUrl)}
                          title={e.fileName || ''}
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                          <Paperclip className="h-3 w-3" />{label}{list.length > 1 ? ` (${n + 1})` : ''}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{t('بلا مرفق', 'no file')}
                        </span>
                      )}
                      {e.note && <span className="text-slate-400">· {e.note}</span>}
                      {e.addedByName && <span className="text-slate-300">· {e.addedByName}</span>}
                      {/* Finance's decision sits beside the request itself, not in an email. */}
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${PAY_BADGE[e.payStatus || 'pending'].cls}`}>
                        {ar ? PAY_BADGE[e.payStatus || 'pending'].ar : PAY_BADGE[e.payStatus || 'pending'].en}
                      </span>
                      {canEdit && (
                        <button type="button" onClick={() => remove(e._id)} disabled={busy === e._id}
                          className="ms-auto text-slate-300 hover:text-red-600" title={t('حذف', 'Delete')}>
                          {busy === e._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {(e.decisionNote || (e.proofFiles || []).length || e.decidedByName) && (
                        <span className="w-full ps-5 text-[11px] text-slate-500">
                          {e.decisionNote ? <span className="text-slate-700">{e.decisionNote}</span> : null}
                          {e.decidedByName ? <span className="ms-1.5">· {e.decidedByName}</span> : null}
                          {(e.proofFiles || []).map((f, i) => (
                            <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer"
                              className="ms-1.5 inline-flex items-center gap-1 font-semibold text-green-700 hover:underline">
                              <Paperclip className="h-3 w-3" />{f.fileName || t('إثبات الدفع', 'proof')}
                            </a>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {openKey === def.key && canEdit && (
                <AddEntry clearanceId={clearanceId} stageKey={def.key} ar={ar}
                  amountRequired={AMOUNT_REQUIRED_STAGE_KEYS.has(def.key)}
                  onDone={(cl) => { onChanged(cl); setOpenKey(null); }}
                  onCancel={() => setOpenKey(null)} />
              )}
            </div>
          );
        })}
        {!grouped.length && (
          <p className="py-6 text-center text-xs text-slate-400">
            {t('لا مراحلَ معرَّفة — أضِفها من إعدادات القسم.', 'No stages defined — add them in section settings.')}
          </p>
        )}
      </div>

      {/* Invoice, then closing: two actions. The invoice issues when work is complete; the transaction closes when the transport invoice arrives. The status is stated here before clicking, not after. */}
      <div className={`rounded-lg border p-3 ${completed ? 'border-green-300 bg-green-50' : awaitingTransport ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
        {completed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Lock className="h-4 w-4 text-green-700" />
            <span className="text-sm font-bold text-green-800">{t('المعاملة مغلقة', 'Transaction closed')}</span>
            {invoiceNumber && <span className="text-[11px] font-semibold text-green-800"><bdi>{invoiceNumber}</bdi></span>}
            {completedByName && (
              <span className="text-[11px] text-green-700/80">
                {completedByName}{completedAt ? ` · ${new Date(completedAt).toLocaleDateString('en-GB')}` : ''}
              </span>
            )}
            {canEdit && (
              <button type="button" onClick={() => setComplete(false)} disabled={busy === 'complete'}
                className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:text-[#f37121]">
                <Unlock className="h-3.5 w-3.5" />{t('إعادة الفتح', 'Reopen')}
              </button>
            )}
          </div>
        ) : invoiceNumber ? (
          <div className="flex flex-wrap items-center gap-2">
            <Receipt className={`h-4 w-4 ${awaitingTransport ? 'text-red-600' : 'text-slate-600'}`} />
            <span className="text-sm font-bold text-slate-800">{t('صدرت الفاتورة', 'Invoice issued')} <bdi>{invoiceNumber}</bdi></span>
            {awaitingTransport && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10.5px] font-bold text-white">
                {t('بانتظار فاتورة النقل', 'Awaiting transport invoice')}
              </span>
            )}
            {canEdit && (
              <button type="button" onClick={onIssueInvoice}
                className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:text-[#f37121]">
                <Receipt className="h-3.5 w-3.5" />{t('تعديل الفاتورة', 'Edit invoice')}
              </button>
            )}
            {canEdit && !awaitingTransport && (
              <button type="button" onClick={() => setComplete(true)} disabled={busy === 'complete'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                {busy === 'complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {t('إنهاء المعاملة', 'Close transaction')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">{t('فاتورة العميل', 'Customer invoice')}</span>
            <span className="text-[11px] text-slate-500">
              {t('يمكن إغلاقُ المعاملة الآن (مغلقة غير مفوترة) وطلبُ فوترتها منها لاحقًا.', 'Close it now (closed, not invoiced) and request invoicing from it later.')}
            </span>
            {canEdit && (
              <button type="button" onClick={() => setComplete(true)} disabled={busy === 'complete'}
                className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                {busy === 'complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {t('إغلاق المعاملة', 'Close transaction')}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={onIssueInvoice}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-xs font-bold text-white">
                <Receipt className="h-3.5 w-3.5" />{t('طلب فوترة', 'Request invoicing')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Form for a single entry: date, amount, note and file. */
function AddEntry({
  clearanceId, stageKey, ar, amountRequired, onDone, onCancel,
}: {
  clearanceId: string; stageKey: string; ar: boolean;
  /** A stage is written to costs on payment, so it cannot be added without an amount. */
  amountRequired?: boolean;
  onDone: (cl: any) => void; onCancel: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const amountOk = !amountRequired || (amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0);

  const pick = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { notify(t('الملفّ أكبر من 20 ميجابايت', 'File larger than 20MB'), 'error'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ dataUrl: String(r.result), fileName: f.name });
    r.readAsDataURL(f);
  }, [notify, t]);

  const save = async () => {
    if (!date && !file) {
      notify(t('اختر تاريخًا أو ارفع ملفًّا', 'Pick a date or attach a file'), 'error');
      return;
    }
    if (!amountOk) {
      notify(t('اكتب المبلغ — هذه المرحلةُ طلبُ صرفٍ ولا تُضاف بلا مبلغ', 'Enter the amount — this stage is a payment request'), 'error');
      return;
    }
    setSaving(true);
    try {
      const d = await api.post<any>(`/api/customs-clearance/${clearanceId}/payment-stages`, {
        key: stageKey, date, note,
        amount: amount === '' ? null : Number(amount),
        dataUrl: file?.dataUrl, fileName: file?.fileName,
      });
      onDone(d.clearance);
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setSaving(false);
  };

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{t('التاريخ', 'Date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs [color-scheme:light]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{amountRequired
              ? <>{t('المبلغ (إلزامي)', 'Amount (required)')} <span className="text-red-600">*</span></>
              : t('المبلغ (اختياري)', 'Amount (optional)')}
          </span>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required={amountRequired}
            className={`w-24 rounded-lg border px-2 py-1.5 text-xs ${amountRequired && !amountOk ? 'border-red-300' : 'border-slate-200'}`} />
        </label>
        <label className="block flex-1 min-w-[8rem]">
          <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{t('ملاحظة', 'Note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
        </label>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
          <Paperclip className="h-3.5 w-3.5" />
          {file ? file.fileName.slice(0, 22) : t('إرفاق ملفّ', 'Attach file')}
        </button>
        <input ref={inputRef} type="file" className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => pick(e.target.files?.[0] || null)} />
        <button type="button" onClick={save} disabled={saving || !amountOk}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t('حفظ', 'Save')}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-2 text-[11px] text-slate-400 hover:text-slate-700">
          {t('إلغاء', 'Cancel')}
        </button>
      </div>
    </div>
  );
}
