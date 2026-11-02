'use client';
// Fleet overview: a card for every master column, every number clickable.
// The filter comes from the server with each value (item.filter) so the list always matches what the server counted.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Car, ShieldCheck, CreditCard, FileText, Wrench, Satellite, KeyRound,
  ChevronLeft, Settings, CalendarClock, TriangleAlert, IdCard,
} from 'lucide-react';
import FilterPanel, { countActive, type FilterValues } from '@/components/system/FilterPanel';
import HrQuickFilters from '@/components/hr/HrQuickFilters';
import { stateMeta,
  getOverview, STATE_META, stateLabel, money, fmtDate, daysText,
  type VehicleOverview, type DocCard, type Breakdown,
} from '@/lib/vehicleRegistry';

const DOC_ICON: Record<string, any> = {
  insurance: ShieldCheck, operatingCard: CreditCard, vehicleLicense: FileText,
  inspection: Wrench, gps: Satellite, authorization: KeyRound,
  // The driver card is the seventh card: a paper on a person, not a vehicle, but its expiry stops work like any registration. See overview on the server.
  driverCard: IdCard,
};

function VehiclesOverviewInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<VehicleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // The filter is the source of every number on this page; cards and analytics are re-read from it.
  // It lives in the URL so back/forward keeps the built view.
  const sp = useSearchParams();
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])]));
  const [refreshing, setRefreshing] = useState(false);

  // Ignore stale responses: a slower earlier request must not overwrite a newer one. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    setRefreshing(true);
    try {
      const res = await getOverview(filters as Record<string, string>);
      if (!guard.isCurrent(mine)) return;
      setD(res);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (!guard.isCurrent(mine)) return;
    setLoading(false);
    setRefreshing(false);
  }, [JSON.stringify(filters), notify, guard]);
  useEffect(() => { load(); }, [load]);

  // replace, not push: each value click should not add a browser history step.
  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.replace(`/system/vehicles/registry/overview${q ? `?${q}` : ''}`, { scroll: false });
  }, [JSON.stringify(filters), router]);
  // Rider, authorization and employee status are also written from B2C and HR.
  const reload = useCallback(() => { load(); }, [load]);
  useSocket('vreg:updated', reload);
  useSocket('lt:updated', reload);
  useSocket('hr:employee', reload);

  /** Opens the list with the same filter the server counted with, plus the active filter, so the number clicked matches the rows shown. */
  const openList = (filter: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries({ ...filters, ...filter }).filter(([, v]) => v !== '') as [string, string][]).toString();
    router.push(`/system/vehicles/registry${q ? `?${q}` : ''}`);
  };
  const openExpiring = (q: Record<string, string | number>) => {
    const p = new URLSearchParams(Object.entries({ ...filters, ...q }).map(([k, v]) => [k, String(v)])).toString();
    router.push(`/system/vehicles/registry/expiring?${p}`);
  };
  /** Each number opens the vehicles behind it without adding a filter to this page: the filter produces the number, the click shows its contents. */
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

      {/* Quick filters: only the important columns, like the HR dashboard bar. Searchable lists with per-value counts; full filtering stays below. */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <p className="mb-2 text-[12px] font-bold text-slate-500">{t('فلترة اللوحة — كل الأرقام تتعدّل حسب اختيارك', 'Filter the dashboard — every number follows your choice')}</p>
        <HrQuickFilters
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          ar={ar}
          keys={[
            { key: 'sector', ar: 'القطاع', en: 'Sector' },
            { key: 'department', ar: 'الإدارة / المشروع', en: 'Department' },
            { key: 'registrationType', ar: 'نوع التسجيل', en: 'Registration type' },
            { key: 'brand', ar: 'الماركة', en: 'Brand' },
            { key: 'city', ar: 'المدينة', en: 'City' },
            { key: 'ownerCompany', ar: 'الشركة المالكة', en: 'Owner company' },
            { key: 'serviceStatus', ar: 'حالة التشغيل', en: 'Service status' },
            { key: 'authState', ar: 'التفويض', en: 'Authorisation' },
            { key: 'documentHealth', ar: 'صحّة المستندات', en: 'Document health' },
            { key: 'accidentBand', ar: 'الحوادث', en: 'Accidents' },
          ]}
        />
      </div>

      {/* Filter bar; every number below is computed under it. */}
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

      {/* 1. Big numbers */}
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

      {/* 2. Documents: the painful part */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('المستندات ومواعيد انتهائها', 'Documents and their expiry')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.documents.map((doc) => <DocumentCard key={doc.key} doc={doc} ar={ar} t={t} onOpen={openExpiring} onList={openList} />)}
        </div>
      </section>

      {/* 3. Company documents: expiry stops all work */}
      {!!d.corporate.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">{t('وثائق التأمين على مستوى الشركة', 'Company-level policies')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.corporate.map((p) => {
              const m = stateMeta(p.state);
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

      {/* 4. Accidents: the question is money */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('الحوادث والمطالبات التأمينية', 'Accidents & insurance claims')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Big label={t('إجمالي الحوادث', 'Total')} value={d.claims.total} accent="#0f172a" onClick={() => router.push('/system/vehicles/registry/claims')} />
          <Big label={t('مطالبات مفتوحة', 'Open claims')} value={d.claims.open} accent="#f59e0b" onClick={() => router.push('/system/vehicles/registry/claims?status=pending')} />
          <Big label={t('الخطأ علينا', 'Our fault')} value={d.claims.ourFault} accent="#dc2626"
            onClick={() => router.push('/system/vehicles/registry/claims?fault=ours')} />
          {/* The two amounts are not row lists; they open the full accidents page because they are its totals, not a slice. */}
          <Big label={t('المبلغ المقدَّر (ر.س)', 'Estimated (SAR)')} value={money(d.claims.estimatedSar)} accent="#0ea5e9"
            onClick={() => router.push('/system/vehicles/registry/claims')} />
          <Big label={t('متوقع استرداده (ر.س)', 'Expected recovery')} value={money(d.claims.expectedRecoverySar)} accent="#16a34a"
            onClick={() => router.push('/system/vehicles/registry/claims')} />
        </div>
      </section>

      {/* Analytics: derived slices; clicking a slice filters the page. */}
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

      {/* Long detail tables were removed from this page: missing data lives in the vehicle register with its filter, columns on their own pages. The overview answers what needs work today. */}
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

// Document card. Separates computed states (valid/expired/near, change daily) from administrative states (required/not required/none, typed by a person).
function DocumentCard({ doc, ar, t, onOpen, onList }: {
  doc: DocCard; ar: boolean; t: (a: string, e: string) => string;
  onOpen: (q: Record<string, string | number>) => void; onList: (f: Record<string, string>) => void;
}) {
  const Icon = DOC_ICON[doc.key] || FileText;
  const s = doc.states;
  // The three severity levels each get their own line. Thresholds come from section settings, and zero counts are hidden as noise.
  const rows: { key: string; n: number }[] = [
    { key: 'expired', n: s.expired || 0 },
    { key: 'critical', n: s.critical || 0 },
    { key: 'warning', n: s.warning || 0 },
    { key: 'upcoming', n: (s as any).upcoming || 0 },
    { key: 'valid', n: s.valid || 0 },
  ].filter((r) => r.n > 0 || r.key === 'valid');
  // Registered states fold into two numbers: missing date, and not needed. Not required is an administrative decision, not a gap.
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

      {/* Computed states */}
      <div className="grid grid-cols-3 gap-1.5">
        {rows.map((r) => {
          const m = stateMeta(r.key);
          return (
            <button key={r.key} onClick={() => onOpen({ doc: doc.key, state: r.key, includeExpired: 1 })}
              className="rounded-lg border border-slate-100 py-2 hover:border-slate-300 transition-colors">
              <p className="text-lg font-extrabold leading-none" style={{ color: m.color }}>{r.n}</p>
              <p className="text-[9.5px] text-slate-500 mt-1 leading-tight px-0.5">{ar ? m.ar : m.en}</p>
            </button>
          );
        })}
      </div>

      {/* One line for items without a date: needs a date vs not needed, each clickable, instead of every spreadsheet status as its own slice. */}
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

// Column card
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

// Analysis card: horizontal slices sized by count.
// A slice carries the filter that produced it and adds it on click, so the number never differs from the rows it opens.
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
