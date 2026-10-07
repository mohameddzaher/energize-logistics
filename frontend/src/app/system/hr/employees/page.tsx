'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import { ColumnFilter } from '@/components/ColumnFilter';
import { HR_DATE_FIELDS, HR_NUM_RANGES } from '@/lib/hrMaster';
import { syncUrl } from '@/lib/urlSync';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { Users, Plus, Edit, UserMinus, RotateCcw } from 'lucide-react';
import {
  isHRStaff, Employee, EMPLOYMENT_STATUS, empName,
} from '@/lib/hr';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Select,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { EmployeeFormModal } from '@/components/hr/EmployeeFormModal';
import { getHrEmployeesTranslations } from '@/lib/translations';
import ScrollX from '@/components/system/ScrollX';

export default function HREmployeesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrEmployeesTranslations(lang);
  const router = useRouter();
  // الإجراءات، الرقم الوظيفيّ، الاسم، الهويّة — ثابتةٌ على اليمين.
  const pin = usePinnedColumns(4);
  const searchParams = useSearchParams();
  const staff = isHRStaff(user);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Search is server-side, so the raw box value is debounced — otherwise every
  // keystroke fires a request and a slow early one can land after a later one.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams?.get('status') || '');
  // ── وبقيّةُ الفلاتر ────────────────────────────────────────────────────────
  // `listEmployees` كان يقرأ فلاتر الماستر كلَّها منذ اليوم الأوّل
  // (`master._buildFilter`) — والشاشةُ لا ترسل منها إلّا الحالة. فالسؤالُ
  // «أرِني الباكستانيّين في النقل الثقيل بجدّة» كان يُجاب عنه في القاعدة ولا
  // سبيلَ إلى طرحه من هنا.
  //
  // واللوحةُ هي نفسُها لوحةَ الماستر ومصدرُ خياراتها هو نفسُه، فما يُفلتَر به
  // هناك يُفلتَر به هنا بلا تعريفٍ ثانٍ يشيخ.
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(searchParams?.entries() || [])].filter(([k]) => k !== 'q' && k !== 'status')));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  /**
   * ── وقمعُ العمود كما في إكسل ───────────────────────────────────────────────
   * فلترُ الصفحة (لوحةُ الفلاتر) يسأل الخادمَ ويُضيّق المجموعة؛ وهذا يُضيّق
   * **ما يُعرَض منها** بقيمةٍ بعينها في عمودٍ بعينه — وهو ما يفعله المستخدمُ
   * في الورقة: يضغط رأسَ العمود ويختار. فالاثنان يعملان معًا: القمعُ يُحسَب
   * على ما وصل بعد فلتر الصفحة، فلا يُرى في القائمة ما لا يُرى في الجدول.
   */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setCol = (k: string, v: Set<string>) => setColFilters((p) => {
    const n = { ...p };
    if (v.size) n[k] = v; else delete n[k];
    return n;
  });

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
      for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) qs.set(k, String(v));
      const d = await api.get<{ employees: Employee[] }>(`/api/hr/employees?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setEmployees(d.employees || []);
    } catch {}
    if (guard.isCurrent(mine)) setLoading(false);
  }, [debouncedSearch, statusFilter, JSON.stringify(filters), guard]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ما تختاره يعيش في العنوان: يعمل الرجوعُ والتقدّم، ويبقى ما بنيتَه إن حُدِّثت
  // الصفحة أو أُرسل الرابطُ لزميل.
  useEffect(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('q', search.trim());
    if (statusFilter) p.set('status', statusFilter);
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    syncUrl('/system/hr/employees', p);
  }, [search, statusFilter, JSON.stringify(filters)]);

  useEffect(() => { load(); }, [load]);
  // ── وما يُعدَّل في الماستر يصل هنا ──────────────────────────────────────
  // شاشاتُ الماستر تكتب في الحقول نفسِها التي تعرضها هذه الشاشة، وتبثّ
  // `hr:master`. وبلا هذا السطر تبقى هذه على أرقامها حتى يُحدِّثها أحدٌ بيده —
  // فيُقرأ رقمان مختلفان للشيء نفسِه في شاشتين مفتوحتين.
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:master', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit = (e: Employee) => { setEditing(e); setShowModal(true); };

  /**
   * ── ولا زرَّ حذفٍ في سجلّ الموظّفين ─────────────────────────────────────
   * كان هنا زرٌّ يمحو الموظّف ومستنداتِه وملفّاتَها على القرص محوًا لا رجعةَ
   * فيه. ومَن ترك العملَ تُنهى خدمتُه ولا يُمحى ملفُّه: يُسأل عنه بعد سنواتٍ —
   * مكتبُ العمل، والتأمينات، وشهادةُ خبرة، وعهدةٌ كانت بيده. والبابُ في الخادم
   * مسدودٌ أيضًا (راجع `deleteEmployee`)، فلا يُصنَع الطلبُ من غير هذه الشاشة.
   *
   * وإنهاءُ الخدمة يُفعَل من ملفّ الموظّف حيث يُكتب سببُه وتاريخُه ويُحرَس
   * بالعهدة والتفويض — فالزرُّ يفتح الملفّ ولا يفعل شيئًا بنفسه.
   */
  const openFileToEndService = (e: Employee) => {
    router.push(`/system/hr/employees/${e._id}`);
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
  // «المعروض» و«الكل» يفترقان متى كان ثَمّ فلترٌ أصلًا — واللوحةُ الجديدة منه.
  const hasActiveFilters = !!(debouncedSearch.trim() || statusFilter || countActive(filters));
  /** الفلاتر التي قد تحجب نتيجةَ بحثٍ صحيح — تُسمّى للقارئ لا تُعَدّ. */
  const blockers = [
    statusFilter
      ? `${ar ? 'الحالة' : 'status'}: ${ar ? EMPLOYMENT_STATUS[statusFilter]?.ar : EMPLOYMENT_STATUS[statusFilter]?.en}`
      : '',
    countActive(filters) ? `${countActive(filters)} ${ar ? 'فلتر متقدّم' : 'advanced filter(s)'}` : '',
  ].filter(Boolean);
  const clearAllFilters = () => { setStatusFilter(''); setFilters({}); };
  const fetchAllEmployees = async () => {
    const d = await api.get<{ employees: Employee[] }>('/api/hr/employees');
    return [{ name: 'Employees', rows: d.employees || [], columns: exportColumns }];
  };
  // القيمةُ المقروءةُ لكلّ عمود — واحدةٌ للرسم وللقمع وللتصدير، فلا يُفلتَر
  // على شيءٍ غيرِ المعروض.
  const colValue: Record<string, (e: Employee) => string> = {
    employeeNumber: (e) => String(e.employeeNumber || ''),
    name: (e) => empName(e, lang),
    iqamaId: (e) => String((e as any).iqamaNumber || (e as any).nationalId || ''),
    jobTitle: (e) => String((e as any).jobTitle || ''),
    nationality: (e) => String((e as any).nationality || ''),
    // ويُقرأ نصُّ الحالة من نفس الخريطة التي تُرسَم بها الشارةُ في الصفّ،
    // فلا تُفلتَر على كلمةٍ غيرِ المعروضة.
    status: (e) => {
      const m = (EMPLOYMENT_STATUS as any)[(e as any).employmentStatus || 'active'];
      return m ? (ar ? m.ar : m.en) : String((e as any).employmentStatus || '');
    },
  };

  // ما يُعرَض فعلًا: ما وصل من الخادم بعد فلتر الصفحة، مُضيَّقًا بقمع الأعمدة.
  const shown = useMemo(() => {
    const keys = Object.keys(colFilters);
    if (!keys.length) return employees;
    return employees.filter((e) => keys.every((k) => colFilters[k].has(colValue[k]?.(e) ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, JSON.stringify(Object.fromEntries(Object.entries(colFilters).map(([k, v]) => [k, [...v]])))]);

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
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-48 shrink-0">
          <Select aria-label={ar ? 'فلترة الحالة' : 'Filter by status'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.allStatuses}</option>
            {Object.entries(EMPLOYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
        </div>
        <div className="shrink-0">
          <FilterPanel
            optionsUrl="/api/hr/master/filters"
            // الشاشةُ تعرض كلَّ السجلّات، فتُعَدُّ الخياراتُ على النطاق نفسِه —
            // وإلّا قالت اللوحةُ «١٧٠» وفتح الجدولُ ١٨٢.
            optionsParams={{ scope: 'all' }}
            value={filters}
            onChange={setFilters}
            dateFields={HR_DATE_FIELDS}
            numRanges={HR_NUM_RANGES}
            resultCount={employees.length}
            resultLabel={ar ? 'الموظفون المطابقون' : 'Matching employees'}
          />
        </div>
      </div>

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th {...pin.th(0, 'text-start font-semibold px-4 py-3 whitespace-nowrap')}>{tx.thActions}</th>
              {([
                [1, 'employeeNumber', tx.thEmpNumber],
                [2, 'name', tx.thName],
                [3, 'iqamaId', tx.thIqamaId],
                [null, 'jobTitle', tx.thJobTitle],
                [null, 'nationality', tx.thNationality],
                [null, 'status', tx.thStatus],
              ] as [number | null, string, string][]).map(([pinIdx, key, label]) => {
                const cls = 'text-start font-semibold px-4 py-3 whitespace-nowrap';
                const inner = (
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <ColumnFilter rows={employees} field={key} valueOf={colValue[key]}
                      selected={colFilters[key] || new Set()} onChange={(v) => setCol(key, v)} lang={ar ? 'ar' : 'en'} />
                  </span>
                );
                return pinIdx == null
                  ? <th key={key} className={cls}>{inner}</th>
                  : <th key={key} {...pin.th(pinIdx, cls)}>{inner}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              /* ── ولا يُقال «لا يوجد» وهو موجود ──────────────────────────────
                 «بعمل سيرش عن موظّف مش بيلاقيه» — والموظّفُ في السجلّ. العلّةُ
                 أنّ الفلترَ يبقى مكتوبًا في عنوان الصفحة فيعيش عبر التنقّل
                 والتحديث، والبحثُ يُطبَّق **داخله**. فمن فلتر بالحالة «نشط»
                 مرّةً ثمّ بحث عن واحدٍ من الواحدٍ وتسعين المنتهيةِ خدمتُهم قرأ
                 «لا يوجد موظفون». ثبت ذلك على البرودكشن: الاسمُ يُوجَد بلا فلتر
                 ويُعطي صفرًا مع `status=active`.
                 فالشاشةُ الفارغةُ تقول ما يحجب، وتمسحه بضغطةٍ واحدة. */
              <tr><td colSpan={7} className="text-center py-12">
                <p className="text-slate-800 font-semibold">{tx.noEmployees}</p>
                {blockers.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[12.5px] text-slate-500">
                      {ar ? 'فيه فلاتر شغّالة والبحث بيتم جوّاها: ' : 'Filters are active and the search runs inside them: '}
                      <span className="font-semibold text-slate-700">{blockers.join(' · ')}</span>
                    </p>
                    <button type="button" onClick={clearAllFilters}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold hover:bg-[#e06010]">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {ar ? 'ابحث في كل الموظفين' : 'Search all employees'}
                    </button>
                  </div>
                )}
              </td></tr>
            ) : shown.map((e) => (
              <tr key={e._id} className="group border-b border-slate-200/70 hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => router.push(`/system/hr/employees/${e._id}`)}>
                <td {...pin.td(0, 'px-4 py-3', 'bg-white group-hover:bg-slate-100')} onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>
                    {(user?.role === 'super_admin' || user?.role === 'hr_manager') && e.employmentStatus !== 'terminated' && (
                      <button type="button" onClick={() => openFileToEndService(e)}
                        className="p-1.5 rounded-lg text-slate-700 hover:text-amber-600 hover:bg-slate-100"
                        title={ar ? 'إنهاء الخدمة — من ملفّ الموظّف' : 'End service — in the employee file'}>
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
                <td {...pin.td(1, 'px-4 py-3 text-slate-700 whitespace-nowrap', 'bg-white group-hover:bg-slate-100')}>{e.employeeNumber || '—'}</td>
                {/* سطر واحد — الإيميل كان تحت الاسم فبيطوّل الصف من غير داعي */}
                {/* ── والاسمُ لا يأخذ نصفَ الشاشة ──────────────────────────────
                    كان العمودُ `whitespace-nowrap` بلا حدٍّ، والأسماءُ الرباعيّة
                    العربيّة تُمدّده حتى يبلغ نصفَ شاشةِ اللابتوب فتُدفَع بقيّةُ
                    الأعمدة خارجها. فله حدٌّ وما زاد يُقصّ — والكاملُ يُقرأ
                    بالوقوف عليه، ويبقى كاملًا في التصدير. */}
                <td {...pin.td(2, 'px-4 py-3 text-slate-900 font-semibold', 'bg-white group-hover:bg-slate-100')}>
                  <span className="block max-w-[15rem] truncate" title={empName(e, lang)}>{empName(e, lang)}</span>
                </td>
                <td {...pin.td(3, 'px-4 py-3 text-slate-700 whitespace-nowrap', 'bg-white group-hover:bg-slate-100')}>{e.idType === 'national_id' ? (e.nationalId || '—') : (e.iqamaNumber || '—')}</td>
                <td className="px-4 py-3 text-slate-700">{e.jobTitle || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.nationality || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      <EmployeeFormModal open={showModal} employee={editing} onClose={() => setShowModal(false)} onSaved={() => load()} />
    </div>
  );
}
