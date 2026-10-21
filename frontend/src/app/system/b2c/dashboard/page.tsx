'use client';
/**
 * لوحةُ قسم الأفراد والنقل الخفيف — الصورةُ الكاملة.
 *
 * ── الترتيبُ كما طلبه صاحبُ الشركة (٢٠٢٦/١٠/٢١) ───────────────────────────────
 *   ١. «الإجمالي» وحدَه فوق، وتحته — لا بجانبه — ثلاثةُ كروت: مندوب · إداري · فني.
 *      لكلٍّ رقمُه فوق، ونصفُه الأسفلُ «على الكفالة» / «فريلانسر»؛ وما ليس هذا ولا
 *      ذاك (متدرّب · يوزرات · غير محدد) رقمٌ صغيرٌ تحتهما — فالنصفان وما تحتهما =
 *      الكارت، والكروتُ (ومعها «غير مصنَّف» إن وُجد) = الإجمالي.
 *   ٢. «حالة العمل» قسمٌ مستقلّ: يعمل · إجازة · موقوف · حادث — لكلٍّ قسمتُه على
 *      الفئات الثلاث، ومجموعُها الإجماليُّ نفسُه. وحالةُ اليوم تُعدَّل من صفّ الموظّف
 *      في «موظفو النقل الخفيف» (وإجازةُ الموارد البشريّة وإيقافُها يغلبانها).
 *   ٣. كلُّ رقمٍ يُضغَط فيفتح أصحابَه: الناسَ في سجلّ الموظّفين، والمركباتِ في
 *      «مركبات النقل الخفيف» — بالفلاتر نفسِها، والخادمُ يعدّ ويفتح بمعنىً واحد
 *      (backend utils/b2cBoard).
 *   ٤. المركباتُ كلُّ ما ينسبه قسمُ المركبات إلى النقل الخفيف — مفوَّضةً أو لا.
 *   ٥. فلاترُ فوق اللوحة كفلاتر لوحة الموارد البشريّة: قوائمُ فيها بحث، وبجانب
 *      كلّ قيمةٍ عددُها تحت الفلاتر الأخرى، وكلُّ رقمٍ في اللوحة يتبعها.
 *
 * والكروتُ هادئة (صاحبُ الشركة لا يحبّ الكروتَ الملوّنة): أبيضُ ورقمٌ داكنٌ ونقطةُ
 * لونٍ صغيرة — على طراز components/collections/ReceivablesTree.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import OrdersReport from '@/components/b2c/OrdersReport';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { LayoutDashboard, Users, Car, Home, BarChart3, Truck, AlertTriangle, ChevronLeft } from 'lucide-react';

type Opt = { value: string; label?: string; count: number };
/**
 * ما تقرؤه اللوحةُ من أرقام القسم القديمة — يُعرَّف هنا لا يُستورَد من lib/lightTransport:
 * خريطةُ نقاط الصفحات تُولَّد من الملفّات المستورَدة، فاستيرادُ ذلك الملفّ كان يفتح
 * لصاحب اللوحة وحدَها نقاطَ السجلّ كلَّها (الإسناد، أوامر التشغيل…). راجع genPageApis.
 */
interface LTTotals {
  housed: number; unhoused: number;
  byProject: Record<string, number>; byCity: Record<string, number>; byJob: Record<string, number>;
  byRegister: Record<string, number>; bySupervisor: Record<string, number>;
}
type Cat = 'rep' | 'admin' | 'tech' | 'none';
type Eng = 'sponsored' | 'freelance' | 'trainee' | 'users' | 'none';
interface Board {
  total: number;
  categories: Record<Cat, { total: number } & Record<Eng, number>>;
  status: Record<string, { total: number } & Record<Cat, number>>;
  vehicles: { total: number; withRider: number; idle: number; onActiveOrder: number; auth: { authorized: number; expired: number; none: number } };
  otherDepartment: number;
  b2cDepartment: string;
}
interface RepsProject { project: string; sponsored: number; freelance: number; users: number; noContract: number; total: number }
interface Overview {
  board: Board;
  filterOptions: Record<string, Opt[]>;
  quickFilters: { key: string; ar: string; en: string }[];
  employees: LTTotals;
  reps?: { total: number; sponsored: number; freelance: number; users: number; noContract: number; projects: RepsProject[] };
  vehicles: {
    total: number; totalAll: number; withRider: number; idle: number; onActiveOrder: number;
    byType: Record<string, number>; byProject: Record<string, number>; byServiceStatus: Record<string, number>;
  };
  housing: { _id: string; name: string; cityAr?: string; capacity: number; occupied: number; free: number;
    rooms: { name: string; kind: string; capacity: number; occupied: number; free: number }[] }[];
  orders: { active: number };
  gaps: {
    workingWithoutVehicle: number; idleVehicles: number; noRegister: number;
    noContractType: number; noSupervisor: number; unhoused: number;
    noHrFile: number; authorizationMismatch: number;
  };
}

const qsOf = (o: Record<string, string>) =>
  Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const num = (n?: number) => (n || 0).toLocaleString('en-US');

const CATS: { key: Cat; ar: string; en: string; tone: string }[] = [
  { key: 'rep', ar: 'مندوب', en: 'Reps', tone: '#475569' },
  { key: 'admin', ar: 'إداري', en: 'Admin', tone: '#0d9488' },
  { key: 'tech', ar: 'فني', en: 'Technicians', tone: '#a16207' },
];
const STATES: { key: string; en: string; tone: string }[] = [
  { key: 'يعمل', en: 'Working', tone: '#16a34a' },
  { key: 'إجازة', en: 'On leave', tone: '#0284c7' },
  { key: 'موقوف', en: 'Suspended', tone: '#d97706' },
  { key: 'حادث', en: 'Accident', tone: '#dc2626' },
];
/** ما ليس كفالةً ولا فريلانسر — يُعرَض صغيرًا تحت النصفين، ولا يُقال الصفر. */
const REST: { key: Eng; ar: string; en: string }[] = [
  { key: 'trainee', ar: 'متدرّب', en: 'Trainee' },
  { key: 'users', ar: 'يوزرات', en: 'Rented users' },
  { key: 'none', ar: 'غير محدد', en: 'Not set' },
];

/**
 * ── المكوّناتُ خارجَ جسم الصفحة ─────────────────────────────────────────────
 * مكوّنٌ يُعرَّف داخل الرسم يُهدَم ويُبنى مع كلّ ردٍّ وكلّ حدثٍ حيّ — راجع ذاكرة
 * «inline components remount».
 */
const BOX = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden';

function Dot({ tone }: { tone: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone }} />;
}

/** نصفٌ (أو ثلثٌ) من كارت: عنوانٌ ورقمٌ ونسبةٌ — يُضغَط فيفتح أصحابَه. */
function Half({ label, value, of, href, tone, unit }: { label: string; value: number; of?: number; href: string; tone?: string; unit?: string }) {
  const pct = of ? Math.round((value / of) * 100) : 0;
  return (
    <Link href={href} className="block text-center px-2 py-3 hover:bg-slate-50/70 transition-colors">
      <p className="text-[11.5px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
        {tone && <Dot tone={tone} />}{label}
      </p>
      <p className="mt-1 text-[19px] font-bold tabular-nums tracking-tight text-slate-900">{num(value)}</p>
      <p className="mt-0.5 text-[10.5px] text-slate-400 tabular-nums">{unit ? `${unit}${pct ? ' · ' : ''}` : ''}{pct ? `${pct}%` : ''}</p>
    </Link>
  );
}

/** تقسيمةٌ تُقرأ وتُضغَط — هادئة: شريطٌ رماديٌّ ورقمٌ داكن. والصفرُ لا يُعرَض. */
function Breakdown({ title, icon, data, filterKey, f, toggle, hrefOf }: {
    title: string; icon: React.ReactNode; data: Record<string, number>; filterKey?: string;
    f: Record<string, string>; toggle: (k: string, v: string) => void; hrefOf?: (k: string) => string;
  }) {
  const rows = Object.entries(data || {}).filter(([k, v]) => v > 0 && k !== '—')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));
  if (!rows.length) return null;
  const max = rows[0][1];
  const totalOf = rows.reduce((n, [, v]) => n + v, 0);
  const picked = (k: string) => !!filterKey && String(f[filterKey] || '').split(',').includes(k);
  return (
    <section className={BOX}>
      <div className="px-4 pt-3 pb-3">
        <h3 className="font-semibold text-slate-800 text-[13px] flex items-center gap-1.5 mb-2.5">
          <span className="text-slate-400">{icon}</span>{title}
          <span className="text-slate-400 font-normal text-[11.5px]">({num(totalOf)})</span>
        </h3>
        <div className="space-y-1">
          {rows.map(([k, v]) => {
            const on = picked(k);
            const inner = (
              <>
                <span className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className={`truncate ${on ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{k}</span>
                  <span className="tabular-nums font-semibold text-slate-900 shrink-0">
                    {num(v)}<span className="text-slate-400 font-normal text-[10.5px]"> · {Math.round((v / totalOf) * 100)}%</span>
                  </span>
                </span>
                <span className="mt-1 block h-1 rounded-full bg-slate-100 overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: on ? '#f37121' : '#94a3b8' }} />
                </span>
              </>
            );
            if (filterKey) {
              return (
                <button key={k} type="button" onClick={() => toggle(filterKey, k)}
                  className={`w-full text-start rounded-lg px-2 py-1.5 transition-colors ${on ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>{inner}</button>
              );
            }
            if (hrefOf) return <Link key={k} href={hrefOf(k)} className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">{inner}</Link>;
            return <div key={k} className="px-2 py-1.5">{inner}</div>;
          })}
        </div>
      </div>
    </section>
  );
}

/** رقمٌ صغيرٌ في كارتٍ هادئ — لـ«ما يحتاج عملًا» والسكن. */
function Small({ label, value, href, onClick, hint }: { label: string; value: number; href?: string; onClick?: () => void; hint?: string }) {
  const body = (
    <>
      <p className="text-[11.5px] text-slate-500 leading-tight">{label}</p>
      <p className="mt-1 text-[20px] font-bold tabular-nums text-slate-900 leading-tight">{num(value)}</p>
      {hint && <p className="text-[10.5px] text-slate-400 mt-0.5">{hint}</p>}
    </>
  );
  const cls = `block text-center ${BOX} px-3 py-3 ${href || onClick ? 'hover:bg-slate-50/70 transition-colors' : ''}`;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`w-full ${cls}`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

const FALLBACK_KEYS = [
  { key: 'project', ar: 'المشروع', en: 'Project' }, { key: 'rep', ar: 'المندوب', en: 'Rep' },
  { key: 'vehicle', ar: 'المركبة', en: 'Vehicle' }, { key: 'auth', ar: 'التفويض', en: 'Authorisation' },
  { key: 'cr', ar: 'السجل التجاري', en: 'Commercial register' }, { key: 'engagement', ar: 'كفالة / فريلانسر', en: 'Engagement' },
  { key: 'category', ar: 'الفئة', en: 'Category' }, { key: 'city', ar: 'المدينة', en: 'City' },
  { key: 'status', ar: 'حالة العمل', en: 'Work status' },
];

export default function B2CDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();

  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<Record<string, string>>({});
  /** التقسيماتُ تُضيف قيمتَها إلى الفلتر أو تُزيلها — كقوائم الفلاتر فوق. */
  const toggle = (k: string, v: string) => setF((p) => {
    const cur = String(p[k] || '').split(',').filter(Boolean);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    const n = { ...p };
    if (next.length) n[k] = next.join(','); else delete n[k];
    return n;
  });

  const guard = useLatestRequest();
  const fKey = qsOf(f);
  const load = useCallback(async () => {
    const token = guard.begin();
    try {
      const r = await api.get<Overview>(`/api/light-transport/overview${fKey ? `?${fKey}` : ''}`);
      if (!guard.isCurrent(token)) return;
      setD(r);
    } catch { /* تبقى الشاشةُ على ما لديها */ }
    if (guard.isCurrent(token)) setLoading(false);
  }, [fKey, guard]);
  useEffect(() => { load(); }, [load]);
  // حيّة: القسمُ والموارد البشريّة (حالةٌ ومشروعٌ وسجلّ) وسجلُّ المركبات (تفويضٌ ومشروع).
  useSocket('lt:updated', useCallback(() => load(), [load]));
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('hr:master', useCallback(() => load(), [load]));
  useSocket('vreg:updated', useCallback(() => load(), [load]));
  useSocket('b2c:rep:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!d || !d.board) return <div className="p-8 text-slate-500">{t('تعذّر تحميل اللوحة', 'Could not load the board')}</div>;

  const B = d.board; const E = d.employees; const V = d.vehicles;
  const includeEnded = String(f.status || '').split(',').includes('إنهاء خدمة');
  /** الناسُ خلف الرقم: فلاترُ اللوحة + ما يخصّ الرقم، وفي الخدمة وحدَهم. */
  const people = (extra: Record<string, string> = {}) =>
    `/system/b2c/light-transport?${qsOf({ ...f, inService: includeEnded ? '' : '1', ...extra })}`;
  /** والمركباتُ خلف الرقم — في «مركبات النقل الخفيف» بالفلاتر نفسِها. */
  const vehiclesOf = (extra: Record<string, string> = {}) => `/system/b2c/vehicles?${qsOf({ ...f, ...extra })}`;
  const catTotal = (c: Cat) => B.categories[c]?.total || 0;

  // ما يُصدَّر: الأرقامُ والتقسيماتُ في ورقةٍ واحدةٍ مسطَّحة.
  const flat = [
    { group: t('الإجمالي', 'Total'), value: '', count: B.total },
    ...CATS.flatMap((c) => (['sponsored', 'freelance', 'trainee', 'users', 'none'] as Eng[])
      .map((k) => ({ group: t(c.ar, c.en), value: k, count: B.categories[c.key]?.[k] || 0 }))),
    ...STATES.map((s) => ({ group: t('حالة العمل', 'Work status'), value: s.key, count: B.status[s.key]?.total || 0 })),
    { group: t('المركبات', 'Vehicles'), value: t('الإجمالي', 'Total'), count: B.vehicles.total },
    { group: t('المركبات', 'Vehicles'), value: t('مفوَّضة', 'Authorised'), count: B.vehicles.auth.authorized },
    { group: t('المركبات', 'Vehicles'), value: t('تفويض منتهٍ', 'Expired'), count: B.vehicles.auth.expired },
    { group: t('المركبات', 'Vehicles'), value: t('بلا تفويض', 'Not authorised'), count: B.vehicles.auth.none },
    ...Object.entries(E.byProject || {}).map(([k, v]) => ({ group: t('المشروع', 'Project'), value: k, count: v })),
    ...Object.entries(E.byCity || {}).map(([k, v]) => ({ group: t('الفرع', 'Branch'), value: k, count: v })),
    ...Object.entries(E.byRegister || {}).map(([k, v]) => ({ group: t('السجل', 'Register'), value: k, count: v })),
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة قسم الأفراد', 'B2C board')}
        subtitle={t('الموظفون والمركبات والسكن — وكل رقم يفتح أصحابه', 'People, vehicles and housing — every number opens its list')}>
        <ExportMenu fileName="b2c-board" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export')}
          options={[{
            key: 'board', label: t('أرقام اللوحة', 'Board numbers'),
            sheets: [{
              name: 'Board', rows: flat as any[],
              columns: [
                { header: t('التقسيم', 'Breakdown'), key: 'group', width: 20 },
                { header: t('القيمة', 'Value'), key: 'value', width: 24 },
                { header: t('العدد', 'Count'), key: 'count', width: 10 },
              ],
            }],
          }]} />
        <Link href="/system/b2c/orders-analysis"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-300">
          <BarChart3 className="w-4 h-4" /> {t('تحليل الأوردرات', 'Orders analysis')}
        </Link>
      </PageHeader>

      {/* ── الفلاتر: كفلاتر لوحة الموارد البشريّة — وكلُّ رقمٍ تحتها يتبعها ──── */}
      <HrQuickFilters ar={ar} value={f} onChange={setF}
        keys={d.quickFilters?.length ? d.quickFilters : FALLBACK_KEYS} options={d.filterOptions || {}} />

      {/* ① الإجمالي — وحدَه، وتحته الفئاتُ الثلاث ───────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5"><Users className="w-4 h-4 text-slate-400" />{t('الموظفون', 'People')}</h2>
        <div className={BOX}>
          <Link href={people()} className="block text-center px-4 pt-5 pb-4 hover:bg-slate-50/60 transition-colors">
            <p className="text-[12px] font-medium text-slate-500">{t('الإجمالي', 'Total')}</p>
            <p className="mt-1.5 text-[34px] leading-none font-bold tabular-nums tracking-tight text-slate-900">{num(B.total)}</p>
            <p className="mt-1.5 text-[11.5px] text-slate-400 tabular-nums">
              {CATS.map((c, i) => (
                <span key={c.key}>{i > 0 && <span className="text-slate-300"> · </span>}{t(c.ar, c.en)} {num(catTotal(c.key))}</span>
              ))}
              {catTotal('none') > 0 && <><span className="text-slate-300"> · </span>{t('غير مصنَّف', 'Uncategorised')} {num(catTotal('none'))}</>}
            </p>
          </Link>
          {/* شريطُ النسبة: كم من الكلّ مندوبٌ وكم إداريٌّ وكم فنّيّ. */}
          <div className="mx-4 mb-4 h-1.5 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden>
            {CATS.map((c) => <span key={c.key} style={{ width: `${B.total ? (catTotal(c.key) / B.total) * 100 : 0}%`, background: c.tone }} />)}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CATS.map((c) => {
            const n = B.categories[c.key];
            const rest = REST.filter((r) => (n?.[r.key] || 0) > 0);
            return (
              <div key={c.key} className={BOX}>
                <Link href={people({ category: c.key })} className="block text-center px-4 pt-3.5 pb-3 hover:bg-slate-50/60 transition-colors">
                  <p className="text-[12px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5"><Dot tone={c.tone} />{t(c.ar, c.en)}</p>
                  <p className="mt-1 text-[26px] leading-none font-bold tabular-nums tracking-tight text-slate-900">{num(n?.total)}</p>
                </Link>
                <div className="grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
                  <Half label={t('على الكفالة', 'Sponsored')} value={n?.sponsored || 0} of={n?.total} href={people({ category: c.key, engagement: 'sponsored' })} />
                  <Half label={t('فريلانسر', 'Freelance')} value={n?.freelance || 0} of={n?.total} href={people({ category: c.key, engagement: 'freelance' })} />
                </div>
                {/* وما ليس هذا ولا ذاك — رقمٌ صغيرٌ يُفتَح، فيبقى مجموعُ الكارت صحيحًا. */}
                {rest.length > 0 && (
                  <div className="border-t border-slate-100 px-3 py-1.5 text-center text-[11px] text-slate-500">
                    {rest.map((r, i) => (
                      <span key={r.key}>
                        {i > 0 && <span className="text-slate-300"> · </span>}
                        <Link href={people({ category: c.key, engagement: r.key })} className="hover:text-slate-800 hover:underline">
                          {t(r.ar, r.en)} <span className="tabular-nums font-semibold text-slate-700">{num(n?.[r.key])}</span>
                        </Link>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {catTotal('none') > 0 && (
          <Link href={people({ category: 'none' })}
            className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
            {t(`${num(catTotal('none'))} بلا فئة (لا وظيفة ولا فئة وظيفية) — اضغط لعرضهم وتحديدها`, `${num(catTotal('none'))} uncategorised — click to see them`)}
            <ChevronLeft className={`w-3.5 h-3.5 ${isRTL ? '' : 'rotate-180'}`} />
          </Link>
        )}
      </section>

      {/* ② حالة العمل — يعمل · إجازة · موقوف · حادث، ومجموعُها الإجمالي ──────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[13px] font-semibold text-slate-700">{t('حالة العمل', 'Work status')}</h2>
          <span className="text-[11px] text-slate-400">
            {t('تُعدَّل من صفّ الموظف في «موظفو النقل الخفيف» — والإجازة والإيقاف من الموارد البشرية يغلبان',
              'Set from the employee row in Light-transport employees — HR leave and suspension take precedence')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {STATES.map((s) => {
            const n = B.status[s.key] || { total: 0, rep: 0, admin: 0, tech: 0, none: 0 };
            return (
              <div key={s.key} className={BOX}>
                <Link href={people({ status: s.key })} className="block text-center px-4 pt-3.5 pb-3 hover:bg-slate-50/60 transition-colors">
                  <p className="text-[12px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5"><Dot tone={s.tone} />{ar ? s.key : s.en}</p>
                  <p className="mt-1 text-[24px] leading-none font-bold tabular-nums tracking-tight text-slate-900">{num(n.total)}</p>
                  <p className="mt-1 text-[10.5px] text-slate-400 tabular-nums">{B.total ? `${Math.round((n.total / B.total) * 100)}%` : ''}</p>
                </Link>
                <div className="grid grid-cols-3 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
                  {CATS.map((c) => (
                    <Half key={c.key} label={t(c.ar, c.en)} value={n[c.key] || 0} href={people({ status: s.key, category: c.key })} />
                  ))}
                </div>
                {(n.none || 0) > 0 && (
                  <Link href={people({ status: s.key, category: 'none' })} className="block border-t border-slate-100 px-3 py-1 text-center text-[10.5px] text-slate-500 hover:bg-slate-50">
                    {t(`غير مصنَّف ${n.none}`, `Uncategorised ${n.none}`)}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ③ المركبات — كلُّ مركبات القسم من سجلّ المركبات، مفوَّضةً أو لا ──────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5"><Car className="w-4 h-4 text-slate-400" />{t('المركبات', 'Vehicles')}</h2>
          <span className="text-[11px] text-slate-400">
            {t('كل ما ينسبه قسم المركبات إلى النقل الخفيف (قطاعًا أو إدارة) وما عليه راكب من القسم — والتفويض من سجلّ المركبات',
              'Everything the Vehicles section assigns to light transport (sector or department) plus anything ridden by the section — authorisation from the vehicle register')}
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className={BOX}>
            <Link href={vehiclesOf()} className="block text-center px-4 pt-4 pb-3 hover:bg-slate-50/60 transition-colors">
              <p className="text-[12px] font-medium text-slate-500">{t('مركبات القسم', 'Section vehicles')}</p>
              <p className="mt-1 text-[28px] leading-none font-bold tabular-nums tracking-tight text-slate-900">{num(B.vehicles.total)}</p>
              <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
                {t(`عليها أمر تشغيل سارٍ ${num(B.vehicles.onActiveOrder)}`, `Under an active order ${num(B.vehicles.onActiveOrder)}`)}
              </p>
            </Link>
            <div className="grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
              <Half label={t('عليها راكب', 'With a rider')} value={B.vehicles.withRider} of={B.vehicles.total} tone="#475569" href={vehiclesOf({ vstate: 'withRider' })} />
              <Half label={t('واقفة بلا راكب', 'Idle')} value={B.vehicles.idle} of={B.vehicles.total} tone="#cbd5e1" href={vehiclesOf({ vstate: 'idle' })} />
            </div>
          </div>
          <div className={BOX}>
            <div className="text-center px-4 pt-4 pb-3">
              <p className="text-[12px] font-medium text-slate-500">{t('التفويض', 'Authorisation')}</p>
              <p className="mt-1 text-[11px] text-slate-400">{t('من «المفوَّض بالقيادة» في سجلّ المركبات', 'From the authorised person in the vehicle register')}</p>
            </div>
            <div className="grid grid-cols-3 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
              <Half label={t('مفوَّض', 'Authorised')} value={B.vehicles.auth.authorized} of={B.vehicles.total} tone="#16a34a" href={vehiclesOf({ auth: 'authorized' })} />
              <Half label={t('تفويض منتهٍ', 'Expired')} value={B.vehicles.auth.expired} of={B.vehicles.total} tone="#d97706" href={vehiclesOf({ auth: 'expired' })} />
              <Half label={t('بلا تفويض', 'Not authorised')} value={B.vehicles.auth.none} of={B.vehicles.total} tone="#94a3b8" href={vehiclesOf({ auth: 'none' })} />
            </div>
          </div>
        </div>
      </section>

      {/* ── المناديب حسب المشروع: كفالة · فريلانسر · يوزرات — كلُّ رقمٍ يفتح أصحابه ── */}
      {d.reps && d.reps.projects.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-slate-400" />{t('المناديب حسب المشروع', 'Reps by project')}
            <span className="text-slate-400 font-normal text-[11.5px]">{t(`(${num(d.reps.total)} — ومعهم اليوزرات المؤجَّرة)`, `(${num(d.reps.total)} incl. rented users)`)}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {d.reps.projects.map((p) => (
              <div key={p.project} className={BOX}>
                <Link href={people({ staffKind: 'rep', project: p.project })} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/60">
                  <span className="text-[13px] font-semibold text-slate-800">{p.project}</span>
                  <span className="tabular-nums text-[15px] font-bold text-slate-900">{num(p.total)}</span>
                </Link>
                <div className="grid grid-cols-3 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
                  {([['sponsored', t('كفالة', 'Sponsored')], ['freelance', t('فريلانسر', 'Freelance')], ['users', t('يوزرات', 'Users')]] as const).map(([k, label]) => (
                    <Half key={k} label={label} value={p[k]} href={people({ staffKind: 'rep', project: p.project, contractKind: k })} />
                  ))}
                </div>
                {p.noContract > 0 && (
                  <Link href={people({ staffKind: 'rep', project: p.project, contractKind: 'none' })}
                    className="block border-t border-slate-100 px-3 py-1 text-center text-[10.5px] text-slate-500 hover:bg-slate-50">
                    {t(`${p.noContract} غير محدد — اضغط لعرضهم`, `${p.noContract} not set — click to see them`)}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── تقريرُ تحقيق المناديب — حيًّا من مدخلات الأوردرات ── */}
      <OrdersReport url="/api/b2c/entry" />

      {/* ── التقسيمات: ضغطُ سطرٍ يضيفه إلى الفلاتر فوق (ويُزيله) ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Breakdown f={f} toggle={toggle} title={t('بالمشروع', 'By project')} icon={<Truck className="w-4 h-4" />} data={E.byProject} filterKey="project" />
        <Breakdown f={f} toggle={toggle} title={t('بالفرع', 'By branch')} icon={<Home className="w-4 h-4" />} data={E.byCity} filterKey="city" />
        <Breakdown f={f} toggle={toggle} title={t('بالوظيفة', 'By job')} icon={<Users className="w-4 h-4" />} data={E.byJob} filterKey="jobTitle" />
        <Breakdown f={f} toggle={toggle} title={t('بالمشرف', 'By supervisor')} icon={<Users className="w-4 h-4" />} data={E.bySupervisor} filterKey="supervisor" />
        <Breakdown f={f} toggle={toggle} title={t('بنوع المركبة', 'By vehicle type')} icon={<Car className="w-4 h-4" />} data={V.byType} filterKey="vehicleType" />
        <Breakdown f={f} toggle={toggle} title={t('مركبات بحالة التشغيل', 'Vehicles by service status')} icon={<Car className="w-4 h-4" />} data={V.byServiceStatus} />
      </div>

      {/* ── ما يحتاج عملًا — وكلُّ رقمٍ يفتح أصحابه ─────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-slate-400" />{t('ما يحتاج عملًا', 'Needs attention')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Small label={t('يعملون بلا مركبة', 'Working without a vehicle')} value={d.gaps.workingWithoutVehicle} href={people({ hasVehicle: 'no', status: 'يعمل,إجازة' })} />
          <Small label={t('مركبات واقفة', 'Idle vehicles')} value={d.gaps.idleVehicles} href={vehiclesOf({ vstate: 'idle' })} />
          <Small label={t('تفويض باسم غير الراكب', 'Authorised to someone else')} value={d.gaps.authorizationMismatch}
            onClick={() => router.push('/system/b2c/orders')} hint={t('يُصحَّح من أوامر التشغيل', 'fix from operating orders')} />
          <Small label={t('مناديب بلا مشرف', 'Reps with no supervisor')} value={d.gaps.noSupervisor} href={people({ staffKind: 'rep', supervisor: 'none' })} />
          <Small label={t('بلا سكن', 'Unhoused')} value={d.gaps.unhoused} href={people({ housing: 'none' })} />
          <Small label={t('بلا ملفّ في الموارد البشرية', 'No HR file')} value={d.gaps.noHrFile} hint={t('القسم يملك سجلّهم', 'owned by the section')} />
          {/* نُقل في الموارد البشريّة إلى قسمٍ آخر ولم يُخرَج من سجلّ القسم — يُراجَع. */}
          <Small label={t(`قسمه في الموارد البشرية غير ${B.b2cDepartment}`, `HR department is not ${B.b2cDepartment}`)} value={B.otherDepartment}
            hint={t('نُقل هناك — يُراجَع هنا', 'moved in HR — review here')} />
          <Small label={t('أوامر تشغيل سارية', 'Active orders')} value={d.orders.active} href="/system/b2c/orders" />
        </div>
      </section>

      {/* ── السكن ───────────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
          <Home className="w-4 h-4 text-slate-400" />{t('السكن', 'Housing')}
          <Link href="/system/b2c/settings" className="font-normal text-[#f37121] hover:underline">{t('إدارة السكن', 'manage')}</Link>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Small label={t('لهم سكن', 'Housed')} value={E.housed} />
          <Small label={t('بلا سكن', 'Unhoused')} value={E.unhoused} href={people({ housing: 'none' })} />
          <Small label={t('سعة السكن', 'Total capacity')} value={d.housing.reduce((n, h) => n + h.capacity, 0)} />
          <Small label={t('الأماكن المتاحة', 'Places free')} value={d.housing.reduce((n, h) => n + h.free, 0)} />
        </div>
        {!!d.housing.length && (
          <div className={BOX}>
            <ScrollX>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 text-slate-500 text-[11.5px]">
                  <tr>{[t('السكن', 'Housing'), t('المدينة', 'City'), t('السعة', 'Capacity'), t('مشغول', 'Occupied'),
                    t('متاح', 'Free'), t('الغرف', 'Rooms')]
                    .map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.housing.map((h) => {
                    const full = h.capacity > 0 && h.occupied >= h.capacity;
                    return (
                      <tr key={h._id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          <Link href={people({ housing: h._id })} className="hover:underline">{h.name}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{h.cityAr || '—'}</td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold">{h.capacity}</td>
                        <td className="px-3 py-2.5 tabular-nums">{h.occupied}</td>
                        <td className="px-3 py-2.5 tabular-nums">{full ? <span className="text-slate-500">{t('مكتمل', 'full')}</span> : h.free}</td>
                        <td className="px-3 py-2.5">
                          {!h.rooms.length ? <span className="text-slate-400 text-[11.5px]">{t('بلا غرف', 'no rooms')}</span> : (
                            <span className="flex flex-wrap gap-1">
                              {h.rooms.map((r) => (
                                <span key={r.name} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10.5px] font-semibold text-slate-600"
                                  title={r.kind === 'rep' ? t('للمناديب', 'reps') : r.kind === 'admin' ? t('للإداريين', 'admin') : t('للجميع', 'anyone')}>
                                  {r.name} {r.occupied}/{r.capacity}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link href="/system/b2c/light-transport" className="text-[12.5px] font-semibold text-[#f37121] hover:underline">{t('سجل الموظفين ←', 'Employee register →')}</Link>
        <span className="text-slate-300">·</span>
        <Link href="/system/b2c/vehicles" className="text-[12.5px] font-semibold text-[#f37121] hover:underline">{t('مركبات القسم ←', 'Section vehicles →')}</Link>
        <span className="text-slate-300">·</span>
        <Link href="/system/finance/light-transport" className="text-[12.5px] font-semibold text-[#f37121] hover:underline">{t('ماليات النقل الخفيف ←', 'Light-transport finance →')}</Link>
      </div>
    </div>
  );
}
