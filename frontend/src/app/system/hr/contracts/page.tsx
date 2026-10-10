'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { FileText, Plus, Edit, Ban, Check, Trash2, RefreshCw } from 'lucide-react';
import { isHRStaff, Contract, Employee, CONTRACT_STATUS, empName, fmtDate, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, Select, SearchableSelect, TextArea, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrContractsTranslations } from '@/lib/translations';
import ContractsTabs from '@/components/hr/ContractsTabs';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import { localFilterFields, applyLocalFilters, type LocalFieldDef } from '@/lib/localFilters';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';

const EMPTY = { employee: '', type: 'fixed', startDate: '', endDate: '', durationMonths: 12, annualLeaveDays: 21, jobTitle: '', basicSalary: 0, allowances: 0, probationMonths: 3, notes: '',
  iqamaNumber: '', contractProfession: '', sponsorRegistration: '', contractNumber: '' };

const BG = 'bg-white group-hover:bg-slate-100';

export default function ContractsPage() {
  const { notify, prompt, confirm } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrContractsTranslations(lang);
  const staff = isHRStaff(user);

  // الإجراءات، الرقم الوظيفيّ، الاسم، الهويّة — ثابتةٌ على اليمين.
  const pin = usePinnedColumns(4);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // ── السجلُّ يُحمَّل كاملًا، وحالةُ العقد فلترٌ كغيرها ─────────────────────────
  // كانت «الحالة» وحدَها تُرسَل إلى الخادم وبقيّةُ الفلاتر تُحسَب من الصفوف
  // المحمّلة. فمَن اختار «ساري» لم يبقَ في الذاكرة إلّا العقودُ السارية: خياراتُ
  // اللوحة وأعدادُها تُحسَب على جزءٍ من السجلّ، و«حالة العقد» فيها قيمةٌ واحدة،
  // والعنوانُ يقول «٢٦٥ عقدًا» والسجلُّ ثلاثمئة. فيُحمَّل السجلُّ كلُّه مرّةً
  // (والخادمُ يسقفه بألفَين) وتُحسَب الخياراتُ كلُّها عليه.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ contracts: Contract[] }>('/api/hr/contracts');
      // تحديثان متتاليان من السوكِت: الأقدمُ قد يصل أخيرًا فيعيد الجدولَ إلى
      // ما قبل التعديل الثاني.
      if (!guard.isCurrent(mine)) return;
      setContracts(d.contracts || []);
    } catch {}
    if (guard.isCurrent(mine)) setLoading(false);
  }, [guard]);

  useEffect(() => { load(); }, [load]);
  // ── وما يُعدَّل في الماستر يصل هنا ──────────────────────────────────────
  // شاشاتُ الماستر تكتب في الحقول نفسِها التي تعرضها هذه الشاشة، وتبثّ
  // `hr:master`. وبلا هذا السطر تبقى هذه على أرقامها حتى يُحدِّثها أحدٌ بيده —
  // فيُقرأ رقمان مختلفان للشيء نفسِه في شاشتين مفتوحتين.
  useSocket('hr:contract', useCallback(() => load(), [load]));
  useSocket('hr:master', useCallback(() => load(), [load]));
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

  // ── فلاترُ العقود ─────────────────────────────────────────────────────────
  // تُحسَب من الصفوف المحمّلة: الصفحةُ تُحمَّل كاملةً وتُفلتَر محلّيًّا، فنداءٌ
  // إلى الخادم ليعدّ ما بين يديها يصنع فرصةً لأن يختلف العددُ عن الجدول.
  //
  // ── وقارئٌ واحدٌ لكلّ عمود ──────────────────────────────────────────────────
  // ما يُرسَم في الخانة هو ما يُفلتَر به في اللوحة وفي قمع العمود وما يُصدَّر.
  // كانت اللوحةُ تقرأ `annualLeaveDays` رقمًا والجدولُ يعرض «غير مطلوب» من
  // `annualLeaveText` — فيُختار «٠» ليظهر صفٌّ مكتوبٌ فيه «غير مطلوب». والقسمُ
  // كان يُقرأ من عمودٍ لا يجلبه الخادم (راجع listContracts) فخرج فارغًا كلُّه.
  const read = useMemo(() => {
    const emp = (c: Contract) => (typeof c.employee === 'object' && c.employee ? c.employee : null) as any;
    const year = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? String(d.getFullYear()) : ''; };
    return {
      employeeNumber: (c: Contract) => emp(c)?.employeeNumber || '',
      employee: (c: Contract) => empName(c.employee, lang) || c.employeeNameAr || '',
      idNumber: (c: Contract) => c.iqamaNumber || emp(c)?.iqamaNumber || emp(c)?.nationalId || '',
      department: (c: Contract) => emp(c)?.department || '',
      branch: (c: Contract) => emp(c)?.branchName || '',
      project: (c: Contract) => emp(c)?.project || '',
      contractNumber: (c: Contract) => c.contractNumber || '',
      profession: (c: Contract) => c.contractProfession || c.jobTitle || '',
      type: (c: Contract) => (c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed),
      startDate: (c: Contract) => fmtDate(c.startDate),
      endDate: (c: Contract) => (c.endDate ? fmtDate(c.endDate) : ''),
      startYear: (c: Contract) => year(c.startDate),
      endYear: (c: Contract) => year(c.endDate),
      annualLeave: (c: Contract) => c.annualLeaveText || `${c.annualLeaveDays} ${tx.daysShort}`,
      probation: (c: Contract) => c.probationText || (c.probationMonths ? `${c.probationMonths} ${ar ? 'شهر' : 'mo'}` : ''),
      cr: (c: Contract) => c.sponsorRegistration || '',
      status: (c: Contract) => { const m: any = (CONTRACT_STATUS as any)[c.status]; return m ? (ar ? m.ar : m.en) : String(c.status || ''); },
    };
  }, [ar, lang, tx.typeUnlimited, tx.typeFixed, tx.daysShort]);

  // كلُّ عمودٍ معروضٍ له فلتر. والأعمدةُ التي قيمتُها فريدةٌ لكلّ عقد (الرقم
  // الوظيفيّ، الاسم، الهويّة، رقم العقد، التاريخُ بيومه) تُفلتَر من قمع رأس
  // العمود ومن البحث — قائمةٌ من ثلاثمئةِ سطرٍ كلٌّ منها «١» لا تُختار منها
  // قيمة. وللتاريخين هنا سنتُهما، وهي ما يُسأل به: «عقودُ تنتهي في ٢٠٢٧».
  const FILTER_DEFS: LocalFieldDef<Contract>[] = useMemo(() => [
    { key: 'status', ar: 'حالة العقد', en: 'Status', groupAr: 'العقد', groupEn: 'Contract', get: read.status },
    { key: 'type', ar: 'نوع العقد', en: 'Type', groupAr: 'العقد', groupEn: 'Contract', get: read.type },
    { key: 'contractProfession', ar: 'المهنة في العقد', en: 'Profession', groupAr: 'العقد', groupEn: 'Contract', get: read.profession },
    { key: 'startYear', ar: 'سنة بداية العقد', en: 'Start year', groupAr: 'العقد', groupEn: 'Contract', get: read.startYear },
    { key: 'endYear', ar: 'سنة نهاية العقد', en: 'End year', groupAr: 'العقد', groupEn: 'Contract', get: read.endYear },
    { key: 'annualLeave', ar: 'الإجازة السنوية', en: 'Annual leave', groupAr: 'العقد', groupEn: 'Contract', get: read.annualLeave },
    { key: 'probation', ar: 'فترة التجربة', en: 'Probation', groupAr: 'العقد', groupEn: 'Contract', get: read.probation },
    { key: 'sponsorRegistration', ar: 'السجل التجاري', en: 'CR', groupAr: 'الجهة', groupEn: 'Sponsor', get: read.cr },
    { key: 'department', ar: 'القسم', en: 'Department', groupAr: 'الموظف', groupEn: 'Employee', get: read.department },
    { key: 'branch', ar: 'الفرع', en: 'Branch', groupAr: 'الموظف', groupEn: 'Employee', get: read.branch },
    { key: 'project', ar: 'وحدة العمل', en: 'Business unit', groupAr: 'الموظف', groupEn: 'Employee', get: read.project },
  ], [read]);

  // «الحالة» في الشريط فلترٌ محلّيٌّ كغيره — وتُستثنى من حساب قيمِ نفسِها في
  // اللوحة كما تُستثنى كلُّ لوحةٍ من فلترها.
  const byStatus = useMemo(
    () => (statusFilter ? contracts.filter((c) => c.status === statusFilter) : contracts), [contracts, statusFilter]);

  const filterFields = useMemo(
    () => localFilterFields(byStatus, FILTER_DEFS, filters), [byStatus, FILTER_DEFS, filters]);

  const filtered = applyLocalFilters(byStatus, FILTER_DEFS, filters).filter((c) => {
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
    { header: ar ? 'الهوية' : 'ID number', key: 'iqamaNumber', width: 16, transform: (_v: any, r: any) => read.idNumber(r) || '—' },
    { header: ar ? 'القسم' : 'Department', key: 'employee', width: 18, transform: (_v: any, r: any) => read.department(r) || '—' },
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
  /**
   * قمعُ الأعمدة — القارئُ لكلّ عمودٍ هو الذي يُرسَم به، والقائمةُ من الصفوف
   * بعد فلتر الصفحة. راجع hooks/useColumnFilters.
   */
  const cf = useColumnFilters<any>(read, filtered, ar ? 'ar' : 'en');
  const shown = cf.apply(filtered);

  // السجلُّ كلُّه في الذاكرة (راجع load)، فـ«الكلّ» يُصدَّر منها بلا نداءٍ ثانٍ؛
  // و«المعروض» هو ما في الجدول بعد اللوحة والبحث وقمع الأعمدة جميعًا.
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Contracts', rows: shown, columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: 'Contracts', rows: contracts, columns: exportColumns }] },
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

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
        <div className="shrink-0">
          {/* الخياراتُ وأعدادُها محسوبةٌ على السجلّ كلِّه بعد بقيّة الفلاتر — راجع lib/localFilters. */}
          <FilterPanel
            fields={filterFields}
            value={filters}
            onChange={setFilters}
            resultCount={shown.length}
            resultLabel={ar ? 'العقود المطابقة' : 'Matching contracts'}
          />
        </div>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th {...pin.th(0, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{tx.colActions}</th>
            <th {...pin.th(1, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('employeeNumber', ar ? 'الرقم الوظيفي' : 'Emp. no.')}</th>
            <th {...pin.th(2, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('employee', tx.colEmployee)}</th>
            <th {...pin.th(3, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{cf.head('idNumber', ar ? 'الهوية' : 'ID number')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('department', ar ? 'القسم' : 'Department')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('contractNumber', ar ? 'رقم العقد' : 'Contract no.')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('profession', ar ? 'المهنة في العقد' : 'Contract profession')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('type', tx.colType)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('startDate', tx.thStart)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('endDate', tx.thEnd)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('annualLeave', tx.thAnnualLeave)}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('probation', ar ? 'فترة التجربة' : 'Probation')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('cr', ar ? 'السجل' : 'CR number')}</th>
            <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{cf.head('status', tx.colStatus)}</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={14} className="text-center text-slate-800 py-12">{tx.noContracts}</td></tr>
            ) : shown.map((c) => (
              <tr key={c._id} className="group border-b border-slate-200/70 hover:bg-slate-100">
                <td {...pin.td(0, 'px-4 py-3', BG)}>
                  <div className="flex items-center gap-1">
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
                <td {...pin.td(1, 'px-4 py-3 text-slate-700 whitespace-nowrap', BG)}>{(c.employee as any)?.employeeNumber || '—'}</td>
                <td {...pin.td(2, 'px-4 py-3 text-slate-900 font-medium whitespace-nowrap', BG)}>
                  {/* حدٌّ أعلى وقصّ — راجع جدول الموظّفين. */}
                  <span className="block max-w-[15rem] truncate" title={empName(c.employee, lang) || c.employeeNameAr || ''}>{empName(c.employee, lang) || c.employeeNameAr || '—'}</span>
                </td>
                <td {...pin.td(3, 'px-4 py-3 text-slate-700 whitespace-nowrap', BG)}>{c.iqamaNumber || (c.employee as any)?.iqamaNumber || (c.employee as any)?.nationalId || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{read.department(c) || '—'}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.contractNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.contractProfession || c.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{c.type === 'unlimited' ? tx.typeUnlimited : tx.typeFixed}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(c.startDate)}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.endDate ? fmtDate(c.endDate) : '—'}</td>
                {/* «غير مطلوب» حالةٌ سليمة لا صفرٌ ناقص — تُكتب كما هي. */}
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.annualLeaveText || `${c.annualLeaveDays} ${tx.daysShort}`}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.probationText || (c.probationMonths ? `${c.probationMonths} ${ar ? 'شهر' : 'mo'}` : '—')}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{c.sponsorRegistration || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
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
