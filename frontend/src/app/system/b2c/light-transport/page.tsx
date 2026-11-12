'use client';
/**
 * Light-transport employees: the department register.
 * The department ran on two Excel sheets (employees; vehicles and authorizations) that were mailed, copied and edited in several versions, so simple questions needed manual sorting or counting.
 * The old page here listed only reps from order reports, leaving out supervisors, mechanics and cleaners (11 of 161).
 * The register now covers everyone in light transport: project, branch, supervisor, vehicle, sponsorship registration and housing. The person stays in HR and the vehicle in the vehicle register; see backend/models/LightTransport.
 */
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { PersonDocDate, personDocExportColumns } from '@/components/system/PersonDocDate';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import ManagedSelect from '@/components/system/ManagedSelect';
import ScrollX from '@/components/system/ScrollX';
import { LEAD, LEAD_CELL } from '@/components/vehicles/stickyLead';
import ManagersProjects from '@/components/b2c/ManagersProjects';
import TransferProjectModal from '@/components/b2c/TransferProjectModal';
import { Truck, Plus, Pencil, RotateCcw, UserMinus, ExternalLink, X, ArrowLeftRight } from 'lucide-react';
import {
  getLTEmployees, updateLTEmployee, createLTEmployee, deactivateLTEmployee, ltFacetedTotals, ltPasses,
  LT_COLUMNS, statusCls, KIND_AR, KIND_EN, canEditLT, canTransferLT, fmtDate,
  supervisorIdOf, dutySupervisorIdOf, assignLTSupervisors, serverFilters, OP_STATUS_OPTIONS,
  DOC_CLS, DOC_AR, DOC_EN,
  type LTEmployee, type LTOptions, type LTDoc,
} from '@/lib/lightTransport';

/** Filter key names used by the active-filter chips. */
const CHIP_KEY_AR: Record<string, string> = {
  project: 'المشروع', city: 'الفرع', jobTitle: 'الوظيفة', contractType: 'نوع التعاقد', register: 'السجل',
  vehicleType: 'نوع المركبة', supervisor: 'المشرف', dutySupervisor: 'مشرف التفقد', staffKind: 'النوع',
  status: 'الحالة', housing: 'السكن', hasVehicle: 'المركبة', hiredFrom: 'التعيين من', hiredTo: 'التعيين إلى',
  contractKind: 'العقد', doc: 'الوثيقة', inService: 'الخدمة',
  // From the department dashboard filters.
  rep: 'المندوب', vehicle: 'المركبة', auth: 'التفويض', cr: 'السجل التجاري', engagement: 'الارتباط', category: 'الفئة',
};
const CHIP_KEY_EN: Record<string, string> = {
  project: 'Project', city: 'Branch', jobTitle: 'Job', contractType: 'Contract', register: 'Register',
  vehicleType: 'Vehicle type', supervisor: 'Supervisor', dutySupervisor: 'Duty supervisor', staffKind: 'Kind',
  status: 'Status', housing: 'Housing', hasVehicle: 'Vehicle', hiredFrom: 'Hired from', hiredTo: 'Hired to',
  contractKind: 'Contract', doc: 'Document', inService: 'Service',
  rep: 'Rep', vehicle: 'Vehicle', auth: 'Authorisation', cr: 'Register', engagement: 'Engagement', category: 'Category',
};
/** Dashboard filter values by name; the keys are what the server sends (utils/b2cBoard). */
const BOARD_VALUE_AR: Record<string, Record<string, string>> = {
  auth: { authorized: 'مفوَّض', expired: 'تفويض منتهٍ', none: 'بلا تفويض' },
  engagement: { sponsored: 'على الكفالة', freelance: 'فريلانسر', trainee: 'متدرّب', users: 'يوزرات', none: 'غير محدد' },
  category: { rep: 'مندوب', admin: 'إداري', tech: 'فني', none: 'غير مصنَّف' },
};
const BOARD_VALUE_EN: Record<string, Record<string, string>> = {
  auth: { authorized: 'Authorised', expired: 'Expired', none: 'Not authorised' },
  engagement: { sponsored: 'Sponsored', freelance: 'Freelance', trainee: 'Trainee', users: 'Rented users', none: 'Not set' },
  category: { rep: 'Rep', admin: 'Admin', tech: 'Technician', none: 'Uncategorised' },
};

/** Card and filter list live outside the page body: defined inside, they become a new component on every render, so cards remount on each click or reply and an open list closes under the user when a socket update arrives. See the inline components remount rule. */
function Stat({ label, value, accent, onClick, on }: { label: string; value: any; accent?: string; onClick?: () => void; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`text-start bg-white border rounded-xl px-3.5 py-2.5 shadow-sm transition-all ${
        on ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'} ${onClick ? 'hover:border-[#f37121]/50 cursor-pointer' : ''}`}>
      <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
      <p className={`text-[19px] font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
    </button>
  );
}

/** A single-shape select list; values come from the register itself. */
function Filter({ value, onChange, label, list }: { value: string; onChange: (v: string) => void; label: string; list: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
      <option value="">{label}</option>
      {list.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

function LightTransportEmployeesInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify, confirm, prompt } = useDialog();
  const canEdit = canEditLT(user as any);

  const [rows, setRows] = useState<LTEmployee[]>([]);
  // The server total stays shown as 'x of y' so the displayed rows read as part of it.
  const [serverTotal, setServerTotal] = useState(0);
  const [options, setOptions] = useState<LTOptions>({ project: [], city: [], jobTitle: [], contractType: [], register: [], vehicleType: [], supervisor: [], supervisorsUnlinked: [], housing: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<LTEmployee> | null>(null);
  const [managersOpen, setManagersOpen] = useState(false);
  const [transferring, setTransferring] = useState<LTEmployee | null>(null);
  // The row's project before editing; the form cannot change it (see the project-move action).
  const origProject = editing?._id ? String(rows.find((r) => r._id === editing._id)?.projectAr || '') : '';
  // Adding an employee creates his HR file.
  // Restricted to sector manager, deputy, system admin and finance roles, matching the route guard in routes/lightTransport. Documents come with it: a name per file, possibly several.
  // role-only: creating an HR file is not opened by a section grant; the server guards it with `authorize.strict`.
  const canAdd = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'].includes(String(user?.role || ''));
  const [docs, setDocs] = useState<NewDoc[]>([]);
  const [saving, setSaving] = useState(false);

  // Filters.
  // All server-side: the table has 161 rows today and will grow. Card counts are computed after filtering, so what the card says is what the table has.
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  /**
   * Filter inherited from the dashboard.
   * The dashboard button carries its filter in the URL so the list opens on the same answer, not the whole department. Read once on open, then the screen keeps its own state; otherwise the URL would rewrite what the user changes.
   */
  const sp = useSearchParams();
  const [f, setF] = useState<Record<string, string>>(() => {
    const keys = ['project', 'city', 'jobTitle', 'contractType', 'register', 'vehicleType',
      'supervisor', 'dutySupervisor', 'staffKind', 'status', 'housing', 'hasVehicle', 'hiredFrom', 'hiredTo',
      // Two derived keys computed on rows, not in the database; see `LOCAL_KEYS`.
      'contractKind', 'doc',
      // From the dashboard's total-reps figures: only people in service; see `listEmployees`.
      'inService',
      // From the dashboard filters and cards; applied server-side with the dashboard's meaning.
      'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'];
    const init: Record<string, string> = {};
    for (const k of keys) { const v = sp?.get(k); if (v) init[k] = v; }
    return init;
  });
  const setFilter = (k: string, v: string) => setF((p) => ({ ...p, [k]: p[k] === v ? '' : v }));
  /**
   * The reps card filters on reps together with the condition.
   * All card figures except the total and its split are computed on reps only (see `ltTotalsOf`). Filtering the condition alone would show an administrative row the number above does not count. So condition and type are set together.
   */
  const repFilter = (k: string, v: string) => setF((p) => (
    p[k] === v ? { ...p, [k]: '', staffKind: '' } : { ...p, [k]: v, staffKind: 'rep' }
  ));
  const clearFilters = () => { setF({}); setQ(''); setDq(''); };
  const activeCount = Object.values(f).filter(Boolean).length + (dq ? 1 : 0);

  useEffect(() => { const h = setTimeout(() => setDq(q), 350); return () => clearTimeout(h); }, [q]);

  // Every filtered call needs its own guard: the unfiltered call is slower, arrives last and overwrites the filtered total. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    // The slowest arrives last: an unfiltered call fired first replies after the filtered one and overwrites its total. Read replies in request order, not arrival order.
    const token = guard.begin();
    try {
      // Card keys are not sent (`LOCAL_KEYS`): applied here with the server's meaning (`ltPasses`) so each group is counted without its own filter; see `ltFacetedTotals`.
      const d = await getLTEmployees({ ...serverFilters(f), q: dq });
      if (!guard.isCurrent(token)) return;
      setRows(d.employees || []);
      setServerTotal(d.totals?.total || (d.employees || []).length);
      setOptions(d.options || options);
    } catch (e: any) {
      if (guard.isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (guard.isCurrent(token)) setLoading(false);
    // Clicking a card asks the server for nothing: card keys are local, so the table changes in place with no pending reply or intermediate render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(serverFilters(f)), dq, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));
  // Anything touching the HR file touches the status shown here.
  useSocket('hr:employee', useCallback(() => load(), [load]));

  /**
   * Card filters are computed here, not in the database.
   * The sponsored/freelancer and expired-card cards are derived, and the other cards (type, status, vehicle, housing, inspection supervisor) count each group without its own filter, which needs the rows before the card filter. All are applied with `ltPasses`, the same meaning the server uses, so card and table read the same thing.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const localFiltered = useMemo(() => rows.filter((r) => ltPasses(r, f)), [rows, JSON.stringify(f)]);

  /**
   * Assignment targets a group.
   * Supervision is distributed per station or project, not per man; row by row would mean opening a dialog 147 times. Rows are marked and assigned in one batch; marking survives filter and search because it stores the row, not just its id.
   */
  const [picked, setPicked] = useState<Map<string, LTEmployee>>(new Map());
  const [assigning, setAssigning] = useState(false);
  const [assignOps, setAssignOps] = useState('');
  const [assignDuty, setAssignDuty] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);

  const cf = useColumnFilters<LTEmployee>();
  const getters = useMemo(() => {
    const o: Record<string, (e: LTEmployee) => any> = {};
    for (const c of LT_COLUMNS) o[c.key] = c.get;
    return o;
  }, []);
  const shown = cf.apply(localFiltered, getters);
  // Counts follow the column filter as they follow the chips, but each card group is counted without its own filter, so the pressed figure and its neighbours do not move. See `ltFacetedTotals`.
  const colFiltered = cf.apply(rows, getters);
  const totals = ltFacetedTotals(colFiltered, f);

  // Residency and licence columns export as a date and a status, two columns each.
  const exportColumns: ExportColumn[] = LT_COLUMNS.flatMap((c): ExportColumn[] => (
    c.key === 'iqamaExp' ? personDocExportColumns(ar).slice(0, 2)
      : c.key === 'licenseExp' ? personDocExportColumns(ar).slice(2)
        : [{ header: ar ? c.ar : c.en, key: c.key, width: c.width || 16, transform: (_: any, r: any) => c.get(r) }]
  ));
  const scope = exportScopeLabels(ar);
  const exportOptions = (activeCount || cf.count)
    ? [
      { key: 'shown', label: scope.shown, sheets: [{ name: 'LightTransport', rows: shown as any[], columns: exportColumns }] },
      { key: 'all', label: scope.all, resolve: async () => {
        const d = await getLTEmployees({ active: 'all' });
        return [{ name: 'LightTransport', rows: d.employees as any[], columns: exportColumns }];
      } },
    ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: 'LightTransport', rows: shown as any[], columns: exportColumns }] }];

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body: any = { ...editing };
      delete body._id; delete body.vehicle; delete body.employee; delete body.supervisor;
      // The name is a snapshot the server writes from the account; not sent, so it cannot diverge.
      delete body.supervisorName;
      body.supervisorUser = supervisorIdOf(editing) || '';
      delete body.dutySupervisorName;
      body.dutySupervisorUser = dutySupervisorIdOf(editing) || '';
      if (editing._id) await updateLTEmployee(editing._id, body);
      else {
        const ready = docs.filter((x) => x.file);
        if (ready.some((x) => !x.title.trim())) { notify(t('اكتب اسمَ كلّ مستندٍ مرفق', 'Name every attached document'), 'error'); setSaving(false); return; }
        body.files = await Promise.all(ready.map(async (x) => ({ title: x.title.trim(), fileName: x.file!.name, dataUrl: await uploadDataUrl(x.file!) })));
        const mb = body.files.reduce((n: number, f: any) => n + f.dataUrl.length, 0) / 1048576;
        if (mb > 22) { notify(t(`المرفقاتُ كبيرة (${Math.round(mb)} ميغابايت) — الحدُّ ٢٢. احذف بعضَها أو أرفقها من ملفّه بعد الحفظ.`, `Attachments are too large (${Math.round(mb)} MB, limit 22). Remove some or add them from the profile after saving.`), 'error'); setSaving(false); return; }
        const r: any = await createLTEmployee(body);
        if (r?.hrCreated) notify(t('أُنشئ ملفُّه في الموارد البشريّة — وصلهم إشعارٌ لإكمال بياناته.', 'His HR file was created — HR has been notified to complete it.'), 'success');
      }
      notify(t('حُفظ', 'Saved'), 'success');
      setEditing(null); setDocs([]);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const runAssign = async () => {
    if (!picked.size || (!assignOps && !assignDuty)) return;
    setAssignBusy(true);
    try {
      const body: any = { ids: [...picked.keys()] };
      if (assignOps) body.supervisorUser = assignOps;
      if (assignDuty) body.dutySupervisorUser = assignDuty;
      const r = await assignLTSupervisors(body);
      notify(t(`أُسند ${r.updated} موظفًا`, `${r.updated} employees assigned`), 'success');
      setPicked(new Map()); setAssigning(false); setAssignOps(''); setAssignDuty('');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الإسناد', 'Could not assign'), 'error'); }
    setAssignBusy(false);
  };

  const deactivate = async (e: LTEmployee) => {
    const ok = await confirm({
      message: t(`يُخرَج «${e.name}» من سجلّ القسم؟ السجلُّ يبقى وأثرُه محفوظ.`,
        `Remove "${e.name}" from the section register? The record and its trail are kept.`),
      tone: 'error',
      confirmLabel: t('إخراج', 'Remove'),
    });
    if (!ok) return;
    const reason = await prompt({ message: t('السبب (اختياري)', 'Reason (optional)') });
    try { await deactivateLTEmployee(e._id, String(reason || '')); load(); }
    catch (err: any) { notify(err?.message || t('تعذّر', 'Failed'), 'error'); }
  };

  if (loading) return <Spinner />;

  /** Filter value as read by people: no supervisor id and no English key in the chip. */
  const chipValue = (k: string, v: string) => {
    if (k === 'contractKind') return ar ? ({ sponsored: 'على الكفالة', freelance: 'فري لانسر', users: 'يوزرات', none: 'بلا نوع عقد' } as Record<string, string>)[v] || v
      : ({ sponsored: 'Sponsored', freelance: 'Freelance', none: 'No contract type' } as Record<string, string>)[v] || v;
    if (k === 'staffKind') {
      const m: Record<string, string> = ar ? { ...KIND_AR, driver: 'سائق', unknown: 'بلا وظيفة' } : { ...KIND_EN, driver: 'Driver', unknown: 'No job title' };
      return m[v] || v;
    }
    if (k === 'doc') {
      const m: Record<string, string> = ar
        ? { 'card-gap': 'كارت تشغيل منتهي/حرج', 'card-soon': 'كارت تشغيل قريب', 'inspection-gap': 'فحص منتهي/حرج', 'inspection-soon': 'فحص قريب' }
        : { 'card-gap': 'Operating card expired/critical', 'card-soon': 'Operating card due soon', 'inspection-gap': 'Inspection expired/critical', 'inspection-soon': 'Inspection due soon' };
      return m[v] || v;
    }
    if (k === 'inService') return t('بلا المنتهين', 'excluding ended');
    if (BOARD_VALUE_AR[k]) return v.split(',').map((x) => (ar ? BOARD_VALUE_AR : BOARD_VALUE_EN)[k][x] || x).join('، ');
    if (k === 'rep') {
      const ids = v.split(',');
      return ids.length === 1 ? rows.find((r) => r._id === ids[0])?.name || t('مندوب واحد', 'one rep') : t(`${ids.length} مناديب`, `${ids.length} reps`);
    }
    if (k === 'vehicle') {
      const ids = v.split(',');
      return ids.length === 1 ? rows.find((r) => String((r.vehicle as any)?._id || '') === ids[0])?.vehicle?.plateNumber || t('مركبة واحدة', 'one vehicle') : t(`${ids.length} مركبات`, `${ids.length} vehicles`);
    }
    if (k === 'hasVehicle') return v === 'yes' ? t('له مركبة', 'has a vehicle') : t('بلا مركبة', 'no vehicle');
    if (k === 'housing') return v === 'none' ? t('بلا سكن', 'unhoused') : options.housing.find((h) => h._id === v)?.name || v;
    if (k === 'supervisor' || k === 'dutySupervisor') return v === 'none' ? t('بلا مشرف', 'none') : options.supervisor.find((x) => x._id === v)?.name || v;
    return v;
  };


  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <ManagersProjects open={managersOpen} onClose={() => setManagersOpen(false)} ar={ar} />
      {transferring && (
        <TransferProjectModal open onClose={() => setTransferring(null)} id={String(transferring._id)} name={transferring.name}
          current={transferring.projectAr || ''} ar={ar} onDone={() => load()} />
      )}
      <PageHeader icon={<Truck className="w-6 h-6 text-[#f37121]" />}
        title={t('موظفون النقل الخفيف', 'Light-transport employees')}
        subtitle={t(`${serverTotal} موظفًا — المندوبون والإداريون معًا`, `${serverTotal} employees — reps and admin together`)}>
        <ExportMenu fileName="light-transport" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export')} options={exportOptions} />
        {/* Who sees which project in order entry; assigned here per supervisor and project manager. */}
        <button type="button" onClick={() => setManagersOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#f37121]">
          {t('مشاريع المشرفين', 'Supervisors’ projects')}
        </button>
        {canAdd && <PrimaryButton onClick={() => { setDocs([]); setEditing({}); }}><Plus className="w-4 h-4" /> {t('إضافة موظف', 'Add employee')}</PrimaryButton>}
      </PageHeader>

      {/* Cards filter, they do not just report. Each figure is clickable and filters the table, and counts are recomputed on what remains. */}
      {/* The total and its split: the only row about the whole department. */}
      {/* 'No job title' is its own count. There were only two types, rep and administrative, with the second as the remainder, so anyone without a job title became administrative; the administrative card overstated (38, of which 19 had no title; only 6 were truly administrative). 'Unknown' is not a category: shown as a count to be filled, not inflated inside another number. Clicking it lists them by name. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <Stat label={t('الإجمالي', 'Total')} value={totals.total} onClick={clearFilters} on={!activeCount} />
        <Stat label={t('مناديب', 'Reps')} value={totals.reps} accent="text-indigo-600"
          onClick={() => setFilter('staffKind', 'rep')} on={f.staffKind === 'rep'} />
        <Stat label={t('سائقون', 'Drivers')} value={totals.drivers ?? 0} accent="text-sky-600"
          onClick={() => setFilter('staffKind', 'driver')} on={f.staffKind === 'driver'} />
        <Stat label={t('إداريون وفنيون', 'Admin & technical')} value={totals.admins} accent="text-teal-600"
          onClick={() => setFilter('staffKind', 'admin')} on={f.staffKind === 'admin'} />
        <Stat label={t('بلا وظيفة مكتوبة', 'No job title')} value={totals.unknownKind ?? 0} accent="text-rose-600"
          onClick={() => setFilter('staffKind', 'unknown')} on={f.staffKind === 'unknown'} />
      </div>
      {/* The base is written explicitly, not guessed: figures after the total and its split are about reps only. */}
      <p className="-mt-1 text-[11.5px] text-slate-500">
        {t(`البطاقات التالية محسوبةٌ على المناديب (${totals.reps}) — لا تشمل ${totals.admins} إداريًّا وفنيًّا ومشرفًا ولا ${totals.drivers ?? 0} سائقًا ولا ${totals.unknownKind ?? 0} بلا وظيفةٍ مكتوبة، فليست لهم مركبةٌ ولا كارت تشغيل. وضغطُ أيٍّ منها يفلتر على المناديب أيضًا.`,
           `The cards below are computed on reps (${totals.reps}) — excluding ${totals.admins} admin/technical, ${totals.drivers ?? 0} drivers and ${totals.unknownKind ?? 0} with no job title, who have no vehicle or operating card. Pressing one also filters to reps.`)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat label={t('على رأس العمل', 'Working')} value={totals.working} accent="text-emerald-600"
          onClick={() => repFilter('status', 'يعمل')} on={f.status === 'يعمل'} />
        <Stat label={t('لهم مركبة', 'With a vehicle')} value={totals.withVehicle} accent="text-slate-900"
          onClick={() => repFilter('hasVehicle', 'yes')} on={f.hasVehicle === 'yes'} />
        <Stat label={t('بلا مركبة', 'No vehicle')} value={totals.withoutVehicle} accent="text-amber-600"
          onClick={() => repFilter('hasVehicle', 'no')} on={f.hasVehicle === 'no'} />
        <Stat label={t('في إجازة', 'On leave')} value={totals.onLeave} accent="text-sky-600"
          onClick={() => repFilter('status', 'إجازة')} on={f.status === 'إجازة'} />
        {/* Ended service is not a card: ended staff are not counted in department figures. Their rows stay in the table for review; counting them belongs to the HR dashboard. */}
        {/* Who has an HR file versus who the department owns: a difference people ask about. */}
        <Stat label={t('لهم ملفّ في الموارد البشرية', 'Have an HR file')} value={totals.hrLinked} accent="text-slate-900" />
        <Stat label={t('بلا ملفّ (القسم يملكهم)', 'Owned by the section')} value={totals.ownedHere} accent="text-violet-600" />
        <Stat label={t('لهم سكن', 'Housed')} value={totals.housed} accent="text-slate-900"
          onClick={() => repFilter('housing', '')} />
        <Stat label={t('بلا سكن', 'Unhoused')} value={totals.unhoused} accent="text-amber-600"
          onClick={() => repFilter('housing', 'none')} on={f.housing === 'none'} />
      </div>

      {/* Contract type and vehicle documents: fixed cards. How many are sponsored and how many freelance is the first question on opening, and answering it needed opening the filter list and picking each. Like other cards, they are computed after filtering. Also the operating-card and inspection card: the documents sit on the vehicle but the rider is the one stopped in the morning, so the expired count is read here. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat label={t('على الكفالة', 'On sponsorship')} value={totals.sponsored} accent="text-slate-900"
          onClick={() => repFilter('contractKind', 'sponsored')} on={f.contractKind === 'sponsored'} />
        <Stat label={t('فري لانسر', 'Freelance')} value={totals.freelance} accent="text-violet-600"
          onClick={() => repFilter('contractKind', 'freelance')} on={f.contractKind === 'freelance'} />
        <Stat label={t('كارت تشغيل منتهي/حرج', 'Operating card expired/critical')} value={totals.cardGap} accent="text-red-600"
          onClick={() => repFilter('doc', 'card-gap')} on={f.doc === 'card-gap'} />
        <Stat label={t('كارت تشغيل قريب', 'Operating card due soon')} value={totals.cardSoon} accent="text-amber-600"
          onClick={() => repFilter('doc', 'card-soon')} on={f.doc === 'card-soon'} />
        <Stat label={t('فحص منتهي/حرج', 'Inspection expired/critical')} value={totals.inspectionGap} accent="text-red-600"
          onClick={() => repFilter('doc', 'inspection-gap')} on={f.doc === 'inspection-gap'} />
        <Stat label={t('فحص قريب', 'Inspection due soon')} value={totals.inspectionSoon} accent="text-amber-600"
          onClick={() => repFilter('doc', 'inspection-soon')} on={f.doc === 'inspection-soon'} />
        {/* A rider with no inspection supervisor appears to nobody on the duty-check screen; tracked until it reaches zero. */}
        <Stat label={t('بلا مشرف تفقد', 'No duty supervisor')} value={totals.noDutySupervisor} accent="text-red-600"
          onClick={() => repFilter('dutySupervisor', 'none')} on={f.dutySupervisor === 'none'} />
      </div>

      {/* Active filters written out. Whoever arrived from a dashboard number sees why the list is shorter, and each filter clears in one click. A hidden filter makes the table read as incomplete. */}
      {Object.entries(f).some(([, v]) => v) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#f37121]/30 bg-[#f37121]/5 px-3 py-2.5">
          <span className="text-[12px] font-bold text-slate-700">{t('الفلاتر الشغّالة:', 'Active filters:')}</span>
          {Object.entries(f).filter(([, v]) => v).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setF((p) => ({ ...p, [k]: '' }))}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[12px] font-semibold text-slate-700 hover:border-red-300 hover:text-red-600">
              <span className="text-slate-400 font-normal">{(ar ? CHIP_KEY_AR : CHIP_KEY_EN)[k] || k}:</span>
              {chipValue(k, v)} <X className="w-3 h-3 text-slate-400" />
            </button>
          ))}
          <button type="button" onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-[12px] font-bold">
            <RotateCcw className="w-3.5 h-3.5" /> {t('مسح الكل', 'Clear all')}
          </button>
        </div>
      )}

      {/* Filters. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap gap-2.5 items-center">
        <div className="flex-1 min-w-[230px]">
          <SearchInput value={q} onChange={setQ}
            placeholder={t('اسم · هوية · لوحة · مشرف · مشروع · سجل…', 'name, ID, plate, supervisor, project, register…')} />
        </div>
        <Filter value={f.project || ''} onChange={(v) => setF((p) => ({ ...p, project: v }))} label={t('كل المشاريع', 'All projects')} list={options.project} />
        <Filter value={f.city || ''} onChange={(v) => setF((p) => ({ ...p, city: v }))} label={t('كل الفروع', 'All branches')} list={options.city} />
        <Filter value={f.jobTitle || ''} onChange={(v) => setF((p) => ({ ...p, jobTitle: v }))} label={t('كل الوظائف', 'All jobs')} list={options.jobTitle} />
        <Filter value={f.contractType || ''} onChange={(v) => setF((p) => ({ ...p, contractType: v }))} label={t('كل أنواع التعاقد', 'All contracts')} list={options.contractType} />
        <Filter value={f.register || ''} onChange={(v) => setF((p) => ({ ...p, register: v }))} label={t('كل السجلات', 'All registers')} list={options.register} />
        <Filter value={f.vehicleType || ''} onChange={(v) => setF((p) => ({ ...p, vehicleType: v }))} label={t('كل أنواع المركبات', 'All vehicle types')} list={options.vehicleType} />
        {/* Supervisor filter by account, not by name. The supervisor is now a system account, so the filter uses its id and rows do not split over two spellings. A name written in the register with no account yet stays at the end of the list so its row does not vanish from a screen where it was visible. */}
        {/* Inspection supervisor: who stands over the rider in the morning; splits the duty-check screen. */}
        <select value={f.dutySupervisor || ''} onChange={(e) => setF((p) => ({ ...p, dutySupervisor: e.target.value }))}
          aria-label={t('كل مشرفي التفقد', 'All duty supervisors')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل مشرفي التفقد', 'All duty supervisors')}</option>
          <option value="none">{t('— بلا مشرف تفقد —', '— no duty supervisor —')}</option>
          {options.supervisor.map((s2) => (
            <option key={s2._id} value={s2._id}>{s2.name} — {s2.roleAr}</option>
          ))}
        </select>
        <select value={f.supervisor || ''} onChange={(e) => setF((p) => ({ ...p, supervisor: e.target.value }))}
          aria-label={t('كل المشرفين التشغيليين', 'All ops supervisors')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل المشرفين التشغيليين', 'All ops supervisors')}</option>
          <option value="none">{t('— بلا مشرف —', '— no supervisor —')}</option>
          {options.supervisor.map((s) => (
            <option key={s._id} value={s._id}>{s.name} — {s.roleAr}</option>
          ))}
          {(options.supervisorsUnlinked || []).length > 0 && (
            <optgroup label={t('أسماءٌ بلا حساب', 'Names without an account')}>
              {(options.supervisorsUnlinked || []).map((n) => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          )}
        </select>
        {/* Status list is built from all rows, not from the reps aggregate: the aggregate is now reps-only, so a status held only by an administrative row would drop out and be unfilterable. */}
        <Filter value={f.status || ''} onChange={(v) => setF((p) => ({ ...p, status: v }))} label={t('كل الحالات', 'All statuses')}
          list={[...new Set(rows.map((r) => String(r.workStatusShown || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'))} />
        <select value={f.housing || ''} onChange={(e) => setF((p) => ({ ...p, housing: e.target.value }))} aria-label={t('السكن', 'Housing')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل السكن', 'All housing')}</option>
          <option value="none">{t('بلا سكن', 'Unhoused')}</option>
          {options.housing.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
        </select>
        {/* By dates: hire date from/to; the upper bound includes the day itself. */}
        <input type="date" value={f.hiredFrom || ''} onChange={(e) => setF((p) => ({ ...p, hiredFrom: e.target.value }))}
          aria-label={t('التعيين من', 'Hired from')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800 [color-scheme:light]" />
        <input type="date" value={f.hiredTo || ''} onChange={(e) => setF((p) => ({ ...p, hiredTo: e.target.value }))}
          aria-label={t('التعيين إلى', 'Hired to')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800 [color-scheme:light]" />
        {(activeCount > 0) && (
          <button type="button" onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            <RotateCcw className="w-4 h-4" /> {t('مسح الفلاتر', 'Clear')}
          </button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="text-xs text-slate-500 tabular-nums">{t(`${shown.length} من ${serverTotal}`, `${shown.length} of ${serverTotal}`)}</span>
        {/* Ended staff are rows to review, not numbers to count, so say how many are in the table, to avoid misreading the gap between the total and the row count. */}
        {f.status !== 'إنهاء خدمة' && shown.some((r) => r.workStatusShown === 'إنهاء خدمة') && (
          <span className="text-xs text-slate-400 tabular-nums">
            {t(`منهم ${shown.filter((r) => r.workStatusShown === 'إنهاء خدمة').length} منتهي الخدمة — لا يُعَدّون في الكروت`,
               `${shown.filter((r) => r.workStatusShown === 'إنهاء خدمة').length} of them ended — not counted in the cards`)}
          </span>
        )}
      </div>

      {/* Marked-rows bar: their count, how many are outside the current filter, and the assign button. */}
      {canEdit && picked.size > 0 && (
        <div className="rounded-xl border-2 border-[#f37121]/40 bg-orange-50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">
              {t(`${picked.size} موظفًا محدَّدًا`, `${picked.size} selected`)}
            </span>
            {(() => {
              const off = [...picked.keys()].filter((id) => !shown.some((e) => e._id === id)).length;
              return off > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-white border border-orange-200 text-[11.5px] font-semibold text-orange-700">
                  {t(`منهم ${off} خارج الفلتر الحالي — محفوظون`, `${off} outside the current filter — kept`)}
                </span>
              ) : null;
            })()}
            <span className="flex-1" />
            <button type="button" onClick={() => setAssigning(true)}
              className="px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-bold hover:bg-[#e06010]">
              {t('إسناد مشرف', 'Assign supervisor')}
            </button>
            <button type="button" onClick={() => setPicked(new Map())}
              className="text-xs font-semibold text-red-600 hover:text-red-700">{t('إلغاء التحديد', 'Clear')}</button>
          </div>
        </div>
      )}

      {/* Assignment dialog: either or both. A field left empty is untouched, so whoever distributes the inspection does not drop operational supervision by omitting it. */}
      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setAssigning(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 space-y-3" onClick={(ev) => ev.stopPropagation()}>
            <p className="text-sm font-bold text-slate-900">
              {t(`إسناد مشرف لـ${picked.size} موظفًا`, `Assign a supervisor to ${picked.size} employees`)}
            </p>
            <Field label={t('المشرف التشغيلي', 'Ops supervisor')}>
              <Select value={assignOps} onChange={(ev: any) => setAssignOps(ev.target.value)}>
                <option value="">{t('— لا تغيير —', '— leave as is —')}</option>
                <option value="none">{t('— رفع الإشراف التشغيلي —', '— clear it —')}</option>
                {options.supervisor.map((s2) => <option key={s2._id} value={s2._id}>{s2.name} — {s2.roleAr}</option>)}
              </Select>
            </Field>
            <Field label={t('مشرف التفقد', 'Duty supervisor')}>
              <Select value={assignDuty} onChange={(ev: any) => setAssignDuty(ev.target.value)}>
                <option value="">{t('— لا تغيير —', '— leave as is —')}</option>
                <option value="none">{t('— رفع مشرف التفقد —', '— clear it —')}</option>
                {options.supervisor.map((s2) => <option key={s2._id} value={s2._id}>{s2.name} — {s2.roleAr}</option>)}
              </Select>
            </Field>
            <p className="text-[11.5px] text-slate-500">
              {t('ما يُترك على «لا تغيير» لا يُمَسّ. ومشرف التفقد هو الذي يرى هؤلاء في شاشة تفقّد بداية الدوام.',
                 'Anything left on “leave as is” is untouched. The duty supervisor is who sees these riders in the duty check.')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAssigning(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600">{t('إلغاء', 'Cancel')}</button>
              <button type="button" onClick={runAssign} disabled={assignBusy || (!assignOps && !assignDuty)}
                className="px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-bold disabled:opacity-40">
                {assignBusy ? t('يُسند…', 'Assigning…') : t('إسناد', 'Assign')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {canEdit && (
                  <th className={`${LEAD} bg-slate-900 px-3 py-2.5 text-start font-semibold whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                        checked={shown.length > 0 && shown.every((e) => picked.has(e._id))}
                        onChange={(ev) => setPicked((prev) => {
                          const n = new Map(prev);
                          shown.forEach((e) => { if (ev.target.checked) n.set(e._id, e); else n.delete(e._id); });
                          return n;
                        })}
                        aria-label={t('تحديد كل المعروض', 'Select everything shown')} />
                      {t('إجراءات', 'Actions')}
                    </span>
                  </th>
                )}
                {LT_COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">{ar ? c.ar : c.en}{cf.header(c.key, rows, c.get, ar)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={LT_COLUMNS.length + (canEdit ? 1 : 0)} className="px-4 py-12 text-center">
                  <p className="text-slate-800 font-semibold">{t('لا نتائج', 'No results')}</p>
                  {(activeCount > 0 || cf.count > 0) && (
                    // Never show 'no results' without naming what hides them: the filter stays visible so an empty list is not read as a fault.
                    <button type="button" onClick={() => { clearFilters(); cf.clear(); }}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold">
                      <RotateCcw className="w-3.5 h-3.5" /> {t(`فيه ${activeCount + cf.count} فلترًا شغّالًا — امسحها`, `${activeCount + cf.count} filters active — clear them`)}
                    </button>
                  )}
                </td></tr>
              ) : shown.map((e) => (
                <tr key={e._id} className="group border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  {canEdit && (
                    <td className={`${LEAD_CELL} px-3 py-2.5 whitespace-nowrap`}>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" className="w-4 h-4 accent-[#f37121] me-1"
                          checked={picked.has(e._id)}
                          onChange={() => setPicked((prev) => {
                            const n = new Map(prev);
                            if (n.has(e._id)) n.delete(e._id); else n.set(e._id, e);
                            return n;
                          })}
                          aria-label={e.name} />
                        <button type="button" onClick={() => setEditing(e)} title={t('تعديل', 'Edit')}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                        {/* Project move from the table itself; only for those who own it. */}
                        {canTransferLT(user as any) && (
                          <button type="button" onClick={() => setTransferring(e)} title={t('نقل المشروع', 'Transfer project')}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100"><ArrowLeftRight className="w-4 h-4" /></button>
                        )}
                        <button type="button" onClick={() => router.push(`/system/b2c/light-transport/${e._id}`)} title={t('الملفّ', 'Profile')}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></button>
                        <button type="button" onClick={() => deactivate(e)} title={t('إخراج من القسم', 'Remove from section')}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-600 hover:bg-slate-100"><UserMinus className="w-4 h-4" /></button>
                      </div>
                    </td>
                  )}
                  {LT_COLUMNS.map((c) => {
                    const v = c.get(e);
                    const cell = c.key === 'workStatus'
                      ? (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${statusCls(v)}`}
                          title={e.statusSource === 'hr' ? t('من ملفّ الموارد البشرية', 'from the HR file') : ''}>
                          {v || '—'}{e.statusSource === 'hr' ? ' ⚑' : ''}
                        </span>
                      )
                      : c.key === 'staffKind'
                        ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${e.staffKind === 'rep' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>{ar ? KIND_AR[e.staffKind || ''] : KIND_EN[e.staffKind || '']}</span>
                        : c.key === 'name'
                          ? (
                            <button type="button" onClick={() => router.push(`/system/b2c/light-transport/${e._id}`)}
                              className="font-semibold text-slate-800 hover:text-[#f37121] text-start">{v || '—'}</button>
                          )
                          // A date alone is not readable.
                          // A bare date does not say whether it is near or past, so its status is written beside it with the vehicles section's own thresholds.
                          : c.key === 'iqamaExp' ? <PersonDocDate ar={ar} date={e.iqamaExpiry} state={e.iqamaState} />
                          : c.key === 'licenseExp' ? <PersonDocDate ar={ar} date={e.licenseExpiry} state={e.licenseState} />
                          : (c.key === 'operatingCardExpiry' || c.key === 'inspectionExpiry')
                            ? <DocCell doc={c.key === 'operatingCardExpiry' ? e.operatingCard : e.inspection} text={v} ar={ar} />
                            : (v || <span className="text-slate-300">—</span>);
                    return (
                      <td key={c.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${c.key === 'plate' ? 'font-mono font-semibold text-slate-900' : c.mono ? 'font-mono text-slate-600' : 'text-slate-700'}`}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(null)}
          title={editing._id ? t('تعديل موظف', 'Edit employee') : t('إضافة موظف', 'Add employee')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t('رقم الهوية', 'ID number')}>
              <TextInput value={editing.idNumber || ''} disabled={!!editing._id}
                onChange={(ev) => setEditing((p) => ({ ...p!, idNumber: ev.target.value }))} />
            </Field>
            <Field label={t('الاسم', 'Name')}>
              <TextInput value={editing.name || ''} onChange={(ev) => setEditing((p) => ({ ...p!, name: ev.target.value }))} />
            </Field>
            {/* Fixed values are managed lists. Set from the department settings and extended in place with the add button. A free field spells one value a thousand ways, so reports show several projects for one. */}
            {/* The project is chosen on add; afterwards it changes only through the project-move action on the rep's page, by whoever owns it. */}
            <Field label={t('المشروع', 'Project')}>
              <ManagedSelect storeLabel type="lt_project" value={editing.projectAr || ''}
                disabled={!!editing._id && !!origProject}
                onChange={(v) => setEditing((p) => ({ ...p!, projectAr: v }))} />
              {!!editing._id && !!origProject && (
                <p className="mt-1 text-[11px] text-slate-500">{t('لتغيير المشروع: «نقل مشروع» من صفحة المندوب', 'To change the project use “Transfer project” on the rep’s page')}</p>
              )}
            </Field>
            <Field label={t('الفرع', 'Branch')}>
              <ManagedSelect storeLabel type="lt_city" value={editing.cityAr || ''}
                onChange={(v) => setEditing((p) => ({ ...p!, cityAr: v }))} />
            </Field>
            <Field label={t('الوظيفة', 'Job title')}>
              <ManagedSelect storeLabel type="lt_job_title" value={editing.jobTitleAr || ''}
                onChange={(v) => setEditing((p) => ({ ...p!, jobTitleAr: v }))} />
            </Field>
            {/* Sponsored / freelancer: for someone with an HR file it is read from the commercial registration number there and not written here. It is written here only for people without an HR file. */}
            <Field label={t('على الكفالة / فري لانسر', 'Sponsored / freelance')}>
              {(editing as any).hrLinked ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {(editing as any).contractTypeShown || t('غير محدد', 'Not set')}
                  <span className="block text-[11px] text-slate-500">{t('من «رقم السجل التجاري» في الموارد البشرية', 'From the commercial register number in HR')}</span>
                </div>
              ) : (
                <ManagedSelect storeLabel type="lt_contract_type" value={editing.contractTypeAr || ''}
                  onChange={(v) => setEditing((p) => ({ ...p!, contractTypeAr: v }))} />
              )}
            </Field>
            <Field label={t('رقم السجل', 'Commercial register')}>
              <ManagedSelect storeLabel type="lt_register" value={editing.registerNumber || ''}
                onChange={(v) => setEditing((p) => ({ ...p!, registerNumber: v }))} />
            </Field>
            <Field label={t('نوع المركبة', 'Vehicle type')}>
              <ManagedSelect storeLabel type="lt_vehicle_type" value={editing.vehicleTypeAr || ''}
                onChange={(v) => setEditing((p) => ({ ...p!, vehicleTypeAr: v }))} />
            </Field>
            {/* Work status: working, on leave, suspended, accident. Written from here and recorded in the employee log; shown in his HR file and on his vehicle in the vehicles section. Suspended is an operational stop owned by this department only. Leave can come from either side: HR leave is read here, not written. Ended staff have no status. */}
            {editing._id && (
              <Field label={t('حالة العمل', 'Work status')}>
                {(editing as any).workStatusShown === 'إنهاء خدمة' ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{t('إنهاء خدمة (الموارد البشرية)', 'Ended (HR)')}</div>
                ) : (
                  <>
                    <Select value={editing.opStatus || ''}
                      onChange={(ev: any) => setEditing((p) => ({ ...p!, opStatus: ev.target.value }))}>
                      {OP_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{ar ? o.ar : o.en}</option>)}
                    </Select>
                    {!!editing.opStatus && (
                      <TextInput className="mt-1.5" value={editing.opStatusNote || ''} placeholder={t('سبب الحالة (اختياري)', 'Reason (optional)')}
                        onChange={(ev) => setEditing((p) => ({ ...p!, opStatusNote: ev.target.value }))} />
                    )}
                    {!editing.opStatus && (editing as any).statusSource === 'hr' && (
                      <p className="mt-1 text-[11px] text-slate-600">{t('في إجازة من الموارد البشرية.', 'On leave in HR.')}</p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">{t('تظهر في ملفه بالموارد البشرية وعلى مركبته — ولا تُنشئ طلب إجازة.', 'Shown on his HR file and on his vehicle — it does not create a leave request.')}</p>
                  </>
                )}
              </Field>
            )}
            {/* Supervisor is an account to pick, not a name to type. The list is the department's supervision accounts (rep supervisor, project manager, sector manager). Whoever is picked here sees this man in the start-of-shift check, so assignment in one place shows on both screens. */}
            <Field label={t('المشرف التشغيلي', 'Ops supervisor')}>
              <Select value={supervisorIdOf(editing) || ''}
                onChange={(ev: any) => setEditing((p) => ({ ...p!, supervisorUser: ev.target.value || null }))}>
                <option value="">{t('— بلا مشرف —', '— none —')}</option>
                {options.supervisor.map((s) => (
                  <option key={s._id} value={s._id}>{s.name} — {s.roleAr}</option>
                ))}
              </Select>
              {!supervisorIdOf(editing) && (editing.supervisorName || '').trim() && (
                <p className="mt-1 text-[11.5px] text-amber-700">
                  {t(`مكتوبٌ في السجلّ: «${editing.supervisorName}» — بلا حساب على النظام.`,
                     `Recorded as "${editing.supervisorName}" with no system account.`)}
                </p>
              )}
            </Field>
            {/* Inspection supervisor differs from the operational one. Operational is responsibility for the whole day; the inspection supervisor stands at the station in the morning and photographs him before he goes out. Only this one splits the start-of-shift check screen. */}
            <Field label={t('مشرف التفقد', 'Duty supervisor')}>
              <Select value={dutySupervisorIdOf(editing) || ''}
                onChange={(ev: any) => setEditing((p) => ({ ...p!, dutySupervisorUser: ev.target.value || null }))}>
                <option value="">{t('— بلا مشرف تفقد —', '— none —')}</option>
                {options.supervisor.map((s2) => (
                  <option key={s2._id} value={s2._id}>{s2.name} — {s2.roleAr}</option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-slate-500">
                {t('هو الذي يراه في «تفقّد بداية الدوام» ويُسأل عن تفقّده.',
                   'He is the one who sees this rider in the duty check and answers for it.')}
              </p>
            </Field>
            <Field label={t('الجنسية', 'Nationality')}>
              <TextInput value={editing.nationalityAr || ''} onChange={(ev) => setEditing((p) => ({ ...p!, nationalityAr: ev.target.value }))} />
            </Field>
            <Field label={t('الجوال', 'Phone')}>
              <TextInput value={editing.phone || ''} onChange={(ev) => setEditing((p) => ({ ...p!, phone: ev.target.value }))} />
            </Field>
            <Field label={t('تاريخ التعيين', 'Hire date')}>
              <input type="date" value={fmtDate(editing.hireDate)} onChange={(ev) => setEditing((p) => ({ ...p!, hireDate: ev.target.value }))}
                aria-label={t('تاريخ التعيين', 'Hire date')}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
            </Field>
            {!editing._id && (
              <Field label={t('تاريخ الميلاد', 'Date of birth')}>
                <input type="date" value={String((editing as any).dateOfBirth || '')} onChange={(ev) => setEditing((p) => ({ ...p!, dateOfBirth: ev.target.value } as any))}
                  aria-label={t('تاريخ الميلاد', 'Date of birth')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
              </Field>
            )}
            <Field label={t('السكن', 'Housing')}>
              <Select value={(editing.housing as any)?._id || (editing as any).housing || ''}
                onChange={(ev: any) => setEditing((p) => ({ ...p!, housing: ev.target.value } as any))}>
                <option value="">{t('— بلا سكن —', '— none —')}</option>
                {options.housing.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
              </Select>
            </Field>
            <Field label={t('الغرفة', 'Room')}>
              <TextInput value={editing.housingRoom || ''} onChange={(ev) => setEditing((p) => ({ ...p!, housingRoom: ev.target.value }))} />
            </Field>
            <div className="md:col-span-2">
              <Field label={t('ملاحظات', 'Notes')}>
                <TextInput value={editing.notesAr || ''} onChange={(ev) => setEditing((p) => ({ ...p!, notesAr: ev.target.value }))} />
              </Field>
            </div>
            {!editing._id && (
              <div className="md:col-span-2 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-bold text-slate-800">{t('مستندات الموظف', 'Employee documents')}</p>
                  <button type="button" onClick={() => setDocs((p) => [...p, { id: Date.now() + Math.random(), title: '', file: null }])}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-200">
                    <Plus className="w-3.5 h-3.5" /> {t('إضافة مستند', 'Add document')}
                  </button>
                </div>
                <p className="mt-0.5 text-[11.5px] text-slate-500">{t('تُحفَظ في ملفّه بالموارد البشريّة (صورة الإقامة، الجواز، العقد…). اختياريّة، وقد تتعدّد.', 'Saved to his HR file (iqama, passport, contract…). Optional; add as many as needed.')}</p>
                {docs.map((x) => (
                  <div key={x.id} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                    <TextInput value={x.title} placeholder={t('اسم المستند — مثل: صورة الإقامة', 'Document name — e.g. Iqama copy')}
                      onChange={(ev) => setDocs((p) => p.map((y) => (y.id === x.id ? { ...y, title: ev.target.value } : y)))} />
                    <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                      onChange={(ev) => { const file = ev.target.files?.[0] || null; setDocs((p) => p.map((y) => (y.id === x.id ? { ...y, file, title: y.title || (file ? file.name.replace(/\.[^.]+$/, '') : '') } : y))); }}
                      className="text-[12.5px] text-slate-600 file:me-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold" />
                    <button type="button" onClick={() => setDocs((p) => p.filter((y) => y.id !== x.id))} title={t('إزالة', 'Remove')} className="justify-self-end p-1 text-slate-300 hover:text-red-600"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            {!editing._id && (
              <p className="md:col-span-2 text-[11.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {t('عند الحفظ يُنشأ ملفُّه في الموارد البشريّة (قسم B2C) إن لم يكن له ملفّ، وتُكمل الموارد البشريّة بقيّةَ بياناته.',
                   'On save his HR file is created (department B2C) if he has none; HR completes the rest.')}
              </p>
            )}
            {/* The vehicle is assigned by an operating order, not from here: assignment is an act with history and a transferable authorization, not a field to type. */}
            <p className="md:col-span-2 text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {t('المركبة والمشرف والسكن تُسنَد أيضًا بأمر تشغيل — فيُقيَّد التاريخ ويُنقَل التفويض في سجلّ المركبات.',
                 'Vehicle, supervisor and housing are also assigned by an operating order, which records the move and transfers authorisation in the vehicle registry.')}
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={save} disabled={saving}>{t('حفظ', 'Save')}</PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A new document in the add form: its name and its file. */
type NewDoc = { id: number; title: string; file: File | null };
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('read')); r.readAsDataURL(file);
});

/** Phone photos are several MB each; a document stays readable at 2000px JPEG. Non-images go as they are. */
const uploadDataUrl = async (file: File): Promise<string> => {
  if (!/^image\/(jpeg|png|webp|heic)/i.test(file.type) || file.size < 600 * 1024) return readAsDataUrl(file);
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', 0.82);
    return out.length < file.size * 1.37 ? out : readAsDataUrl(file);
  } catch { return readAsDataUrl(file); }
};

/**
 * Document date cell: the date and its status.
 * File-level component, not inside the render body, since a component defined in render is rebuilt whenever state changes. See the inline components rule.
 */
function DocCell({ doc, text, ar }: { doc?: LTDoc; text: string; ar: boolean }) {
  if (!doc || doc.state === 'missing' || !text) {
    return <span className="text-slate-300">—</span>;
  }
  const label = ar ? DOC_AR[doc.state] : DOC_EN[doc.state];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-mono text-slate-700">{text}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold ${DOC_CLS[doc.state] || ''}`}
        title={doc.days != null ? (ar ? `${doc.days} يومًا` : `${doc.days} days`) : ''}>
        {label}
      </span>
    </span>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><LightTransportEmployeesInner /></Suspense>;
}
