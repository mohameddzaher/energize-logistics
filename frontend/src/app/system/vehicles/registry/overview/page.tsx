'use client';
// نظرة شاملة على المركبات — كل عمود في الماستر له كارت، وكل رقم بيتضغط.
//
// الفكرة اللي الصفحة مبنية عليها: صاحب الشركة يبص مرة واحدة ويعرف كل حاجة عن
// المركبات، وأي رقم يشدّ انتباهه يدوس عليه فيلاقي نفسه في القائمة مفلترة عليه
// بالظبط. عشان كده الفلتر بييجي **من السيرفر** مع كل قيمة (`item.filter`) بدل
// ما الصفحة تبنيه — لو بنته هنا كان ممكن يختلف عن اللي السيرفر بيعدّ بيه، ويبقى
// الرقم بيقول حاجة والصفحة بتوري حاجة تانية.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Car, ShieldCheck, CreditCard, FileText, Wrench, Satellite, KeyRound,
  ChevronLeft, Settings, CalendarClock, TriangleAlert,
} from 'lucide-react';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import {
  getOverview, STATE_META, stateLabel, money, fmtDate, daysText,
  type VehicleOverview, type DocCard, type Breakdown,
} from '@/lib/vehicleRegistry';

const DOC_ICON: Record<string, any> = {
  insurance: ShieldCheck, operatingCard: CreditCard, vehicleLicense: FileText,
  inspection: Wrench, gps: Satellite, authorization: KeyRound,
};

function VehiclesOverviewInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<VehicleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // الفلتر هو مصدر كل رقم في هذه الصفحة — البطاقات والتحليلات تُعاد قراءتها منه،
  // فلا يبقى رقمٌ محسوبٌ على أسطولٍ غير الذي يراه المستخدم أمامه.
  // ويعيش في عنوان الصفحة: تفلتر، تفتح رقمًا، ترجع بزرّ المتصفّح فتجد ما بنيتَه
  // كما تركتَه — لا اللوحةَ خامًا وقد ضاع الفلتر مع أوّل انتقال.
  const sp = useSearchParams();
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])]));
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setD(await getOverview(filters as Record<string, string>)); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
    setRefreshing(false);
  }, [JSON.stringify(filters), notify]);
  useEffect(() => { load(); }, [load]);

  // `replace` لا `push`: كل ضغطةِ قيمةٍ لا تستحقّ خطوةً في تاريخ المتصفّح.
  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.replace(`/system/vehicles/registry/overview${q ? `?${q}` : ''}`, { scroll: false });
  }, [JSON.stringify(filters), router]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  /**
   * يفتح القائمة بنفس الفلتر الذي عدّ به الخادم — **مضافًا إليه الفلتر النشط**.
   * لولا ذلك لفتح «١٠ منتهية» وأنت تنظر إلى جدة على العشر في الأسطول كلّه:
   * رقمٌ ضغطتَه فأعطاك غيره.
   */
  const openList = (filter: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries({ ...filters, ...filter }).filter(([, v]) => v !== '') as [string, string][]).toString();
    router.push(`/system/vehicles/registry${q ? `?${q}` : ''}`);
  };
  const openExpiring = (q: Record<string, string | number>) => {
    const p = new URLSearchParams(Object.entries({ ...filters, ...q }).map(([k, v]) => [k, String(v)])).toString();
    router.push(`/system/vehicles/registry/expiring?${p}`);
  };
  /**
   * كل رقم يفتح المركبات التي وراءه — لا يُضيف فلترًا إلى هذه الصفحة.
   *
   * الفرق بين الأمرين هو الفرق بين سؤالٍ وجواب: الفلتر يصنع الرقم، والضغط على
   * الرقم يُري ما فيه. وكان الضغط يُضيف الشرط فتبقى أمامك اللوحة نفسها بأرقامٍ
   * أصغر ولا ترى المركبات أصلًا.
   */
  const drill = (q: Record<string, string>) => openList(q);

  if (loading) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Car className="w-5 h-5" />}
        title={t('نظرة شاملة على المركبات', 'Vehicles Overview')}
        subtitle={t('كل بيانات الأسطول ومستنداته — اضغط أي رقم لتفتح تفاصيله', 'The whole fleet and its paperwork — click any number to open it')}
      >
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/system/vehicles/registry/expiring')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm">
            <CalendarClock className="w-4 h-4" /> {t('الانتهاءات', 'Expiries')}
          </button>
          <button onClick={() => router.push('/system/vehicles/settings')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 text-sm">
            <Settings className="w-4 h-4" /> {t('إعدادات التنبيه', 'Alerts')}
          </button>
        </div>
      </PageHeader>

      {/* شريط الفلترة — كل رقم تحته محسوب عليه */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          resultCount={d?.totals?.vehicles}
          resultLabel={t('المركبات المطابقة', 'Matching vehicles')}
          extraLabels={{
            missing: { ar: 'ينقصها بيانات', en: 'Missing data', values: { 1: { ar: 'ينقصها بيانات', en: 'Missing data' } } },
            logistiGaps: { ar: 'نواقص لوجستي', en: 'Logisti gaps', values: {
              1: { ar: 'ينقصها شرط لوجستي', en: 'Has Logisti gaps' },
              0: { ar: 'مستوفية شروط لوجستي', en: 'Logisti complete' } } },
            hasGps: { ar: 'التتبّع', en: 'GPS', values: {
              1: { ar: 'عليها جهاز تتبّع', en: 'With GPS' },
              0: { ar: 'بلا جهاز تتبّع', en: 'Without GPS' } } },
            expiryDoc: { ar: 'المستند', en: 'Document' },
            missingDocDate: { ar: 'بلا تاريخ', en: 'No date' },
            yearFrom: { ar: 'سنة الصنع من', en: 'Year from' },
            yearTo: { ar: 'سنة الصنع إلى', en: 'Year to' },
            expiryFrom: { ar: 'الانتهاء من', en: 'Expiry from' },
            expiryTo: { ar: 'الانتهاء إلى', en: 'Expiry to' },
          }}
          extra={(
            <div className="flex items-center gap-1.5 flex-wrap">
              {([['missing', '1', 'ينقصها بيانات', 'Missing data'],
                 ['logistiGaps', '1', 'ينقصها شرط لوجستي', 'Logisti gaps'],
                 ['logistiGaps', '0', 'مستوفية شروط لوجستي', 'Logisti complete'],
                 ['hasGps', '1', 'عليها جهاز تتبّع', 'With GPS'],
                 ['hasGps', '0', 'بلا جهاز تتبّع', 'Without GPS']] as const).map(([k, v, a, e]) => (
                <button key={`${k}${v}`}
                  onClick={() => setFilters((f) => { const n = { ...f }; if (n[k] === v) delete n[k]; else n[k] = v; return n; })}
                  className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                    ${filters[k] === v ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {t(a, e)}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* ① الأرقام الكبيرة */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Big label={t('إجمالي المركبات', 'Vehicles')} value={d.totals.vehicles} accent="#f37121" onClick={() => openList({})} />
        <Big label={t('يحتاج متابعة', 'Needs attention')} value={d.totals.needsAttention} accent="#dc2626" onClick={() => openExpiring({ withinDays: 60 })} />
        <Big label={t('أقساط التأمين (ر.س)', 'Premiums (SAR)')} value={money(d.totals.insuredPremiumSar)} accent="#16a34a" />
        <Big label={t('عليها جهاز تتبّع', 'With GPS')} value={d.totals.withGps} accent="#0ea5e9"
          onClick={() => drill({ hasGps: '1' })} />
        <Big label={t('شرائح وقود نشطة', 'Active fuel cards')} value={d.totals.activeFuelCards} accent="#8b5cf6" />
        <Big label={t('مركبات لها حوادث', 'With accidents')} value={d.totals.withAccidents} accent="#ea580c" onClick={() => router.push('/system/vehicles/registry/claims')} />
        <Big label={t('ينقصها بيانات', 'Missing data')} value={d.totals.withMissing} accent="#7c3aed"
          onClick={() => openList({ missing: '1' })} />
      </div>

      {/* ② المستندات — الجزء اللي بيوجع */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('المستندات ومواعيد انتهائها', 'Documents and their expiry')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.documents.map((doc) => <DocumentCard key={doc.key} doc={doc} ar={ar} t={t} onOpen={openExpiring} onList={openList} />)}
        </div>
      </section>

      {/* ③ وثائق الشركة — انتهاؤها بيوقّف الشغل كله */}
      {!!d.corporate.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">{t('وثائق التأمين على مستوى الشركة', 'Company-level policies')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.corporate.map((p) => {
              const m = STATE_META[p.state] || STATE_META.valid;
              return (
                <button key={p._id} onClick={() => router.push('/system/vehicles/registry/corporate')}
                  className="text-start bg-white border rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors"
                  style={{ borderColor: p.state === 'valid' ? undefined : m.color }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{p.scopeAr}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{p.companyAr} · {fmtDate(p.expiryDate)}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${m.bg}`}>
                      {stateLabel(p.state, ar)}
                    </span>
                  </div>
                  <p className="text-[12px] mt-2" style={{ color: m.color }}>{daysText(p.days, ar)}</p>
                  {!!p.premiumSar && <p className="text-[11px] text-slate-400 mt-0.5">{t('القسط', 'Premium')}: {money(p.premiumSar)} {t('ر.س', 'SAR')}</p>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ④ الحوادث — السؤال هنا فلوس */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('الحوادث والمطالبات التأمينية', 'Accidents & insurance claims')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Big label={t('إجمالي الحوادث', 'Total')} value={d.claims.total} accent="#0f172a" onClick={() => router.push('/system/vehicles/registry/claims')} />
          <Big label={t('مطالبات مفتوحة', 'Open claims')} value={d.claims.open} accent="#f59e0b" onClick={() => router.push('/system/vehicles/registry/claims?status=pending')} />
          <Big label={t('الخطأ علينا', 'Our fault')} value={d.claims.ourFault} accent="#dc2626" />
          <Big label={t('المبلغ المقدَّر (ر.س)', 'Estimated (SAR)')} value={money(d.claims.estimatedSar)} accent="#0ea5e9" />
          <Big label={t('متوقع استرداده (ر.س)', 'Expected recovery')} value={money(d.claims.expectedRecoverySar)} accent="#16a34a" />
        </div>
      </section>

      {/* التحليلات — شرائح مشتقّة، كل شريحة تفلتر الصفحة عند الضغط */}
      {!!d.analytics?.length && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">{t('التحليلات', 'Analytics')}</h2>
            <span className="text-[11px] text-slate-400">
              {t('اضغط أيّ شريحة لعرض ما فيها', 'Click any band to see what is in it')}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {d.analytics.map((a) => (
              <AnalyticCard key={a.key} a={a} ar={ar} total={d.totals.vehicles} onPick={drill} active={filters} />
            ))}
          </div>
        </section>
      )}

      {/* النواقص — بندًا بندًا وبسببه. «لا يوجد» و«مطلوب» و«لدى البنك» ثلاثة
          أوضاع مختلفة: الأول نقص، والثاني عملٌ مطلوب، والثالث ليس نقصًا أصلًا. */}
      {!!d.missingBreakdown?.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">
            {t(`نواقص البيانات — ${d.totals.withMissing} مركبة · ${d.totals.missingItems} بندًا`,
               `Missing data — ${d.totals.withMissing} vehicles · ${d.totals.missingItems} items`)}
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {d.missingBreakdown.map((g) => (
              <button key={`${g.item}|${g.reason}`} onClick={() => openList(g.filter)}
                className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:bg-violet-50/60 transition">
                <span className="w-11 shrink-0 text-center px-1.5 py-0.5 rounded-lg bg-violet-100 text-violet-800 text-[12.5px] font-bold tabular-nums">
                  {g.count}
                </span>
                <span className="flex-1 text-[13px] text-slate-900 font-medium">{g.item}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${
                  g.reason === 'required' ? 'bg-rose-100 text-rose-700'
                    : g.reason === 'none' ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-700'}`}>
                  {ar ? g.reasonAr : g.reasonEn}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* نواقص منصّة لوجستي — شرطًا شرطًا، والضغط يفتح المركبات التي ينقصها */}
      {!!d.logistiGaps?.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">
            {t(`نواقص منصّة لوجستي — ${d.totals.withLogistiGaps} مركبة · ${d.totals.logistiGapItems} بندًا`,
               `Logisti platform gaps — ${d.totals.withLogistiGaps} vehicles · ${d.totals.logistiGapItems} items`)}
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {d.logistiGaps.map((g) => (
              <button key={g.value} onClick={() => openList(g.filter)}
                className="w-full text-start px-4 py-2.5 flex items-center gap-3 hover:bg-violet-50/60 transition">
                <span className="w-11 shrink-0 text-center px-1.5 py-0.5 rounded-lg bg-violet-100 text-violet-800 text-[12.5px] font-bold tabular-nums">
                  {g.count}
                </span>
                <span className="flex-1 text-[13px] text-slate-800">{g.value}</span>
                <span className="text-[11.5px] text-slate-500">{t('اعرض المركبات', 'Show vehicles')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ⑤ كارت لكل عمود */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('تفصيل كل عمود', 'Every column, broken down')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.breakdowns.map((b) => <BreakdownCard key={b.key} b={b} ar={ar} t={t} onPick={openList} />)}
        </div>
      </section>
    </div>
  );
}

function Big({ label, value, accent, onClick }: { label: string; value: any; accent: string; onClick?: () => void }) {
  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm h-full">
      <p className="text-2xl font-extrabold leading-none" style={{ color: accent }}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </div>
  );
  return onClick
    ? <button onClick={onClick} className="text-start hover:opacity-90 transition-opacity">{inner}</button>
    : <div>{inner}</div>;
}

// ── كارت مستند ───────────────────────────────────────────────────────────────
// بيفرّق بين حاجتين بيتخلط بينهم دايمًا:
//   الحالات المحسوبة (ساري/منتهي/قارب) — دي بتتغيّر لوحدها كل يوم
//   الحالات الإدارية (مطلوب/غير مطلوب/لا يوجد) — دي حد كتبها
function DocumentCard({ doc, ar, t, onOpen, onList }: {
  doc: DocCard; ar: boolean; t: (a: string, e: string) => string;
  onOpen: (q: Record<string, string | number>) => void; onList: (f: Record<string, string>) => void;
}) {
  const Icon = DOC_ICON[doc.key] || FileText;
  const s = doc.states;
  // ثلاثُ حالاتٍ لا أربع: «ينتهي قريبًا جدًا» و«قارب على الانتهاء» و«على
  // الرادار» شيءٌ واحدٌ بثلاث درجاتٍ من الإلحاح — راجع publicState.
  const rows: { key: string; n: number }[] = [
    { key: 'expired', n: s.expired || 0 },
    { key: 'due', n: (s.critical || 0) + (s.warning || 0) + ((s as any).upcoming || 0) },
    { key: 'valid', n: s.valid || 0 },
  ];
  // الحالات المسجَّلة تُطوى إلى رقمين: ما ينقصنا تاريخه، وما لا يلزم أصلًا.
  // «غير مطلوب» قرارٌ إداريّ لا نقصٌ — خلطه بالنقص يجعل قائمة العمل تكذب.
  const notRequired = s.not_applicable ?? 0;
  const missing = s.missing ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-[#f37121] shrink-0" />
          <h3 className="font-bold text-slate-900 text-sm truncate">{ar ? doc.ar : doc.en}</h3>
        </div>
        {doc.needsAttention > 0 && (
          <button onClick={() => onOpen({ doc: doc.key })}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold shrink-0">
            <TriangleAlert className="w-3 h-3" />{doc.needsAttention}
          </button>
        )}
      </div>

      {/* الحالات المحسوبة */}
      <div className="grid grid-cols-3 gap-1.5">
        {rows.map((r) => {
          const m = STATE_META[r.key];
          return (
            <button key={r.key} onClick={() => onOpen({ doc: doc.key, state: r.key, includeExpired: 1 })}
              className="rounded-lg border border-slate-100 py-2 hover:border-slate-300 transition-colors">
              <p className="text-lg font-extrabold leading-none" style={{ color: m.color }}>{r.n}</p>
              <p className="text-[9.5px] text-slate-500 mt-1 leading-tight px-0.5">{ar ? m.ar : m.en}</p>
            </button>
          );
        })}
      </div>

      {/* ── سطرٌ واحد لما لا تاريخ له ─────────────────────────────────────────
          كانت الحالات الإدارية تُنثَر كلّها شرائحَ بأسمائها من الإكسل، فيصير
          نصفُ الكارت أسماءً لا يبحث عنها أحد ويضيع فيها الأربعة التي تعني عملًا.
          والسؤال الحقيقيّ عمّا لا تاريخ له سؤالان لا سبعة: «ينقصنا» و«لا يلزم
          أصلًا» — وكلاهما يُضغَط فيفتح ما فيه. */}
      {(missing > 0 || notRequired > 0) && (
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
          <button onClick={() => onList({ missingDocDate: doc.key })} className="hover:text-slate-700">
            {t('بلا تاريخ', 'No date')}: <b className="text-slate-600">{missing}</b>
          </button>
          <button onClick={() => onOpen({ doc: doc.key, state: 'not_applicable' })} className="hover:text-slate-700">
            {t('لا ينطبق', 'N/A')}: <b className="text-slate-600">{notRequired}</b>
          </button>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10.5px] text-slate-400">
        <span>
          {t('تنبيه قبل', 'Alert')} {doc.alert?.warnDays ?? 30} {t('يوم', 'days')}
          {doc.alert?.enabled === false && <span className="text-slate-300"> · {t('موقوف', 'off')}</span>}
        </span>
        {doc.nearestDays != null && <span>{t('أقرب انتهاء', 'Next')}: {doc.nearestDays} {t('يوم', 'd')}</span>}
      </div>
    </div>
  );
}

// ── كارت عمود ────────────────────────────────────────────────────────────────
function BreakdownCard({ b, ar, t, onPick }: {
  b: Breakdown; ar: boolean; t: (a: string, e: string) => string; onPick: (f: Record<string, string>) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? b.items : b.items.slice(0, 6);
  const total = b.items.reduce((n, i) => n + i.count, 0) || 1;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h3 className="font-bold text-slate-900 text-sm">{ar ? b.ar : b.en}</h3>
        <span className="text-[11px] text-slate-400">{b.items.length} {t('قيمة', 'values')}</span>
      </div>
      <div className="space-y-1">
        {shown.map((i) => (
          <button key={i.value} onClick={() => onPick(i.filter)}
            className="w-full flex items-center gap-2 group text-start">
            <span className="text-[12px] text-slate-600 truncate flex-1 group-hover:text-slate-900">{i.value}</span>
            <span className="h-1.5 rounded-full bg-[#f37121]/25 shrink-0" style={{ width: `${Math.max(6, (i.count / total) * 60)}px` }} />
            <span className="text-[12px] font-bold text-slate-800 w-9 text-end tabular-nums">{i.count}</span>
            <ChevronLeft className="w-3 h-3 text-slate-300 group-hover:text-[#f37121] rtl:rotate-0 ltr:rotate-180 shrink-0" />
          </button>
        ))}
      </div>
      {b.items.length > 6 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2">
          {all ? t('عرض أقل', 'Show less') : t(`عرض الكل (${b.items.length})`, `Show all (${b.items.length})`)}
        </button>
      )}
    </div>
  );
}

// ── بطاقة تحليل: شرائح أفقية بعرض متناسب مع العدد ─────────────────────────────
//
// الشريحة تحمل معها الفلتر الذي أنتجها؛ الضغط عليها يضيفه إلى الفلتر بدل أن
// تخمّن الواجهة الشرط — فلا يفترق الرقم المعروض عن الصفوف التي يفتحها.
function AnalyticCard({ a, ar, total, onPick, active }:
{ a: VehicleOverview['analytics'][number]; ar: boolean; total: number;
  onPick: (q: Record<string, string>) => void; active: Record<string, string> }) {
  const max = Math.max(1, ...a.items.map((i) => i.count));
  const isOn = (f: Record<string, string>) => Object.entries(f).every(([k, v]) => active[k] === v);
  const colors = a.kind === 'horizon'
    ? ['#dc2626', '#ea580c', '#f59e0b', '#0ea5e9', '#16a34a', '#94a3b8']
    : ['#12325c', '#2a5490', '#3d6aa8', '#5480bf', '#7b9dd1'];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-bold text-slate-900">{ar ? a.ar : a.en}</h3>
        <span className="text-[10.5px] text-slate-400 tabular-nums">{total}</span>
      </div>
      <div className="space-y-1.5">
        {a.items.map((it, i) => {
          const on = isOn(it.filter);
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
                  style={{ width: `${Math.round((it.count / max) * 100)}%`, background: colors[i % colors.length] }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function VehiclesOverviewPage() {
  return <Suspense fallback={<Spinner />}><VehiclesOverviewInner /></Suspense>;
}
