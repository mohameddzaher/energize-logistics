'use client';
/**
 * مركباتُ النقل الخفيف — مركباتُ مشاريع القسم (كيتا، هنقرستيشن، أمازون، نينجا).
 *
 * نافذةٌ على سجلّ المركبات نفسِه لا نسخةٌ منه: ما يُعدَّل هنا يُكتب في قسم
 * المركبات ويظهر فيه في الحال، وما يُعدَّل هناك يظهر هنا — الشاشتان تسمعان
 * الحدثَ نفسَه. وما يُعدَّل من هنا ما يديره القسم: المشروعُ والمدينةُ وحالةُ
 * التشغيل واللونُ والملاحظاتُ وتواريخُ المستندات، والقائدُ الفعليّ والتفويض.
 * اللوحةُ يعدّلها مَن يعدّل سجلَّ المركبات وحدَه، والرقمُ التسلسليّ يبقى له.
 *
 * ── القائدُ الفعليّ = راكبُ المركبة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ───────────────
 * يُقرأ من صفّه في «موظفي النقل الخفيف» لا من نصٍّ على المركبة، ويُختار من
 * موظّفي القسم بالبحث فيُربط بها (backend utils/ltRider) — فلا تكون مركبةٌ
 * «واقفة» وعليها اسم. والمفوَّضُ يُختار كذلك ويُكتب بـ setHolder.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, StatCard, Modal, Field, TextInput, PrimaryButton } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import ManagedSelect from '@/components/system/ManagedSelect';
import PersonSelect, { refreshPeople, type Person } from '@/components/system/PersonSelect';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import { Truck, Pencil, Search, Loader2, X } from 'lucide-react';
import { useLatestRequest } from '@/hooks/useLatestRequest';

interface Row {
  _id: string; serialNumber: string; project: string; city: string; plateNumber: string;
  driverId: string; driverName: string; authorizedId: string; authorizedName: string; authorizedPhone: string;
  authStart: string; authEnd: string; authNumber: string; durationDays: number | null; daysLeft: number | null;
  /** بمعاني لوحة القسم: مشروعُ الراكب (وإلّا الإدارة)، وحالةُ التفويض، والراكبُ من سجلّ القسم. */
  boardProject?: string; authState?: 'authorized' | 'expired' | 'none'; riderName?: string; riderId?: string;
  /** الراكبُ من سجلّ القسم (معرّفُ صفّه)، ومنتهي الخدمة «بانتظار التسليم»، ونصٌّ قديمٌ غيرُ مربوط. */
  driverLt?: string; driverHold?: boolean; driverUnlinked?: string; vstate?: 'withRider' | 'hold' | 'idle';
  serviceStatus?: string; color?: string; notes?: string; registrationType?: string;
  operatingCardNumber?: string; operatingCardEnd?: string; insuranceEnd?: string; licenseEnd?: string; inspectionEnd?: string;
}
/**
 * ── فلاترُ اللوحة في الرابط ─────────────────────────────────────────────────
 * كلُّ رقمِ مركباتٍ في لوحة القسم يفتح هذه الصفحةَ بفلاتره (المشروع، المندوب،
 * التفويض، السجل… و`vstate`: عليها راكب / بانتظار التسليم / واقفة / أمرُ تشغيل).
 * تُرسَل إلى الخادم كما هي فيردّ المركباتِ التي عدّها الكارتُ بأعيانها.
 */
const BOARD_KEYS: Record<string, [string, string]> = {
  project: ['المشروع', 'Project'], rep: ['المندوب', 'Rep'], vehicle: ['المركبة', 'Vehicle'], auth: ['التفويض', 'Authorisation'],
  cr: ['السجل التجاري', 'Register'], engagement: ['الارتباط', 'Engagement'], category: ['الفئة', 'Category'],
  city: ['المدينة', 'City'], status: ['حالة العمل', 'Work status'], vehicleType: ['نوع المركبة', 'Vehicle type'], vstate: ['الحالة', 'State'],
};
const BOARD_VALUES: Record<string, [string, string]> = {
  authorized: ['مفوَّض', 'Authorised'], expired: ['تفويض منتهٍ', 'Expired'], none: ['غير محدد', 'Not set'],
  sponsored: ['على الكفالة', 'Sponsored'], freelance: ['فريلانسر', 'Freelance'], trainee: ['متدرّب', 'Trainee'], users: ['يوزرات', 'Users'],
  rep: ['مندوب', 'Rep'], admin: ['إداري', 'Admin'], tech: ['فني', 'Technician'],
  withRider: ['عليها راكب', 'With a rider'], hold: ['بانتظار التسليم', 'Awaiting hand-over'], idle: ['واقفة بلا راكب', 'Idle'],
  activeOrder: ['عليها أمر تشغيل سارٍ', 'Under an active order'],
};
interface Payload {
  vehicles: Row[];
  summary: { total: number; noAuthorization: number; expired: number; expiringSoon: number; noDriver: number; hold?: number };
  canEdit: boolean; canEditPlate?: boolean;
}

const dmy = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
type StateKey = '' | 'noAuthorization' | 'expired' | 'expiringSoon' | 'noDriver' | 'hold' | 'withDriver' | 'activeOrder';
const STATES: StateKey[] = ['noAuthorization', 'expired', 'expiringSoon', 'noDriver', 'hold', 'withDriver', 'activeOrder'];

export default function B2cVehiclesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [d, setD] = useState<Payload | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<StateKey>('');
  // اللوحةُ تفتح هذه الصفحة على رقمٍ بعينه (`?state=`) — فتُعرض مركباتُه لا الكلّ.
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('state') || '';
      if ((STATES as string[]).includes(v)) setState(v as StateKey);
    } catch { /* */ }
  }, []);
  const [editing, setEditing] = useState<Row | null>(null);
  const cf = useColumnFilters<Row>();
  const [bf, setBf] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const o: Record<string, string> = {};
      for (const k of Object.keys(BOARD_KEYS)) { const v = sp.get(k); if (v) o[k] = v; }
      setBf(o);
    } catch { /* */ }
  }, []);
  const bfKey = JSON.stringify(bf);

  // نداءٌ مفلتَرٌ يحتاج حارسَه: ردٌّ أقدمُ (بلا فلتر) لا يكتب فوق أحدث.
  const guard = useLatestRequest();
  const load = useCallback(() => {
    const token = guard.begin();
    const qs = new URLSearchParams(bf).toString();
    api.get<Payload>(`/api/light-transport/vehicles${qs ? `?${qs}` : ''}`)
      .then((r) => { if (guard.isCurrent(token)) setD(r); })
      .catch((e: any) => { if (guard.isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bfKey, guard]);
  useEffect(() => { load(); }, [load]);
  // قسمُ المركبات يبثّ `vreg:updated` (ومعه `lt:updated`) عند كلّ تعديلٍ هناك.
  const reloadLive = useCallback(() => { refreshPeople(); load(); }, [load]);
  useSocket('vreg:updated', reloadLive);
  useSocket('lt:updated', reloadLive);
  // عمودا التعديل واللوحة ثابتان في أوّل الجدول — هويّةُ الصفّ وفعلُه لا يغيبان بالتمرير.
  const pin = usePinnedColumns(2);

  const getters: Record<string, (r: Row) => any> = useMemo(() => ({
    project: (r) => r.project, city: (r) => r.city, driver: (r) => r.driverName, authorized: (r) => r.authorizedName,
    endMonth: (r) => (r.authEnd || '').slice(0, 7), service: (r) => r.serviceStatus,
  }), []);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    const base = (d?.vehicles || []).filter((r) => {
      if (state === 'noAuthorization' && (r.authorizedName || r.authNumber)) return false;
      if (state === 'expired' && !(r.daysLeft != null && r.daysLeft < 0)) return false;
      if (state === 'expiringSoon' && !(r.daysLeft != null && r.daysLeft >= 0 && r.daysLeft <= 30)) return false;
      // «بلا قائد» و«بانتظار التسليم» بحالة المركبة من الخادم — المعنى نفسُه الذي تعدّه اللوحة.
      if (state === 'noDriver' && r.vstate !== 'idle') return false;
      if (state === 'hold' && r.vstate !== 'hold') return false;
      if (state === 'withDriver' && r.vstate !== 'withRider') return false;
      // أمرُ التشغيل السارِي = تفويضٌ قائمٌ لم ينتهِ.
      if (state === 'activeOrder' && !((r.authorizedName || r.authNumber) && (r.daysLeft == null || r.daysLeft >= 0))) return false;
      return !k || [r.plateNumber, r.serialNumber, r.project, r.city, r.driverName, r.driverId, r.authorizedName, r.authorizedId, r.authorizedPhone, r.authNumber, r.serviceStatus, r.operatingCardNumber]
        .some((v) => String(v || '').toLowerCase().includes(k));
    });
    return cf.apply(base, getters);
  }, [d, q, state, cf, getters]);

  if (!d) return <Spinner />;

  const cols: ExportColumn[] = [
    { header: t('رقم اللوحة', 'Plate'), key: 'plateNumber', width: 14 },
    { header: t('الرقم التسلسلي', 'Serial no.'), key: 'serialNumber', width: 16 },
    { header: t('المشروع', 'Project'), key: 'project', width: 16 },
    { header: t('المدينة', 'City'), key: 'city', width: 12 },
    { header: t('حالة التشغيل', 'Service status'), key: 'serviceStatus', width: 14 },
    { header: t('هوية القائد الفعلي', 'Actual driver ID'), key: 'driverId', width: 16 },
    { header: t('اسم القائد الفعلي للمركبة', 'Actual driver'), key: 'driverName', width: 28 },
    { header: t('رقم هوية المفوض', 'Authorized ID'), key: 'authorizedId', width: 16 },
    { header: t('اسم المفوض', 'Authorized person'), key: 'authorizedName', width: 28 },
    { header: t('رقم جوال المفوض', 'Authorized phone'), key: 'authorizedPhone', width: 16 },
    { header: t('بداية التفويض', 'Auth. start'), key: 'authStart', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('نهاية التفويض', 'Auth. end'), key: 'authEnd', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('المدة بالأيام', 'Duration (days)'), key: 'durationDays', transform: (v) => (v == null ? '' : v), width: 12 },
    { header: t('رقم التفويض', 'Auth. number'), key: 'authNumber', width: 16 },
    { header: t('بطاقة التشغيل', 'Operating card'), key: 'operatingCardNumber', width: 16 },
    { header: t('انتهاء بطاقة التشغيل', 'Op. card end'), key: 'operatingCardEnd', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('انتهاء التأمين', 'Insurance end'), key: 'insuranceEnd', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('انتهاء الاستمارة', 'Istimara end'), key: 'licenseEnd', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('انتهاء الفحص الدوري', 'Inspection end'), key: 'inspectionEnd', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('اللون', 'Colour'), key: 'color', width: 10 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 24 },
  ];
  const th = (k: string | null, label: string) => (
    <th key={label} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
      <span className="inline-flex items-center gap-1">{label}{k ? cf.header(k, d.vehicles, getters[k], ar) : null}</span>
    </th>
  );
  const card = (key: StateKey, label: string, value: number, accent: string) => (
    <button type="button" onClick={() => setState((v) => (v === key ? '' : key))} className={`text-start rounded-xl ${state === key && key ? 'ring-2 ring-[#f37121]' : ''}`}>
      <StatCard label={label} value={value} accent={accent} />
    </button>
  );
  const endCls = (r: Row) => (r.daysLeft == null ? 'text-slate-400' : r.daysLeft < 0 ? 'text-red-600 font-bold' : r.daysLeft <= 30 ? 'text-amber-600 font-bold' : 'text-slate-700');
  const today = new Date().toISOString().slice(0, 10);
  const docCls = (v?: string) => (!v ? 'text-slate-400' : v < today ? 'text-red-600 font-semibold' : 'text-slate-600');

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={t('مركبات النقل الخفيف', 'Light Transport Vehicles')}
        subtitle={t('مركبات مشاريع القسم من سجلّ المركبات — القائد الفعليّ والتفويض', 'The section’s project vehicles from the vehicle register — actual driver and authorization')}>
        <ExportMenu fileName="b2c-vehicles" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('المركبات', 'Vehicles'), rows: shown, columns: cols }] }]} />
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {card('', t('عدد المركبات', 'Vehicles'), d.summary.total, 'text-[#f37121]')}
        {card('noAuthorization', t('بلا تفويض', 'No authorization'), d.summary.noAuthorization, 'text-slate-600')}
        {card('expired', t('تفويض منتهٍ', 'Authorization expired'), d.summary.expired, 'text-red-600')}
        {card('expiringSoon', t('ينتهي خلال ٣٠ يومًا', 'Expiring in 30 days'), d.summary.expiringSoon, 'text-amber-600')}
        {card('noDriver', t('بلا قائدٍ فعليّ', 'No actual driver'), d.summary.noDriver, 'text-slate-600')}
        {card('hold', t('بانتظار التسليم', 'Awaiting hand-over'), d.summary.hold || 0, 'text-amber-700')}
      </div>
      {/* فلترٌ جاء من اللوحة ولا كرتَ له هنا — يُقال صراحةً ويُرفَع بضغطة. */}
      {(state === 'withDriver' || state === 'activeOrder') && (
        <button type="button" onClick={() => setState('')}
          className="inline-flex items-center gap-1 rounded-lg border border-[#f37121]/30 bg-[#f37121]/5 px-2.5 py-1 text-[12px] font-semibold text-[#f37121]">
          {state === 'withDriver' ? t('عليها راكب', 'With a rider') : t('عليها أمر تشغيل سارٍ', 'Under an active order')}
          <span className="text-slate-400">×</span>
        </button>
      )}

      {Object.keys(bf).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <span className="text-[12px] font-semibold text-slate-600">{t('من لوحة القسم:', 'From the board:')}</span>
          {Object.entries(bf).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setBf((p) => { const n = { ...p }; delete n[k]; return n; })}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[12px] font-semibold text-slate-700 hover:border-red-300">
              <span className="text-slate-400 font-normal">{ar ? BOARD_KEYS[k][0] : BOARD_KEYS[k][1]}:</span>
              {['rep', 'vehicle'].includes(k) ? t(`${v.split(',').length} محدَّد`, `${v.split(',').length} selected`)
                : v.split(',').map((x) => (BOARD_VALUES[x] ? (ar ? BOARD_VALUES[x][0] : BOARD_VALUES[x][1]) : x)).join('، ')}
              <X className="w-3 h-3 text-slate-400" />
            </button>
          ))}
          <button type="button" onClick={() => setBf({})} className="text-[12px] font-semibold text-slate-500 underline">{t('مسح الكل', 'Clear all')}</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('اللوحة / الاسم / الهوية / رقم التفويض…', 'plate / name / ID / auth. number…')} className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-80 max-w-full" />
        </div>
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="ms-auto text-xs text-slate-400">{shown.length} {t('مركبة', 'vehicles')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full min-w-[2200px] text-[13px]">
            <thead className="bg-slate-900 text-slate-300 text-xs sticky top-0 z-10"><tr>
              <th {...pin.th(0, 'px-2 py-2.5 w-10')} />
              <th {...pin.th(1, 'px-3 py-2.5 text-start font-semibold whitespace-nowrap')}>{t('رقم اللوحة', 'Plate')}</th>
              {th(null, t('الرقم التسلسلي', 'Serial no.'))}
              {th('project', t('المشروع', 'Project'))}
              {th('city', t('المدينة', 'City'))}
              {th('service', t('حالة التشغيل', 'Service status'))}
              {th(null, t('هوية القائد الفعلي', 'Actual driver ID'))}
              {th('driver', t('اسم القائد الفعلي للمركبة', 'Actual driver'))}
              {th(null, t('رقم هوية المفوض', 'Authorized ID'))}
              {th('authorized', t('اسم المفوض', 'Authorized person'))}
              {th(null, t('رقم جوال المفوض', 'Authorized phone'))}
              {th(null, t('بداية التفويض', 'Auth. start'))}
              {th('endMonth', t('نهاية التفويض', 'Auth. end'))}
              {th(null, t('المدة بالأيام', 'Days'))}
              {th(null, t('رقم التفويض', 'Auth. number'))}
              {th(null, t('بطاقة التشغيل', 'Operating card'))}
              {th(null, t('انتهاء التأمين', 'Insurance end'))}
              {th(null, t('انتهاء الاستمارة', 'Istimara end'))}
              {th(null, t('انتهاء الفحص الدوري', 'Inspection end'))}
              {th(null, t('اللون', 'Colour'))}
              {th(null, t('ملاحظات', 'Notes'))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r._id} className="group hover:bg-slate-50">
                  <td {...pin.td(0, 'px-2 py-2 text-center')}>
                    {d.canEdit && (
                      <button type="button" onClick={() => setEditing(r)} title={t('تعديل', 'Edit')} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-[#f37121]"><Pencil className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                  <td {...pin.td(1, 'px-3 py-2 font-bold text-slate-900 whitespace-nowrap')}><bdi>{r.plateNumber || '—'}</bdi></td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap"><bdi>{r.serialNumber || '—'}</bdi></td>
                  <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{r.project || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.city || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.serviceStatus || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap"><bdi>{r.driverId || '—'}</bdi></td>
                  <td className="px-3 py-2 text-slate-800 whitespace-nowrap">
                    {r.driverName || (r.driverUnlinked ? <span className="text-slate-400" title={t('نصٌّ قديمٌ على المركبة لا يطابق موظّفًا', 'Old text on the vehicle, not linked to an employee')}>{r.driverUnlinked} · {t('غير مربوط', 'not linked')}</span> : '—')}
                    {r.driverHold && <span className="ms-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700">{t('بانتظار التسليم', 'Awaiting hand-over')}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap"><bdi>{r.authorizedId || '—'}</bdi></td>
                  <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{r.authorizedName || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap"><bdi>{r.authorizedPhone || '—'}</bdi></td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dmy(r.authStart)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${endCls(r)}`}>
                    {dmy(r.authEnd)}
                    {r.daysLeft != null && r.daysLeft <= 30 && <span className="block text-[10.5px] font-semibold">{r.daysLeft < 0 ? t(`منتهٍ منذ ${-r.daysLeft} يومًا`, `expired ${-r.daysLeft}d ago`) : t(`باقٍ ${r.daysLeft} يومًا`, `${r.daysLeft}d left`)}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{r.durationDays ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap"><bdi>{r.authNumber || '—'}</bdi></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <bdi className="text-slate-700">{r.operatingCardNumber || '—'}</bdi>
                    {r.operatingCardEnd && <span className={`block text-[11px] ${docCls(r.operatingCardEnd)}`}>{dmy(r.operatingCardEnd)}</span>}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${docCls(r.insuranceEnd)}`}>{dmy(r.insuranceEnd)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${docCls(r.licenseEnd)}`}>{dmy(r.licenseEnd)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${docCls(r.inspectionEnd)}`}>{dmy(r.inspectionEnd)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.color || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-[240px] truncate" title={r.notes || ''}>{r.notes || '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={21} className="px-3 py-10 text-center text-slate-400">{t('لا مركباتَ في هذا العرض', 'No vehicles in this view')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {editing && <VehicleForm row={editing} ar={ar} canEditPlate={!!d.canEditPlate} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refreshPeople(); load(); }} />}
    </div>
  );
}

const PEOPLE = '/api/light-transport/people';

function VehicleForm({ row, ar, canEditPlate, onClose, onSaved }: { row: Row; ar: boolean; canEditPlate: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  // الحقولُ النصّيّة والتواريخ — يُرسَل ما تغيّر منها وحدَه.
  const initial = {
    plateNumber: row.plateNumber, project: row.project, city: row.city, serviceStatus: row.serviceStatus || '', color: row.color || '',
    notes: row.notes || '', operatingCardNumber: row.operatingCardNumber || '', operatingCardEnd: row.operatingCardEnd || '',
    insuranceEnd: row.insuranceEnd || '', licenseEnd: row.licenseEnd || '', inspectionEnd: row.inspectionEnd || '',
    authStart: row.authStart, authEnd: row.authEnd, authNumber: row.authNumber,
  };
  const [f, setF] = useState(initial);
  // الشخصان يُختاران: `undefined` = لم يُمَسّ، `null` = «بلا»، وإلّا الشخصُ المختار.
  const [driver, setDriver] = useState<Person | null | undefined>(undefined);
  const [holder, setHolder] = useState<Person | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const days = f.authStart && f.authEnd ? Math.round((new Date(f.authEnd).getTime() - new Date(f.authStart).getTime()) / 86400000) : null;
  const save = async () => {
    if (days != null && days < 0) { notify(t('نهايةُ التفويض قبل بدايته', 'End is before start'), 'error'); return; }
    // يُرسَل ما تغيّر وحدَه: خانةٌ لم تُمَسّ لا تُكتب فوق تعديلِ زميلٍ في قسم المركبات.
    const body: Record<string, any> = Object.fromEntries(Object.entries(f).filter(([k, v]) => String(v || '') !== String((initial as any)[k] || '')));
    if (driver !== undefined) body.driverLt = driver ? driver.ltId : '';
    if (holder !== undefined) {
      if (holder) Object.assign(body, { authorizedEmployee: holder.employeeId, authorizedLt: holder.ltId, authorizedId: holder.idNumber });
      else Object.assign(body, { authorizedId: '', authorizedName: '' });
    }
    if (!Object.keys(body).length) { onClose(); return; }
    setBusy(true);
    try {
      await api.put(`/api/light-transport/vehicles/${row._id}`, body);
      notify(t('حُفظ — وظهر في قسم المركبات والموارد البشرية', 'Saved — and visible in Vehicles and HR'), 'success'); onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); } finally { setBusy(false); }
  };
  const holderShown = holder === undefined ? { id: row.authorizedId, name: row.authorizedName } : { id: holder?.idNumber || '', name: holder?.name || '' };
  return (
    <Modal open onClose={onClose} title={t(`مركبة ${row.plateNumber}`, `Vehicle ${row.plateNumber}`)}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <PrimaryButton onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
      </>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <p className="md:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          {t('الرقم التسلسلي', 'Serial')}: <bdi className="font-semibold">{row.serialNumber || '—'}</bdi>{row.registrationType ? <> · {row.registrationType}</> : null}
          <span className="block text-[11.5px] text-slate-400">
            {canEditPlate ? t('ما يُحفَظ هنا يُكتب في سجلّ المركبات نفسِه.', 'Saved straight into the vehicle register.')
              : t('اللوحةُ والرقمُ التسلسليّ يُعدَّلان من قسم المركبات.', 'Plate and serial are edited in the Vehicles section.')}
          </span>
        </p>
        {canEditPlate && <Field label={t('رقم اللوحة', 'Plate')}><TextInput value={f.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} /></Field>}
        <Field label={t('المشروع', 'Project')}><ManagedSelect storeLabel noAdd type="vehicle_department" value={f.project} onChange={(v) => set('project', v)} /></Field>
        <Field label={t('المدينة', 'City')}><ManagedSelect storeLabel noAdd type="vehicle_city" value={f.city} onChange={(v) => set('city', v)} /></Field>
        <Field label={t('حالة التشغيل', 'Service status')}><ManagedSelect storeLabel noAdd type="vehicle_service_status" value={f.serviceStatus} onChange={(v) => set('serviceStatus', v)} /></Field>
        <Field label={t('اللون', 'Colour')}><ManagedSelect storeLabel noAdd type="vehicle_color" value={f.color} onChange={(v) => set('color', v)} /></Field>

        <div className="md:col-span-2 border-t border-slate-100 pt-2 text-[12px] font-semibold text-slate-500">{t('القائد الفعلي والتفويض', 'Actual driver and authorisation')}</div>
        <Field label={t('القائد الفعلي للمركبة', 'Actual driver')}>
          <PersonSelect endpoint={PEOPLE} ar={ar} onlyLt clearLabel={t('بلا قائد', 'No driver')}
            idNumber={driver === undefined ? (row.driverHold ? '' : row.driverId) : (driver?.idNumber || '')}
            name={driver === undefined ? (row.driverName || row.driverUnlinked || '') : ''}
            onChange={(p) => setDriver(p)} />
          <span className="mt-1 block text-[11px] text-slate-400">{t('من موظّفي النقل الخفيف — يُربط بالمركبة بأمر تشغيل.', 'From light-transport staff — linked to the vehicle by an operating order.')}</span>
        </Field>
        <Field label={t('المفوَّض', 'Authorized person')}>
          <PersonSelect endpoint={PEOPLE} ar={ar} clearLabel={t('بلا تفويض', 'No authorisation')}
            idNumber={holderShown.id} name={holderShown.name} onChange={(p) => setHolder(p)} />
          <span className="mt-1 block text-[11px] text-slate-400">
            {t('الهوية والجوال من ملفّه', 'ID and phone from his file')}: <bdi>{holderShown.id || '—'}</bdi> · <bdi>{holder === undefined ? (row.authorizedPhone || '—') : (holder?.phone || '—')}</bdi>
          </span>
        </Field>
        <Field label={t('رقم التفويض', 'Authorization number')}><TextInput dir="ltr" value={f.authNumber} onChange={(e) => set('authNumber', e.target.value)} /></Field>
        <div />
        <Field label={t('بداية التفويض', 'Authorization start')}><TextInput type="date" value={f.authStart} onChange={(e) => set('authStart', e.target.value)} /></Field>
        <Field label={t('نهاية التفويض', 'Authorization end')}><TextInput type="date" value={f.authEnd} onChange={(e) => set('authEnd', e.target.value)} /></Field>
        <p className="md:col-span-2 text-[12.5px] text-slate-600">{t('المدة بالأيام', 'Duration (days)')}: <b className={days != null && days < 0 ? 'text-red-600' : ''}>{days ?? '—'}</b> <span className="text-slate-400">{t('— تُحسَب من البداية إلى النهاية', '— computed from start to end')}</span></p>

        <div className="md:col-span-2 border-t border-slate-100 pt-2 text-[12px] font-semibold text-slate-500">{t('المستندات', 'Documents')}</div>
        <Field label={t('رقم بطاقة التشغيل', 'Operating card number')}><TextInput dir="ltr" value={f.operatingCardNumber} onChange={(e) => set('operatingCardNumber', e.target.value)} /></Field>
        <Field label={t('انتهاء بطاقة التشغيل', 'Operating card end')}><TextInput type="date" value={f.operatingCardEnd} onChange={(e) => set('operatingCardEnd', e.target.value)} /></Field>
        <Field label={t('انتهاء التأمين', 'Insurance end')}><TextInput type="date" value={f.insuranceEnd} onChange={(e) => set('insuranceEnd', e.target.value)} /></Field>
        <Field label={t('انتهاء الاستمارة', 'Istimara end')}><TextInput type="date" value={f.licenseEnd} onChange={(e) => set('licenseEnd', e.target.value)} /></Field>
        <Field label={t('انتهاء الفحص الدوري', 'Inspection end')}><TextInput type="date" value={f.inspectionEnd} onChange={(e) => set('inspectionEnd', e.target.value)} /></Field>
        <div />
        <div className="md:col-span-2"><Field label={t('ملاحظات', 'Notes')}><TextInput value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}
