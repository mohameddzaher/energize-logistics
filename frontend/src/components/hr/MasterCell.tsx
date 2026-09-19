'use client';
/**
 * خانةُ الماستر — تعرض القيمةَ أو حالتَها («مطلوب»، «غير مطلوب»)، والضغطُ يفتحها
 * للتعديل. مشتركةٌ بين جدول الماستر الشامل وصفحات المجموعات، فلا يُعدَّل الحقلُ
 * في شاشةٍ بطريقةٍ وفي أخرى بغيرها.
 *
 * ── وحقولُ الاختيار قائمةٌ لا نصٌّ حرّ ─────────────────────────────────────────
 * نوعُ الرخصة والبنكُ وحالةُ التأمين كانت تُكتب بيد، فصار البنكُ الواحد خمسَ
 * صيغٍ والرخصةُ «دراجة الية» و«دراجة اليه» قيمتين. القائمةُ من القيم المستعملة
 * فعلًا (GET /api/hr/master/choices)، ومعها «أخرى…» لقيمةٍ جديدة. وللبنك «راتب
 * نقدي» — القيمةُ المخزَّنة لها منذ الاستيراد «cash».
 *
 * والحفظُ يمرّ بـ PUT /master/employee/:id/fields، الذي يبثّ `hr:master`
 * و`hr:employee` فتتحدّث بقيّةُ صفحات القسم ولوحتُه فورًا — ويكتب بطاقةَ السائق في
 * سجلّ المركبات (utils/driverCardSync).
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { updateEmployeeFields, statusMeta, statusLabel, fmtDate, toDateInput } from '@/lib/hrMaster';

export type MasterField = { key: string; ar: string; en: string; type: string; choice?: boolean; cashPayroll?: boolean };
export type Choices = Record<string, { value: string; count: number }[]>;

const CASH = 'cash';
export const displayValue = (f: MasterField, raw: any, ar: boolean) => {
  if (f.type === 'date') return fmtDate(raw);
  if (f.cashPayroll && String(raw || '').trim().toLowerCase() === CASH) return ar ? 'راتب نقدي' : 'Cash payroll';
  return raw || '—';
};

export default function MasterCell({ id, f, raw, st, choices, ar, canEdit, onSaved, notify, compact }: {
  id: string; f: MasterField; raw: any; st?: string; choices?: Choices; ar: boolean; canEdit: boolean;
  onSaved: () => void; notify: (m: string, tone?: any) => void; compact?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const opts = (choices?.[f.key] || []).filter((o) => !(f.cashPayroll && o.value.toLowerCase() === CASH));

  const start = () => {
    if (!canEdit) return;
    // التاريخ غير المقروء («مطلوب» مكتوبةً في خانة تاريخ) يُفتح فارغًا ليُصحَّح.
    const v = f.type === 'date' ? toDateInput(raw) : String(raw ?? '');
    setVal(v);
    setFree(!!f.choice && !!v && v.toLowerCase() !== CASH && !opts.some((o) => o.value === v));
    setEditing(true);
  };

  const save = async (value = val) => {
    setBusy(true);
    try {
      await updateEmployeeFields(id, { [f.key]: value });
      notify(t('تم الحفظ', 'Saved'), 'success');
      setEditing(false);
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  if (editing) {
    const box = `${compact ? 'w-28' : 'w-36'} px-2 py-1 rounded border border-[#f37121] text-[12px]`;
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {f.choice && !free ? (
          <select value={val} autoFocus className={`${box} bg-white`}
            onChange={(e) => { if (e.target.value === '__other') { setFree(true); setVal(''); } else setVal(e.target.value); }}>
            <option value="">{t('— اختر —', '— choose —')}</option>
            {f.cashPayroll && <option value={CASH}>{t('راتب نقدي', 'Cash payroll')}</option>}
            {opts.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
            <option value="__other">{t('أخرى… (اكتب)', 'Other… (type)')}</option>
          </select>
        ) : (
          <input type={f.type === 'date' ? 'date' : 'text'} value={val} autoFocus
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            className={`${box} text-center`} />
        )}
        <button type="button" onClick={() => save()} disabled={busy} className="p-1 rounded bg-emerald-50 text-emerald-700"><Check className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => setEditing(false)} className="p-1 rounded text-slate-600 hover:text-slate-900"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  if (st === 'required') {
    return (
      <button type="button" onClick={start} disabled={!canEdit}
        className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold hover:bg-red-200 disabled:hover:bg-red-100">
        {t('مطلوب', 'Required')}
      </button>
    );
  }
  if (st === 'not_required' || st === 'none' || st === 'cash_payroll' || st === 'inactive') {
    return (
      <button type="button" onClick={start} disabled={!canEdit}
        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusMeta(st).bg} ${canEdit ? 'hover:ring-1 hover:ring-slate-400' : ''}`}
        title={canEdit ? t('اضغط للتعديل', 'Click to edit') : ''}>
        {statusLabel(st, ar)}
      </button>
    );
  }
  return (
    <button type="button" onClick={start} disabled={!canEdit}
      title={canEdit ? t('اضغط للتعديل', 'Click to edit') : ''}
      className="text-[13px] text-slate-900 hover:text-[#f37121] disabled:hover:text-slate-900 whitespace-nowrap">
      {displayValue(f, raw, ar)}
    </button>
  );
}
