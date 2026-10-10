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
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { money } from '@/lib/collections';
import SearchSelect from '@/components/system/SearchSelect';
import { Spinner, PageHeader, Field } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import ExportMenu from '@/components/ls2/ExportMenu';
import ReceivablesTree, { type Tree, type Check } from '@/components/collections/ReceivablesTree';
import ReceivablesRows from '@/components/collections/ReceivablesRows';
import {
  Wallet, Users, ChevronLeft, SlidersHorizontal, X,
  UserCheck, Truck,
} from 'lucide-react';

interface Recv {
  tree: Tree;
  checks: Check[];
  officers: { officer: string; count: number; value: number; late: number; lateValue: number; over60: number; over60Value: number }[];
  parties: { party: string | null; name: string; code: string; officer: string; issueState: string; count: number; value: number; late: number; lateValue: number; over60: number; over60Value: number; oldest: number | null }[];
}
// من لوحة كشوف التشغيل يبقى عددُ الموردين وحدَه — المالُ كلُّه من الدفتر.
interface Dash {
  counts: { customer: { active: number; inactive: number }; supplier: { active: number; inactive: number } };
}

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

// (مكوّنُ Kpi رُفع مع البطاقات التي كانت تستعمله — راجع القسم ١ أدناه.)

export default function CollectionsDashboardPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  // شجرةُ المديونيّة من دفتر الفواتير — راجع components/collections/ReceivablesTree.
  const [recv, setRecv] = useState<Recv | null>(null);
  // العقدةُ المفتوحة: صفوفُها تأتي من نفس اشتقاق الخادم الذي حسب البطاقة.
  const [drill, setDrill] = useState<{ q: Record<string, string>; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // اللوحةُ تُفلتر كما تُفلتر الصفحات: عميلٌ بعينه، وفرع، وشريحةُ عمر، ومدى.
  const [customer, setCustomer] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [opts, setOpts] = useState<{ customers: string[]; suppliers: string[]; branches: string[] }>(
    { customers: [], suppliers: [], branches: [] },
  );
  const activeCount = [customer, from, to].filter(Boolean).length;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;

    try {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (customer) p.set('customer', customer);
      // المالُ كلُّه من دفتر الفواتير؛ ومن لوحة الكشوف عددُ الموردين وحدَه.
      const [d, rv] = await Promise.all([
        api.get<Dash>('/api/collections-dept/dashboard'),
        api.get<Recv>(`/api/collections-dept/receivables/overview?${p.toString()}`).catch(() => null),
      ]);
      // ردٌّ متأخّرٌ لفلترٍ سابق لا يكتب فوق الأحدث.
      if (mine === seq.current) { setData(d); if (rv) setRecv(rv); }
    } catch (e: any) {
      if (mine === seq.current) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (mine === seq.current) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, customer]);
  useEffect(() => { load(); }, [load]);

  // ── حيّة: تعديلٌ على كشفٍ أو فاتورةٍ أو طرف ⇒ قراءةٌ واحدةٌ بعد هدوء الدفعة ──
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

  useEffect(() => {
    // أسماءُ الدفتر لا أسماءُ الكشوف: الفلترُ يُطبَّق على فواتير الدفتر.
    api.get<{ customers: string[] }>('/api/collections-dept/invoices/filters?kind=tax')
      .then((r) => setOpts({ customers: r.customers || [], suppliers: [], branches: [] })).catch(() => {});
  }, []);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const top = (recv?.parties || []).slice(0, 15);
  const topMax = Math.max(1, ...top.map((r) => r.value));
  const clear = () => { setCustomer(''); setFrom(''); setTo(''); };
  // فلاترُ الصفحة تُحمَل إلى كلِّ جدولٍ يُفتَح منها: بطاقةٌ مفلترةٌ تفتح صفوفَها هي.
  const ledgerFilters: Record<string, string> = {
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(customer ? { customer } : {}),
  };

  const topCols = [
    { header: t('الكود', 'Code'), key: 'code', width: 12 },
    { header: t('العميل', 'Customer'), key: 'name', width: 34 },
    { header: t('موظف التحصيل', 'Officer'), key: 'officer', width: 14 },
    { header: t('فواتير', 'Invoices'), key: 'count', width: 10 },
    { header: t('المديونية', 'Outstanding'), key: 'value', width: 16 },
    { header: t('منها متأخر', 'Of which late'), key: 'lateValue', width: 16 },
    { header: t('منها فوق ٦٠', 'Of which 60+'), key: 'over60Value', width: 16 },
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

      {/* ── الفلاتر: شريطٌ واحدٌ هادئ، والتفصيلُ عند الطلب ─────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} ar={ar} />
          <button type="button" onClick={() => setShowFilters((p) => !p)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              activeCount ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
            <SlidersHorizontal className="w-4 h-4" />{t('فلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
          </button>
          {activeCount > 0 && (
            <button type="button" onClick={clear}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
              <X className="w-4 h-4" />{t('إزالة الفلاتر', 'Clear')}
            </button>
          )}
        </div>
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('العميل', 'Customer')}>
                <SearchSelect ar={ar} value={customer} onChange={setCustomer}
                  allLabel={t('جميع العملاء', 'All customers')}
                  options={opts.customers.map((c) => ({ value: c, label: c }))} />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* ── ٠. المديونيّةُ كشجرة ───────────────────────────────────────────────
          أوّلُ سؤالٍ يُسأل في القسم: كم علينا، وما منه في موعده وما خرج عنه،
          وما كسر الستّين أمشكلةٌ في اليد أم قضيّة. ومصدرُه **دفترُ الفواتير**
          لا كشوفُ التشغيل (٩٤٪ من فواتير الدفتر لا كشوفَ لها عندنا) — ولذلك
          هو نداءٌ آخر، والشجرةُ تُطابق نفسَها بشريط تحقّقٍ أسفلها. */}
      {recv && (
        <ReceivablesTree tree={recv.tree} checks={recv.checks} ar={ar}
          onOpen={(q, title) => setDrill({ q: { ...ledgerFilters, ...(q as Record<string, string>) }, title })} />
      )}

      {/* وبالموظّف: العملُ موزَّعًا لا مجموعًا — لكلٍّ ما عليه وما تأخّر منه. */}
      {!!recv?.officers?.length && (
        <Panel title={t('المديونية بموظف التحصيل', 'Receivables by officer')} icon={<UserCheck className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {recv.officers.map((o) => (
              <button key={o.officer} type="button"
                onClick={() => setDrill({ q: { ...ledgerFilters, officer: o.officer === '—' ? 'none' : o.officer }, title: `${t('مديونية', 'Receivables')} — ${o.officer}` })}
                className="text-start bg-slate-50 border border-slate-200 rounded-xl p-3 hover:border-[#f37121]/50 transition-colors">
                <p className="text-[12px] font-semibold text-slate-800">{o.officer}</p>
                <p className="text-lg font-extrabold tabular-nums text-slate-900">{money(o.value)}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {o.count} {t('فاتورة', 'inv')} · {t('متأخر', 'late')} {money(o.lateValue)} · {t('فوق ٦٠', '60+')} {o.over60}
                </p>
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
                    onClick={() => (r.party
                      ? setDrill({ q: { ...ledgerFilters, party: String(r.party) }, title: `${t('مديونية', 'Receivables')} — ${r.name}` })
                      : setDrill({ q: { ...ledgerFilters, customer: r.name }, title: `${t('مديونية', 'Receivables')} — ${r.name}` }))}
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
          <button type="button" onClick={() => router.push('/system/collections-dept/suppliers')}
            className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm text-start hover:border-[#f37121]/50 hover:shadow-md transition-all group">
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><Truck className="w-5 h-5" /></span>
            <span className="flex-1">
              <span className="block text-[12px] text-slate-500">{t('موردون مسجَّلون', 'Registered suppliers')}</span>
              <span className="block text-[18px] font-extrabold tabular-nums text-slate-900">{money(data.counts.supplier.active)}</span>
            </span>
            <ChevronLeft className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>

      {/* صفوفُ العقدة المفتوحة — ومنها يُصنَّف خلافُ العميل. */}
      <ReceivablesRows
        open={!!drill} onClose={() => setDrill(null)}
        title={drill?.title || ''} query={drill?.q || {}}
        ar={ar} canEdit
        onChanged={load}
      />
    </div>
  );
}
