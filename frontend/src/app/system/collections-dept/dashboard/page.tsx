'use client';
/**
 * لوحةُ التحصيل — ما لنا، وكم عمرُه، وعند مَن، وأين.
 *
 * الرقمُ الواحد «مستحقٌّ كذا» لا يقول شيئًا عن خطره: مليونٌ عمرُه أسبوعٌ عملٌ
 * جارٍ، ومليونٌ عمرُه سنةٌ مالٌ يكاد يضيع. فمعه تقادمُه دائمًا.
 *
 * ── الترتيبُ هو ترتيبُ الأسئلة ──────────────────────────────────────────────
 *   ١. كم لنا، وكم حصّلنا منه؟          ← البطاقةُ الكبيرة ونسبةُ التحصيل
 *   ٢. ما الذي يحتاج تصرّفًا اليوم؟       ← تنبيهاتُ الحدود والاستحقاق
 *   ٣. كم عمرُ ما لنا؟ وكيف يسير الشهر؟   ← سلّمُ التقادم والرسمُ الشهريّ
 *   ٤. عند مَن؟ وفي أيّ فرع؟              ← أكبرُ المتأخّرين والفروع
 * وكلُّ بطاقةٍ تفتح ما تعدّه.
 *
 * ── «ما لنا» لا غير ─────────────────────────────────────────────────────────
 * القسمُ يُحصِّل؛ ما ندفعه للموردين والصافيُ بينهما شأنُ الإدارة والمالية،
 * ولوحةُ الحسابات تعرض الوجهين. فاللوحةُ هنا للجميع بلا إخفاءٍ بالدور.
 *
 * ── حيّة ────────────────────────────────────────────────────────────────────
 * كلُّ تعديلٍ على كشفٍ أو طرفٍ يعيد القراءة، والأرقامُ القائمة تبقى معروضةً حتى
 * يصل الجديد — لا تُمسح ولا تومض.
 *
 * والمكوّناتُ الصغيرة خارج الصفحة عمدًا: مكوّنٌ يُعرَّف داخل الرسم يُعاد إنشاؤه
 * مع كلّ تحديث، فتُفقَد حالتُه ويُعاد رسمُ الرسوم كلّها.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { money, canEditCollections } from '@/lib/collections';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import ReceivablesTree, { type Tree, type Check, type AttachKpi, type DefaultTerm } from '@/components/collections/ReceivablesTree';
import DefaultTermList, { type DefaultTermParty } from '@/components/collections/DefaultTermList';
import {
  ReceivablesFilterBar, filtersFromParams, filtersToQuery, receivablesHref,
  DASHBOARD_PATH, type DashFilters, type Facets,
} from '@/components/collections/receivablesFilters';
import {
  Wallet, Users, ChevronLeft, UserCheck, Truck, Scale,
} from 'lucide-react';

interface Recv {
  tree: Tree;
  checks: Check[];
  attachments?: AttachKpi;
  defaultTerm?: DefaultTerm & { parties: DefaultTermParty[] };
  manager?: { name: string; email: string } | null;
  facets?: Facets;
  officers: { officer: string; isManager?: boolean; defaulted?: number; count: number; value: number; late: number; lateValue: number; hard: number; hardValue: number }[];
  parties: { party: string | null; key: string; name: string; code: string; officer: string; officerIsDefault?: boolean; issueState: string; count: number; value: number; late: number; lateValue: number; hard: number; hardValue: number; oldest: number | null }[];
}
// من لوحة كشوف التشغيل يبقى عددُ الموردين وحدَه — المالُ كلُّه من الدفتر.
interface Dash {
  counts: { customer: { active: number; inactive: number }; supplier: { active: number; inactive: number } };
}

/*
 * فلاترُ اللوحة — خمسُ قوائمَ متعدّدةِ الاختيار ومدى تاريخ، وكلُّ رقمٍ في الصفحة
 * تحتها. تعيش في الرابط (راجع components/collections/receivablesFilters): فتُحمَل
 * إلى صفحة التفاصيل مع كلّ رقمٍ يُضغط، ويعود الرجوعُ إلى اللوحة بها.
 */

function Panel({ title, icon, right, children, className = '' }: {
  title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          {icon && <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">{icon}</span>}
          {title}
        </h2>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function CollectionsDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditCollections(user);
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  // شجرةُ المديونيّة من دفتر الفواتير — راجع components/collections/ReceivablesTree.
  const [recv, setRecv] = useState<Recv | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── الفلاترُ في الرابط ─────────────────────────────────────────────────
  // تُقرأ منه وتُكتب فيه (`replace` لا `push`: تغييرُ فلترٍ ليس صفحةً يُرجَع
  // إليها)، فيعود زرُّ الرجوع من صفحة التفاصيل إلى اللوحة بفلاترها.
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() || '';
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(qs)), [qs]);
  const setFilters = useCallback((f: DashFilters) => {
    const s = new URLSearchParams(filtersToQuery(f)).toString();
    router.replace(s ? `${DASHBOARD_PATH}?${s}` : DASHBOARD_PATH, { scroll: false });
  }, [router]);

  // فلاترُ الصفحة كنصّ استعلام — تُرسَل إلى اللوحة وتُحمَل إلى كلِّ رقمٍ يُفتَح منها.
  const ledgerFilters = useMemo(() => filtersToQuery(filters), [filters]);
  // كلُّ رقمٍ يفتح صفحةَ صفوفه — بفلاتر اللوحة والعقدةِ التي ضُغطت.
  const openNode = useCallback((node: Record<string, string> = {}) => {
    router.push(receivablesHref(filters, node));
  }, [router, filters]);

  // ── لكلّ نداءٍ حارسُه ───────────────────────────────────────────────────
  // ردٌّ متأخّرٌ لفلترٍ سابق لا يكتب فوق الأحدث — وأبطأُ الردود هو غيرُ المفلتَر
  // الذي أُطلق أوّلَ الفتح (راجع stale-response-races). وحارسٌ لكلّ نداء: حارسٌ
  // مشتركٌ يجعل كلَّ نداءٍ يُبطل ردَّ الآخر.
  const recvGuard = useLatestRequest();
  const dashGuard = useLatestRequest();

  const loadRecv = useCallback(async () => {
    const mine = recvGuard.begin();
    try {
      const p = new URLSearchParams(ledgerFilters);
      const rv = await api.get<Recv>(`/api/collections-dept/receivables/overview?${p.toString()}`);
      if (recvGuard.isCurrent(mine)) setRecv(rv);
    } catch (e: any) {
      if (recvGuard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (recvGuard.isCurrent(mine)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerFilters, recvGuard]);

  const loadDash = useCallback(async () => {
    const mine = dashGuard.begin();
    try {
      const d = await api.get<Dash>('/api/collections-dept/dashboard');
      if (dashGuard.isCurrent(mine)) setData(d);
    } catch { /* عددُ الموردين وحدَه — لا يُوقف اللوحة */ }
  }, [dashGuard]);

  const load = useCallback(() => { loadRecv(); loadDash(); }, [loadRecv, loadDash]);
  useEffect(() => { loadRecv(); }, [loadRecv]);
  useEffect(() => { loadDash(); }, [loadDash]);

  // ── حيّة: تعديلٌ على كشفٍ أو فاتورةٍ أو طرفٍ أو مرفق ⇒ قراءةٌ بعد هدوء الدفعة ──
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => { load(); }, 800);
  }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('workflow:updated', soon);
  useSocket('workflow:bulkImported', soon);
  useSocket('collections:party', soon);
  useSocket('finance:changed', soon);
  useSocket('collections:changed', soon);
  useSocket('collections:attachments', soon);

  if (loading && !recv) return <Spinner />;

  const top = (recv?.parties || []).slice(0, 15);
  const topMax = Math.max(1, ...top.map((r) => r.value));

  const topCols = [
    { header: t('الكود', 'Code'), key: 'code', width: 12 },
    { header: t('العميل', 'Customer'), key: 'name', width: 34 },
    { header: t('موظف التحصيل', 'Officer'), key: 'officer', width: 14 },
    { header: t('فواتير', 'Invoices'), key: 'count', width: 10 },
    { header: t('المديونية', 'Outstanding'), key: 'value', width: 16 },
    { header: t('منها متأخر', 'Of which late'), key: 'lateValue', width: 16 },
    { header: t('منها مرتفع الخطورة', 'Of which hard risk'), key: 'hardValue', width: 16 },
  ];

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Wallet className="w-6 h-6 text-[#f37121]" />}
        title={t('لوحة التحصيل', 'Collections dashboard')}
        subtitle={t('محسوبةٌ من دفتر الفواتير — حيّةٌ مع كلّ تحصيلٍ وتسليم', 'Straight from the invoice ledger — live with every collection and delivery')}
      >
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{t('مباشر', 'Live')}
        </span>
        <ExportMenu
          fileName="collections-dashboard"
          lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'shown',
            label: t('المعروض', 'Shown'),
            sheets: [
              { name: t('المديونية بالعميل', 'Receivables by customer'), rows: recv?.parties || [], columns: topCols },
            ],
          }]}
        />
      </PageHeader>

      {/* ── الفلاتر: شريطٌ واحدٌ فوق اللوحة ───────────────────────────────────
          خمسُ قوائمَ فيها بحثٌ واختيارٌ متعدّد، وبجانب كلِّ خيارٍ عددُه تحت
          الفلاتر الأخرى. وكلُّ رقمٍ في الصفحة تحتها — الإجماليُّ والأنواعُ الأربعة
          وعمرُ التأخير والمرفقاتُ والتحقّق — وكلُّ جدولٍ يُفتَح يحملها. */}
      <ReceivablesFilterBar filters={filters} onChange={setFilters} facets={recv?.facets} ar={ar} manager={recv?.manager} />

      {/* ── ٠. المديونيّةُ كشجرة ───────────────────────────────────────────────
          أوّلُ سؤالٍ يُسأل في القسم: كم علينا، وكم عمرُه، وما منه في حدود مدّة
          عميله وما خرج عنها. ومصدرُه **دفترُ الفواتير** لا كشوفُ التشغيل (٩٤٪ من
          فواتير الدفتر لا كشوفَ لها عندنا)، والشجرةُ تُطابق نفسَها بشريط تحقّقٍ أسفلها. */}
      {recv && (
        <ReceivablesTree tree={recv.tree} checks={recv.checks} ar={ar}
          attachments={recv.attachments} defaultTerm={recv.defaultTerm}
          onOpenDefaultTerm={() => setTermOpen(true)}
          onOpen={(q) => openNode(q as Record<string, string>)} />
      )}

      {/* وبالمسؤول: العملُ موزَّعًا لا مجموعًا — ولا صفَّ «بلا مسؤول»: ما لم يُسنَد
          فعلى مدير القسم، ويُقال كم منه كذلك. */}
      {!!recv?.officers?.length && (
        <Panel title={t('المديونية بمسؤول التحصيل', 'Receivables by collector')} icon={<UserCheck className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {recv.officers.map((o) => (
              <button key={o.officer} type="button"
                onClick={() => router.push(receivablesHref({ ...filters, officer: [o.officer] }))}
                className="text-start bg-slate-50 border border-slate-200 rounded-xl p-3 hover:border-[#f37121]/50 transition-colors">
                <p className="text-[12px] font-semibold text-slate-800">
                  {o.officer}
                  {o.isManager && <span className="ms-1.5 text-[10.5px] font-medium text-slate-400">{t('مدير القسم', 'Dept. manager')}</span>}
                </p>
                <p className="text-lg font-extrabold tabular-nums text-slate-900">{money(o.value)}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {o.count} {t('صف', 'rows')} · {t('متأخر', 'late')} {money(o.lateValue)} · {t('مرتفع', 'hard')} {money(o.hardValue)}
                </p>
                {!!o.defaulted && (
                  <p className="text-[10.5px] text-slate-400 tabular-nums">{t(`منها ${o.defaulted} غير مُسنَد`, `${o.defaulted} of them unassigned`)}</p>
                )}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* ── ١. كم لنا، وكم حصّلنا ────────────────────────────────────────────
          هنا كانت بطاقةُ «المستحق لنا من العملاء» ومعها المبيعاتُ والمحصَّلُ
          ونسبةُ التحصيل — محسوبةً من **كشوف التشغيل**. وشجرةُ المديونيّة فوقها
          محسوبةٌ من **دفتر الفواتير**. فكانت الصفحةُ تقول رقمين لشيءٍ واحد:
          20,661,545 فوق و47,214,194 تحت، ولا شيءَ يقول لماذا.

          والسببُ قيس: `collectedAmount` **صفرٌ على كلّ الكشوف** — سبعةٌ
          وثلاثون ألفًا وخمسمئةٍ واثنا عشر، بلا استثناء. لا أحد يكتبها. فكان
          ذلك الحسابُ يعدّ كلَّ ما سُلِّم منذ بدء الشركة مستحقًّا. وتفكيكُ
          الفرق يثبته: 29.9 مليونًا منه كشوفٌ يقول الدفترُ إنّ فواتيرَها
          **حُصِّلت** (125.9 مليونًا محصَّلة من 146.6).

          فالدفترُ هو الحقيقة: 1,572 فاتورةً غيرَ محصَّلة بـ20.7 مليون. وشجرةُ
          المديونيّة تقولها وتطابق نفسَها. ورقمٌ ثانٍ يناقضها ليس معلومةً
          إضافيّةً — هو شكٌّ في الاثنين معًا.

          وبطاقةُ «الحد الائتماني» (`CreditAlerts`) رُفعت بطلب المستخدم. */}

      {/* ── ٣. عند مَن ───────────────────────────────────────────────────────
          هنا كانت أربعُ لوحاتٍ من **كشوف التشغيل**: تقادمُ المستحقّ، والمبيعاتُ
          والمحصَّلُ بالشهر، وأكبرُ المتأخّرين، وبالفرع. وهي الحسابُ نفسُه الذي
          رُفعت بطاقاتُه من فوق: يعدّ كلَّ كشفٍ بلا تاريخ تحصيلٍ دَينًا، وتاريخُ
          التحصيل لا يُكتب على الكشوف — فكان «تقادمُ المستحقّ» يجمع ٤٧٫٤ مليونًا
          تحت شجرةٍ تقول ١٩٫٩٦. فرُفعت، وحلّ محلَّها أكبرُ المديونيّات من الدفتر
          نفسِه الذي تُبنى منه الشجرة: الأرقامُ هنا تُجمَع فتساوي ما فوقها. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" icon={<Users className="w-4 h-4" />} title={t('أكبر المديونيات', 'Largest receivables')}
          right={<span className="text-[11px] text-slate-400">{t(`أعلى ${top.length} من ${recv?.parties.length || 0}`, `Top ${top.length} of ${recv?.parties.length || 0}`)}</span>}>
          {top.length === 0 ? (
            <p className="py-8 text-center text-slate-400 text-sm">{t('لا شيء مستحق', 'Nothing outstanding')}</p>
          ) : (
            <ol className="-my-1 divide-y divide-slate-100">
              {top.map((r, i) => (
                <li key={`${r.party || r.name}`}>
                  <button type="button"
                    onClick={() => router.push(receivablesHref({ ...filters, parties: [r.key] }))}
                    className="w-full text-start flex items-center gap-3 py-2.5 group">
                    <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[12px] font-bold ${i < 3 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-[#f37121]">{r.name}</span>
                        <span className="shrink-0 tabular-nums text-[13.5px] font-bold text-slate-900">{money(r.value)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-3">
                        <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <span className="block h-full rounded-full bg-red-400/80" style={{ width: `${(Math.max(0, r.value) / topMax) * 100}%` }} />
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                          {t(`${money(r.count)} فاتورة · متأخّر ${money(r.lateValue)}${r.officer ? ` · ${r.officer}` : ''}`,
                             `${money(r.count)} invoices · late ${money(r.lateValue)}${r.officer ? ` · ${r.officer}` : ''}`)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="lg:col-span-2 space-y-4">
          <button type="button" onClick={() => router.push('/system/collections-dept/aging')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Users className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('أعمار الديون — كلُّ الحسابات', 'Ageing — every account')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{money(recv?.tree.all.value || 0)}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
          {/* «القضايا»: العملاءُ تحت التفاوض أو في القضاء — صفحتُهم، والرقمُ ما عليهم تحت فلاتر اللوحة. */}
          <button type="button" onClick={() => router.push('/system/collections-dept/cases')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Scale className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('القضايا والتفاوض', 'Cases & negotiations')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">
                {money((recv?.facets?.issue || []).filter((x) => x.value !== 'none').reduce((a, x) => a + (x.amount || 0), 0))}
              </span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
          <button type="button" onClick={() => router.push('/system/collections-dept/suppliers')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Truck className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('موردون مسجَّلون', 'Registered suppliers')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{data ? money(data.counts.supplier.active) : '—'}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>

      {/* عملاءُ المدّة الافتراضيّة — تُكتب مُددُهم من هنا. */}
      <DefaultTermList
        open={termOpen} onClose={() => setTermOpen(false)}
        parties={recv?.defaultTerm?.parties || []} days={recv?.defaultTerm?.days || 30}
        ar={ar} canEdit={canEdit} onSaved={load}
        onOpenInvoices={(p) => router.push(receivablesHref({ ...filters, parties: [p.key] }, { term: 'default' }))}
      />
    </div>
  );
}
