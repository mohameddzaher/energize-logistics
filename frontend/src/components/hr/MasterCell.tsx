'use client';
/**
 * Master cell: shows the value or its state (required, not required); click opens it for editing. Shared by the master table and the group pages so a field is edited the same way everywhere.
 * Choice fields are lists, not free text: license type, bank and insurance status were typed by hand and produced variants. Options come from values actually used (GET /api/hr/master/choices) plus 'other...' for a new value. The bank cash option is stored as 'cash'.
 * Saving goes through PUT /master/employee/:id/fields, which broadcasts `hr:master` and `hr:employee` and writes the driver card to the vehicle register (utils/driverCardSync).
 */
import { useState } from 'react';
import { Check, X, UserCheck } from 'lucide-react';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { updateEmployeeFields, statusMeta, statusLabel, fmtDate, toDateInput } from '@/lib/hrMaster';

// `strict`: closed list (department), no 'other...' and no typing; see utils/hrDepartments on the server.
// `readOnly`: read but not written from the cell (vehicle is a snapshot from the vehicle register).
export type MasterField = { key: string; ar: string; en: string; type: string; choice?: boolean; cashPayroll?: boolean; strict?: boolean; readOnly?: boolean };
export type Choices = Record<string, { value: string; count: number }[]>;

const CASH = 'cash';
export const displayValue = (f: MasterField, raw: any, ar: boolean) => {
  if (f.type === 'date') return fmtDate(raw);
  // Amount with thousands separators; zero is blank (the schema default).
  if (f.type === 'number') return Number(raw) ? Number(raw).toLocaleString('en-US') : '—';
  if (f.cashPayroll && String(raw || '').trim().toLowerCase() === CASH) return ar ? 'راتب نقدي' : 'Cash payroll';
  return raw || '—';
};

const LOCKED_KEYS = new Set(['workStatusText', 'systemStatus', 'employmentStatus']);

export default function MasterCell({ id, f, raw, st, choices, ar, canEdit, onSaved, notify, compact }: {
  id: string; f: MasterField; raw: any; st?: string; choices?: Choices; ar: boolean; canEdit: boolean;
  onSaved: () => void; notify: (m: string, tone?: any) => void; compact?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cell state is chosen together with its value, e.g. 'not required' for someone who does not need the document.
  const [mark, setMark] = useState('');
  const opts = (choices?.[f.key] || []).filter((o) => !(f.cashPayroll && o.value.toLowerCase() === CASH));

  // Work status and system status are read-only in the cell: they change only through termination, reactivation and leaving the system.
  const locked = LOCKED_KEYS.has(f.key) || !!f.readOnly;
  const { confirm } = useDialog();
  // 'Not working' is reversed from its cell: the reinstate button is the same reactivation (contract returns, archived returns inside the system), not a cell write.
  // Leave statuses (on leave / did not return) are not a termination: no reinstate.
  const reinstatable = canEdit && f.key === 'workStatusText' && /^لا يعمل/.test(String(raw || '')) && !/الإجازة|إجازة/.test(String(raw || ''));
  const reinstate = async () => {
    if (!(await confirm({ message: t('إعادة هذا الموظف إلى الخدمة؟ تصير حالته «يعمل» ويعود عقده كما كان.', 'Return this employee to service? Status becomes “working” and the contract is restored.'), confirmLabel: t('إعادته للخدمة', 'Reinstate') }))) return;
    setBusy(true);
    try {
      await api.post(`/api/hr/employees/${id}/reactivate`, {});
      notify(t('عاد إلى الخدمة', 'Back in service'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  const start = () => {
    if (!canEdit || locked) return;
    // An unreadable date (the 'required' text typed into a date cell) opens empty to be corrected.
    // Hijri is shown and edited as 'yyyy-mm-dd' text, since browsers have no native Hijri date input.
    const v = f.type === 'date' ? toDateInput(raw) : String(raw ?? '');
    setVal(v);
    setMark('');
    setFree(!f.strict && !!f.choice && !!v && v.toLowerCase() !== CASH && !opts.some((o) => o.value === v));
    setEditing(true);
  };

  const save = async (value = val) => {
    setBusy(true);
    try {
      await updateEmployeeFields(id, { [f.key]: value }, mark ? { [f.key]: mark } : undefined);
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
            {!f.strict && <option value="__other">{t('أخرى… (اكتب)', 'Other… (type)')}</option>}
          </select>
        ) : (
          <input type={f.type === 'date' ? 'date' : 'text'} value={val} autoFocus
            inputMode={f.type === 'number' ? 'decimal' : undefined}
            dir={f.type === 'hijri' ? 'ltr' : undefined}
            placeholder={f.type === 'hijri' ? '1448-05-07' : undefined}
            title={f.type === 'hijri' ? t('اكتب التاريخ الهجري — يُحوَّل إلى ميلاديٍّ ويُحفَظ', 'Type the Hijri date — it is converted and stored as Gregorian') : undefined}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            className={`${box} text-center`} />
        )}
        <select value={mark} onChange={(e) => setMark(e.target.value)} title={t('حالة الخانة', 'Field status')}
          className="px-1 py-1 rounded border border-slate-200 bg-slate-50 text-[11px] text-slate-600">
          <option value="">{t('الحالة', 'Status')}</option>
          <option value="required">{t('مطلوب', 'Required')}</option>
          <option value="not_required">{t('غير مطلوب', 'Not required')}</option>
          <option value="none">{t('لا يوجد', 'None')}</option>
          <option value="inactive">{t('غير نشط', 'Inactive')}</option>
          <option value="clear">{t('بلا علامة', 'Clear')}</option>
        </select>
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
  if (reinstatable) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-[13px] text-slate-900">{displayValue(f, raw, ar)}</span>
        <button type="button" onClick={reinstate} disabled={busy}
          title={t('إعادة الموظف إلى الخدمة', 'Return the employee to service')}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold disabled:opacity-50">
          <UserCheck className="w-3.5 h-3.5" />{t('إعادته للخدمة', 'Reinstate')}
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={start} disabled={!canEdit || !!f.readOnly}
      title={f.readOnly ? t('يُقرأ من سجل المركبات', 'Read from the vehicle registry') : canEdit ? t('اضغط للتعديل', 'Click to edit') : ''}
      className="text-[13px] text-slate-900 hover:text-[#f37121] disabled:hover:text-slate-900 whitespace-nowrap">
      {displayValue(f, raw, ar)}
    </button>
  );
}
