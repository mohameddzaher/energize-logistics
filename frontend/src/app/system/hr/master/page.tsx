'use client';
// نظرة الموارد البشرية الشاملة — كارت لكل عمود، وقايمة شغل مش أرقام.
//
// كل رقم «مطلوب» معناه بيانات ناقصة لازم التيم يجمّعها، والضغط عليه بيفتح
// الناس اللي وراه عشان يتملي من هناك على طول. و«غير مطلوب» متعدّة لوحدها —
// سعودي مالوش إقامة مش «ناقص إقامة»، وحطّه في قايمة الشغل بيضيّع وقت الناس.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import MasterNav from '@/components/hr/MasterNav';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Users, CalendarClock, ChevronLeft, TriangleAlert, ClipboardList, Search, BarChart3,
} from 'lucide-react';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import {
  getHrOverview, STATUS_META, STATE_META, statusLabel, stateLabel, HR_DATE_FIELDS,
  type HrOverview, type GroupCard, type FieldCard, type AnalyticBlock,
} from '@/lib/hrMaster';
import api from '@/lib/api';

export default function HrMasterPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<HrOverview | null>(null);
  // الجزء التشغيلي (إجازات، طلبات، عهد، تراخيص) جاي من داشبورد الموارد البشرية
  // القديمة — الصفحة دي بقت المكان الوحيد، فما ينفعش نسيب حاجة وراها.
  const [ops, setOps] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // الفلتر هو مصدر كل رقم في هذه الصفحة. البطاقات والتحليلات كلها تُعاد قراءتها
  // منه، فلا يبقى في الشاشة رقمٌ محسوبٌ على مجموعة غير التي يراها المستخدم.
  const [filters, setFilters] = useState<FilterValues>({});
  const onlyActive = filters.employment === 'active';

  // التراخيص وحدها تأتي من الداشبورد العامّ، وهي لا تتحرّك مع الفلتر — فتُقرأ
  // مرّةً واحدة عند فتح الصفحة، لا مع كل ضغطةٍ على فلتر.
  useEffect(() => { api.get<any>('/api/hr/dashboard').then(setOps).catch(() => {}); }, []);

  const load = useCallback(async () => {
    // الشاشة تبقى معروضةً باهتةً أثناء التحديث بدل أن تُفرَّغ: الفراغ يجعل كل
    // ضغطة فلترٍ تبدو انقطاعًا، والباهت يقول «يُحدَّث» بلا أن يأخذ الصفحة منك.
    setRefreshing(true);
    try {
      setD(await getHrOverview(filters));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
    setRefreshing(false);
  }, [JSON.stringify(filters), notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  /**
   * يفتح صفحة المجموعة على الصفوف التي وراء الرقم المضغوط بالضبط.
   *
   * الفلتر النشط يُحمل معه. لولا ذلك لفتح «١٢ مطلوبًا» وأنت تنظر إلى جدة على
   * الاثني عشر في الشركة كلها — رقمٌ ضغطتَه فأعطاك غيره.
   */
  const open = (group: string, q: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...filters, ...q } as Record<string, string>).toString();
    router.push(`/system/hr/master/${group}${p ? `?${p}` : ''}`);
  };
  /**
   * كل رقم يفتح الصفوف التي وراءه — لا يُضيف فلترًا إلى هذه الصفحة.
   *
   * كان الضغط على «ليس على رأس العمل ١٣» يُضيف الشرط إلى فلتر اللوحة، فتبقى
   * أمامك اللوحة نفسها بأرقامٍ أصغر ولا ترى الثلاثة عشر. والفرق بين الأمرين
   * هو الفرق بين سؤالٍ وجواب: الفلتر يصنع الرقم، والضغط على الرقم يُري مَن فيه.
   * «الهوية» هي المجموعة العامّة التي تعرض الموظف ببياناته الأساسية.
   */
  const drill = (q: Record<string, string>) => open('identity', q);

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
          <button onClick={() => router.push('/system/hr/master/expiring')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm">
            <CalendarClock className="w-4 h-4" /> {t('الانتهاءات', 'Expiries')}
          </button>
        </div>
      </PageHeader>

      {/* شريط الفلترة — كل ما تحته محسوب عليه */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <FilterPanel
          optionsUrl="/api/hr/master/filters"
          value={filters}
          onChange={setFilters}
          dateFields={HR_DATE_FIELDS}
          resultCount={d?.totals?.filtered}
          resultLabel={t('الموظفون المطابقون', 'Matching employees')}
          extraLabels={{
            employment: { ar: 'حالة التوظيف', en: 'Employment', values: {
              active: { ar: 'على رأس العمل', en: 'Active' },
              inactive: { ar: 'ليس على رأس العمل', en: 'Not active' } } },
            outsideKingdom: { ar: 'خارج المملكة', en: 'Outside kingdom', values: { 1: { ar: 'خارج المملكة', en: 'Outside kingdom' } } },
            freelancer: { ar: 'عمل حر', en: 'Freelancer', values: { 1: { ar: 'عمل حر', en: 'Freelancer' } } },
          }}
          extra={(
            <div className="flex items-center gap-1.5 flex-wrap">
              {([['', 'الكل', 'All'], ['active', 'على رأس العمل', 'Active'], ['inactive', 'ليس على رأس العمل', 'Not active']] as const).map(([v, a, e]) => (
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
      {/* الأرقام الكبيرة */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
        {/* كل رقم هنا محسوب على ما يعرضه الفلتر. «الموظفون» يحمل تحته إجمالي
            الملفّ الوظيفيّ ليُعرف من أيٍّ اقتُطع هذا العدد. */}
        <Big label={t('الموظفون', 'Employees')} value={d.totals.employees} c="#f37121"
          sub={countActive(filters) > 0 ? t(`من ${d.totals.roster}`, `of ${d.totals.roster}`) : undefined}
          onClick={() => open('identity')} />
        <Big label={t('على رأس العمل', 'Active')} value={d.totals.active} c="#16a34a"
          onClick={() => drill({ employment: 'active' })} />
        <Big label={t('ليس على رأس العمل', 'Not active')} value={d.totals.notActive} c="#94a3b8"
          onClick={() => drill({ employment: 'inactive' })} />
        <Big label={t('بيانات مطلوبة', 'Required fields')} value={d.totals.required} c="#dc2626"
          onClick={() => open('identity', { status: 'required' })} />
        <Big label={t('ينتهي قريبًا', 'Expiring soon')} value={d.totals.expiringSoon} c="#ea580c"
          onClick={() => router.push('/system/hr/master/expiring')} />
        <Big label={t('مسجّل بالتأمينات', 'GOSI registered')} value={d.totals.gosiRegistered} c="#0ea5e9"
          onClick={() => open('gosi')} />
        <Big label={t('خارج المملكة', 'Outside kingdom')} value={d.totals.outsideKingdom} c="#64748b"
          onClick={() => drill({ outsideKingdom: '1' })} />
        <Big label={t('عمل حر', 'Freelancers')} value={d.totals.freelancers} c="#0f172a"
          onClick={() => drill({ freelancer: '1' })} />
      </div>

      {/* الشغل اليوميّ — محسوبٌ على الموظفين المطابقين وحدهم */}
      <div className="grid grid-cols-3 gap-2.5">
        <Big label={t('إجازات قيد المراجعة', 'Leaves pending')} value={d.work?.pendingLeaves ?? 0} c="#0ea5e9"
          onClick={() => router.push('/system/hr/leaves')} />
        <Big label={t('طلبات مفتوحة', 'Open requests')} value={d.work?.openRequests ?? 0} c="#8b5cf6"
          onClick={() => router.push('/system/hr/requests')} />
        <Big label={t('عهد بعهدة الموظفين', 'Assets held')} value={d.work?.assignedAssets ?? 0} c="#0f172a"
          onClick={() => router.push('/system/hr/custody')} />
      </div>

      {/* التراخيص والاشتراكات على مستوى الشركة، لا على مستوى الموظفين — فلا
          يحرّكها فلترُ جنسيةٍ أو فرع. مفصولةٌ بعنوانها حتى لا يُظنّ أنها لم
          تسمع الفلتر. */}
      {ops?.summary && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">
            {t('على مستوى الشركة — لا يحرّكها الفلتر', 'Company-wide — not affected by the filter')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Big label={t('التراخيص والاشتراكات', 'Licences')} value={ops.summary.licensesTotal} c="#64748b"
              onClick={() => router.push('/system/hr/licenses')} />
            <Big label={t('تراخيص تنتهي خلال ٦٠ يوم', 'Licences due 60d')} value={ops.summary.licensesExpiringCount} c="#f59e0b"
              onClick={() => router.push('/system/hr/licenses')} />
            <Big label={t('تراخيص منتهية', 'Licences expired')} value={ops.summary.licensesExpiredCount} c="#dc2626"
              onClick={() => router.push('/system/hr/licenses')} />
          </div>
        </section>
      )}

      {/* التحليلات — شرائح مشتقّة، كل شريحة تفلتر الصفحة عند الضغط */}
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

      {/* توزيع كل عمود له قيم متكرّرة — بطاقة لكل عمود */}
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

      {/* ابدأ من هنا — أكتر البيانات نقصًا */}
      {!!d.topRequired.length && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-slate-800">{t('ابدأ من هنا — أكتر البيانات نقصًا', 'Start here — most missing')}</h2>
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

      {/* المستندات ذات التاريخ */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('المستندات ومواعيد انتهائها', 'Documents and their expiry')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.filter((g) => g.document).map((g) => (
            <DocGroupCard key={g.key} g={g} ar={ar} t={t} onOpen={open} />
          ))}
        </div>
      </section>

      {/* كل مجموعة وكل حقل جواها */}
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

function Big({ label, value, c, onClick, sub }: {
  label: string; value: any; c: string; onClick?: () => void;
  /** سطرٌ صغير تحت الرقم — يُستعمل لإجمالي الملفّ بجانب الرقم المفلتر. */
  sub?: string;
}) {
  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm h-full">
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-extrabold leading-none" style={{ color: c }}>{value}</p>
        {sub && <span className="text-[10px] text-slate-400 font-semibold tabular-nums">{sub}</span>}
      </div>
      <p className="text-[10.5px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </div>
  );
  return onClick ? <button onClick={onClick} className="text-start hover:opacity-90 w-full">{inner}</button> : <div>{inner}</div>;
}

// كارت مستند: حالات التاريخ فوق، وحالة الحقول تحت.
function DocGroupCard({ g, ar, t, onOpen }: { g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  const s = g.states!;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <button onClick={() => onOpen(g.key)} className="font-bold text-slate-900 text-sm hover:text-[#f37121]">
          {ar ? g.ar : g.en}
        </button>
        {!!g.needsAttention && (
          <button onClick={() => onOpen(g.key, { state: 'expired' })}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
            <TriangleAlert className="w-3 h-3" />{g.needsAttention}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => (
          <button key={k} onClick={() => onOpen(g.key, { state: k })}
            className="rounded-lg border border-slate-100 py-2 hover:border-slate-300 transition-colors">
            <p className="text-lg font-extrabold leading-none" style={{ color: STATE_META[k].color }}>{s[k]}</p>
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

// كارت مجموعة: كل حقل بعدّاداته الأربعة.
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
      className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${STATUS_META[code]?.bg || 'bg-slate-100 text-slate-600'} hover:opacity-80`}>
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
          {chip('filled', c.filled)}
          {chip('none', c.none)}
        </div>
      </div>
      {/* الحقول اللي ليها قيم متكرّرة (القسم، الجنسية…) بتتفتح بتوزيعها */}
      {!!f.values?.length && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="text-[10px] text-slate-400 hover:text-slate-700 mt-0.5">
            {open ? t('إخفاء التوزيع', 'Hide breakdown') : t(`التوزيع (${f.values.length})`, `Breakdown (${f.values.length})`)}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── بطاقة تحليل: شرائح أفقية بعرض متناسب مع العدد ─────────────────────────────
//
// الشريحة تحمل معها الفلتر الذي يُنتجها؛ الضغط عليها يضيفه إلى الفلتر بدل أن
// تُعيد الواجهة تخمين الشرط — فلا يفترق الرقم المعروض عن الصفوف التي يفتحها.
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

// ── بطاقة توزيع عمود: أعلى القيم، وبقيّتها خلف زر ────────────────────────────
//
// فوق البطاقة عدّادا «مطلوب» و«غير مطلوب» — لأنهما ليسا وجهين لعملة: «مطلوب»
// عملٌ ينتظر، و«غير مطلوب» لا شيء فيه أصلًا، وخلطهما يصنع قائمة عملٍ كاذبة.
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
