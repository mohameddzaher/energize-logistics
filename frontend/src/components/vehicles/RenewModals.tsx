'use client';
// Single and bulk renewal modals for vehicle documents.
// Shared by the expiries and alerts pages so the two copies cannot drift apart.
import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useDialog } from '@/components/system/DialogProvider';
// Renewal dates are entered in Hijri or Gregorian, as in the edit form. See HijriGregorianField.
import HijriGregorianField from '@/components/vehicles/HijriGregorianField';
import { renewDocument, renewBulk, renewSharedPolicy, fmtDate, docNumberLabel, docStartLabel } from '@/lib/vehicleRegistry';

/**
 * Minimum a modal needs to renew a document, so rows from different sources fit.
 * Expiries rows name the document docKey and alerts rows name it docType; this shared shape avoids forcing one naming on the modal.
 */
export type RenewTarget = {
  vehicleId: string;
  /** A driver card has no vehicle; it is renewed by its own id. See renewDriverCard. */
  driverCardId?: string;
  plateNumber: string;
  docKey: string;
  docAr?: string;
  docEn?: string;
  expiryDate?: string | null;
  /** Current document number, shown to compare with the new one before replacing it. */
  documentNumber?: string;
  /** Current document start date (authorization), shown to compare with the new one. */
  startDate?: string | null;
};

// Renew: one step, the new date; the rest is optional. The server records old and new values in the vehicle history.
export function RenewModal({ row, ar, onClose, onDone }: {
  row: RenewTarget; ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // The number label comes from the document definition, not this modal, so a document with no number gets no field.
  const numLabel = docNumberLabel(row.docKey, ar);
  const startLabel = docStartLabel(row.docKey, ar);

  // Suggested date: one year from the current expiry if still valid, otherwise one year from today.
  useEffect(() => {
    const base = row.expiryDate && new Date(row.expiryDate) > new Date() ? new Date(row.expiryDate) : new Date();
    const y = new Date(base); y.setFullYear(y.getFullYear() + 1);
    setNewExpiry(y.toISOString().slice(0, 10));
    // Start defaults to today since a document renewed today usually starts today; it can be edited.
    setStartDate(new Date().toISOString().slice(0, 10));
  }, [row]);

  const save = async () => {
    if (!newExpiry) { notify(ar ? 'اختر تاريخ الانتهاء الجديد' : 'Pick the new expiry', 'error'); return; }
    setBusy(true);
    try {
      // A driver card has no vehicle, so the request goes by its own id.
      await renewDocument(row.vehicleId || row.driverCardId || '', {
        document: row.docKey, newExpiry,
        ...(row.driverCardId ? { driverCardId: row.driverCardId } : {}),
        ...(startLabel && startDate ? { startDate } : {}),
        documentNumber: documentNumber.trim(),
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
          {/* Start first, then end: a duration reads from start to end, and this is the order dates appear on paper. */}
          {startLabel && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {startLabel} *
                {row.startDate && <span className="font-normal text-slate-400"> ({t('الحاليّ', 'current')}: {fmtDate(row.startDate)})</span>}
              </label>
              <HijriGregorianField value={startDate} onChange={setStartDate} ar={ar} inp={inp} max={newExpiry || undefined} autoFocus />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {startLabel ? t('تاريخ النهاية الجديد', 'New end date') : t('تاريخ الانتهاء الجديد', 'New expiry')} *
            </label>
            <HijriGregorianField value={newExpiry} onChange={setNewExpiry} ar={ar} inp={inp}
              min={startLabel && startDate ? startDate : undefined} autoFocus={!startLabel} />
          </div>
          {/* New number, for documents that come out of renewal with a different number (operating card, sometimes authorization). Empty means keep the same number, not clear it. */}
          {numLabel && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {numLabel} <span className="font-normal text-slate-400">({t('اتركه فارغًا إن لم يتغيّر', 'leave blank if unchanged')})</span>
              </label>
              <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder={row.documentNumber || ''} className={inp} dir="ltr" />
              {!!row.documentNumber && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {t('الحالي', 'Current')}: <b className="font-mono">{row.documentNumber}</b>
                  {documentNumber.trim() && documentNumber.trim() !== row.documentNumber && (
                    <span className="text-amber-700"> · {t('سيُستبدل، ويُقيَّد القديم في السجل', 'will be replaced; the old one is kept in the trail')}</span>
                  )}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('التكلفة (ر.س)', 'Cost (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('رقم الإيصال', 'Receipt reference')}</label>
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

// Bulk renewal of several documents with one date.
// The server rejects the whole operation if one line is invalid, since a half-applied renewal across many vehicles would be untraceable.
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
  // New numbers: one per line, collapsed until opened. Each vehicle's card has its own number, so one shared number would clone one paper across many vehicles. Date-only renewals skip this list.
  const [showNumbers, setShowNumbers] = useState(false);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const numbered = rows.filter((r) => !!docNumberLabel(r.docKey, ar));
  const changedCount = numbered.filter((r, i) => {
    const v = (numbers[`${r.vehicleId}:${r.docKey}:${i}`] || '').trim();
    return v && v !== (r.documentNumber || '');
  }).length;

  const today = new Date().toISOString().slice(0, 10);
  const past = !!when && when < today;
  // The same document on several vehicles is common; the breakdown is shown so the selection can be checked.
  const byDoc = rows.reduce((m: Record<string, number>, r) => {
    const k = (ar ? r.docAr : r.docEn) || r.docKey; m[k] = (m[k] || 0) + 1; return m;
  }, {});

  const save = async () => {
    setErrors([]); setBusy(true);
    try {
      const r = await renewBulk({
        items: rows.map((x, i) => ({
          vehicle: x.vehicleId, document: x.docKey,
          // A driver card has no vehicle; sent by its own id.
          ...(x.driverCardId ? { driverCardId: x.driverCardId } : {}),
          documentNumber: (numbers[`${x.vehicleId}:${x.docKey}:${i}`] || '').trim(),
        })),
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
            <HijriGregorianField value={when} onChange={setWhen} ar={ar} inp={inp} min={today} autoFocus />
            {past && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">
              {t('التاريخ في الماضي — راجعه', 'That date is in the past')}</p>}
          </div>
          {!!numbered.length && (
            <div className="rounded-lg border border-slate-200">
              <button type="button" onClick={() => setShowNumbers((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                <span>{t('تحديث أرقام المستندات (اختياري)', 'Update document numbers (optional)')}</span>
                <span className="text-[11px] text-slate-500">
                  {changedCount > 0
                    ? t(`${changedCount} رقمًا سيتغيّر`, `${changedCount} will change`)
                    : t(`${numbered.length} مستندًا له رقم`, `${numbered.length} have a number`)}
                </span>
              </button>
              {showNumbers && (
                <div className="max-h-48 overflow-y-auto border-t border-slate-200 divide-y divide-slate-100">
                  {rows.map((r, i) => {
                    if (!docNumberLabel(r.docKey, ar)) return null;
                    const k = `${r.vehicleId}:${r.docKey}:${i}`;
                    return (
                      <div key={k} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-24 shrink-0 text-[11.5px] font-semibold text-slate-800 truncate">{r.plateNumber}</span>
                        <input value={numbers[k] ?? ''} dir="ltr"
                          onChange={(e) => setNumbers((m) => ({ ...m, [k]: e.target.value }))}
                          placeholder={r.documentNumber || t('الرقم الجديد', 'New number')}
                          className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-[11.5px] font-mono" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div>
            <label className={lbl}>{t('رقم الإيصال (اختياري)', 'Receipt reference (optional)')}</label>
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

// Renewing one paper that covers many vehicles (e.g. one insurance policy).
// The modal asks about the policy, not the vehicles: it lists document numbers with their vehicle counts, and one date is applied to all. A new number applies to all, valid only because it is one document. The server rejects it for documents that have a paper per vehicle.
export function SharedPolicyRenewModal({ docKey, groups, ar, onClose, onDone }: {
  docKey: string;
  /** Document numbers shown, with the vehicle count and nearest expiry of each. */
  groups: { number: string; count: number; expiryDate?: string | null }[];
  ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [number, setNumber] = useState(groups[0]?.number || '');
  const [when, setWhen] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const picked = groups.find((g) => g.number === number);
  const numLabel = docNumberLabel(docKey, ar);
  const today = new Date().toISOString().slice(0, 10);
  const past = !!when && when < today;

  // One year from the current expiry if still valid, otherwise one year from today, as in single renewal.
  useEffect(() => {
    const base = picked?.expiryDate && new Date(picked.expiryDate) > new Date()
      ? new Date(picked.expiryDate) : new Date();
    const y = new Date(base); y.setFullYear(y.getFullYear() + 1);
    setWhen(y.toISOString().slice(0, 10));
  }, [number, picked?.expiryDate]);

  const save = async () => {
    if (!number || !when) return;
    setBusy(true);
    try {
      const r = await renewSharedPolicy({
        document: docKey, number, newExpiry: when,
        newNumber: newNumber.trim(),
        cost: cost === '' ? null : Number(cost),
        reference: reference.trim(), note: note.trim(),
      });
      notify(t(`اتجدّدت الوثيقة على ${r?.summary?.count ?? 0} مركبة`
        + (r?.summary?.policyUpdated ? ' وسجلّ الوثيقة معها' : ''),
        `Renewed on ${r?.summary?.count ?? 0} vehicles`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{t('تجديد وثيقة كاملة', 'Renew a whole policy')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-[12px] text-slate-600 leading-relaxed">
            {t('الوثيقة الواحدة تغطّي عدّة مركبات، وتجديدها يسري عليها كلّها دفعةً واحدة ويُقيَّد في سجلّ كلٍّ منها.',
               'One policy covers many vehicles; renewing it applies to all of them and is recorded on each.')}
          </p>
          <div>
            <label className={lbl}>{numLabel || t('رقم الوثيقة', 'Policy number')} *</label>
            <select value={number} onChange={(e) => setNumber(e.target.value)} className={inp}>
              {groups.map((g) => (
                <option key={g.number} value={g.number}>
                  {g.number} — {t(`${g.count} مركبة`, `${g.count} vehicles`)}
                  {g.expiryDate ? ` · ${fmtDate(g.expiryDate)}` : ''}
                </option>
              ))}
            </select>
          </div>
          {picked && (
            <p className="text-[12px] text-slate-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t(`سيُجدَّد على ${picked.count} مركبة`, `Will renew on ${picked.count} vehicles`)}
            </p>
          )}
          <div>
            <label className={lbl}>{t('تاريخ الانتهاء الجديد', 'New expiry date')} *</label>
            <HijriGregorianField value={when} onChange={setWhen} ar={ar} inp={inp} min={today} />
            {past && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">
              {t('التاريخ في الماضي — راجعه', 'That date is in the past')}</p>}
          </div>
          {numLabel && (
            <div>
              <label className={lbl}>{t(`${numLabel} الجديد (اتركه فارغًا إن لم يتغيّر)`, `New ${numLabel} (leave empty if unchanged)`)}</label>
              <input value={newNumber} dir="ltr" onChange={(e) => setNewNumber(e.target.value)} className={`${inp} font-mono`} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>{t('التكلفة (اختياري)', 'Cost (optional)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>{t('رقم الإيصال (اختياري)', 'Receipt (optional)')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} />
            </div>
          </div>
          <div>
            <label className={lbl}>{t('ملاحظة (اختياري)', 'Note (optional)')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy || !number || !when || past}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ التجديد…', 'Renewing…')
              : t(`تجديد الوثيقة على ${picked?.count ?? 0} مركبة`, `Renew on ${picked?.count ?? 0} vehicles`)}
          </button>
        </div>
      </div>
    </div>
  );
}
