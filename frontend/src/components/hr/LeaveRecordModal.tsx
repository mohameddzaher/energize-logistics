'use client';
/**
 * Record a leave from HR (past, current or future) for any employee, with or without a login.
 * Saved approved immediately (POST /api/hr/leaves/backdated, mode 'manual'); the balance follows.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Modal, PrimaryButton, SearchableSelect, TextArea } from '@/components/hr/HRKit';
import DatePair from '@/components/hr/DatePair';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';
import { DeductionChoice } from '@/components/hr/LeaveDeduction';

const EMPTY = { employee: '', leaveType: '', startDate: '', endDate: '', reason: '', deductBalance: null as boolean | null };

export default function LeaveRecordModal({ open, onClose, onSaved, ar, employeeId }: {
  open: boolean; onClose: () => void; onSaved?: () => void; ar: boolean;
  /** Fixed employee (from the profile): the picker is hidden. */
  employeeId?: string;
}) {
  const { notify } = useDialog();
  const [form, setForm] = useState<any>({ ...EMPTY, employee: employeeId || '' });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [empState, setEmpState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [types, setTypes] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!employeeId) {
      setEmpState('loading');
      try {
        const d = await api.get<{ employees: any[] }>('/api/hr/employees-search?limit=2000');
        setEmployees(d.employees || []);
        setEmpState('ready');
      } catch (e: any) {
        setEmpState('error');
        notify(e?.message || (ar ? 'تعذّر تحميل قائمة الموظفين' : 'Could not load the employee list'), 'error');
      }
    }
    try {
      const d = await api.get<{ leaveTypes: any[] }>('/api/hr/leave-types');
      setTypes(d.leaveTypes || []);
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر تحميل أنواع الإجازات' : 'Could not load the leave types'), 'error');
    }
  }, [ar, employeeId, notify]);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, employee: employeeId || '' });
    setFiles([]);
    if (!types.length || (!employeeId && !employees.length)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId]);

  const days = (() => {
    const { startDate, endDate } = form;
    if (!startDate || !endDate || endDate < startDate) return 0;
    return Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
  })();

  const save = async () => {
    if (!form.employee || !form.leaveType || !days) {
      notify(ar ? 'اختر الموظّف ونوع الإجازة والتاريخين' : 'Pick the employee, the leave type and both dates', 'error');
      return;
    }
    // HR states the deduction here as it does when approving a request.
    if (form.deductBalance === null) {
      notify(ar ? 'اختر: تُخصم من الرصيد أم بدون خصم.' : 'Choose whether the leave is deducted from the balance.', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await api.post<any>('/api/hr/leaves/backdated', {
        ...form, mode: 'manual',
        files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      const b = r?.balance;
      notify(ar
        ? `سُجّلت الإجازة (${days} يوم)${b ? ` — الرصيد المتبقّي ${b.available} يوم` : ''}`
        : `Leave recorded (${days} day(s))${b ? ` — remaining balance ${b.available}` : ''}`, 'success');
      onClose();
      onSaved?.();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التسجيل' : 'Could not record'), 'error'); }
    setSaving(false);
  };

  const FROM = ar ? 'تاريخ البداية' : 'Start date';
  const TO = ar ? 'تاريخ النهاية' : 'End date';
  return (
    <Modal open={open} onClose={onClose} title={ar ? 'تسجيل إجازة' : 'Record a leave'}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <PrimaryButton onClick={save} disabled={saving || !days}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {ar ? 'تسجيل' : 'Record'}
        </PrimaryButton>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-500 text-xs">
          {ar
            ? 'تُسجَّل معتمَدةً مباشرةً وتُخصَم من الرصيد أو لا بحسب اختيارك أدناه — لموظفٍ بلا حسابٍ في النظام أو لإجازةٍ تُسجِّلها الموارد البشرية بنفسها. ويبقى في السجل من سجّلها ومتى.'
            : 'Saved as approved, deducted or not as you choose below — for an employee without a login, or a leave HR records itself. The log keeps who recorded it and when.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!employeeId && (
            <div className="sm:col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'الموظّف' : 'Employee'}</label>
              <SearchableSelect
                value={form.employee}
                onChange={(v) => setForm((f: any) => ({ ...f, employee: v }))}
                placeholder={ar ? '— اختر الموظّف —' : '— pick the employee —'}
                searchPlaceholder={ar ? 'ابحث بالاسم أو الإقامة أو الرقم الوظيفي…' : 'name, ID or employee number…'}
                emptyLabel={employees.length ? undefined : (empState === 'loading' ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'لم تُحمَّل القائمة' : 'The list did not load'))}
                options={employees.map((e) => ({
                  value: e._id,
                  label: [(e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim()) || '—', e.employeeNumber ? `#${e.employeeNumber}` : '', e.iqamaNumber || e.nationalId || ''].filter(Boolean).join(' · '),
                }))}
              />
              {empState === 'error' && (
                <button type="button" onClick={load}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100">
                  <RefreshCw className="w-3.5 h-3.5" /> {ar ? 'إعادة المحاولة' : 'Retry'}
                </button>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="text-slate-500 text-xs mb-1 block">{ar ? 'نوع الإجازة' : 'Leave type'}</label>
            <SearchableSelect
              value={form.leaveType}
              onChange={(v) => setForm((f: any) => ({ ...f, leaveType: v }))}
              placeholder={ar ? '— اختر نوع الإجازة —' : '— pick the leave type —'}
              searchPlaceholder={ar ? 'ابحث…' : 'search…'}
              options={types.map((t) => ({
                value: t._id,
                label: `${ar ? t.nameAr : t.nameEn}${t.affectsBalance === false ? (ar ? ' — لا تُخصَم من الرصيد' : ' — no balance deduction') : (ar ? ' — تُخصَم من الرصيد' : ' — deducted from balance')}`,
              }))}
            />
          </div>
          <DatePair label={FROM} ar={ar} inputClassName="[color-scheme:light]"
            value={form.startDate} onChange={(v) => setForm((f: any) => ({ ...f, startDate: v }))} />
          <DatePair label={TO} ar={ar} inputClassName="[color-scheme:light]" min={form.startDate || undefined}
            value={form.endDate} onChange={(v) => setForm((f: any) => ({ ...f, endDate: v }))} />
        </div>
        {!!days && <p className="text-slate-900 text-sm font-semibold">{ar ? `المدّة: ${days} يوم` : `Duration: ${days} day(s)`}</p>}
        <DeductionChoice value={form.deductBalance} onChange={(v) => setForm((f: any) => ({ ...f, deductBalance: v }))}
          leave={{ days, leaveType: types.find((t) => t._id === form.leaveType) } as any} ar={ar} />
        <div>
          <label className="text-slate-500 text-xs mb-1 block">{ar ? 'السبب / ملاحظة' : 'Reason / note'}</label>
          <TextArea rows={2} value={form.reason} onChange={(e: any) => setForm((f: any) => ({ ...f, reason: e.target.value }))} />
        </div>
        <div>
          <label className="text-slate-500 text-xs mb-1 block">{ar ? 'مرفقات (اختياري)' : 'Attachments (optional)'}</label>
          <FilePicker files={files} onChange={setFiles} max={5} />
        </div>
      </div>
    </Modal>
  );
}
