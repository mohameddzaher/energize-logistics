'use client';
// HR overview: a card per column and a work list, not just numbers. Each "required" number is missing data the team must collect, and pressing it opens those people to fill in place. "Not required" is counted separately: a Saudi with no residency is not missing a residency, and listing him wastes people's time.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import MasterNav from '@/components/hr/MasterNav';
import DepartmentAnalysis, { type DeptAnalysis } from '@/components/hr/DepartmentAnalysis';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Users, CalendarClock, ChevronLeft, TriangleAlert, ClipboardList, Search, BarChart3,
} from 'lucide-react';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import { stateMeta, statusMeta,
  getHrOverview, STATUS_META, STATE_META, statusLabel, stateLabel, HR_DATE_FIELDS, HR_NUM_RANGES, HR_EMPLOYMENT_LABELS,
  type HrOverview, type GroupCard, type FieldCard, type AnalyticBlock,
} from '@/lib/hrMaster';
import api from '@/lib/api';

function HrMasterInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<HrOverview | null>(null);
  // The operational part (leave, requests, custody, licenses) comes from the old HR dashboard. This page is now the only place, so nothing may be left behind.
  const [ops, setOps] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The filter is the source of every number on this page. Cards and analytics are re-read from it, so no number is computed on a different group than the user sees.
  const sp = useSearchParams();
  // The filter lives in the URL. Otherwise it is lost on the first navigation: filter, open a number, press back, and the dashboard is as it was. In the URL back/forward work, the choice survives refresh, and the link can be shared. The open half of "on the job" shows how many work and how many are on leave.
  const [dutyHalf, setDutyHalf] = useState<'' | 'sponsored' | 'freelance'>('');
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])]));
  const onlyActive = filters.employment === 'active';

  // Licenses alone come from the general dashboard and do not move with the filter, so they are read once on open, not on every filter click. The same read also reacts to socket writes (previously a created contract stayed "no contract" until reload). No-contract and expired-contract lists are computed on the panel filter, while licenses are company-wide.
  const opsQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
  const loadOps = useCallback(() => { api.get<any>(`/api/hr/dashboard${opsQs ? `?${opsQs}` : ''}`).then(setOps).catch(() => {}); }, [opsQs]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useSocket('hr:master', loadOps);
  const [contractList, setContractList] = useState<'' | 'noContract' | 'lapsedContracts'>('');

  // Department analysis reads the same filter. If the panel is limited to Jeddah, department numbers are Jeddah's, so two numbers never describe two groups.
  const [depts, setDepts] = useState<DeptAnalysis | null>(null);
  // Count of library forms: one number on the panel opens it and the employee filter does not move it.
  const [forms, setForms] = useState(0);
  useEffect(() => {
    api.get<{ total: number }>('/api/hr/forms').then((r) => setForms(r.total || 0)).catch(() => {});
  }, []);

  // Ignore stale responses. The unfiltered panel is the heaviest request and fires on open, so each filter added afterwards opens a window where the widest response lands last and shows company numbers under one department's filter. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    // The screen stays shown but dimmed while refreshing instead of emptying: empty makes each filter click look like an outage, while dimmed says "updating" without taking the page.
    setRefreshing(true);
    try {
      const qs = new URLSearchParams(filters as Record<string, string>).toString();
      const [ov, dep] = await Promise.all([
        getHrOverview(filters),
        api.get<DeptAnalysis>(`/api/hr/master/by-department${qs ? `?${qs}` : ''}`).catch(() => null),
      ]);
      if (!guard.isCurrent(mine)) return;
      setD(ov);
      if (dep) setDepts(dep);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (!guard.isCurrent(mine)) return;
    setLoading(false);
    setRefreshing(false);
  }, [JSON.stringify(filters), notify, guard]);
  useEffect(() => { load(); }, [load]);

  // `replace`, not `push`: each filter value click does not deserve a browser history step, or going back would take ten presses.
  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.replace(`/system/hr/master${q ? `?${q}` : ''}`, { scroll: false });
  }, [JSON.stringify(filters), router]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  /** Opens the group page on exactly the rows behind the pressed number. The active filter is carried along; otherwise "12 required" while looking at Jeddah would open the company-wide twelve. */
  const open = (group: string, q: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...filters, ...q } as Record<string, string>).toString();
    router.push(`/system/hr/master/${group}${p ? `?${p}` : ''}`);
  };
  /** Each number opens the rows behind it and does not add a filter to this page. Pressing "not on the job" used to add the condition to the panel filter, leaving the same panel with smaller numbers and not showing the thirteen. A filter makes the number; pressing the number shows who is in it. "Identity" is the general group showing the employee with basic data. */
  const drill = (q: Record<string, string>) => open('identity', q);
  /** Expiries page with the current filter and the duration the number was counted with. "Expiring soon" is expired plus what expires within `alert.warnDays` on the filter's scope, so the page opens on both conditions. */
  const openExpiring = (state?: unknown) => {
    const p = new URLSearchParams({
      ...(filters as Record<string, string>),
      ...(d?.alert?.warnDays != null ? { withinDays: String(d.alert.warnDays) } : {}),
      ...(typeof state === 'string' ? { state } : {}),
    }).toString();
    router.push(`/system/hr/master/expiring${p ? `?${p}` : ''}`);
  };

  // The two halves of each card (on sponsorship, freelancer) come from the server. See Big.
  const H = (k: string) => ((d as any)?.totals?.halves?.[k] ?? null) as { sponsored: number; freelance: number } | null;
  if (loading) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <MasterNav />
      <PageHeader
        icon={<Users className="w-5 h-5" />}
        title={t('نظرة الموارد البشرية الشاملة', 'HR Overview')}
        subtitle={t('لكل عمود بطاقة — اضغط أي رقم لعرض الموظفين المعنيين واستكمال بياناتهم',
                    'A card per column — click any number to open the people behind it and fill their data')}
      >
        <div className="flex items-center gap-2">
          <button onClick={openExpiring}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm">
            <CalendarClock className="w-4 h-4" /> {t('الانتهاءات', 'Expiries')}
          </button>
        </div>
      </PageHeader>

      {/* Quick filtering: every number below is computed on it. Department, city, work status, project, nationality, in the same filter the full filter panel below and the server read. See HrQuickFilters. */}
      <div className="rounded-xl border border-orange-200 bg-gradient-to-l from-orange-50 to-white p-3 shadow-sm">
        <p className="mb-2 text-[12px] font-bold text-slate-500">{t('فلترة اللوحة — كل الأرقام تتعدّل حسب اختيارك', 'Filter the dashboard — every number follows your choice')}</p>
        <HrQuickFilters optionsUrl="/api/hr/master/filters" value={filters} onChange={setFilters} ar={ar} />
      </div>

      {/* Filter strip: everything below is computed on it. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <FilterPanel
          optionsUrl="/api/hr/master/filters"
          value={filters}
          onChange={setFilters}
          dateFields={HR_DATE_FIELDS}
          numRanges={HR_NUM_RANGES}
          resultCount={d?.totals?.filtered}
          resultLabel={t('الموظفون المطابقون', 'Matching employees')}
          extraLabels={{
            employment: HR_EMPLOYMENT_LABELS,
            outsideKingdom: { ar: 'خارج المملكة', en: 'Outside kingdom', values: { 1: { ar: 'خارج المملكة', en: 'Outside kingdom' } } },
            freelancer: { ar: 'عمل حر', en: 'Freelancer', values: { 1: { ar: 'عمل حر', en: 'Freelancer' } } },
          }}
          extra={(
            <div className="flex items-center gap-1.5 flex-wrap">
              {([['', 'الكل', 'All'], ['active', 'على رأس العمل', 'Active'], ['inactive', 'ليس على رأس العمل', 'Not active'], ['terminated', 'منتهية خدمته', 'Service ended']] as const).map(([v, a, e]) => (
                <button key={v || 'all'}
                  onClick={() => setFilters((f) => { const n = { ...f }; if (v) n.employment = v; else delete n.employment; return n; })}
                  className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                    ${(filters.employment || '') === v ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {t(a, e)}
                </button>
              ))}
              {(['outsideKingdom', 'freelancer'] as const).map((k) => (
                <button key={k}
                  onClick={() => setFilters((f) => { const n = { ...f }; if (n[k] === '1') delete n[k]; else n[k] = '1'; return n; })}
                  className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                    ${filters[k] === '1' ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {k === 'outsideKingdom' ? t('خارج المملكة', 'Outside kingdom') : t('عمل حر', 'Freelancer')}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      <div className={refreshing ? 'opacity-50 transition-opacity pointer-events-none space-y-5' : 'transition-opacity space-y-5'}>
      {/* Big numbers. */}
      {/* Matching employees: the count alone in its row. */}
      <div role="button" tabIndex={0} onClick={() => open('identity')}
        onKeyDown={(e) => { if (e.key === 'Enter') open('identity'); }}
        className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300">
        <span>
          <span className="block text-[13px] font-bold text-slate-700">{countActive(filters) > 0 ? t('الموظفون المطابقون للفلتر', 'Employees matching the filter') : t('إجمالي عدد الموظفين', 'Total employees')}</span>
          {countActive(filters) > 0 && <span className="block text-[11px] text-slate-400">{t(`من ${d.totals.roster} في الملف الوظيفي`, `of ${d.totals.roster} on the roster`)}</span>}
        </span>
        <span className="text-3xl font-extrabold tabular-nums text-[#f37121]">{d.totals.employees}</span>
      </div>

      {/* Work status: five states summing to total employees. Works; not working (in the system, no specific status); not working, awaiting sponsorship transfer; not working, final exit; sister company. Archive is outside the total. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Big label={t('يعمل', 'Working')} value={d.totals.active} c="#16a34a"
          halves={H('active')} onHalf={(k) => setDutyHalf((v) => (v === k ? '' : k))} activeHalf={dutyHalf} ar={ar}
          onClick={() => drill({ employment: 'working' })}
          // The detail line's space is reserved. It used to appear when a half was pressed, lengthening the card and the whole row of five cards so the screen jumped under the user's hand. The line always exists and stays hidden until selected.
          detail={d.totals.onDutyDetail ? (() => {
            const half = dutyHalf || 'sponsored';
            const x = d.totals.onDutyDetail[half] || { working: 0, leave: 0 };
            return (
              <span className={`mt-1.5 flex flex-wrap gap-1.5 text-[10.5px] tabular-nums ${dutyHalf ? '' : 'invisible'}`} aria-hidden={!dutyHalf}>
                <button type="button" tabIndex={dutyHalf ? 0 : -1} onClick={(e) => { e.stopPropagation(); drill({ employment: 'working', engagement: half }); }}
                  className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-100">
                  {t(`يعمل ${x.working}`, `Working ${x.working}`)}
                </button>
                <button type="button" tabIndex={dutyHalf ? 0 : -1} onClick={(e) => { e.stopPropagation(); drill({ employment: 'leave', engagement: half }); }}
                  className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700 hover:bg-sky-100">
                  {t(`إجازة ${x.leave}`, `On leave ${x.leave}`)}
                </button>
              </span>
            );
          })() : undefined} />
        <Big label={t('لا يعمل — داخل النظام', 'Not working — in system')} value={d.totals.noKind ?? 0} c="#94a3b8"
          sub={t('بلا حالة محدّدة · ينتظر الخروج من النظام', 'no status set · awaiting system exit')}
          halves={H('noKind')} onHalf={(k) => drill({ employment: 'nokind', engagement: k })} ar={ar}
          onClick={() => drill({ employment: 'nokind' })} />
        <Big label={t('لا يعمل — انتظار نقل الكفالة', 'Not working — awaiting transfer')} value={d.totals.transfer ?? 0} c="#d97706"
          halves={H('transfer')} onHalf={(k) => open('iqama', { employment: 'transfer', engagement: k })} ar={ar}
          onClick={() => open('iqama', { employment: 'transfer' })} />
        <Big label={t('لا يعمل — خروج نهائي', 'Not working — final exit')} value={d.totals.finalExit ?? 0} c="#b91c1c"
          halves={H('finalExit')} onHalf={(k) => drill({ employment: 'final_exit', engagement: k })} ar={ar}
          onClick={() => drill({ employment: 'final_exit' })} />
        <Big label={t('شركة شقيقة', 'Sister company')} value={d.totals.sister ?? 0} c="#0d9488"
          halves={H('sister')} onHalf={(k) => drill({ employment: 'sister', engagement: k })} ar={ar}
          onClick={() => drill({ employment: 'sister' })} />
      </div>
      {/* The total is stated explicitly so nobody sums by eye. */}
      {(() => {
        const sum = (d.totals.active || 0) + (d.totals.noKind || 0) + (d.totals.transfer || 0) + (d.totals.finalExit || 0) + (d.totals.sister || 0);
        return (
          <p className={`-mt-1 text-[11px] ${sum === d.totals.employees ? 'text-slate-400' : 'font-semibold text-red-600'}`}>
            {t(`المجموع ${sum} = إجمالي الموظفين ${d.totals.employees}`, `Sum ${sum} = total employees ${d.totals.employees}`)}
          </p>
        );
      })()}

      <hr className="border-slate-200" />

      {/* The archive is not here; it has its own page. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Big label={t('خانات مطلوبة', 'Required fields')} value={d.totals.required} c="#dc2626"
          halves={H('required')} onHalf={(k) => open('required', { status: 'required', engagement: k })} ar={ar}
          onClick={() => open('required', { status: 'required' })} />
        <Big label={t('مستندات منتهية أو قريبة الانتهاء', 'Expired or expiring documents')} value={d.totals.expiringSoon} c="#ea580c"
          halves={H('expiringSoon')} ar={ar}
          onClick={openExpiring}
          // Its three stages sum to the card's number, and each opens the expiries on its own state.
          detail={d.totals.expiringStates ? (
            <span className="mt-1.5 flex flex-wrap gap-1.5 text-[10.5px] tabular-nums">
              {(['expired', 'critical', 'warning'] as const).map((k) => (
                <button key={k} type="button" onClick={(e) => { e.stopPropagation(); openExpiring(k); }}
                  className={`rounded px-1.5 py-0.5 font-semibold hover:opacity-80 ${stateMeta(k).bg}`}>
                  {stateLabel(k, ar)} {d.totals.expiringStates?.[k] ?? 0}
                </button>
              ))}
            </span>
          ) : undefined} />
        <Big label={t('مسجّل بالتأمينات', 'GOSI registered')} value={d.totals.gosiRegistered} c="#0ea5e9"
          halves={H('gosiRegistered')} onHalf={(k) => open('socialInsurance', { field: 'gosiNumber', status: 'filled', engagement: k })} ar={ar}
          onClick={() => open('socialInsurance', { field: 'gosiNumber', status: 'filled' })} />
        <Big label={t('خارج المملكة', 'Outside kingdom')} value={d.totals.outsideKingdom} c="#64748b"
          halves={H('outsideKingdom')} onHalf={(k) => drill({ outsideKingdom: '1', engagement: k })} ar={ar}
          onClick={() => drill({ outsideKingdom: '1' })} />
        <Big label={t('فريلانسر', 'Freelancers')} value={d.totals.freelancers} c="#0f172a"
          onClick={() => drill({ engagement: 'freelance' })} />
      </div>

      {/* Daily work, computed on the matching employees only. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Big label={t('إجازات قيد المراجعة', 'Leaves pending')} value={d.work?.pendingLeaves ?? 0} c="#0ea5e9"
          onClick={() => router.push('/system/hr/leaves')} />
        <Big label={t('طلبات مفتوحة', 'Open requests')} value={d.work?.openRequests ?? 0} c="#8b5cf6"
          onClick={() => router.push('/system/hr/requests')} />
        <Big label={t('عهد بعهدة الموظفين', 'Assets held')} value={d.work?.assignedAssets ?? 0} c="#0f172a"
          onClick={() => router.push('/system/hr/custody')} />
        {/* The department's forms library. Forms and letters were in chats and personal folders, so an old copy was signed and returned; they now have one place opened from here. */}
        <Big label={t('النماذج والخطابات', 'Forms & letters')} value={forms} c="#0d9488"
          onClick={() => router.push('/system/hr/forms')} />
      </div>

      {/* Licenses and subscriptions are company-level, not employee-level, so a nationality or branch filter does not move them. Separated by their heading so they are not thought to ignore the filter. */}
      {ops?.summary && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">
            {t('على مستوى الشركة — لا يحرّكها الفلتر', 'Company-wide — not affected by the filter')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Big label={t('التراخيص والاشتراكات', 'Licences')} value={ops.summary.licensesTotal} c="#64748b"
              onClick={() => router.push('/system/hr/licenses')} />
            <Big label={t('تراخيص تنتهي خلال 60 يوم', 'Licences due 60d')} value={ops.summary.licensesExpiringCount} c="#f59e0b"
              onClick={() => router.push('/system/hr/licenses')} />
            <Big label={t('تراخيص منتهية', 'Licences expired')} value={ops.summary.licensesExpiredCount} c="#dc2626"
              onClick={() => router.push('/system/hr/licenses')} />
          </div>
        </section>
      )}

      {/* Contracts needing attention: workforce (non-freelancer) with no contract in the system, and those whose contract term ended without renewal. An employee leaves the list as soon as a contract is created or renewed. */}
      {ops?.summary && (ops.summary.noContractCount > 0 || ops.summary.lapsedContractsCount > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">{t('عقود تحتاج انتباهًا', 'Contracts needing attention')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Big label={t('موظفون بلا عقد مسجَّل', 'Employees with no contract')} value={ops.summary.noContractCount} c="#dc2626"
              onClick={() => setContractList((v) => (v === 'noContract' ? '' : 'noContract'))} />
            <Big label={t('عقود منتهية لم تُجدَّد', 'Expired contracts, not renewed')} value={ops.summary.lapsedContractsCount} c="#f59e0b"
              onClick={() => setContractList((v) => (v === 'lapsedContracts' ? '' : 'lapsedContracts'))} />
          </div>
          {contractList && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0"><tr className="bg-slate-900 text-slate-300">
                    <th className="px-3 py-2 text-start font-semibold">{t('الرقم الوظيفي', 'Emp. no.')}</th>
                    <th className="w-56 px-3 py-2 text-start font-semibold">{t('الموظف', 'Employee')}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t('القسم', 'Department')}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t('المسمّى', 'Job title')}</th>
                    {contractList === 'lapsedContracts' && <th className="px-3 py-2 text-start font-semibold">{t('انتهى في', 'Ended on')}</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(ops[contractList] || []).map((e: any) => (
                      <tr key={e._id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/system/hr/employees/${e._id}`)}>
                        <td className="px-3 py-2 tabular-nums text-slate-600">{e.employeeNumber || '—'}</td>
                        <td className="max-w-[14rem] truncate px-3 py-2 font-semibold text-slate-900" title={e.name}>{e.name}</td>
                        <td className="px-3 py-2 text-slate-600">{e.department || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{e.jobTitle || '—'}</td>
                        {contractList === 'lapsedContracts' && <td className="px-3 py-2 font-semibold text-red-600">{String(e.endDate || '').slice(0, 10).split('-').reverse().join('/') || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Analytics: derived slices, each filtering the page when pressed. */}
      {!!d.analytics?.length && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#12325c]" />
            <h2 className="text-sm font-bold text-slate-800">{t('التحليلات', 'Analytics')}</h2>
            <span className="text-[11px] text-slate-400">
              {t('اضغط أيّ شريحة لعرض مَن فيها', 'Click any band to see who is in it')}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {d.analytics.map((a) => (
              <AnalyticCard key={a.key} a={a} ar={ar} total={d.totals.filtered} onPick={drill} active={filters} />
            ))}
          </div>
        </section>
      )}

      {/* Department analysis: answers which departments are worst. */}
      {!!depts?.departments?.length && (
        <DepartmentAnalysis
          data={depts} ar={ar}
          onOpen={(q) => drill(q as Record<string, string>)}
          onFilter={(dept) => setFilters((f) => ({
            ...f,
            // A second press on the same department removes the restriction, so the user does not hunt for a button to undo it.
            department: f.department === dept ? '' : dept,
          }))}
          active={String(filters.department || '')}
        />
      )}

      {/* Distribution of each column with repeated values: a card per column. */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('التوزيعات', 'Distributions')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.flatMap((g) => g.fields
            .filter((f) => (f.values?.length || 0) > 1)
            .map((f) => (
              <DistributionCard key={`${g.key}.${f.key}`} f={f} groupAr={ar ? g.ar : g.en} ar={ar} t={t}
                total={d.totals.filtered} onPick={drill} active={filters} />
            )))}
        </div>
      </section>

      {/* Start here: the most incomplete data. */}
      {!!d.topRequired.length && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-slate-800">{t('ابدأ من هنا — أكثر البيانات نقصًا', 'Start here — most missing')}</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {d.topRequired.map((f) => (
              <button key={`${f.groupKey}.${f.key}`}
                onClick={() => open(f.groupKey, { field: f.key, status: 'required' })}
                className="text-start rounded-lg border border-red-100 bg-red-50/50 hover:border-red-300 px-3 py-2 transition-colors">
                <p className="text-xl font-extrabold text-red-600 leading-none">{f.required}</p>
                <p className="text-[11px] text-slate-700 mt-1 leading-tight">{ar ? f.ar : f.en}</p>
                <p className="text-[10px] text-slate-400">{f.groupAr}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Documents with dates. */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('المستندات ومواعيد انتهائها', 'Documents and their expiry')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.filter((g) => g.document).map((g) => (
            <DocGroupCard key={g.key} g={g} ar={ar} t={t} scope={d.expiryScope || {}} onOpen={open} />
          ))}
        </div>
      </section>

      {/* Every group and each field inside it. */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('كل عمود بالتفصيل', 'Every column in detail')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.map((g) => <GroupBlock key={g.key} g={g} ar={ar} t={t} onOpen={open} />)}
        </div>
      </section>
      </div>
    </div>
  );
}

type Half = 'sponsored' | 'freelance';
function Big({ label, value, c, onClick, sub, halves, onHalf, activeHalf, detail, ar }: {
  label: string; value: any; c: string; onClick?: () => void;
  /** Small line under the number, used for the file total beside the filtered number. */
  sub?: string;
  /** The two halves of the number (on sponsorship, freelancer), each pressable on its own. */
  halves?: { sponsored: number; freelance: number } | null;
  onHalf?: (k: Half) => void;
  activeHalf?: string;
  detail?: React.ReactNode;
  ar?: boolean;
}) {
  // The card is a div that is clicked, not a button: it contains the half buttons, and a button inside a button is invalid.
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      className={`bg-white border border-slate-200 rounded-xl p-3 shadow-sm h-full text-start ${onClick ? 'cursor-pointer hover:border-slate-300' : ''}`}>
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-extrabold leading-none tabular-nums" style={{ color: c }}>{value}</p>
        {sub && <span className="text-[10px] text-slate-400 font-semibold tabular-nums">{sub}</span>}
      </div>
      <p className="text-[10.5px] text-slate-500 mt-1.5 leading-tight">{label}</p>
      {halves && (
        <span className="mt-2 grid grid-cols-2 gap-1 border-t border-slate-100 pt-1.5">
          {(['sponsored', 'freelance'] as const).map((k) => (
            <button key={k} type="button" disabled={!onHalf}
              onClick={(e) => { e.stopPropagation(); onHalf?.(k); }}
              className={`rounded-md px-1.5 py-1 text-start transition-colors ${activeHalf === k ? 'bg-slate-900 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-700'} disabled:cursor-default`}>
              <span className="block text-[9.5px] leading-tight opacity-75">{k === 'sponsored' ? (ar ? 'على الكفالة' : 'Sponsored') : (ar ? 'فريلانسر' : 'Freelance')}</span>
              <span className="block text-[13px] font-extrabold tabular-nums leading-tight">{halves[k] ?? 0}</span>
            </button>
          ))}
        </span>
      )}
      {detail}
    </div>
  );
}

// Document card: date states on top, field states below. Each number opens its rows with its condition. Expiry states are counted for those whose service has not ended (`scope` from the server), so the condition is carried on every click. The "needs attention" badge is expired plus critical plus soon; it used to open only expired (257 on the badge vs 102 in the table).
function DocGroupCard({ g, ar, t, onOpen: openRaw, scope }: { g: GroupCard; ar: boolean; t: any; onOpen: any; scope: Record<string, string> }) {
  const onOpen = (key: string, q: Record<string, string> = {}) => openRaw(key, { ...scope, ...q });
  const s = g.states!;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <button onClick={() => onOpen(g.key)} className="font-bold text-slate-900 text-sm hover:text-[#f37121]">
          {ar ? g.ar : g.en}
        </button>
        {!!g.needsAttention && (
          <button onClick={() => onOpen(g.key, { state: 'attention' })}
            title={t('منتهية أو قريبة الانتهاء', 'Expired or nearing expiry')}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
            <TriangleAlert className="w-3 h-3" />{g.needsAttention}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => (
          <button key={k} onClick={() => onOpen(g.key, { state: k })}
            className="rounded-lg border border-slate-100 py-2 hover:border-slate-300 transition-colors">
            <p className="text-lg font-extrabold leading-none" style={{ color: stateMeta(k).color }}>{s[k]}</p>
            <p className="text-[9.5px] text-slate-500 mt-1 leading-tight px-0.5">{stateLabel(k, ar)}</p>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <button onClick={() => onOpen(g.key, { state: 'not_applicable' })} className="hover:text-slate-700">
          {t('لا ينطبق', 'N/A')}: {s.not_applicable}
        </button>
        <button onClick={() => onOpen(g.key, { state: 'missing' })} className="hover:text-slate-700">
          {t('بدون تاريخ', 'No date')}: {s.missing}
        </button>
      </div>
    </div>
  );
}

// Group card: each field with its four counters.
function GroupBlock({ g, ar, t, onOpen }: { g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <button onClick={() => onOpen(g.key)} className="font-bold text-slate-900 text-sm hover:text-[#f37121] inline-flex items-center gap-1">
          {ar ? g.ar : g.en}
          <ChevronLeft className="w-3.5 h-3.5 text-slate-300 rtl:rotate-0 ltr:rotate-180" />
        </button>
        {g.required > 0 && (
          <button onClick={() => onOpen(g.key, { status: 'required' })}
            className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
            {g.required} {t('مطلوب', 'required')}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {g.fields.map((f) => <FieldRow key={f.key} f={f} g={g} ar={ar} t={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function FieldRow({ f, g, ar, t, onOpen }: { f: FieldCard; g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  const [open, setOpen] = useState(false);
  const c = f.counts;
  const chip = (code: string, n: number) => n > 0 && (
    <button key={code} onClick={() => onOpen(g.key, { field: f.key, status: code })}
      className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${statusMeta(code).bg} hover:opacity-80`}>
      {statusLabel(code, ar)} {n}
    </button>
  );

  return (
    <div className="border-b border-slate-50 last:border-0 pb-1.5 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-slate-700 truncate">{ar ? f.ar : f.en}</span>
        <div className="flex items-center gap-1 shrink-0">
          {chip('required', c.required)}
          {chip('not_required', c.not_required)}
          {chip('cash_payroll', c.cash_payroll)}
          {chip('inactive', c.inactive)}
          {chip('filled', c.filled)}
          {chip('none', c.none)}
        </div>
      </div>
      {/* Fields with repeated values (department, nationality, ...) open with their distribution. */}
      {!!f.values?.length && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="text-[10px] text-slate-400 hover:text-slate-700 mt-0.5">
            {open ? t('إخفاء التوزيع', 'Hide breakdown')
                  : t(`التوزيع (${f.valuesTotal ?? f.values.length})`, `Breakdown (${f.valuesTotal ?? f.values.length})`)}
          </button>
          {open && (
            <div className="mt-1 space-y-0.5 ps-2 border-s-2 border-slate-100">
              {f.values.slice(0, 20).map((v) => (
                <button key={v.value} onClick={() => onOpen(g.key, { [f.key]: v.value })}
                  className="w-full flex items-center justify-between gap-2 text-[11px] text-slate-500 hover:text-slate-900">
                  <span className="truncate">{v.value}</span>
                  <b className="text-slate-700 tabular-nums">{v.count}</b>
                </button>
              ))}
              {/* The card shows the top values; without this line the reader assumes it is all values and builds on incomplete data. Choosing among all values is in the filter panel above. */}
              {(f.valuesTotal ?? 0) > 20 && (
                <p className="text-[10px] text-slate-400 pt-0.5">
                  {t(`أعلى 20 من ${f.valuesTotal} — الباقي في لوحة الفلترة`,
                     `Top 20 of ${f.valuesTotal} — the rest is in the filter panel`)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Analysis card: horizontal slices with width proportional to the count. A slice carries the filter that produces it; pressing adds it to the filter rather than the UI guessing the condition, so the shown number never differs from the rows it opens.
function AnalyticCard({ a, ar, total, onPick, active }:
{ a: AnalyticBlock; ar: boolean; total: number; onPick: (q: Record<string, string>) => void; active: Record<string, string> }) {
  const max = Math.max(1, ...a.items.map((i) => i.count));
  const isOn = (f: Record<string, string>) => Object.entries(f).every(([k, v]) => active[k] === v);
  const colors = a.kind === 'horizon'
    ? ['#dc2626', '#ea580c', '#f59e0b', '#0ea5e9', '#16a34a', '#94a3b8']
    : ['#12325c', '#1b4278', '#2a5490', '#3d6aa8', '#5480bf', '#7b9dd1'];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-bold text-slate-900">{ar ? a.ar : a.en}</h3>
        <span className="text-[10.5px] text-slate-400 tabular-nums">{total}</span>
      </div>
      <div className="space-y-1.5">
        {a.items.map((it, i) => {
          const on = isOn(it.filter);
          const pct = Math.round((it.count / max) * 100);
          return (
            <button key={it.label} onClick={() => onPick(it.filter)} disabled={!it.count}
              className={`w-full group text-start ${it.count ? '' : 'opacity-40 cursor-default'}`}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={`text-[11.5px] truncate ${on ? 'font-bold text-[#12325c]' : 'text-slate-600'}`}>
                  {ar ? it.label : it.labelEn}
                </span>
                <span className="text-[11.5px] font-bold tabular-nums text-slate-800 shrink-0">
                  {it.count}
                  {total > 0 && <span className="text-[10px] text-slate-400 font-normal ms-1">{Math.round((it.count / total) * 100)}%</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all group-hover:opacity-80"
                  style={{ width: `${pct}%`, background: colors[i % colors.length] }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Column distribution card: top values, the rest behind a button. The "required" and "not required" counters sit above because they are not two sides of one coin: required is pending work, not required has nothing in it, and mixing them makes a false work list.
function DistributionCard({ f, groupAr, ar, t, total, onPick, active }:
{ f: FieldCard; groupAr: string; ar: boolean; t: any; total: number;
  onPick: (q: Record<string, string>) => void; active: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const vals = f.values || [];
  const shown = all ? vals : vals.slice(0, 6);
  const max = Math.max(1, ...vals.map((v) => v.count));
  const sel = String(active[f.key] || '').split(',').filter(Boolean);
  const pick = (v: string) => {
    const list = [...sel];
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1); else list.push(v);
    onPick({ [f.key]: list.join(',') });
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-slate-900 truncate">{ar ? f.ar : f.en}</h3>
          <p className="text-[10px] text-slate-400">{groupAr}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {f.counts.required > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">
              {t('مطلوب', 'Required')} {f.counts.required}
            </span>
          )}
          {f.counts.not_required > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
              {t('غير مطلوب', 'N/R')} {f.counts.not_required}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {shown.map((v) => {
          const on = sel.includes(v.value);
          return (
            <button key={v.value} onClick={() => pick(v.value)} className="w-full group text-start">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={`text-[11.5px] truncate ${on ? 'font-bold text-[#f37121]' : 'text-slate-600'}`}>
                  {v.value === '—' ? t('(بلا قيمة)', '(blank)') : v.value}
                </span>
                <span className="text-[11.5px] font-bold tabular-nums text-slate-800 shrink-0">
                  {v.count}
                  {total > 0 && <span className="text-[10px] text-slate-400 font-normal ms-1">{Math.round((v.count / total) * 100)}%</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all group-hover:opacity-80 ${on ? 'bg-[#f37121]' : 'bg-[#12325c]'}`}
                  style={{ width: `${Math.round((v.count / max) * 100)}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      {vals.length > 6 && (
        <button onClick={() => setAll((x) => !x)} className="mt-2 text-[10.5px] text-slate-400 hover:text-slate-700">
          {all ? t('عرض أقل', 'Show less') : t(`عرض الكل (${vals.length})`, `Show all (${vals.length})`)}
        </button>
      )}
    </div>
  );
}

export default function HrMasterPage() {
  return <Suspense fallback={<Spinner />}><HrMasterInner /></Suspense>;
}
