'use client';
// نافذتا التجديد — الفردية والجماعية — لمستندات المركبات.
//
// كانتا مكتوبتين داخل صفحة «الانتهاءات» وحدها، فصفحة التنبيهات — وهي أول شاشة
// يفتحها المسؤول صباحًا — لم يكن فيها زر تجديد أصلًا: يرى المستند منتهيًا ثم
// يخرج ليفتح شاشة أخرى ليجدّده. النسخ واللصق كان سيجعل النافذتين تفترقان مع
// أول تعديل، فالمكان الصحيح لهما ملف واحد تستورده الشاشتان.
import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useDialog } from '@/components/system/DialogProvider';
import { renewDocument, renewBulk, fmtDate } from '@/lib/vehicleRegistry';

/** أقلّ ما تحتاجه النافذة لتجدّد مستندًا — تكتفي به الصفوف على اختلاف مصادرها.
 *  صفوف «الانتهاءات» تسمّي المستند docKey وصفوف «التنبيهات» تسمّيه docType،
 *  فالشكل المشترك هنا هو ما يمنع كل شاشة من فرض تسميتها على النافذة. */
export type RenewTarget = {
  vehicleId: string;
  plateNumber: string;
  docKey: string;
  docAr?: string;
  docEn?: string;
  expiryDate?: string | null;
};

// ── تجديد ────────────────────────────────────────────────────────────────────
// خطوة واحدة: التاريخ الجديد. الباقي اختياري. السيرفر بيقيّد القديم والجديد في
// سجل المركبة، فـ«جدّدناها امتى وبكام» بيفضل له إجابة.
export function RenewModal({ row, ar, onClose, onDone }: {
  row: RenewTarget; ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // اقتراح: سنة من تاريخ الانتهاء الحالي لو لسه ساري، وإلا سنة من النهاردة.
  useEffect(() => {
    const base = row.expiryDate && new Date(row.expiryDate) > new Date() ? new Date(row.expiryDate) : new Date();
    const y = new Date(base); y.setFullYear(y.getFullYear() + 1);
    setNewExpiry(y.toISOString().slice(0, 10));
  }, [row]);

  const save = async () => {
    if (!newExpiry) { notify(ar ? 'اختر تاريخ الانتهاء الجديد' : 'Pick the new expiry', 'error'); return; }
    setBusy(true);
    try {
      await renewDocument(row.vehicleId, {
        document: row.docKey, newExpiry,
        cost: cost === '' ? null : Number(cost),
        reference: reference.trim(), note: note.trim(),
      });
      notify(ar ? `تم التجديد حتى ${newExpiry}` : `Renewed until ${newExpiry}`, 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-emerald-700">{t('تجديد المستند', 'Renew document')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {row.plateNumber} · <b>{ar ? row.docAr : row.docEn}</b> · {t('ينتهي', 'expires')} {fmtDate(row.expiryDate)}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
            <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('التكلفة (ر.س)', 'Cost (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('رقم الوثيقة/الإيصال', 'Reference')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
          {t('يُقيَّد في سجل المركبة: التاريخ السابق والجديد واسم من نفّذه — حتى يبقى لسؤال «متى جُدِّدت وبكم؟» إجابة.',
             'Recorded on the vehicle: old date, new date and your name — so "when did we renew, and for how much" keeps an answer.')}
        </p>

        <button onClick={save} disabled={busy}
          className="w-full mt-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />{busy ? t('جارٍ الحفظ…', 'Saving…') : t('تأكيد التجديد', 'Confirm renewal')}
        </button>
      </div>
    </div>
  );
}

// ── تجديد أكتر من مستند بنفس التاريخ ─────────────────────────────────────────
// «النهاردة عندي تجديد ١٥١ كارت تشغيل كلهم انتهاءهم في يوم واحد» — فبدل ما يفتح
// مركبة مركبة، يختار ويقول التاريخ مرة واحدة.
//
// السيرفر بيرفض العملية كلها لو سطر واحد غلط: تجديد نصّه اتنفّذ على ١٥١ مركبة
// كارثة — مفيش حد هيعرف مين اتجدّد ومين لأ.
export function BulkRenewModal({ rows, ar, onClose, onDone }: {
  rows: RenewTarget[]; ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [when, setWhen] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const today = new Date().toISOString().slice(0, 10);
  const past = !!when && when < today;
  // نفس المستند على أكتر من مركبة شائع؛ بنعرض التقسيمة عشان يتأكد إنه اختار صح.
  const byDoc = rows.reduce((m: Record<string, number>, r) => {
    const k = (ar ? r.docAr : r.docEn) || r.docKey; m[k] = (m[k] || 0) + 1; return m;
  }, {});

  const save = async () => {
    setErrors([]); setBusy(true);
    try {
      const r = await renewBulk({
        items: rows.map((x) => ({ vehicle: x.vehicleId, document: x.docKey })),
        newExpiry: when, reference: reference.trim(), note: note.trim(),
      });
      notify(t(`اتجدّد ${r?.summary?.count ?? rows.length} مستند على ${r?.summary?.vehicles ?? '—'} مركبة`,
        `Renewed ${r?.summary?.count ?? rows.length} documents`), 'success');
      onDone();
    } catch (e: any) {
      const errs = e?.data?.errors || e?.errors;
      if (Array.isArray(errs) && errs.length) {
        setErrors(errs.map((x: any) => `${t('سطر', 'line')} ${x.line}: ${x.message}`));
        notify(t('رُفضت العملية بالكامل — لم تُجدَّد أي مركبة', 'Rejected in full — nothing renewed'), 'error');
      } else notify(e?.message || 'Failed', 'error');
    } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{t('تجديد جماعي', 'Bulk renewal')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[12.5px] text-slate-700">
            {t(`${rows.length} مستند هيتجدّدوا لنفس التاريخ`, `${rows.length} documents will get the same date`)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byDoc).map(([k, n]) => (
              <span key={k} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11.5px] font-semibold">{k} {n}</span>
            ))}
          </div>
          <div>
            <label className={lbl}>{t('تاريخ الانتهاء الجديد', 'New expiry date')} *</label>
            <input type="date" min={today} value={when} onChange={(e) => setWhen(e.target.value)} className={inp} autoFocus />
            {past && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">
              {t('التاريخ في الماضي — راجعه', 'That date is in the past')}</p>}
          </div>
          <div>
            <label className={lbl}>{t('رقم مرجعي (اختياري)', 'Reference (optional)')}</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>{t('ملاحظة (اختياري)', 'Note (optional)')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
          </div>
          {errors.length > 0 && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 max-h-32 overflow-y-auto">
              {errors.map((x, i) => <p key={i} className="text-[11.5px] text-rose-800">{x}</p>)}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy || !when || past}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ التجديد…', 'Renewing…')
              : !when ? t('اختر التاريخ أولًا', 'Pick the date first')
              : t(`تجديد ${rows.length} مستند`, `Renew ${rows.length} documents`)}
          </button>
        </div>
      </div>
    </div>
  );
}
