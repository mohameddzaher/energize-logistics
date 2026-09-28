'use client';
/**
 * أوامرُ تشغيل النقل الخفيف.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * «هذا الموظّفُ يعمل على هذه المركبة» كان يُقال في شيتٍ ويُنسى: تُستبدَل الخانةُ
 * فلا يبقى أثرٌ لمن كان عليها قبله ولا متى نزل. وهو أثرٌ يُطلَب عند مخالفةٍ
 * قديمةٍ أو حادثٍ أو خلافٍ على أجرة.
 *
 * فالإسنادُ صار أمرًا يُسجَّل: من، وعلى ماذا، وفي أيّ مشروعٍ وفرعٍ وتحت أيّ
 * مشرفٍ وفي أيّ سكن. أمرٌ واحدٌ سارٍ لكلّ موظّف، وما قبله يُغلَق ولا يُمحى.
 *
 * ── ونقلُ التفويض يُكتب في قسم المركبات ────────────────────────────────────
 * التفويضُ ورقةٌ واحدةٌ للمركبة، وموضعُها سجلُّ المركبات. فلو كُتب هنا وحدَه صار
 * للمركبة مفوَّضان: واحدٌ يقرأه هذا القسمُ وآخرُ يقرأه قسمُ المركبات — وهو غلطٌ
 * يُكتشف عند المرور لا قبله. فالخيارُ هنا يكتب هناك ويُقيَّد في سجلّ المركبة.
 */
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, SearchableSelect } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import ScrollX from '@/components/system/ScrollX';
import { LEAD, LEAD_CELL } from '@/components/vehicles/stickyLead';
import { ClipboardList, Plus, RotateCcw, Square, ExternalLink, ArrowLeftRight } from 'lucide-react';
import {
  getLTOrders, getLTOrderOptions, createLTOrder, endLTOrder, moveLTAuthorization, fmtDate, canEditLT, type LTOrder,
} from '@/lib/lightTransport';

/** ما يُشتقّ في الخادم من ورقة التفويض الحاضرة — راجع `listOrders`. */
type LTOrderRow = LTOrder & { authorizedNowName?: string; authorizedNowId?: string; authorizationMismatch?: boolean };

type Opts = Awaited<ReturnType<typeof getLTOrderOptions>>;

const COL_DEFS: [string, string, string][] = [
  ['orderNumber', 'رقم الأمر', 'Order no.'],
  ['employeeName', 'الموظف', 'Employee'],
  ['employeeIdNumber', 'رقم الهوية', 'ID'],
  ['vehiclePlate', 'رقم اللوحة', 'Plate'],
  ['vehicleTypeAr', 'نوع المركبة', 'Vehicle type'],
  ['projectAr', 'المشروع', 'Project'],
  ['cityAr', 'الفرع', 'Branch'],
  ['supervisorName', 'المشرف', 'Supervisor'],
  ['housing', 'السكن', 'Housing'],
  ['startDate', 'من', 'From'],
  ['endDate', 'إلى', 'To'],
  ['status', 'الحالة', 'Status'],
  ['authorization', 'التفويض', 'Authorisation'],
  ['authorizedNow', 'التفويض باسم', 'Authorised to'],
  ['createdByName', 'أنشأه', 'Created by'],
];
const GETTERS: Record<string, (o: LTOrderRow) => any> = {
  orderNumber: (o) => o.orderNumber,
  employeeName: (o) => o.employeeName,
  employeeIdNumber: (o) => o.employeeIdNumber,
  vehiclePlate: (o) => o.vehiclePlate || '',
  vehicleTypeAr: (o) => o.vehicleTypeAr || '',
  projectAr: (o) => o.projectAr || '',
  cityAr: (o) => o.cityAr || '',
  supervisorName: (o) => o.supervisorName || '',
  housing: (o) => (typeof o.housing === 'object' && o.housing ? o.housing.name || '' : ''),
  startDate: (o) => fmtDate(o.startDate),
  endDate: (o) => fmtDate(o.endDate),
  status: (o) => (o.status === 'active' ? 'سارٍ' : 'مُغلَق'),
  authorization: (o) => (o.authorizationMoved ? 'نُقل' : ''),
  authorizedNow: (o) => (o as any).authorizedNowName || '',
  createdByName: (o) => o.createdByName || '',
};

function OrdersInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify, confirm, prompt } = useDialog();
  const canEdit = canEditLT(user as any);

  const [orders, setOrders] = useState<LTOrderRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [opts, setOpts] = useState<Opts | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [f, setF] = useState<Record<string, string>>({ status: '', project: '', city: '', from: '', to: '' });
  const [creating, setCreating] = useState<any | null>(null);
  const [moving, setMoving] = useState<any | null>(null);
  // الخلافُ مشتقٌّ في الخادم، فيُفلتَر هنا على ما وصل.
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { const h = setTimeout(() => setDq(q), 350); return () => clearTimeout(h); }, [q]);

  const load = useCallback(async () => {
    try {
      const d = await getLTOrders({ ...f, q: dq, employee: sp?.get('employee') || '' });
      setOrders(d.orders || []);
      setServerTotal(d.totals?.total || (d.orders || []).length);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(f), dq, sp]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));

  // الخياراتُ تُطلَب مرّةً عند أوّل فتحٍ للنافذة — لا مع كلّ تحميلٍ للصفحة.
  const openCreate = async () => {
    const employeeId = sp?.get('employee') || '';
    try {
      const o = opts || await getLTOrderOptions();
      setOpts(o);
      const pre = employeeId ? o.employees.find((x) => x._id === employeeId) : null;
      setCreating({
        ltEmployee: pre?._id || '', projectAr: pre?.projectAr || '', cityAr: pre?.cityAr || '',
        supervisorUser: pre?.supervisorUser || '', vehicle: '', housing: '', housingRoom: '',
        startDate: new Date().toISOString().slice(0, 10), moveAuthorization: true,
        authorizationNumber: '', authorizationStart: '', authorizationEnd: '', notesAr: '',
      });
    } catch (e: any) { notify(e?.message || t('تعذّر تحميل الخيارات', 'Could not load options'), 'error'); }
  };

  /**
   * ── نقلُ التفويض وحدَه ───────────────────────────────────────────────────
   * المركبةُ قد تكون مفوَّضةً لشخصٍ وقائدُها الفعليُّ آخر — أربعةَ عشرَ مركبةً
   * عندنا كذلك، وهي حالةٌ صحيحةٌ لا خطأ. فتصحيحُ الورقةِ وحدَها فعلٌ مستقلٌّ لا
   * يستلزم أمرَ تشغيلٍ جديدًا، والكتابةُ تقع في سجلّ المركبات نفسِه.
   */
  const openMove = async (o: LTOrder) => {
    try {
      const op = opts || await getLTOrderOptions();
      setOpts(op);
      const vid = typeof o.vehicle === 'object' && o.vehicle ? o.vehicle._id : String(o.vehicle || '');
      const v = op.vehicles.find((x) => x._id === vid);
      setMoving({
        vehicle: vid, plateNumber: o.vehiclePlate || v?.plateNumber || '',
        currentName: v?.authorizedName || '', currentId: v?.authorizedId || '',
        // المقترَحُ: القائدُ الفعليُّ لهذا الأمر — وهو الغرضُ الأغلب.
        toEmployee: o.ltEmployee, authorizationNumber: o.authorizationNumber || '',
        startDate: new Date().toISOString().slice(0, 10), expiryDate: fmtDate(o.authorizationEnd), reason: '',
      });
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  };

  const submitMove = async () => {
    if (!moving?.vehicle) return;
    setSaving(true);
    try {
      const r = await moveLTAuthorization({
        vehicle: moving.vehicle, toEmployee: moving.toEmployee || '',
        authorizationNumber: moving.authorizationNumber, startDate: moving.startDate,
        expiryDate: moving.expiryDate, reason: moving.reason,
      });
      notify(t(`تفويض ${r.vehicle.plateNumber} → ${r.vehicle.authorizedPerson?.name || '(رُفع)'}`,
        `${r.vehicle.plateNumber} → ${r.vehicle.authorizedPerson?.name || '(released)'}`), 'success');
      setMoving(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر النقل', 'Could not move'), 'error'); }
    setSaving(false);
  };

  const submit = async () => {
    if (!creating?.ltEmployee) { notify(t('اختر الموظف', 'Pick the employee'), 'error'); return; }
    setSaving(true);
    try {
      await createLTOrder(creating);
      notify(t('صدر أمر التشغيل', 'Operating order created'), 'success');
      setCreating(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الإنشاء', 'Could not create'), 'error'); }
    setSaving(false);
  };

  const end = async (o: LTOrder) => {
    const ok = await confirm({
      message: t(`يُنزَل ${o.employeeName} عن ${o.vehiclePlate || 'المركبة'}؟`, `Take ${o.employeeName} off ${o.vehiclePlate || 'the vehicle'}?`),
      tone: 'error', confirmLabel: t('إنزال', 'Take off'),
    });
    if (!ok) return;
    const reason = await prompt({ message: t('السبب (اختياري)', 'Reason (optional)') });
    // ── ويُسأل عن التفويض صريحًا ──────────────────────────────────────────
    // إنزالُ الراكبِ وإبقاءُ التفويض باسمه يعني مركبةً مسجَّلةً على من لا يقودها.
    const release = await confirm({
      message: t('يُرفَع التفويضُ عن المركبة أيضًا؟ (يُكتب في سجلّ المركبات)',
        'Also release the vehicle authorisation? (written in the vehicle registry)'),
      confirmLabel: t('نعم، ارفعه', 'Yes, release it'),
      cancelLabel: t('لا، اتركه', 'No, keep it'),
    });
    try {
      await endLTOrder(o._id, { reason: String(reason || ''), releaseAuthorization: release });
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر', 'Failed'), 'error'); }
  };

  const cf = useColumnFilters<LTOrderRow>();
  const shown = cf.apply(onlyMismatch ? orders.filter((o) => o.authorizationMismatch) : orders, GETTERS);
  // الأعدادُ من المعروض لا من ردّ الخادم — فيتحرّك الكارتُ مع فلتر العمود أيضًا،
  // ولا يبقى رقمان لشيءٍ واحد على شاشةٍ واحدة.
  const totals = useMemo(() => ({
    total: shown.length,
    active: shown.filter((o) => o.status === 'active').length,
    ended: shown.filter((o) => o.status === 'ended').length,
    authorizationMoved: shown.filter((o) => o.authorizationMoved).length,
    mismatch: shown.filter((o) => o.authorizationMismatch).length,
  }), [shown]);
  const exportColumns: ExportColumn[] = COL_DEFS.map(([k, a, e]) => ({
    header: ar ? a : e, key: k, width: 16, transform: (_: any, r: any) => GETTERS[k](r),
  }));

  if (loading) return <Spinner />;

  const Stat = ({ label, value, accent, onClick, on }: { label: string; value: any; accent?: string; onClick?: () => void; on?: boolean }) => (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`text-start bg-white border rounded-xl px-3.5 py-2.5 shadow-sm transition-all ${
        on ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'} ${onClick ? 'hover:border-[#f37121]/50 cursor-pointer' : ''}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-[19px] font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
    </button>
  );

  const emp = opts?.employees.find((x) => x._id === creating?.ltEmployee);
  const veh = opts?.vehicles.find((x) => x._id === creating?.vehicle);
  const house = opts?.housing.find((x) => x._id === creating?.housing);
  // غرفُ السكن المختار، ومَن يصلح لها: غرفةُ المناديب لا يُسكَن فيها إداريّ.
  const rooms = (house?.rooms || []).filter((r) => r.kind === 'any' || !emp || r.kind === emp.staffKind);

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={t('أوامر التشغيل', 'Operating orders')}
        subtitle={t('مَن يعمل على أيّ مركبة، في أيّ مشروع وفرع — وأثرُ كل نقل', 'Who works on which vehicle, in which project and branch — and the trail of every move')}>
        <ExportMenu fileName="lt-orders" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export')}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: 'Orders', rows: shown as any[], columns: exportColumns }] }]} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {t('إنشاء أمر تشغيل', 'New operating order')}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat label={t('الإجمالي', 'Total')} value={totals.total} onClick={() => setF((p) => ({ ...p, status: '' }))} on={!f.status} />
        <Stat label={t('سارية', 'Active')} value={totals.active} accent="text-emerald-600"
          onClick={() => setF((p) => ({ ...p, status: p.status === 'active' ? '' : 'active' }))} on={f.status === 'active'} />
        <Stat label={t('مُغلَقة', 'Ended')} value={totals.ended} accent="text-slate-500"
          onClick={() => setF((p) => ({ ...p, status: p.status === 'ended' ? '' : 'ended' }))} on={f.status === 'ended'} />
        <Stat label={t('نُقل معها التفويض', 'Authorisation moved')} value={totals.authorizationMoved} accent="text-indigo-600" />
        {/* ── والورقةُ باسم غيرِ الراكب ─────────────────────────────────────
            ليست خطأً يُصحَّح بلا سؤال: الورقةُ باسم واحدٍ والراكبُ غيرُه واقعٌ
            يحدث. لكنّها تُعرَض صريحةً، وإلّا لم تُكتشف إلّا عند مخالفةٍ أو حادث،
            وحينها لا يُعرَف صاحبُها. */}
        <Stat label={t('التفويض باسم غير الراكب', 'Authorised to someone else')} value={totals.mismatch}
          accent={totals.mismatch ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => setOnlyMismatch((v) => !v)} on={onlyMismatch} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap gap-2.5 items-center">
        <div className="flex-1 min-w-[230px]">
          <SearchInput value={q} onChange={setQ} placeholder={t('رقم الأمر · الموظف · الهوية · اللوحة…', 'order no., employee, ID, plate…')} />
        </div>
        <input type="date" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))}
          aria-label={t('من تاريخ', 'From')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light]" />
        <input type="date" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))}
          aria-label={t('إلى تاريخ', 'To')} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light]" />
        {(Object.values(f).some(Boolean) || q) && (
          <button type="button" onClick={() => { setF({ status: '', project: '', city: '', from: '', to: '' }); setQ(''); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold">
            <RotateCcw className="w-4 h-4" /> {t('مسح', 'Clear')}
          </button>
        )}
        {sp?.get('employee') && (
          <button type="button" onClick={() => router.push('/system/b2c/orders')}
            className="text-[12px] font-bold text-[#f37121] hover:underline">{t('كل الموظفين', 'All employees')}</button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="text-xs text-slate-500">{shown.length} / {serverTotal}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {canEdit && <th className={`${LEAD} bg-slate-900 px-3 py-2.5 text-start font-semibold`}>{t('إجراءات', 'Actions')}</th>}
                {COL_DEFS.map(([k, a, e]) => (
                  <th key={k} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">{ar ? a : e}{cf.header(k, orders, GETTERS[k], ar)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!shown.length ? (
                <tr><td colSpan={COL_DEFS.length + (canEdit ? 1 : 0)} className="px-4 py-12 text-center text-slate-400">
                  {t('لا أوامر تشغيل', 'No operating orders')}
                </td></tr>
              ) : shown.map((o) => (
                <tr key={o._id} className="group border-b border-slate-100 hover:bg-slate-50">
                  {canEdit && (
                    <td className={`${LEAD_CELL} px-3 py-2.5 whitespace-nowrap`}>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => router.push(`/system/b2c/light-transport/${o.ltEmployee}`)}
                          title={t('ملفّ الموظف', 'Employee file')}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></button>
                        {!!o.vehicle && (
                          <button type="button" onClick={() => openMove(o)} title={t('نقل تفويض المركبة', 'Move the vehicle authorisation')}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-slate-100"><ArrowLeftRight className="w-4 h-4" /></button>
                        )}
                        {o.status === 'active' && (
                          <button type="button" onClick={() => end(o)} title={t('إنزال وإغلاق الأمر', 'Take off & close')}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-red-600 hover:bg-slate-100"><Square className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  )}
                  {COL_DEFS.map(([k]) => {
                    const v = GETTERS[k](o);
                    if (k === 'status') {
                      return (
                        <td key={k} className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${o.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {o.status === 'active' ? t('سارٍ', 'Active') : t('مُغلَق', 'Ended')}
                          </span>
                        </td>
                      );
                    }
                    if (k === 'authorization') {
                      return (
                        <td key={k} className="px-3 py-2.5 text-[11.5px]">
                          {o.authorizationMoved
                            ? <span className="text-emerald-700 font-bold">{t('نُقل', 'moved')}{o.authorizationNumber ? ` · ${o.authorizationNumber}` : ''}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    }
                    if (k === 'authorizedNow') {
                      return (
                        <td key={k} className="px-3 py-2.5 whitespace-nowrap text-[12.5px]">
                          {!v ? <span className="text-slate-300">—</span> : o.authorizationMismatch ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold"
                              title={t('الورقة باسمه والراكبُ غيره', 'the paper is in their name, the rider is someone else')}>
                              {v} ⚠
                            </span>
                          ) : <span className="text-slate-600">{v}</span>}
                        </td>
                      );
                    }
                    const mono = ['orderNumber', 'employeeIdNumber', 'vehiclePlate', 'startDate', 'endDate'].includes(k);
                    return <td key={k} className={`px-3 py-2.5 whitespace-nowrap ${mono ? 'font-mono text-slate-700' : 'text-slate-700'}`}>{v || <span className="text-slate-300">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {moving && opts && (
        <Modal open onClose={() => setMoving(null)} title={t('نقل تفويض المركبة', 'Move vehicle authorisation')}>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[12.5px] text-slate-600">
                {t('المركبة', 'Vehicle')}: <span className="font-mono font-bold text-slate-900">{moving.plateNumber}</span>
              </p>
              <p className="text-[12.5px] text-slate-600 mt-1">
                {t('التفويض الآن باسم', 'Currently authorised to')}:{' '}
                <span className="font-bold text-slate-900">{moving.currentName || t('(لا أحد)', '(nobody)')}</span>
                {moving.currentId ? <span className="font-mono text-slate-500"> · {moving.currentId}</span> : null}
              </p>
            </div>
            <Field label={t('يُنقَل إلى', 'Move to')}>
              <SearchableSelect
                value={moving.toEmployee}
                onChange={(v: string) => setMoving((p: any) => ({ ...p, toEmployee: v }))}
                options={[{ value: '', label: t('— رفع التفويض بلا بديل —', '— release with no replacement —') },
                  ...opts.employees.map((e2) => ({ value: e2._id, label: `${e2.name} — ${e2.idNumber}` }))]}
                placeholder={t('ابحث بالاسم أو الهوية…', 'search by name or ID…')} />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <Field label={t('رقم التفويض', 'Authorisation no.')}>
                <TextInput value={moving.authorizationNumber} onChange={(ev) => setMoving((p: any) => ({ ...p, authorizationNumber: ev.target.value }))} />
              </Field>
              <Field label={t('من تاريخ', 'Starts')}>
                <input type="date" value={moving.startDate} onChange={(ev) => setMoving((p: any) => ({ ...p, startDate: ev.target.value }))}
                  aria-label={t('من تاريخ', 'Starts')} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
              </Field>
              <Field label={t('إلى تاريخ', 'Ends')}>
                <input type="date" value={moving.expiryDate} onChange={(ev) => setMoving((p: any) => ({ ...p, expiryDate: ev.target.value }))}
                  aria-label={t('إلى تاريخ', 'Ends')} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
              </Field>
            </div>
            <Field label={t('السبب', 'Reason')}>
              <TextInput value={moving.reason} onChange={(ev) => setMoving((p: any) => ({ ...p, reason: ev.target.value }))} />
            </Field>
            <p className="text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
              {t('يُكتب في سجلّ المركبات ويُقيَّد في سجلّ تجديداتها وفي سجلّ الموظفين — عند مَن أخذها ومَن فقدها.',
                 'Written into the vehicle registry, its renewal trail, and both employees’ history — the one who gained it and the one who lost it.')}
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setMoving(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={submitMove} disabled={saving}>{t('نقل التفويض', 'Move it')}</PrimaryButton>
          </div>
        </Modal>
      )}

      {creating && opts && (
        <Modal open onClose={() => setCreating(null)} title={t('إنشاء أمر تشغيل', 'New operating order')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* ── والموظّفون من هذا القسم وحدَه ──────────────────────────────
                لا من كلّ الأقسام: قائمةٌ بأربعمئةٍ وخمسين موظّفًا لا يُختار منها،
                والمطلوبُ من يعمل في النقل الخفيف. وفيها بحثٌ لأنّهم مئةٌ وستّون. */}
            <Field label={t('الموظف', 'Employee')}>
              <SearchableSelect
                value={creating.ltEmployee}
                onChange={(v: string) => {
                  const e2 = opts.employees.find((x) => x._id === v);
                  setCreating((p: any) => ({
                    ...p, ltEmployee: v,
                    projectAr: p.projectAr || e2?.projectAr || '',
                    cityAr: p.cityAr || e2?.cityAr || '',
                    // مشرفُ الموظّف الحاضرُ هو المقترَح — والأمرُ ينقله إن غُيّر.
                    supervisorUser: p.supervisorUser || e2?.supervisorUser || '',
                  }));
                }}
                options={opts.employees.map((e2) => ({
                  value: e2._id,
                  label: `${e2.name} — ${e2.idNumber}${e2.jobTitleAr ? ` · ${e2.jobTitleAr}` : ''}`,
                }))}
                placeholder={t('ابحث بالاسم أو الهوية…', 'search by name or ID…')} />
            </Field>
            {/* والمركباتُ من سجلّ المركبات — دراجاتٌ ومركباتٌ خاصّةٌ لا شاحنات. */}
            <Field label={t('المركبة', 'Vehicle')}>
              <SearchableSelect
                value={creating.vehicle}
                onChange={(v: string) => setCreating((p: any) => ({ ...p, vehicle: v }))}
                options={opts.vehicles.map((v) => ({
                  value: v._id,
                  label: `${v.plateNumber}${v.typeAr ? ` · ${v.typeAr}` : ''}${v.authorizedName ? ` — ${t('مفوَّضة لـ', 'authorised to ')}${v.authorizedName}` : ''}`,
                }))}
                placeholder={t('ابحث برقم اللوحة…', 'search by plate…')} />
            </Field>
            <Field label={t('المشروع', 'Project')}>
              <TextInput value={creating.projectAr} onChange={(ev) => setCreating((p: any) => ({ ...p, projectAr: ev.target.value }))} />
            </Field>
            <Field label={t('الفرع', 'Branch')}>
              <TextInput value={creating.cityAr} onChange={(ev) => setCreating((p: any) => ({ ...p, cityAr: ev.target.value }))} />
            </Field>
            {/* ── المشرفُ حسابٌ على النظام ─────────────────────────────────
                كانت القائمةُ أسماءَ إداريّي القسم — مشرفًا كان أو ميكانيكيًّا.
                والسؤالُ «مَن يقف عليه صباحًا»، وجوابُه حسابٌ يفتح شاشةَ التفقّد.
                وتركُها فارغةً يعني «كما هو على الموظّف» لا «بلا مشرف». */}
            <Field label={t('المشرف', 'Supervisor')}>
              <Select value={creating.supervisorUser} onChange={(ev: any) => setCreating((p: any) => ({ ...p, supervisorUser: ev.target.value }))}>
                <option value="">{t('— كما هو على الموظّف —', '— keep the employee’s —')}</option>
                {opts.supervisors.map((s) => <option key={s._id} value={s._id}>{s.name} — {s.roleAr}</option>)}
              </Select>
            </Field>
            <Field label={t('تاريخ البداية', 'Start date')}>
              <input type="date" value={creating.startDate} onChange={(ev) => setCreating((p: any) => ({ ...p, startDate: ev.target.value }))}
                aria-label={t('تاريخ البداية', 'Start date')} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
            </Field>
            <Field label={t('السكن', 'Housing')}>
              <Select value={creating.housing} onChange={(ev: any) => setCreating((p: any) => ({ ...p, housing: ev.target.value, housingRoom: '' }))}>
                <option value="">{t('— بلا سكن —', '— none —')}</option>
                {opts.housing.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
              </Select>
            </Field>
            <Field label={t('الغرفة', 'Room')}>
              <Select value={creating.housingRoom} disabled={!creating.housing}
                onChange={(ev: any) => setCreating((p: any) => ({ ...p, housingRoom: ev.target.value }))}>
                <option value="">{creating.housing ? t('— اختر الغرفة —', '— pick a room —') : t('اختر السكن أولًا', 'pick housing first')}</option>
                {rooms.map((r) => <option key={r.name} value={r.name}>{r.name} ({r.capacity})</option>)}
              </Select>
            </Field>

            {/* ── نقلُ التفويض ────────────────────────────────────────────── */}
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                <input type="checkbox" className="accent-[#f37121]" checked={!!creating.moveAuthorization}
                  onChange={(ev) => setCreating((p: any) => ({ ...p, moveAuthorization: ev.target.checked }))} />
                {t('نقل تفويض المركبة إلى هذا الموظف', 'Move the vehicle authorisation to this employee')}
              </label>
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                {t('يُكتب في سجلّ المركبات ويُقيَّد في سجلّ تجديداتها — فلا يبقى للمركبة مفوَّضان، أحدهما عند هذا القسم والآخر عند قسم المركبات.',
                   'Written into the vehicle registry and recorded in that vehicle’s renewal trail, so a vehicle can never have two authorised holders.')}
              </p>
              {veh?.authorizedName && creating.moveAuthorization && (
                <p className="text-[12px] text-amber-700 font-semibold">
                  {t(`المركبة مفوَّضة الآن لـ${veh.authorizedName} — سيُستبدَل بالتفويض الجديد.`,
                     `Currently authorised to ${veh.authorizedName} — it will be replaced.`)}
                </p>
              )}
              {creating.moveAuthorization && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <Field label={t('رقم التفويض', 'Authorisation no.')}>
                    <TextInput value={creating.authorizationNumber} onChange={(ev) => setCreating((p: any) => ({ ...p, authorizationNumber: ev.target.value }))} />
                  </Field>
                  <Field label={t('بداية التفويض', 'Starts')}>
                    <input type="date" value={creating.authorizationStart} onChange={(ev) => setCreating((p: any) => ({ ...p, authorizationStart: ev.target.value }))}
                      aria-label={t('بداية التفويض', 'Starts')} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
                  </Field>
                  <Field label={t('نهاية التفويض', 'Ends')}>
                    <input type="date" value={creating.authorizationEnd} onChange={(ev) => setCreating((p: any) => ({ ...p, authorizationEnd: ev.target.value }))}
                      aria-label={t('نهاية التفويض', 'Ends')} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm [color-scheme:light]" />
                  </Field>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <Field label={t('ملاحظات', 'Notes')}>
                <TextInput value={creating.notesAr} onChange={(ev) => setCreating((p: any) => ({ ...p, notesAr: ev.target.value }))} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setCreating(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={submit} disabled={saving}>{t('إصدار الأمر', 'Create order')}</PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><OrdersInner /></Suspense>;
}
