'use client';
/**
 * موظّفو النقل الخفيف — سجلُّ القسم.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كان القسمُ يُدار من شيتَي إكسل: واحدٌ للموظّفين وآخرُ للمركبات وتفاويضها،
 * يُرسَلان بالبريد ويُنسخان ويُعدَّلان في أكثرَ من نسخة. والسؤالُ البسيط — «كم
 * مندوبًا في مشروع كيتا بجدة؟» — جوابُه فرزٌ يدويّ، و«مَن على كفالة السجلّ
 * الفلانيّ؟» لا جوابَ له إلّا بالعدّ.
 *
 * وكانت الصفحةُ التي هنا («مناديب المبيعات») تعرض مناديبَ تقارير الطلبات وحدَهم
 * — أي جزءًا من القسم — فلا يظهر فيها مشرفٌ ولا ميكانيكيٌّ ولا عاملُ نظافة،
 * وهم أحدَ عشرَ من مئةٍ وواحدٍ وستّين.
 *
 * فالسجلُّ هنا كلُّ من يعمل في النقل الخفيف، بكلّ ما يُسأل عنه: مشروعُه وفرعُه
 * ومشرفُه ومركبتُه وسجلُّ كفالته وسكنُه. والإنسانُ نفسُه في الموارد البشريّة
 * والمركبةُ في سجلّ المركبات — راجع تعليقَ backend/models/LightTransport.
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

/** أسماءُ مفاتيح الفلترة في شرائح «الفلاتر الشغّالة». */
const CHIP_KEY_AR: Record<string, string> = {
  project: 'المشروع', city: 'الفرع', jobTitle: 'الوظيفة', contractType: 'نوع التعاقد', register: 'السجل',
  vehicleType: 'نوع المركبة', supervisor: 'المشرف', dutySupervisor: 'مشرف التفقد', staffKind: 'النوع',
  status: 'الحالة', housing: 'السكن', hasVehicle: 'المركبة', hiredFrom: 'التعيين من', hiredTo: 'التعيين إلى',
  contractKind: 'العقد', doc: 'الوثيقة', inService: 'الخدمة',
  // من فلاتر لوحة القسم (٢٠٢٦/١٠/٢١).
  rep: 'المندوب', vehicle: 'المركبة', auth: 'التفويض', cr: 'السجل التجاري', engagement: 'الارتباط', category: 'الفئة',
};
const CHIP_KEY_EN: Record<string, string> = {
  project: 'Project', city: 'Branch', jobTitle: 'Job', contractType: 'Contract', register: 'Register',
  vehicleType: 'Vehicle type', supervisor: 'Supervisor', dutySupervisor: 'Duty supervisor', staffKind: 'Kind',
  status: 'Status', housing: 'Housing', hasVehicle: 'Vehicle', hiredFrom: 'Hired from', hiredTo: 'Hired to',
  contractKind: 'Contract', doc: 'Document', inService: 'Service',
  rep: 'Rep', vehicle: 'Vehicle', auth: 'Authorisation', cr: 'Register', engagement: 'Engagement', category: 'Category',
};
/** قيمُ فلاتر اللوحة بأسمائها — المفاتيحُ هي ما يرسله الخادم (utils/b2cBoard). */
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

/**
 * ── الكارتُ وقائمةُ الفلتر خارجَ جسم الصفحة ─────────────────────────────────
 * كانا يُعرَّفان داخل الصفحة فيصيران مكوِّنًا جديدًا في كلّ رسمة: تُهدَم الكروتُ
 * وتُبنى مع كلّ ضغطةٍ وكلّ ردّ، وتُغلَق القائمةُ المفتوحةُ تحت يد المستخدم إن وصل
 * تحديثٌ من السوكِت. راجع ذاكرة «inline components remount».
 */
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

/** قائمةُ اختيارٍ واحدةُ الشكل — قيمُها من السجلّ نفسِه. */
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
  // إجماليُّ الخادم يبقى معروضًا في «س من ص» ليُعرَف أنّ المعروضَ جزءٌ منه.
  const [serverTotal, setServerTotal] = useState(0);
  const [options, setOptions] = useState<LTOptions>({ project: [], city: [], jobTitle: [], contractType: [], register: [], vehicleType: [], supervisor: [], supervisorsUnlinked: [], housing: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<LTEmployee> | null>(null);
  const [managersOpen, setManagersOpen] = useState(false);
  const [transferring, setTransferring] = useState<LTEmployee | null>(null);
  // مشروعُ الصفّ قبل التعديل — لا يتغيّر من النموذج (راجع «نقل مشروع»).
  const origProject = editing?._id ? String(rows.find((r) => r._id === editing._id)?.projectAr || '') : '';
  // ── إضافةُ موظّفٍ تُنشئ ملفَّه في الموارد البشريّة ─────────────────────────
  // فهي لمدير القطاع ونائبه ومدير النظام وأهل المال — يطابق حارسَ المسار في
  // routes/lightTransport. ومعها مستنداتُه: اسمٌ لكلّ ملفّ، وقد تتعدّد.
  // role-only: إنشاءُ ملفٍّ في الموارد البشريّة لا يُفتَح بمنح القسم؛ الخادمُ يحرسه بـ`authorize.strict`.
  const canAdd = ['super_admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'].includes(String(user?.role || ''));
  const [docs, setDocs] = useState<NewDoc[]>([]);
  const [saving, setSaving] = useState(false);

  // ── الفلاتر ───────────────────────────────────────────────────────────────
  // كلُّها في الخادم: الجدولُ مئةٌ وواحدٌ وستّون صفًّا اليوم وسيكبر، والأعدادُ في
  // الكاردات تُحسَب على ما بعد الفلترة — فما يُقرأ في الكارد هو ما في الجدول.
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  /**
   * ── والفلترُ يُورَث من اللوحة ───────────────────────────────────────────
   * «أعرف أنّهم تسعة — أريد التسعةَ أنفسَهم»: زرُّ اللوحة ينقل فلترَه في الرابط،
   * فتُفتَح القائمةُ على الجواب نفسِه لا على كلّ القسم. ويُقرأ مرّةً عند الفتح
   * ثمّ تُمسك الشاشةُ حالتَها — وإلّا أعاد الرابطُ كتابةَ ما يغيّره المستخدم.
   */
  const sp = useSearchParams();
  const [f, setF] = useState<Record<string, string>>(() => {
    const keys = ['project', 'city', 'jobTitle', 'contractType', 'register', 'vehicleType',
      'supervisor', 'dutySupervisor', 'staffKind', 'status', 'housing', 'hasVehicle', 'hiredFrom', 'hiredTo',
      // مشتقّان يُحسَبان على الصفوف لا على القاعدة — راجع `LOCAL_KEYS`.
      'contractKind', 'doc',
      // من أرقام «إجمالي المناديب» في اللوحة: في الخدمة وحدَهم — راجع `listEmployees`.
      'inService',
      // ومن فلاتر اللوحة وكروتها (٢٠٢٦/١٠/٢١): تُطبَّق في الخادم بمعناها في اللوحة.
      'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'];
    const init: Record<string, string> = {};
    for (const k of keys) { const v = sp?.get(k); if (v) init[k] = v; }
    return init;
  });
  const setFilter = (k: string, v: string) => setF((p) => ({ ...p, [k]: p[k] === v ? '' : v }));
  /**
   * ── وبطاقةُ المناديب تفلتر على المناديب معها ───────────────────────────────
   * أرقامُ البطاقات كلِّها — خلا الإجمال وقسمتَه — محسوبةٌ على المناديب وحدَهم
   * (راجع `ltTotalsOf`). فلو فلترت الشرطَ وحدَه لعرض الجدولُ إداريًّا لا يُعَدُّ
   * في الرقم فوقه: رقمٌ وجدولٌ يقولان شيئين. فالشرطُ والنوعُ يُضبَطان معًا.
   */
  const repFilter = (k: string, v: string) => setF((p) => (
    p[k] === v ? { ...p, [k]: '', staffKind: '' } : { ...p, [k]: v, staffKind: 'rep' }
  ));
  const clearFilters = () => { setF({}); setQ(''); setDq(''); };
  const activeCount = Object.values(f).filter(Boolean).length + (dq ? 1 : 0);

  useEffect(() => { const h = setTimeout(() => setDq(q), 350); return () => clearTimeout(h); }, [q]);

  // كلُّ نداءٍ مفلترٍ يحتاج حارسَه: النداءُ غيرُ المفلتر أبطأُ فيصل آخرًا ويكتب
  // إجماليَّه فوق المفلتر — راجع hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    // الأبطأُ يصل آخرًا: نداءٌ بلا فلترٍ يُطلَب أوّلًا ويردّ بعد المفلتر فيكتب
    // إجماليَّه فوقه. فتُقرأ الردودُ بترتيب طلبها لا بترتيب وصولها.
    const token = guard.begin();
    try {
      // مفاتيحُ الكروت لا تُرسَل (`LOCAL_KEYS`): تُطبَّق هنا بمعنى الخادم نفسِه
      // (`ltPasses`)، لتُعَدّ كلُّ مجموعةٍ بلا فلترها — راجع `ltFacetedTotals`.
      const d = await getLTEmployees({ ...serverFilters(f), q: dq });
      if (!guard.isCurrent(token)) return;
      setRows(d.employees || []);
      setServerTotal(d.totals?.total || (d.employees || []).length);
      setOptions(d.options || options);
    } catch (e: any) {
      if (guard.isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (guard.isCurrent(token)) setLoading(false);
    // ضغطُ كارتٍ لا يطلب من الخادم شيئًا: مفاتيحُ الكروت محلّيّة، فيتبدّل الجدولُ
    // في مكانه بلا ردٍّ ينتظره ولا رسمةٍ وسيطة.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(serverFilters(f)), dq, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));
  // وما يمسّ ملفَّ الموارد البشريّة يمسّ الحالةَ المعروضةَ هنا.
  useSocket('hr:employee', useCallback(() => load(), [load]));

  /**
   * ── فلاترُ الكروت تُحسَب هنا لا في القاعدة ──────────────────────────────────
   *
   * «على الكفالة / فري لانسر» و«كارتٌ منتهي» مشتقّان، وبقيّةُ الكروت (النوع،
   * الحالة، المركبة، السكن، مشرف التفقّد) تُعَدّ كلُّ مجموعةٍ منها بلا فلترها —
   * وذلك يحتاج الصفوفَ قبل فلتر الكارت. فتُطبَّق كلُّها بـ`ltPasses`، بالمعنى
   * الذي يطبّقها به الخادم، فيقرأ الكارتُ والجدولُ الشيءَ نفسَه.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const localFiltered = useMemo(() => rows.filter((r) => ltPasses(r, f)), [rows, JSON.stringify(f)]);

  /**
   * ── والإسنادُ يقع على مجموعة ──────────────────────────────────────────────
   * توزيعُ الإشراف يقع على محطّةٍ أو مشروعٍ لا على رجلٍ رجل، وصفًّا صفًّا يعني
   * فتحَ نافذةٍ مئةً وسبعًا وأربعين مرّة. فتُعلَّم صفوفٌ ويُسنَد لها دفعةً —
   * والتعليمُ يعبر الفلترَ والبحثَ لأنّه يحفظ الصفَّ لا معرِّفَه وحدَه.
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
  // والأعدادُ تتبع فلترَ العمود كما تتبع الشرائح — لكنّ كلَّ مجموعةِ كروتٍ تُعَدّ
  // بلا فلترها هي، فلا يتحرّك الرقمُ المضغوطُ ولا جيرانُه. راجع `ltFacetedTotals`.
  const colFiltered = cf.apply(rows, getters);
  const totals = ltFacetedTotals(colFiltered, f);

  const exportColumns: ExportColumn[] = LT_COLUMNS.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key, width: c.width || 16,
    transform: (_: any, r: any) => c.get(r),
  }));
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
      // الاسمُ لقطةٌ يكتبها الخادمُ من الحساب — ولا يُرسَل كي لا يفترق عنه.
      delete body.supervisorName;
      body.supervisorUser = supervisorIdOf(editing) || '';
      delete body.dutySupervisorName;
      body.dutySupervisorUser = dutySupervisorIdOf(editing) || '';
      if (editing._id) await updateLTEmployee(editing._id, body);
      else {
        const ready = docs.filter((x) => x.file);
        if (ready.some((x) => !x.title.trim())) { notify(t('اكتب اسمَ كلّ مستندٍ مرفق', 'Name every attached document'), 'error'); setSaving(false); return; }
        body.files = await Promise.all(ready.map(async (x) => ({ title: x.title.trim(), fileName: x.file!.name, dataUrl: await readAsDataUrl(x.file!) })));
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

  /** قيمةُ الفلتر كما تُقرأ: لا معرِّفَ مشرفٍ ولا مفتاحَ إنجليزيٍّ في الشريحة. */
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
        {/* مَن يرى أيَّ مشروعٍ في «مدخلات الأوردرات» — يُسنَد هنا لكلّ مشرفٍ ومديرِ مشروع. */}
        <button type="button" onClick={() => setManagersOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#f37121]">
          {t('مشاريع المشرفين', 'Supervisors’ projects')}
        </button>
        {canAdd && <PrimaryButton onClick={() => { setDocs([]); setEditing({}); }}><Plus className="w-4 h-4" /> {t('إضافة موظف', 'Add employee')}</PrimaryButton>}
      </PageHeader>

      {/* ── الكاردات تُفلتِر، لا تُخبِر وحدَها ──────────────────────────────────
          «أريد أن أعرف كم على الكفالة، ثمّ مَن هم» — فكلُّ رقمٍ هنا يُضغَط
          فيُفلتَر الجدولُ عليه، وتُعاد الأعدادُ محسوبةً على ما بقي. */}
      {/* ── الإجمالُ وقسمتُه: الصفُّ الوحيدُ عن القسم كلِّه ───────────────────── */}
      {/* ── و«بلا وظيفة» عددٌ قائمٌ بذاته ───────────────────────────────────
          كان النوعان «مندوب» و«إداريّ» فقط، والثاني فرعَ الباقي: فصار من لا
          وظيفةَ مكتوبةً له إداريًّا. قالت البطاقةُ «إداريّون وفنيّون: ٣٨»
          وفيهم تسعةَ عشرَ بلا وظيفة — والإداريّون ستّة، ومعهم خمسةُ مشرفين
          وثلاثةُ ميكانيكيّين وثلاثةُ سائقين وعاملا نظافة.
          «لا أعرف» ليست تصنيفًا: تُعرَض عددًا يُملأ، لا رقمًا يتضخّم داخل
          غيره. وضغطُها يفتحهم بأسمائهم. */}
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
      {/* والأساسُ يُكتب، لا يُخمَّن: ما بعد الإجمال وقسمتِه عن المناديب وحدَهم. */}
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
        {/* «أُنهيت خدمتهم» ليس كارتًا هنا: المنتهي لا يُعَدّ في أرقام القسم — يبقى
            صفُّه في الجدول ليُراجَع، ومكانُ عدِّه لوحةُ الموارد البشريّة. */}
        {/* ومن له ملفٌّ في الموارد البشريّة ومن يملكه القسم — فرقٌ يُسأل عنه. */}
        <Stat label={t('لهم ملفّ في الموارد البشرية', 'Have an HR file')} value={totals.hrLinked} accent="text-slate-900" />
        <Stat label={t('بلا ملفّ (القسم يملكهم)', 'Owned by the section')} value={totals.ownedHere} accent="text-violet-600" />
        <Stat label={t('لهم سكن', 'Housed')} value={totals.housed} accent="text-slate-900"
          onClick={() => repFilter('housing', '')} />
        <Stat label={t('بلا سكن', 'Unhoused')} value={totals.unhoused} accent="text-amber-600"
          onClick={() => repFilter('housing', 'none')} on={f.housing === 'none'} />
      </div>

      {/* ── نوعُ التعاقد ووثيقتا المركبة: كاردات ثابتة ────────────────────────
          «كم على الكفالة وكم فري لانسر» يُسأل أوّلَ ما تُفتَح الشاشة، وكان
          جوابُه يحتاج فتحَ قائمةِ الفلترة واختيارَ كلٍّ على حدة. وهما — كسائر
          الكاردات — محسوبان على ما بعد الفلترة: من فلتر على مشروعٍ قرأ كفالةَ
          هذا المشروع وحدَه.

          ومعهما كارتُ التشغيل والفحص: الوثيقتان على المركبة، والموقوفُ صباحًا
          هو الرجل — فعددُ من انتهت وثيقتُه يُقرأ هنا لا في قسمٍ آخر. */}
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
        {/* من لا مشرفَ تفقّدٍ له لا يظهر لأحدٍ في شاشة التفقّد — يُتابَع حتى يصفر. */}
        <Stat label={t('بلا مشرف تفقد', 'No duty supervisor')} value={totals.noDutySupervisor} accent="text-red-600"
          onClick={() => repFilter('dutySupervisor', 'none')} on={f.dutySupervisor === 'none'} />
      </div>

      {/* ── الفلاترُ الشغّالةُ مكتوبةً ──────────────────────────────────────────
          من فُتحت له القائمةُ من رقمٍ في اللوحة يرى لماذا هي أقصر — وكلُّ فلترٍ
          يُرفَع بضغطة. الفلترُ الخفيُّ يجعل الجدولَ يُقرأ ناقصًا. */}
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

      {/* ── الفلاتر ───────────────────────────────────────────────────────── */}
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
        {/* ── وفلترُ المشرف بالحساب لا بالاسم ─────────────────────────────
            المشرفُ صار حسابًا على النظام، فالفلترُ بمعرِّفه — فلا يفترق صفٌّ
            عن صفٍّ لأنّ الاسمَ كُتب بصيغتين. ومن كُتب في السجلّ ولا حسابَ له
            بعد يبقى في آخر القائمة كي لا يختفي صفُّه من شاشةٍ كان يُرى فيها. */}
        {/* مشرفُ التفقّد: مَن يقف على الرجل صباحًا — تُقسَم به شاشةُ التفقّد. */}
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
        {/* قائمةُ الحالات من الصفوف كلِّها لا من تجميع المناديب: التجميعُ صار
            عنهم وحدَهم، فحالةٌ لا يحملها إلّا إداريٌّ تسقط من القائمة فلا تُفلتَر. */}
        <Filter value={f.status || ''} onChange={(v) => setF((p) => ({ ...p, status: v }))} label={t('كل الحالات', 'All statuses')}
          list={[...new Set(rows.map((r) => String(r.workStatusShown || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'))} />
        <select value={f.housing || ''} onChange={(e) => setF((p) => ({ ...p, housing: e.target.value }))} aria-label={t('السكن', 'Housing')}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-800">
          <option value="">{t('كل السكن', 'All housing')}</option>
          <option value="none">{t('بلا سكن', 'Unhoused')}</option>
          {options.housing.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
        </select>
        {/* وبالمواعيد: تاريخُ التعيين من/إلى — والحدُّ الأعلى شاملٌ لليوم نفسِه. */}
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
        {/* المنتهون صفوفٌ تُراجَع لا أرقامٌ تُعَدّ — فيُقال كم منهم في الجدول، كي لا
            يُقرأ فرقُ ما بين «الإجمالي» وعددِ الصفوف خطأً. */}
        {f.status !== 'إنهاء خدمة' && shown.some((r) => r.workStatusShown === 'إنهاء خدمة') && (
          <span className="text-xs text-slate-400 tabular-nums">
            {t(`منهم ${shown.filter((r) => r.workStatusShown === 'إنهاء خدمة').length} منتهي الخدمة — لا يُعَدّون في الكروت`,
               `${shown.filter((r) => r.workStatusShown === 'إنهاء خدمة').length} of them ended — not counted in the cards`)}
          </span>
        )}
      </div>

      {/* شريطُ المعلَّم: عددُه، وكم منه خارجَ الفلتر الحاليّ، وزرُّ الإسناد. */}
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

      {/* ── نافذةُ الإسناد: أحدُهما أو كلاهما ───────────────────────────────
          ما يُترَك فارغًا لا يُمَسّ — فمن يوزّع التفقّد لا يُسقِط الإشرافَ
          التشغيليَّ بسكوته عنه. */}
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
                    // ولا يُقال «لا نتائج» بلا ذكرِ ما يحجب — الفلترُ يبقى فيُقرأ الفراغُ عطلًا.
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
                        {/* «نقل المشروع» من الجدول نفسِه — لمن يملكه وحدَه. */}
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
                          // ── والتاريخُ وحدَه لا يُقرأ ──────────────────────
                          // «١٤ / ١١ / ٢٠٢٦» لا تقول أقريبٌ هو أم مضى؛ فتُكتب
                          // معه حالتُه بعتبات قسم المركبات نفسِها.
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
            {/* ── والقيمُ الثابتةُ قوائمُ مُدارة ────────────────────────────────
                تُضبَط من «إعدادات القسم»، ويُضاف إليها من موضعها بـ«+ إضافة».
                الخانةُ الحرّةُ تكتب الواحدةَ بألف صيغة فتصير في التقارير عدّةَ
                مشاريع وهي مشروعٌ واحد. */}
            {/* والمشروعُ يُختار عند الإضافة؛ وبعدها لا يتغيّر إلّا بـ«نقل مشروع» من صفحة
                المندوب، وممّن يملكه (صاحبُ الشركة، ٢٠٢٦/١٠/١٩). */}
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
            {/* على الكفالة / فري لانسر: لمن له ملفٌّ في الموارد البشريّة يُقرأ من «رقم
                السجل التجاري» هناك ولا يُكتب هنا. ويُكتب هنا لمن لا ملفَّ له وحدَه. */}
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
            {/* ── حالةُ العمل: يعمل · إجازة · موقوف · حادث ──────────────────────
                تُكتب من هنا (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) وتُقيَّد في سجلّ الموظّف،
                وتظهر في ملفّه بالموارد البشريّة وعلى مركبته في قسم المركبات.
                «موقوف» توقّفٌ تشغيليّ من القسم وحدَه. والإجازةُ من أيّ الجهتين:
                إجازةُ الموارد البشريّة تُقرأ هنا ولا تُكتب. والمنتهي لا حالةَ له. */}
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
            {/* ── المشرفُ حسابٌ يُختار، لا اسمٌ يُكتب ──────────────────────
                القائمةُ حساباتُ الإشراف في القسم (مشرف مناديب · مدير مشروع ·
                مدير القطاع). ومن يُختار هنا يرى هذا الرجلَ في تفقّد بداية
                الدوام — فالإسنادُ في موضعٍ واحدٍ يظهر في الشاشتين. */}
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
            {/* ── ومشرفُ التفقّد غيرُ التشغيليّ ────────────────────────────────
                التشغيليُّ مسؤوليّةُ اليوم كلِّه، ومشرفُ التفقّد مَن يقف على
                المحطّة صباحًا فيصوّره قبل أن يخرج — وبه وحدَه تنقسم شاشةُ
                تفقّد بداية الدوام. */}
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
            {/* المركبةُ تُسنَد بأمر تشغيل لا من هنا: الإسنادُ فعلٌ له تاريخٌ
                وتفويضٌ يُنقَل، لا خانةٌ تُكتب. */}
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

/** مستندٌ جديدٌ في استمارة الإضافة: اسمُه وملفُّه. */
type NewDoc = { id: number; title: string; file: File | null };
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('read')); r.readAsDataURL(file);
});

/**
 * خليّةُ تاريخِ وثيقة: التاريخُ وحالتُه.
 *
 * مكوّنٌ على مستوى الملفّ لا داخلَ جسم الرسم — المكوّنُ المعرَّف في الرسم يُبنى
 * من جديدٍ عند كلّ حالةٍ تتغيّر. راجع قاعدةَ «المكوّنات المضمَّنة».
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
