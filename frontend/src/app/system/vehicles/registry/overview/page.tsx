'use client';
// نظرة شاملة على المركبات — كل عمود في الماستر له كارت، وكل رقم بيتضغط.
//
// الفكرة اللي الصفحة مبنية عليها: صاحب الشركة يبص مرة واحدة ويعرف كل حاجة عن
// المركبات، وأي رقم يشدّ انتباهه يدوس عليه فيلاقي نفسه في القائمة مفلترة عليه
// بالظبط. عشان كده الفلتر بييجي **من السيرفر** مع كل قيمة (`item.filter`) بدل
// ما الصفحة تبنيه — لو بنته هنا كان ممكن يختلف عن اللي السيرفر بيعدّ بيه، ويبقى
// الرقم بيقول حاجة والصفحة بتوري حاجة تانية.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Car, ShieldCheck, CreditCard, FileText, Wrench, Satellite,
  ChevronLeft, Settings, CalendarClock, TriangleAlert,
} from 'lucide-react';
import {
  getOverview, STATE_META, stateLabel, money, fmtDate, daysText,
  type VehicleOverview, type DocCard, type Breakdown,
} from '@/lib/vehicleRegistry';

const DOC_ICON: Record<string, any> = {
  insurance: ShieldCheck, operatingCard: CreditCard, vehicleLicense: FileText,
  inspection: Wrench, gps: Satellite,
};

export default function VehiclesOverviewPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<VehicleOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await getOverview()); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  /** يودّي على القائمة مفلترة بنفس الفلتر اللي السيرفر عدّ بيه. */
  const openList = (filter: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== '')).toString();
    router.push(`/system/vehicles/registry${q ? `?${q}` : ''}`);
  };
  const openExpiring = (q: Record<string, string | number>) => {
    const p = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
    router.push(`/system/vehicles/registry/expiring?${p}`);
  };

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
          <button onClick={() => router.push('/system/vehicles/registry/settings')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 text-sm">
            <Settings className="w-4 h-4" /> {t('إعدادات التنبيه', 'Alerts')}
          </button>
        </div>
      </PageHeader>

      {/* ① الأرقام الكبيرة */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Big label={t('إجمالي المركبات', 'Vehicles')} value={d.totals.vehicles} accent="#f37121" onClick={() => openList({})} />
        <Big label={t('يحتاج متابعة', 'Needs attention')} value={d.totals.needsAttention} accent="#dc2626" onClick={() => openExpiring({ withinDays: 60 })} />
        <Big label={t('أقساط التأمين (ر.س)', 'Premiums (SAR)')} value={money(d.totals.insuredPremiumSar)} accent="#16a34a" />
        <Big label={t('عليها جهاز تتبّع', 'With GPS')} value={d.totals.withGps} accent="#0ea5e9" />
        <Big label={t('شرائح وقود نشطة', 'Active fuel cards')} value={d.totals.activeFuelCards} accent="#8b5cf6" />
        <Big label={t('مركبات لها حوادث', 'With accidents')} value={d.totals.withAccidents} accent="#ea580c" onClick={() => router.push('/system/vehicles/registry/claims')} />
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
  const rows: { key: string; n: number }[] = [
    { key: 'expired', n: s.expired }, { key: 'critical', n: s.critical },
    { key: 'warning', n: s.warning }, { key: 'valid', n: s.valid },
  ];

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
      <div className="grid grid-cols-4 gap-1.5">
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

      {/* الحالات الإدارية — بالاسم زي ما هو في الإكسل */}
      {!!doc.statuses.length && (
        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 mb-1.5">{t('الحالة المسجَّلة', 'Recorded status')}</p>
          <div className="flex flex-wrap gap-1.5">
            {doc.statuses.map((st) => (
              <span key={st.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                {ar ? st.ar : st.en}
                <b className="text-slate-900">{st.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
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
