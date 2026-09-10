'use client';
/**
 * مراحلُ السداد — إدخالٌ بتاريخه ومرفقه، والمرحلةُ تتكرّر.
 *
 * ── ما كان ────────────────────────────────────────────────────────────────
 * ثمانيةُ صفوفٍ مكتوبةٍ في الشيفرة: تاريخٌ واحدٌ لكلٍّ وعلامةُ «تم» وبلا مرفق.
 * وثلاثةُ أشياءَ لم تكن ممكنة: مرحلةٌ تاسعة (تحتاج نشرةً جديدة)، وورقةُ السداد
 * نفسُها (فيُكتب «سُدِّد ٣/٨» ولا إيصال)، وأن تتكرّر المرحلة — والرسومُ تُسدَّد
 * على دفعتين، والإرجاعُ يقع مرّتين لحاويتين، فيُكتب الثاني فوق الأوّل ويضيع.
 *
 * ── وما صار ───────────────────────────────────────────────────────────────
 * القائمةُ تُدار من إعدادات القسم (`customs_payment_stage`)، وكلُّ مرحلةٍ
 * تُضاف مرّاتٍ بزرّ «+»، ولكلّ إدخالٍ تاريخُه ومرفقُه ومبلغُه. والمرفوعُ يظهر
 * في «مرفقات المعاملة» أيضًا — ملفٌّ واحدٌ مذكورٌ في موضعين، لا نسختان.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import {
  Plus, Paperclip, Trash2, Loader2, Check, CalendarDays, Lock, Unlock, AlertTriangle,
} from 'lucide-react';

export interface StageEntry {
  _id: string; key: string; label?: string; date?: string; amount?: number | null;
  note?: string; fileUrl?: string; fileName?: string;
  addedByName?: string; addedAt?: string;
}
interface StageDef { _id: string; key: string; nameAr?: string; nameEn?: string }

const REQUIRED_KEY = 'transportInvoice';
const fmtDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)
  ? d.split('-').reverse().join('/') : (d || '—'));

export default function PaymentStages({
  clearanceId, entries, completed, completedByName, completedAt, canEdit, ar, onChanged,
}: {
  clearanceId: string;
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

  useEffect(() => {
    api.get<{ items: StageDef[] }>('/api/lookups?type=customs_payment_stage&active=true')
      .then((d) => setDefs(d.items || [])).catch(() => {});
  }, []);

  // الإدخالاتُ مجموعةً تحت مرحلتها، بترتيب الإعدادات لا بترتيب الإضافة.
  const grouped = useMemo(() => {
    const byKey = new Map<string, StageEntry[]>();
    for (const e of entries || []) {
      if (!byKey.has(e.key)) byKey.set(e.key, []);
      byKey.get(e.key)!.push(e);
    }
    for (const list of byKey.values()) list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const known = defs.map((d) => ({ def: d, list: byKey.get(d.key) || [] }));
    // مرحلةٌ حُذفت من الإعدادات وفيها إدخالاتٌ قديمة لا تُخفى — التاريخُ لا يُمحى.
    const orphans = [...byKey.entries()]
      .filter(([k]) => !defs.some((d) => d.key === k))
      .map(([k, list]) => ({ def: { _id: k, key: k, nameAr: list[0]?.label || k, nameEn: list[0]?.label || k } as StageDef, list }));
    return [...known, ...orphans];
  }, [entries, defs]);

  const readyToClose = useMemo(
    () => (entries || []).some((e) => e.key === REQUIRED_KEY && e.date && e.fileUrl),
    [entries],
  );

  const remove = async (entryId: string) => {
    if (!(await confirm(t('حذف هذا الإدخال؟ الملفُّ يبقى في مرفقات المعاملة.',
                          'Delete this entry? The file stays in the transaction attachments.')))) return;
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
      notify(value ? t('أُقفلت المعاملة', 'Transaction closed') : t('أُعيد فتحُ المعاملة', 'Reopened'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الإقفال', 'Failed'), 'error'); }
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
          const isRequired = def.key === REQUIRED_KEY;
          return (
            <div key={def.key} className={`rounded-lg border ${isRequired ? 'border-[#f37121]/40 bg-[#f37121]/5' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  list.length ? 'border-green-500 bg-green-500 text-white' : 'border-slate-300 bg-white'}`}>
                  {!!list.length && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="flex-1 truncate text-sm font-semibold text-slate-800">
                  {label}
                  {isRequired && (
                    <span className="ms-1.5 text-[10.5px] font-normal text-[#f37121]">
                      {t('مطلوبة لإقفال المعاملة', 'required to close')}
                    </span>
                  )}
                  {list.length > 1 && (
                    <span className="ms-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {list.length}
                    </span>
                  )}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => setOpenKey(openKey === def.key ? null : def.key)}
                    title={t('إضافة إدخال', 'Add an entry')}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-[#f37121] ring-1 ring-slate-200 hover:ring-[#f37121]/50">
                    <Plus className="h-3.5 w-3.5" />{t('إضافة', 'Add')}
                  </button>
                )}
              </div>

              {!!list.length && (
                <ul className="space-y-1 border-t border-slate-200/70 px-3 py-2">
                  {list.map((e) => (
                    <li key={e._id} className="flex flex-wrap items-center gap-2 text-xs">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="font-mono font-semibold text-slate-700">{fmtDate(e.date)}</span>
                      {e.amount != null && (
                        <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-200">
                          {Number(e.amount).toLocaleString()}
                        </span>
                      )}
                      {e.fileUrl ? (
                        <a href={e.fileUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                          <Paperclip className="h-3 w-3" />{e.fileName || t('مرفق', 'file')}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{t('بلا مرفق', 'no file')}
                        </span>
                      )}
                      {e.note && <span className="text-slate-400">· {e.note}</span>}
                      {e.addedByName && <span className="text-slate-300">· {e.addedByName}</span>}
                      {canEdit && (
                        <button type="button" onClick={() => remove(e._id)} disabled={busy === e._id}
                          className="ms-auto text-slate-300 hover:text-red-600" title={t('حذف', 'Delete')}>
                          {busy === e._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {openKey === def.key && canEdit && (
                <AddEntry clearanceId={clearanceId} stageKey={def.key} ar={ar}
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

      {/* ── إقفالُ المعاملة ─────────────────────────────────────────────────
          فعلٌ صريحٌ لا حالةٌ تُستنتَج، وشرطُه معلَنٌ قبل الضغط لا بعده. */}
      <div className={`rounded-lg border p-3 ${completed ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'}`}>
        {completed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Lock className="h-4 w-4 text-green-700" />
            <span className="text-sm font-bold text-green-800">{t('المعاملة مقفولة', 'Transaction closed')}</span>
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
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">{t('إنهاء المعاملة', 'Close the transaction')}</span>
            <span className={`text-[11px] ${readyToClose ? 'text-green-700' : 'text-amber-600'}`}>
              {readyToClose
                ? t('فاتورة النقل مُرفقة بتاريخها ✓', 'Transport invoice on file with its date ✓')
                : t('تحتاج «فاتورة النقل» بتاريخٍ ومرفقٍ معًا', 'Needs “Transport invoice” with both a date and a file')}
            </span>
            {canEdit && (
              <button type="button" onClick={() => setComplete(true)} disabled={busy === 'complete' || !readyToClose}
                className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
                {busy === 'complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {t('إنهاء المعاملة', 'Close')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** نموذجُ إدخالٍ واحد: تاريخٌ ومبلغٌ وملاحظةٌ وملفّ. */
function AddEntry({
  clearanceId, stageKey, ar, onDone, onCancel,
}: { clearanceId: string; stageKey: string; ar: boolean; onDone: (cl: any) => void; onCancel: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pick = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { notify(t('الملفّ أكبر من ٢٠ ميجابايت', 'File larger than 20MB'), 'error'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ dataUrl: String(r.result), fileName: f.name });
    r.readAsDataURL(f);
  }, [notify, t]);

  const save = async () => {
    if (!date && !file) {
      notify(t('اختر تاريخًا أو ارفع ملفًّا', 'Pick a date or attach a file'), 'error');
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
          <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{t('المبلغ (اختياري)', 'Amount (optional)')}</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
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
        <button type="button" onClick={save} disabled={saving}
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
