'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Users, Plus, Edit, Trash2 } from 'lucide-react';
import {
  isHRStaff, Employee, EMPLOYMENT_STATUS, empName,
} from '@/lib/hr';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Select,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { EmployeeFormModal } from '@/components/hr/EmployeeFormModal';
import { getHrEmployeesTranslations } from '@/lib/translations';

export default function HREmployeesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrEmployeesTranslations(lang);
  const router = useRouter();
  const searchParams = useSearchParams();
  const staff = isHRStaff(user);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Search is server-side, so the raw box value is debounced — otherwise every
  // keystroke fires a request and a slow early one can land after a later one.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams?.get('status') || '');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  // ── ولا يكتب ردٌّ قديمٌ فوق ردٍّ أحدث ──────────────────────────────────────
  // نداءُ القائمة الكاملة يبدأ عند فتح الصفحة وهو الأبطأ (أربعُمئةِ موظّف)،
  // ونداءُ البحث يبدأ بعده ويعود قبله. فتظهر نتيجةُ البحث ثمّ يهبط الردُّ
  // الأوّلُ فوقها فتعود القائمةُ كاملةً — وهو ما يُرى: «بيظهر الناتج وبعدها
  // على طول بيجيب كل الداتا تاني». راجع hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams();
      if (debouncedSearch.trim()) qs.set('q', debouncedSearch.trim());
      if (statusFilter) qs.set('status', statusFilter);
      const d = await api.get<{ employees: Employee[] }>(`/api/hr/employees?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setEmployees(d.employees || []);
    } catch {}
    if (guard.isCurrent(mine)) setLoading(false);
  }, [debouncedSearch, statusFilter, guard]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:employee', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit = (e: Employee) => { setEditing(e); setShowModal(true); };

  const remove = async (e: Employee) => {
    if (!(await confirm(`${tx.confirmDeletePrefix}${empName(e, lang)}${tx.confirmDeleteSuffix}`))) return;
    try { await api.delete(`/api/hr/employees/${e._id}`); load(); } catch (err: any) { notify(err.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: tx.colName, key: 'firstName', transform: (_: any, r: any) => empName(r), width: 22 },
    { header: tx.colArabicName, key: 'arabicName', width: 22 },
    { header: tx.colEmpNumber, key: 'employeeNumber', width: 12 },
    { header: tx.colJobTitle, key: 'jobTitle', width: 18 },
    { header: tx.colIdType, key: 'idType', width: 12 },
    { header: tx.colIqama, key: 'iqamaNumber', width: 16 },
    { header: tx.colIqamaExpiry, key: 'iqamaExpiry', width: 14 },
    { header: tx.colNationalId, key: 'nationalId', width: 16 },
    { header: tx.colNationality, key: 'nationality', width: 14 },
    { header: tx.colPhone, key: 'phone', width: 16 },
    { header: tx.colStatus, key: 'employmentStatus', width: 12 },
    { header: tx.colHireDate, key: 'hireDate', width: 14 },
  ];
  // البحث وفلتر الحالة كلاهما على الخادم، فالذاكرة لا تحمل إلّا نتائجهما:
  // زرُّ تصديرٍ واحد كان يكتب «الموظّفون» على ملفٍّ فيه ما طابق كلمة البحث
  // وحدَه. ولذلك «الكلّ» يعيد النداء مجرَّدًا من المعاملات، ولا يُعرَض أصلًا
  // حين لا فلتر — إذ يكون المعروضُ هو الكلَّ بعينه.
  const hasActiveFilters = !!(debouncedSearch.trim() || statusFilter);
  const fetchAllEmployees = async () => {
    const d = await api.get<{ employees: Employee[] }>('/api/hr/employees');
    return [{ name: 'Employees', rows: d.employees || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: 'Employees', rows: employees, columns: exportColumns }] },
        { key: 'all', label: scope.all, resolve: fetchAllEmployees },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: 'Employees', rows: employees, columns: exportColumns }] }];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${employees.length} ${tx.employeesUnit}`}>
        <ExportMenu fileName="employees" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addEmployee}</PrimaryButton>
      </PageHeader>

      {/* HRKit's Select is `w-full`, so as a bare flex child it claims the whole
          row and squeezes the search box. Every filter gets a fixed, shrink-0
          box and the search keeps the rest. */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-48 shrink-0">
          <Select aria-label={ar ? 'فلترة الحالة' : 'Filter by status'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className="text-start font-semibold px-4 py-3 whitespace-nowrap">{tx.thName}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.thEmpNumber}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.thJobTitle}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.thIqamaId}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.thNationality}</th>
              <th className="text-start font-semibold px-4 py-3">{tx.thStatus}</th>
              <th className="text-end font-semibold px-4 py-3">{tx.thActions}</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{tx.noEmployees}</td></tr>
            ) : employees.map((e) => (
              <tr key={e._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => router.push(`/system/hr/employees/${e._id}`)}>
                {/* سطر واحد — الإيميل كان تحت الاسم فبيطوّل الصف من غير داعي */}
                <td className="px-4 py-3 text-slate-900 font-semibold whitespace-nowrap">{empName(e, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{e.employeeNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.idType === 'national_id' ? (e.nationalId || '—') : (e.iqamaNumber || '—')}</td>
                <td className="px-4 py-3 text-slate-700">{e.nationality || '—'}</td>
                <td className="px-4 py-3"><Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} /></td>
                <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>
                    {(user?.role === 'super_admin' || user?.role === 'hr_manager') && (
                      <button type="button" onClick={() => remove(e)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.delete}><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EmployeeFormModal open={showModal} employee={editing} onClose={() => setShowModal(false)} onSaved={() => load()} />
    </div>
  );
}
