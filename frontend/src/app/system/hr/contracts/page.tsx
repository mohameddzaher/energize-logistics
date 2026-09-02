'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Edit, Ban, Check, Trash2, RefreshCw } from 'lucide-react';
import { isHRStaff, Contract, Employee, CONTRACT_STATUS, empName, fmtDate, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select, SearchableSelect, TextArea, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrContractsTranslations } from '@/lib/translations';
import ContractsTabs from '@/components/hr/ContractsTabs';

const EMPTY = { employee: '', type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, jobTitle: '', basicSalary: 0, allowances: 0, probationMonths: 3, notes: '',
  iqamaNumber: '', contractProfession: '', sponsorRegistration: '', contractNumber: '' };

export default function ContractsPage() {
  const { notify, prompt, confirm } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrContractsTranslations(lang);
  const staff = isHRStaff(user);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ contracts: Contract[] }>(`/api/hr/contracts${qs}`);
      setContracts(d.contracts || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:contract', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ employees: Employee[] }>('/api/hr/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, startDate: today() }); setShowModal(true); };
  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({ ...EMPTY, ...c, employee: typeof c.employee === 'object' ? c.employee?._id : c.employee });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.employee || !form.startDate) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/contracts/${editing._id}`, form);
      else await api.post('/api/hr/contracts', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  // ── نافذةُ التجديد ────────────────────────────────────────────────────────
  const [renewing, setRenewing] = useState<Contract | null>(null);
  const [renewForm, setRenewForm] = useState({ startDate: '', endDate: '', annualLeaveDays: '', carryOver: true, contractProfession: '', contractNumber: '' });
  const [renewSaving, setRenewSaving] = useState(false);
  useEffect(() => {
    if (!renewing) return;
    // يبدأ الجديدُ من اليوم التالي لنهاية القائم — وهو ما يُكتب يدويًّا كلَّ مرّة.
    const next = renewing.endDate
      ? new Date(new Date(renewing.endDate).getTime() + 86400000).toISOString().slice(0, 10)
      : '';
    const after = next ? new Date(new Date(next).getTime() + 364 * 86400000).toISOString().slice(0, 10) : '';
    setRenewForm({
      startDate: next, endDate: after,
      annualLeaveDays: String(renewing.annualLeaveDays ?? ''), carryOver: true,
      // تُملأ من العقد القائم: التجديدُ إبقاءٌ على ما هو قائمٌ إلّا ما يُغيَّر
      // عمدًا — فمَن لا يمسّها يجدها كما كانت، ومَن يغيّرها يكتبها هنا مرّةً.
      contractProfession: renewing.contractProfession || '',
      contractNumber: renewing.contractNumber || '',
    });
  }, [renewing]);

  const doRenew = async () => {
    if (!renewing) return;
    setRenewSaving(true);
    try {
      const r = await api.post<{ message?: string }>(`/api/hr/contracts/${renewing._id}/renew`, {
        startDate: renewForm.startDate,
        endDate: renewForm.endDate,
        annualLeaveDays: renewForm.annualLeaveDays ? Number(renewForm.annualLeaveDays) : undefined,
        carryOver: renewForm.carryOver,
        contractProfession: renewForm.contractProfession,
        contractNumber: renewForm.contractNumber,
      });
      notify(r?.message || (ar ? 'جُدِّد العقد' : 'Contract renewed'), 'success');
      setRenewing(null);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setRenewSaving(false);
  };

  const terminate = async (c: Contract) => {
    const reason = (await prompt(tx.terminationReasonPrompt)) ?? '';
    try {
      await api.post(`/api/hr/contracts/${c._id}/terminate`, { reason });
      load();
    } catch (e: any) {
      // The backend blocks termination while custody is outstanding.
      notify(e.message, 'error');
    }
  };

  /**
   * حذف عقد — لا «إنهاؤه».
   * الإنهاء واقعةٌ في تاريخ الموظّف تبقى مسجّلةً؛ والحذف لعقدٍ أُدخل خطأً —
   * موظّفٌ غير صحيح أو صفٌّ مكرَّر — ولا معنى لبقائه «منتهيًا» في سجلّه.
   */
  const remove = async (c: Contract) => {
    if (!(await confirm(ar
      ? `حذف عقد «${empName(c.employee)}» نهائيًّا؟ إن كان العقد قد انتهى فعلًا فالأصحّ إنهاؤه لا حذفه.`
      : `Permanently delete the contract for “${empName(c.employee)}”? If it actually ended, terminate it instead.`))) return;
    try { await api.delete(`/api/hr/contracts/${c._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = contracts.filter((c) => {
    if (!search.trim()) return true;
    const n = empName(c.employee).toLowerCase();
    const emp = typeof c.employee === 'object' ? c.employee : null;
    // البحثُ يشمل ما صار معروضًا: الهويّة كما في العقد والمهنة والسجلّ — وإلّا
    // بقيت أعمدةٌ تُقرأ ولا تُبحث.
    return n.includes(search.toLowerCase())
      || (emp?.iqamaNumber || '').includes(search)
      || (emp?.employeeNumber || '').includes(search)
      || (c.iqamaNumber || '').includes(search)
      || (c.sponsorRegistration || '').includes(search)
      || (c.employeeNameAr || '').toLowerCase().includes(search.toLowerCase())
      || (c.contractNumber || '').includes(search)
      || (c.contractProfession || '').toLowerCase().includes(search.toLowerCase());
  });

  const exportColumns: ExportColumn[] = [
    { header: tx.colEmployee, key: 'employee', transform: (v: any) => empName(v), width: 22 },
    { header: ar ? 'الهوية' : 'ID number', key: 'iqamaNumber', width: 16, transform: (v: any) => v || '—' },
    { header: ar ? 'رقم العقد' : 'Contract no.', key: 'contractNumber', width: 16, transform: (v: any) => v || '—' },
    { header: ar ? 'المهنة في العقد' : 'Contract profession', key: 'contractProfession', width: 22, transform: (v: any) => v || '—' },
    { header: tx.colType, key: 'type', width: 12 },
    { header: tx.colStart, key: 'startDate', width: 14 },
    { header: tx.colEnd, key: 'endDate', width: 14 },
    { header: tx.colAnnualLeave, key: 'annualLeaveDays', width: 14, transform: (v: any, r: any) => r?.annualLeaveText || v },
    { header: ar ? 'فترة التجربة' : 'Probation', key: 'probationText', width: 14, transform: (v: any, r: any) => v || (r?.probationMonths ? `${r.probationMonths}` : '—') },
    { header: ar ? 'السجل' : 'CR number', key: 'sponsorRegistration', width: 16, transform: (v: any) => v || '—' },
    { header: tx.colBasicSalary, key: 'basicSalary', width: 14 },
    { header: tx.colStatus, key: 'status', width: 12 },
  ];
  // فلتر الحالة يُطبَّق على الخادم، فالذاكرة لا تحمل إلّا عقود تلك الحالة؛
  // «الكلّ» لو صُدِّر منها لخرج ناقصًا وهو يدّعي الشمول، فلا بدّ من إعادة جلبٍ
  // بلا الفلتر. والبحث نصّيٌّ في الذاكرة، فـ«المعروض» يبقى صادقًا كما هو.
  const fetchAllContracts = async () => {
    const d = await api.get<{ contracts: Contract[] }>('/api/hr/contracts');
    return [{ name: 'Contracts', rows: d.contracts || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Contracts', rows: filtered, columns: exportColumns }] },
    statusFilter
      ? { key: 'all', label: scope.all, resolve: fetchAllContracts }
      : { key: 'all', label: scope.all, sheets: [{ name: 'Contracts', rows: contracts, columns: exportColumns }] },
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <ContractsTabs />
      <PageHeader icon={<FileText className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${contracts.length} ${tx.contractsUnit}`}>
        <ExportMenu fileName="contracts" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newContract}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'الهوية' : 'ID number'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'رقم العقد' : 'Contract no.'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'المهنة في العقد' : 'Contract profession'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.thStart}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.thEnd}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.thAnnualLeave}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'فترة التجربة' : 'Probation'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{ar ? 'السجل' : 'CR number'}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.colStatus}</th>
            <th className="text-end font-semibold px-4 py-3 whitespace-nowrap">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} className="text-center text-slate-800 py-12">{tx.noContracts}</td></tr>
            ) : filtered.map((c) => (
              <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(c.employee, lang) || c.employeeNameAr || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.iqamaNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.contractNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.contractProfession || c.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.endDate ? fmtDate(c.endDate) : '—'}</td>
                {/* «غير مطلوب» حالةٌ سليمة لا صفرٌ ناقص — تُكتب كما هي. */}
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.annualLeaveText || `${c.annualLeaveDays} ${tx.daysShort}`}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.probationText || (c.probationMonths ? `${c.probationMonths} ${ar ? 'شهر' : 'mo'}` : '—')}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.sponsorRegistration || '—'}</td>
                <td className="px-4 py-3"><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.editTooltip}><Edit className="w-4 h-4" /></button>
                    {/* ── التجديدُ فعلٌ مستقلٌّ عن التعديل ────────────────────
                        كان العقدُ يُجدَّد بتعديل تاريخِ نهايته يدويًّا: لا أثرَ
                        يقول متى جُدِّد ولا مَن جدّده ولا من أيّ تاريخ، ورصيدُ
                        الإجازات يُقرأ على عقدٍ ممتدٍّ بلا سنةٍ جديدةٍ تُستحقّ. */}
                    {c.status === 'active' && (
                      <button type="button" onClick={() => setRenewing(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-emerald-600 hover:bg-slate-100" title={ar ? 'تجديد العقد' : 'Renew contract'}><RefreshCw className="w-4 h-4" /></button>
                    )}
                    {c.status === 'active' && (
                      <button type="button" onClick={() => terminate(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.terminateTooltip}><Ban className="w-4 h-4" /></button>
                    )}
                    <button type="button" onClick={() => remove(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف العقد' : 'Delete contract'}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{tx.custodyNote}</p>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? tx.editContract : tx.newContract}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.employee || !form.startDate}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldEmployee} span2>
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v)}
              disabled={!!editing}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.jobTitle, e.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          <Field label={tx.fieldType}><Select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="fixed">{tx.optFixedTerm}</option><option value="unlimited">{tx.typeUnlimited}</option></Select></Field>
          <Field label={tx.fieldDuration}><TextInput type="number" value={form.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))} /></Field>
          <Field label={tx.fieldStartDate}><TextInput type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={tx.fieldEndDate}><TextInput type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label={tx.fieldAnnualLeaveDays}><TextInput type="number" value={form.annualLeaveDays} onChange={(e) => set('annualLeaveDays', Number(e.target.value))} /></Field>
          <Field label={tx.fieldProbation}><TextInput type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', Number(e.target.value))} /></Field>
          <Field label={tx.fieldJobTitle}><TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
          <Field label={tx.fieldBasicSalary}><TextInput type="number" value={form.basicSalary} onChange={(e) => set('basicSalary', Number(e.target.value))} /></Field>
          <Field label={tx.fieldAllowances}><TextInput type="number" value={form.allowances} onChange={(e) => set('allowances', Number(e.target.value))} /></Field>
          {/* بيانات ورقة العقد نفسِها — تُقرأ في الجدول، فتُصحَّح من هنا. */}
          <Field label={ar ? 'الهوية (كما في العقد)' : 'ID number (as on the contract)'}><TextInput value={form.iqamaNumber || ''} onChange={(e) => set('iqamaNumber', e.target.value)} /></Field>
          <Field label={ar ? 'المهنة في العقد' : 'Profession on the contract'}><TextInput value={form.contractProfession || ''} onChange={(e) => set('contractProfession', e.target.value)} /></Field>
          <Field label={ar ? 'رقم العقد' : 'Contract number'}><TextInput value={form.contractNumber || ''} onChange={(e) => set('contractNumber', e.target.value)} /></Field>
          <Field label={ar ? 'السجل التجاري' : 'CR number'}><TextInput value={form.sponsorRegistration || ''} onChange={(e) => set('sponsorRegistration', e.target.value)} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{tx.activeContractNote}</p>
      </Modal>

      {/* ── نافذةُ التجديد ────────────────────────────────────────────────────
          تُقترح تواريخُها من العقد القائم: يبدأ الجديدُ في اليوم التالي لنهايته
          وينتهي بعد سنة. وهي التواريخُ التي تُكتب يدويًّا كلَّ مرّة. */}
      <Modal open={!!renewing} onClose={() => setRenewing(null)}
        title={ar ? 'تجديد العقد' : 'Renew contract'}
        footer={<>
          <button type="button" onClick={() => setRenewing(null)} className="px-4 py-2 text-slate-500 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doRenew} disabled={renewSaving || !renewForm.startDate}>
            {renewSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {ar ? 'تجديد' : 'Renew'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500">
            {ar
              ? 'يُقفَل العقد الحالي بحالة «مجدَّد» ولا يُحذف، ويُنشأ عقدٌ يليه ويُقيَّد التجديد في سجلّ الموظف.'
              : 'The current contract is closed as “renewed” (not deleted), a successor is created, and the renewal is recorded in the employee’s history.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={ar ? 'بداية العقد الجديد *' : 'New start date *'}>
              <TextInput type="date" value={renewForm.startDate} onChange={(e) => setRenewForm((f) => ({ ...f, startDate: e.target.value }))} /></Field>
            <Field label={ar ? 'نهاية العقد الجديد' : 'New end date'}>
              <TextInput type="date" value={renewForm.endDate} onChange={(e) => setRenewForm((f) => ({ ...f, endDate: e.target.value }))} /></Field>
            <Field label={ar ? 'أيام الإجازة السنوية' : 'Annual leave days'}>
              <TextInput type="number" value={renewForm.annualLeaveDays} onChange={(e) => setRenewForm((f) => ({ ...f, annualLeaveDays: e.target.value }))} /></Field>
            {/* ── والمهنةُ تُراجَع هنا، اختياريّةً ──────────────────────────
                التجديدُ هو اللحظةُ التي تتغيّر فيها المهنةُ فعلًا: يُرقّى
                سائقٌ أو يُنقل إلى عملٍ آخر فيُكتب ذلك في العقد الجديد. وكانت
                تُترك كما هي ثمّ يُفتح العقدُ الجديدُ بعد إنشائه ليُصحَّح.
                مملوءةٌ سلفًا من العقد القائم — فمَن لا يريد تغييرها لا يمسّها. */}
            <Field label={ar ? 'المهنة في العقد (اختياري)' : 'Contract profession (optional)'}>
              <TextInput value={renewForm.contractProfession}
                placeholder={ar ? 'كما في العقد الحالي' : 'as on the current contract'}
                onChange={(e) => setRenewForm((f) => ({ ...f, contractProfession: e.target.value }))} /></Field>
            <Field label={ar ? 'رقم العقد (اختياري)' : 'Contract number (optional)'}>
              <TextInput value={renewForm.contractNumber}
                placeholder={ar ? 'رقم العقد الجديد في قوى' : 'new contract number'}
                onChange={(e) => setRenewForm((f) => ({ ...f, contractNumber: e.target.value }))} /></Field>
          </div>
          {/* ── ورصيدُ الإجازات غيرُ المستهلَك ──────────────────────────────
              يتراكم من بداية العقد النشط، فعقدٌ جديدٌ يعني تراكمًا من الصفر —
              وأيّامُ الموظّف الباقيةُ حقٌّ له لا تسقط بالتجديد. تُحسب لحظةَ
              التجديد وتُثبَّت في العقد الجديد فيبدأ بها. */}
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
            <input type="checkbox" checked={renewForm.carryOver}
              onChange={(e) => setRenewForm((f) => ({ ...f, carryOver: e.target.checked }))}
              className="w-4 h-4 accent-[#f37121] mt-0.5" />
            <span className="text-[13px] text-slate-700">
              <b>{ar ? 'ترحيل رصيد الإجازات غير المستهلك' : 'Carry unused leave balance forward'}</b>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                {ar
                  ? 'مَن أخذ ١٥ يومًا من ٣٠ يبدأ عامَه التالي بـ١٥ محفوظة، ويتراكم استحقاق السنة الجديدة فوقها.'
                  : 'Someone who used 15 of 30 starts the next year with 15 in hand, and the new year accrues on top.'}
              </span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
