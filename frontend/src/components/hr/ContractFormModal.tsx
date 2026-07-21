'use client';
// Reusable create/edit form for an employee contract — used from the employee
// profile so the annual-leave entitlement (and the rest of the contract) can be
// edited in place without going to the Contracts page.
import { useState, useEffect } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { Check } from 'lucide-react';
import { Modal, Field, TextInput, Select, TextArea, PrimaryButton, Loader2 } from '@/components/hr/HRKit';

const EMPTY = { type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, probationMonths: 3, jobTitle: '', basicSalary: 0, allowances: 0, notes: '' };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { notify } = useDialog();
  return (
    <div className="border-t border-slate-200 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0">
      <h3 className="text-[#f37121] text-sm font-semibold mb-3 flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-[#f37121]" />{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export default function ContractFormModal({ open, contract, employeeId, onClose, onSaved }: {
  open: boolean;
  contract: any | null;        // null = create
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(contract ? { ...EMPTY, ...contract } : { ...EMPTY, startDate: new Date().toISOString().slice(0, 10) });
  }, [open, contract]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.startDate) return;
    setSaving(true);
    try {
      const body = { ...form, employee: employeeId };
      if (contract) await api.put(`/api/hr/contracts/${contract._id}`, body);
      else await api.post('/api/hr/contracts', body);
      onSaved(); onClose();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} wide
      title={contract ? t('Edit Contract', 'تعديل العقد') : t('Add Contract', 'إضافة عقد')}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('Cancel', 'إلغاء')}</button>
        <PrimaryButton onClick={save} disabled={saving || !form.startDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('Save', 'حفظ')}</PrimaryButton>
      </>}>
      <Group title={t('Term', 'المدة')}>
        <Field label={t('Type', 'النوع')}><Select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="fixed">{t('Fixed term', 'محدد المدة')}</option><option value="unlimited">{t('Unlimited', 'غير محدد')}</option></Select></Field>
        <Field label={t('Duration (months)', 'المدة (أشهر)')}><TextInput type="number" value={form.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))} /></Field>
        <Field label={t('Start date', 'تاريخ البداية')}><TextInput type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label={t('End date', 'تاريخ النهاية')}><TextInput type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
      </Group>

      <Group title={t('Leave & probation', 'الإجازات والاختبار')}>
        <Field label={t('Annual leave (days)', 'الإجازة السنوية (أيام)')}><TextInput type="number" value={form.annualLeaveDays} onChange={(e) => set('annualLeaveDays', Number(e.target.value))} /></Field>
        <Field label={t('Probation (months)', 'فترة الاختبار (أشهر)')}><TextInput type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', Number(e.target.value))} /></Field>
      </Group>

      <Group title={t('Compensation', 'الراتب')}>
        <Field label={t('Job title', 'المسمى الوظيفي')}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
        <Field label={t('Basic salary', 'الراتب الأساسي')}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
        <Field label={t('Allowances', 'البدلات')}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
        <Field label={t('Notes', 'ملاحظات')} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </Group>
    </Modal>
  );
}
