'use client';
/**
 * لوحةُ قسم الأفراد والنقل الخفيف — الصورةُ الكاملة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كانت هذه اللوحةُ تقريرَ طلباتٍ ومناديب: أعدادُ الأوردرات وتحقيقُ الهدف
 * وحدَهما. وهي زاويةٌ من القسم لا القسمُ كلُّه — فلا يُقرأ فيها كم موظّفًا في
 * فرعٍ، ولا كم مركبةً واقفة، ولا مَن على كفالةِ أيّ سجلّ، ولا مَن بلا سكن. وذلك
 * التقريرُ انتقل إلى صفحته («تحليل الأوردرات») وبقي كما هو.
 *
 * ── وكلُّ رقمٍ هنا بابٌ ─────────────────────────────────────────────────────
 * «أريد أن أعرف كم على الكفالة، ثمّ أُضيف سجلًّا معيّنًا فيقول تسعة — فأريد
 * التسعةَ أنفسَهم.» فكلُّ كارتٍ يُضغَط فيصير فلترًا، والفلاترُ تتراكم، وكلُّ
 * الأعداد تُعاد محسوبةً على ما بقي — فلا يقول كارتٌ رقمًا ويقول الجدولُ غيرَه.
 * وزرُّ «اعرض القائمة» ينقل الفلترَ نفسَه إلى سجلّ الموظّفين.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import {
  LayoutDashboard, Users, Car, Home, RotateCcw, ArrowRight, BarChart3, Truck, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { statusCls, type LTTotals, type LTOptions } from '@/lib/lightTransport';

interface Overview {
  employees: LTTotals;
  vehicles: {
    total: number; totalAll: number; withRider: number; idle: number; onActiveOrder: number;
    byType: Record<string, number>; byProject: Record<string, number>; byServiceStatus: Record<string, number>;
  };
  housing: { _id: string; name: string; cityAr?: string; capacity: number; occupied: number; free: number;
    rooms: { name: string; kind: string; capacity: number; occupied: number; free: number }[] }[];
  orders: { active: number };
  /** ما ينقص ويحتاج عملًا — لا ما هو قائم. */
  gaps: {
    workingWithoutVehicle: number; idleVehicles: number; noRegister: number;
    noContractType: number; noSupervisor: number; unhoused: number;
    noHrFile: number; authorizationMismatch: number;
  };
  options: LTOptions;
}

const qsOf = (o: Record<string, string>) =>
  Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export default function B2CDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();

  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<Record<string, string>>({});
  const active = Object.entries(f).filter(([, v]) => v);
  const toggle = (k: string, v: string) => setF((p) => ({ ...p, [k]: p[k] === v ? '' : v }));

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const token = guard.begin();
    try {
      const r = await api.get<Overview>(`/api/light-transport/overview${qsOf(f) ? `?${qsOf(f)}` : ''}`);
      if (!guard.isCurrent(token)) return;
      setD(r);
    } catch { /* تبقى الشاشةُ على ما لديها */ }
    if (guard.isCurrent(token)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(f), guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));
  useSocket('hr:employee', useCallback(() => load(), [load]));
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{t('تعذّر تحميل اللوحة', 'Could not load the board')}</div>;

  const E = d.employees; const V = d.vehicles;

  const Card = ({ label, value, of, accent, onClick, on, hint }: {
    label: string; value: any; of?: number; accent?: string; onClick?: () => void; on?: boolean; hint?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`text-start bg-white border rounded-xl px-3.5 py-3 shadow-sm transition-all ${
        on ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'} ${onClick ? 'hover:border-[#f37121]/50 cursor-pointer' : ''}`}>
      <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
      <p className={`text-[21px] font-extrabold tabular-nums leading-tight ${accent || 'text-slate-900'}`}>
        {value}{of != null && <span className="text-[12px] font-normal text-slate-400"> / {of}</span>}
      </p>
      {hint && <p className="text-[10.5px] text-slate-400 mt-0.5">{hint}</p>}
    </button>
  );

  /**
   * تقسيمةٌ تُقرأ وتُضغَط: كلُّ سطرٍ عددٌ وشريطٌ ونسبة، وضغطُه يفلتر عليه.
   * والصفرُ لا يُعرَض — سطرٌ بصفرٍ يزحم ولا يُخبر.
   */
  const Breakdown = ({ title, icon, data, filterKey, accent = '#f37121', hrefBase }: {
    title: string; icon: React.ReactNode; data: Record<string, number>; filterKey?: string; accent?: string; hrefBase?: string;
  }) => {
    const rows = Object.entries(data || {}).filter(([k, v]) => v > 0 && k !== '—').sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    const totalOf = rows.reduce((n, [, v]) => n + v, 0);
    if (!rows.length) return null;
    return (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="h-1" style={{ background: accent }} />
        <div className="px-4 pt-3 pb-3">
          <h3 className="font-extrabold text-slate-900 text-[13.5px] flex items-center gap-1.5 mb-2.5">
            <span style={{ color: accent }}>{icon}</span>{title}
            <span className="text-slate-400 font-normal text-[11.5px]">({totalOf})</span>
          </h3>
          <div className="space-y-1.5">
            {rows.map(([k, v]) => {
              const on = filterKey ? f[filterKey] === k : false;
              const inner = (
                <>
                  <span className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className={`truncate ${on ? 'font-bold text-[#f37121]' : 'text-slate-700'}`}>{k}</span>
                    <span className="tabular-nums font-bold text-slate-900 shrink-0">
                      {v}<span className="text-slate-400 font-normal text-[10.5px]"> · {Math.round((v / totalOf) * 100)}%</span>
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: on ? '#f37121' : accent }} />
                  </span>
                </>
              );
              return filterKey ? (
                <button key={k} type="button" onClick={() => toggle(filterKey, k)}
                  className={`w-full text-start rounded-lg px-2 py-1.5 transition-colors ${on ? 'bg-[#f37121]/10' : 'hover:bg-slate-50'}`}>
                  {inner}
                </button>
              ) : hrefBase ? (
                <Link key={k} href={`${hrefBase}${encodeURIComponent(k)}`} className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">{inner}</Link>
              ) : (
                <div key={k} className="px-2 py-1.5">{inner}</div>
              );
            })}
          </div>
        </div>
      </section>
    );
  };

  // ما يُصدَّر: التقسيماتُ كلُّها في ورقةٍ واحدةٍ مسطَّحة — تُلصَق في بريدٍ أو تُطبع.
  const flat = [
    ...Object.entries(E.byProject || {}).map(([k, v]) => ({ group: t('المشروع', 'Project'), value: k, count: v })),
    ...Object.entries(E.byCity || {}).map(([k, v]) => ({ group: t('الفرع', 'Branch'), value: k, count: v })),
    ...Object.entries(E.byJob || {}).map(([k, v]) => ({ group: t('الوظيفة', 'Job'), value: k, count: v })),
    ...Object.entries(E.byContract || {}).map(([k, v]) => ({ group: t('نوع التعاقد', 'Contract'), value: k, count: v })),
    ...Object.entries(E.byRegister || {}).map(([k, v]) => ({ group: t('السجل', 'Register'), value: k, count: v })),
    ...Object.entries(E.byStatus || {}).map(([k, v]) => ({ group: t('حالة العمل', 'Status'), value: k, count: v })),
    ...Object.entries(E.bySupervisor || {}).map(([k, v]) => ({ group: t('المشرف', 'Supervisor'), value: k, count: v })),
    ...Object.entries(V.byType || {}).map(([k, v]) => ({ group: t('نوع المركبة', 'Vehicle type'), value: k, count: v })),
    ...Object.entries(V.byServiceStatus || {}).map(([k, v]) => ({ group: t('حالة تشغيل المركبة', 'Vehicle service'), value: k, count: v })),
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة قسم الأفراد', 'B2C board')}
        subtitle={t('الموظفون والمركبات والسكن — وكل رقم يُضغط فيصير فلترًا', 'People, vehicles and housing — every number is a filter')}>
        <ExportMenu fileName="b2c-board" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export')}
          options={[{
            key: 'board', label: t('تقسيمات اللوحة', 'Board breakdowns'),
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
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:border-[#f37121]/50">
          <BarChart3 className="w-4 h-4" /> {t('تحليل الأوردرات', 'Orders analysis')}
        </Link>
      </PageHeader>

      {/* ── الفلاترُ الشغّالةُ معروضةٌ ومُزالةٌ واحدًا واحدًا ────────────────────
          الفلترُ الخفيُّ يجعل الرقمَ يُقرأ خطأً — فهي مكتوبةٌ، وكلُّ واحدٍ يُرفَع
          بضغطة، ومعها زرٌّ ينقل الفلترَ نفسَه إلى القائمة. */}
      {!!active.length && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#f37121]/30 bg-[#f37121]/5 px-3 py-2.5">
          <span className="text-[12px] font-bold text-slate-700">{t('الفلاتر الشغّالة:', 'Active filters:')}</span>
          {active.map(([k, v]) => (
            <button key={k} type="button" onClick={() => setF((p) => ({ ...p, [k]: '' }))}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[12px] font-semibold text-slate-700 hover:border-red-300 hover:text-red-600">
              {v} <span className="text-slate-400">×</span>
            </button>
          ))}
          <button type="button" onClick={() => setF({})}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f37121]/10 text-[#f37121] text-[12px] font-bold">
            <RotateCcw className="w-3.5 h-3.5" /> {t('مسح الكل', 'Clear all')}
          </button>
          <button type="button" onClick={() => router.push(`/system/b2c/light-transport?${qsOf(f)}`)}
            className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold">
            {t('اعرض القائمة بهذه الفلاتر', 'Show the list with these filters')}
            <ArrowRight className={`w-3.5 h-3.5 ${isRTL ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}

      {/* ── الناس ───────────────────────────────────────────────────────────── */}
      <h2 className="text-[13px] font-extrabold text-slate-500 flex items-center gap-1.5 pt-1">
        <Users className="w-4 h-4" />{t('الموظفون', 'People')}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Card label={t('الإجمالي', 'Total')} value={E.total} onClick={() => setF({})} on={!active.length} />
        <Card label={t('مناديب', 'Reps')} value={E.reps} accent="text-indigo-600" onClick={() => toggle('staffKind', 'rep')} on={f.staffKind === 'rep'} />
        <Card label={t('إداريون', 'Admin')} value={E.admins} accent="text-teal-600" onClick={() => toggle('staffKind', 'admin')} on={f.staffKind === 'admin'}
          hint={t('مشرف · فني · نظافة', 'supervisor, technician, cleaning')} />
        <Card label={t('على رأس العمل', 'Working')} value={E.working} accent="text-emerald-600" onClick={() => toggle('status', 'يعمل')} on={f.status === 'يعمل'} />
        <Card label={t('في إجازة', 'On leave')} value={E.onLeave} accent="text-sky-600" onClick={() => toggle('status', 'إجازة')} on={f.status === 'إجازة'} />
        <Card label={t('أُنهيت خدمتهم', 'Service ended')} value={E.terminated} accent="text-red-600" onClick={() => toggle('status', 'إنهاء خدمة')} on={f.status === 'إنهاء خدمة'}
          hint={t('من الموارد البشرية', 'from HR')} />
      </div>

      {/* ── المركبات ─────────────────────────────────────────────────────────
          تُعَدّ من سجلّ المركبات لا من صفوف الموظّفين: مركبةٌ بلا راكبٍ لا تظهر
          في صفوفهم، وهي أوّلُ ما يُسأل عنه. */}
      <h2 className="text-[13px] font-extrabold text-slate-500 flex items-center gap-1.5 pt-1">
        <Car className="w-4 h-4" />{t('المركبات', 'Vehicles')}
        <span className="font-normal text-slate-400">{t('من سجلّ المركبات — قطاع النقل الخفيف', 'from the vehicle registry — light-transport sector')}</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Card label={t('المعروضة', 'Shown')} value={V.total} of={V.totalAll !== V.total ? V.totalAll : undefined} />
        <Card label={t('عليها راكب', 'With a rider')} value={V.withRider} accent="text-emerald-600" />
        <Card label={t('واقفة بلا راكب', 'Idle — no rider')} value={V.idle} accent="text-amber-600"
          onClick={() => toggle('hasVehicle', 'no')} on={f.hasVehicle === 'no'} />
        <Card label={t('عليها أمر تشغيل سارٍ', 'Under an active order')} value={V.onActiveOrder} accent="text-indigo-600" />
        <Card label={t('لهم مركبة', 'Employees with a vehicle')} value={E.withVehicle} accent="text-slate-900"
          onClick={() => toggle('hasVehicle', 'yes')} on={f.hasVehicle === 'yes'} />
        <Card label={t('بلا مركبة', 'Employees without one')} value={E.withoutVehicle} accent="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Breakdown title={t('بالمشروع', 'By project')} icon={<Truck className="w-4 h-4" />} data={E.byProject} filterKey="project" accent="#f37121" />
        <Breakdown title={t('بالفرع', 'By branch')} icon={<Home className="w-4 h-4" />} data={E.byCity} filterKey="city" accent="#0891b2" />
        <Breakdown title={t('بالوظيفة', 'By job')} icon={<Users className="w-4 h-4" />} data={E.byJob} filterKey="jobTitle" accent="#7c3aed" />
        <Breakdown title={t('بنوع التعاقد', 'By contract')} icon={<Users className="w-4 h-4" />} data={E.byContract} filterKey="contractType" accent="#16a34a" />
        {/* ── والسجلُّ التجاريُّ الذي يكفلهم ───────────────────────────────────
            الشركةُ لها أكثرُ من سجلّ، ومن ليس على كفالتنا لا سجلَّ له. وهو
            سؤالٌ يُسأل عند التفتيش وعند التأمين. */}
        <Breakdown title={t('بالسجل التجاري (الكفالة)', 'By commercial register')} icon={<Users className="w-4 h-4" />} data={E.byRegister} filterKey="register" accent="#ca8a04" />
        <Breakdown title={t('بحالة العمل', 'By work status')} icon={<Users className="w-4 h-4" />} data={E.byStatus} filterKey="status" accent="#dc2626" />
        <Breakdown title={t('بالمشرف', 'By supervisor')} icon={<Users className="w-4 h-4" />} data={E.bySupervisor} filterKey="supervisor" accent="#0ea5e9" />
        <Breakdown title={t('بنوع المركبة', 'By vehicle type')} icon={<Car className="w-4 h-4" />} data={V.byType} filterKey="vehicleType" accent="#4f46e5" />
        <Breakdown title={t('مركبات بحالة التشغيل', 'Vehicles by service status')} icon={<Car className="w-4 h-4" />} data={V.byServiceStatus} accent="#64748b" />
      </div>

      {/* ── ما يحتاج عملًا ────────────────────────────────────────────────────
          اللوحةُ إلى هنا تقول ما هو قائم. وهذه تقول ما ينقص — وهي أسئلةٌ تُسأل
          كلَّ أسبوع ولا جوابَ لها إلّا بالفرز اليدويّ. وكلُّ رقمٍ يفتح أصحابَه. */}
      <h2 className="text-[13px] font-extrabold text-slate-500 flex items-center gap-1.5 pt-1">
        <AlertTriangle className="w-4 h-4" />{t('ما يحتاج عملًا', 'Needs attention')}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Card label={t('يعملون بلا مركبة', 'Working without a vehicle')} value={d.gaps.workingWithoutVehicle}
          accent={d.gaps.workingWithoutVehicle ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => router.push('/system/b2c/light-transport?hasVehicle=no&status=يعمل')} />
        <Card label={t('مركبات واقفة', 'Idle vehicles')} value={d.gaps.idleVehicles}
          accent={d.gaps.idleVehicles ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => toggle('hasVehicle', 'no')} on={f.hasVehicle === 'no'} />
        {/* الورقةُ باسم غيرِ الراكب: لا تُكتشَف — إن لم تُعرَض — إلّا عند مخالفة. */}
        <Card label={t('تفويض باسم غير الراكب', 'Authorised to someone else')} value={d.gaps.authorizationMismatch}
          accent={d.gaps.authorizationMismatch ? 'text-red-600' : 'text-slate-900'}
          onClick={() => router.push('/system/b2c/orders')} hint={t('يُصحَّح من أوامر التشغيل', 'fix from operating orders')} />
        <Card label={t('بلا سجل كفالة', 'No register')} value={d.gaps.noRegister}
          accent={d.gaps.noRegister ? 'text-amber-600' : 'text-slate-900'} />
        <Card label={t('بلا نوع تعاقد', 'No contract type')} value={d.gaps.noContractType}
          accent={d.gaps.noContractType ? 'text-amber-600' : 'text-slate-900'} />
        <Card label={t('مناديب بلا مشرف', 'Reps with no supervisor')} value={d.gaps.noSupervisor}
          accent={d.gaps.noSupervisor ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => toggle('staffKind', 'rep')} on={f.staffKind === 'rep'} />
        <Card label={t('بلا سكن', 'Unhoused')} value={d.gaps.unhoused}
          accent={d.gaps.unhoused ? 'text-amber-600' : 'text-slate-900'}
          onClick={() => toggle('housing', 'none')} on={f.housing === 'none'} />
        <Card label={t('بلا ملفّ في الموارد البشرية', 'No HR file')} value={d.gaps.noHrFile}
          hint={t('القسم يملك سجلّهم', 'owned by the section')} accent="text-violet-600" />
      </div>

      {/* ── السكن ───────────────────────────────────────────────────────────── */}
      <h2 className="text-[13px] font-extrabold text-slate-500 flex items-center gap-1.5 pt-1">
        <Home className="w-4 h-4" />{t('السكن', 'Housing')}
        <Link href="/system/b2c/settings" className="font-normal text-[#f37121] hover:underline">{t('إدارة السكن', 'manage')}</Link>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Card label={t('لهم سكن', 'Housed')} value={E.housed} accent="text-slate-900" />
        <Card label={t('بلا سكن', 'Unhoused')} value={E.unhoused} accent="text-amber-600"
          onClick={() => toggle('housing', 'none')} on={f.housing === 'none'} />
        <Card label={t('سعة السكن', 'Total capacity')} value={d.housing.reduce((n, h) => n + h.capacity, 0)} />
        <Card label={t('الأماكن المتاحة', 'Places free')} value={d.housing.reduce((n, h) => n + h.free, 0)} accent="text-emerald-600" />
      </div>

      {!!d.housing.length && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <ScrollX>
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-slate-600 text-[11.5px] uppercase tracking-wide">
                <tr>{[t('السكن', 'Housing'), t('المدينة', 'City'), t('السعة', 'Capacity'), t('مشغول', 'Occupied'),
                  t('متاح', 'Free'), t('الغرف', 'Rooms')]
                  .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.housing.map((h) => {
                  const full = h.capacity > 0 && h.occupied >= h.capacity;
                  return (
                    <tr key={h._id} className="hover:bg-orange-50/40">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">
                        <button type="button" onClick={() => toggle('housing', h._id)}
                          className={`hover:text-[#f37121] ${f.housing === h._id ? 'text-[#f37121]' : ''}`}>{h.name}</button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{h.cityAr || '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold">{h.capacity}</td>
                      <td className="px-3 py-2.5 tabular-nums">{h.occupied}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${full ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {full ? t('مكتمل', 'full') : h.free}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {!h.rooms.length ? <span className="text-slate-400 text-[11.5px]">{t('بلا غرف', 'no rooms')}</span> : (
                          <span className="flex flex-wrap gap-1">
                            {h.rooms.map((r) => (
                              <span key={r.name}
                                className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold ${r.capacity > 0 && r.occupied >= r.capacity ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}
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

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link href="/system/b2c/light-transport" className="text-[12.5px] font-bold text-[#f37121] hover:underline">{t('سجل الموظفين ←', 'Employee register →')}</Link>
        <span className="text-slate-300">·</span>
        <Link href="/system/b2c/orders" className="text-[12.5px] font-bold text-[#f37121] hover:underline">{t('أوامر التشغيل ←', 'Operating orders →')}</Link>
        <span className="text-slate-300">·</span>
        <Link href="/system/finance/light-transport" className="text-[12.5px] font-bold text-[#f37121] hover:underline">{t('ماليات النقل الخفيف ←', 'Light-transport finance →')}</Link>
        <span className="text-slate-300">·</span>
        <span className="text-[12px] text-slate-500">{t(`أوامر تشغيل سارية: ${d.orders.active}`, `Active orders: ${d.orders.active}`)}</span>
      </div>
    </div>
  );
}
