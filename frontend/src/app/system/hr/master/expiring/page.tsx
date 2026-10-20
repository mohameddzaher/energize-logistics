'use client';
// انتهاءات مستندات الموظفين — الإقامة، الجواز، العقد، التأمين الطبي، الشهادة
// الصحية، بطاقة السائق، رخصة القيادة — في شاشة واحدة.
//
// المدة رقم يكتبه المستخدم مش قايمة ثابتة. الأزرار السريعة اختصار بس.
// ملاحظة: المسار ده ساكن، فبياخد الأولوية على [group] في Next — لولا كده كان
// «expiring» هيتفهم على إنه اسم مجموعة ويرجّع 404.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { CalendarClock, Search, X } from 'lucide-react';
import { stateMeta, getHrExpiring, STATE_META, stateLabel, fmtDate, daysText } from '@/lib/hrMaster';
import { hijriCell, pairLabels, exportDatePair } from '@/lib/hrDates';
import MasterNav from '@/components/hr/MasterNav';
import { usePinnedColumns } from '@/components/hr/usePinnedColumns';
import ScrollX from '@/components/system/ScrollX';

const QUICK = [7, 15, 30, 60, 90, 180];
// فلاترُ الصفحة — قوائمُها من الخادم بعدد مستندات كلّ قيمة (راجع hrMaster.expiring).
const FACETS: { key: string; ar: string; en: string }[] = [
  { key: 'registerNumber', ar: 'السجل', en: 'Register' },
  { key: 'engagement', ar: 'نوع التعاقد', en: 'Engagement' },
  { key: 'department', ar: 'القسم', en: 'Department' },
  { key: 'project', ar: 'المشروع', en: 'Project' },
  { key: 'nationality', ar: 'الجنسية', en: 'Nationality' },
  { key: 'branchName', ar: 'الفرع', en: 'Branch' },
];
const ENGAGEMENT_LABEL: Record<string, [string, string]> = {
  sponsored: ['على الكفالة', 'Sponsored'], freelance: ['فري لانسر', 'Freelance'], trainee: ['متدرّب', 'Trainee'], none: ['غير محدّد', 'Not set'],
};

function ExpiringInner() {
  // الرقم الوظيفيّ والاسم والهويّة ثابتةٌ على اليمين — راجع usePinnedColumns.
  const pin = usePinnedColumns(3);
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify } = useDialog();

  const [within, setWithin] = useState(sp?.get('withinDays') || '60');
  const [doc, setDoc] = useState(sp?.get('doc') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('includeExpired') !== '0');
  const [d, setD] = useState<Awaited<ReturnType<typeof getHrExpiring>> | null>(null);
  const [loading, setLoading] = useState(true);
  // ── وفلترُ اللوحة يُحمَل إلى هنا ───────────────────────────────────────────
  // «ينتهي قريبًا» في النظرة الشاملة يُحسَب على فلترها (قسمٌ، جنسيّة…). وكانت
  // الضغطةُ تفتح هذه الصفحةَ مجرَّدةً منه: رقمٌ لقسمٍ واحدٍ يفتح انتهاءاتِ
  // الشركة كلِّها. فما جاء في العنوان غيرَ مفاتيح هذه الشاشة فلترٌ يُرسَل كما هو.
  const CTRL = ['withinDays', 'doc', 'state', 'includeExpired'];
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k, v]) => !CTRL.includes(k) && v !== '')));
  const hasFilters = Object.keys(filters).length > 0;
  const [q, setQ] = useState(sp?.get('q') || '');
  const setFacet = (k: string, v: string) => setFilters((f) => {
    const n = { ...f };
    if (v) n[k] = v; else delete n[k];
    return n;
  });
  // المدّةُ والمستندُ والحالةُ ثلاثةُ مفاتيحَ تتغيّر تباعًا، ومعها تحديثُ السوكِت:
  // أوسعُ الطلبات أبطؤها، فيصل أخيرًا ويكتب فوق الأضيق. راجع useLatestRequest.
  const guard = useLatestRequest();

  // ── ولا تُرسَل حالةُ توظيفٍ من هنا ──────────────────────────────────────────
  // كانت الصفحةُ تُرسل `status: 'active'` والشريطُ يعدّ الملفَّ كلَّه: ٥٦٨ في
  // الرقم و٤٤٣ في الجدول. والنطاقُ الآن قاعدةٌ واحدةٌ في الخادم (مَن لم تنتهِ
  // خدمتُه — وفيهم مَن في إجازة) يقرؤها الرقمُ والجدولُ معًا.
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await getHrExpiring({
        ...filters,
        ...(q.trim() ? { q: q.trim() } : {}),
        withinDays: within === '' ? undefined : within,
        doc, state, includeExpired: includeExpired ? '1' : '0',
      });
      if (!guard.isCurrent(mine)) return;
      setD(res);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [within, doc, state, includeExpired, JSON.stringify(filters), q, notify, guard]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  // ── ويسمع كلَّ كتابةٍ تخصّه ───────────────────────────────────────────────
  // تعديلُ ملفّ موظّف، أو تجديدُ مستند، أو عقد — كلُّها تغيّر تاريخًا هنا.
  const live = useCallback(() => { load(); }, [load]);
  useSocket('hr:master', live);
  useSocket('hr:employee', live);
  useSocket('hr:contract', live);

  const rows = d?.rows || [];
  const EXPIRY_LABEL = t('تاريخ الانتهاء', 'Expiry date');
  const expiryLabels = pairLabels(EXPIRY_LABEL, ar);
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('رقم الهوية', 'ID number'), key: 'iqamaNumber', width: 16 },
    { header: t('المستند', 'Document'), key: 'docAr', width: 18 },
    // تاريخُ الانتهاء عمودان متجاوران: الميلاديُّ ثمّ هجريُّه المشتقّ (lib/hrDates).
    ...exportDatePair(EXPIRY_LABEL, 'expiryDate', ar),
    { header: t('المتبقي', 'Days left'), key: 'daysRemaining', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', transform: (v) => stateLabel(v, ar), width: 16 },
    { header: t('القسم', 'Department'), key: 'department', width: 18 },
  ];

  // الشاشة تفتح على مدّةٍ افتراضيّة (٦٠ يومًا) — أي أنّها مفلترة قبل أن يلمسها
  // أحد. فمَن صدّر ظانًّا أنّه أخذ كلّ الانتهاءات كان يأخذ نافذةً ضيّقة بلا أن
  // يُنبَّه؛ و«الكلّ» هنا يعيد النداء بلا مدّةٍ ولا مستندٍ ولا حالة.
  const hasActiveFilters = within !== '' || !!doc || !!state || !includeExpired || hasFilters || !!q.trim();
  const fetchAllExpiring = async () => {
    const full = await getHrExpiring({ includeExpired: '1' });
    return [{ name: t('الانتهاءات', 'Expiries'), rows: full.rows || [], columns: cols }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: t('الانتهاءات', 'Expiries'), rows, columns: cols }] },
        { key: 'all', label: scope.all, resolve: fetchAllExpiring },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: t('الانتهاءات', 'Expiries'), rows, columns: cols }] }];

  if (loading && !d) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <MasterNav />

      <PageHeader icon={<CalendarClock className="w-5 h-5" />}
        title={t('انتهاءات مستندات الموظفين', 'Employee document expiries')}
        subtitle={(d?.expiryScope?.employment === 'current')
          ? t('كل مستند له تاريخ، لمن لم تنتهِ خدمته — اختر المدة التي تهمّك', 'Every dated document, for staff whose service has not ended — pick the window that matters')
          : t('كل مستند له تاريخ — اختر المدة التي تهمّك', 'Every dated document — pick the window that matters')}>
        <ExportMenu fileName="hr-expiries" lang={lang as 'ar' | 'en'} options={exportOptions} />
      </PageHeader>

      {hasFilters && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
          <p className="text-[13px] font-semibold text-sky-900">
            {t('المعروض مقصور على الفلاتر المختارة', 'Limited to the selected filters')}
          </p>
          <button type="button" onClick={() => setFilters({})}
            className="text-[12px] font-medium text-sky-800 hover:text-sky-950 underline">
            {t('عرض الكل', 'Show all')}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        {/* ── الفلاتر: بحثٌ وقوائمُ بعدد مستندات كلّ قيمة ── */}
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث بالاسم أو رقم الهوية أو الرقم الوظيفي', 'Name, ID or employee no.')}
              className="w-64 max-w-full rounded-lg border border-slate-200 py-2 pe-3 ps-8 text-sm" />
          </div>
          {FACETS.map((fc) => {
            const opts = d?.options?.[fc.key] || [];
            const cur = filters[fc.key] || '';
            return (
              <select key={fc.key} value={cur} onChange={(e) => setFacet(fc.key, e.target.value)}
                className={`rounded-lg border px-2.5 py-2 text-sm bg-white max-w-[13rem] ${cur ? 'border-[#f37121] text-slate-900 font-semibold' : 'border-slate-200 text-slate-700'}`}>
                <option value="">{t(`كل ${fc.ar === 'السجل' ? 'السجلات' : fc.ar}`, `All — ${fc.en}`)}</option>
                {cur && !opts.some((o) => o.value === cur) && <option value={cur}>{cur}</option>}
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {fc.key === 'engagement' ? (ENGAGEMENT_LABEL[o.value]?.[ar ? 0 : 1] || o.value) : (o.value === '—' ? t('(فارغ)', '(blank)') : o.value)} ({o.count})
                  </option>
                ))}
              </select>
            );
          })}
          {(hasFilters || q) && (
            <button type="button" onClick={() => { setFilters({}); setQ(''); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">
              <X className="h-3.5 w-3.5" />{t('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <input type="number" min={0} max={3650} value={within} onChange={(e) => setWithin(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm text-center font-bold" />
          <span className="text-sm text-slate-500">{t('يوم', 'days')}</span>
          {QUICK.map((n) => (
            <button key={n} onClick={() => setWithin(String(n))}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>{n}</button>
          ))}
          <button onClick={() => setWithin('')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
            {t('الكل', 'All')}
          </button>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer ms-auto">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
            {t('اعرض المنتهي بالفعل', 'Include expired')}
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          {(d?.byDoc || []).map((x) => (
            // أرقامُها لا تتبع المستندَ المختارَ ولا الحالة — فلا تتغيّر ولا تهتزّ حين تُضغط.
            <button key={x.key} type="button" onClick={() => setDoc(doc === x.key ? '' : x.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${doc === x.key ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
              {ar ? x.ar : x.en}
              <b className="inline-block min-w-[2.25rem] text-center tabular-nums">{x.count}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => (
          <button key={k} onClick={() => setState(state === k ? '' : k)}
            className={`text-start bg-white border rounded-xl p-3 shadow-sm ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
            <p className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: stateMeta(k).color }}>{d?.summary?.[k] ?? 0}</p>
            <p className="text-[11.5px] text-slate-600 mt-1.5 font-medium">{stateLabel(k, ar)}</p>
          </button>
        ))}
        {/* الإجماليُّ = مجموعُ الحالات الأربع = رقمُ المستند المختار فوق. ضغطُه يرفع فلترَ الحالة. */}
        <button type="button" onClick={() => setState('')}
          className={`text-start bg-slate-900 rounded-xl p-3 text-white ${!state ? 'ring-2 ring-[#f37121]/50' : ''}`}>
          <p className="text-2xl font-extrabold leading-none tabular-nums">{d?.summary?.total ?? 0}</p>
          <p className="text-[11px] text-slate-300 mt-1.5">
            {t('الإجمالي', 'Total')}{doc ? ` — ${(d?.byDoc || []).find((x) => x.key === doc)?.[ar ? 'ar' : 'en'] || ''}` : ''}
          </p>
        </button>
      </div>

      <p className="text-[12.5px] font-semibold text-slate-600">
        {t(`المعروض: ${d?.shown ?? rows.length}`, `Shown: ${d?.shown ?? rows.length}`)}
        {(d?.shown ?? 0) > rows.length && <span className="text-slate-400"> {t(`(أوّل ${rows.length})`, `(first ${rows.length})`)}</span>}
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{[t('الرقم الوظيفي', 'Emp. no.'), t('الموظف', 'Employee'), t('رقم الهوية', 'ID number'),
                t('المستند', 'Document'), expiryLabels[0], expiryLabels[1],
                t('المتبقي', 'Left'), t('الحالة', 'State'), t('القسم', 'Department')].map((h, i) => (
                <th key={i} {...(i < 3 ? pin.th(i, 'px-3 py-3 text-center font-bold whitespace-nowrap') : { className: 'px-3 py-3 text-center font-bold whitespace-nowrap' })}>{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                const m = stateMeta(r.state);
                return (
                  <tr key={`${r.employeeId}-${r.docKey}`} className="group hover:bg-slate-50 text-center">
                    <td {...pin.td(0, 'px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums')}>{r.employeeNumber || '—'}</td>
                    <td {...pin.td(1, 'px-3 py-2.5')}>
                      <button onClick={() => router.push(`/system/hr/employees/${r.employeeId}`)}
                        className="font-semibold text-slate-900 hover:text-[#f37121] text-[13.5px] whitespace-nowrap">{r.name}</button>
                    </td>
                    {/* رقم الهوية — ده اللي القسم بيسيرش بيه */}
                    <td {...pin.td(2, 'px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums')}>{r.iqamaNumber || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => router.push(`/system/hr/master/${r.docKey}`)}
                        className="text-slate-800 hover:text-[#f37121] text-[13px] whitespace-nowrap font-medium">{ar ? r.docAr : r.docEn}</button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">{fmtDate(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums" dir="ltr">{hijriCell(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: m.color }}>{daysText(r.daysRemaining, ar)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg}`}>{stateLabel(r.state, ar)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{r.department || '—'}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400">
                  {t('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ExpiringInner /></Suspense>;
}
