'use client';
/**
 * المديونيّة كشجرة — ومن كلّ عقدةٍ تُفتَح صفوفُها.
 *
 * ── لماذا شجرةٌ لا بطاقاتٌ متجاورة ─────────────────────────────────────────
 * «علينا عشرون مليونًا» رقمٌ لا يُعمَل به. والذي يُعمَل به: منه كذا ضريبيٌّ وكذا
 * كاش، ومنه كذا عمرُه أسبوعان وكذا تجاوز التسعين، ومن كلّ شريحةٍ كذا في حدود
 * مدّة عميله وكذا خرج عنها. فكلُّ عقدةٍ ابنةُ ما فوقها، ومجموعُ الأبناء = الأب.
 * والشاشةُ تقول ذلك صريحًا: شريطُ التحقّق أسفلها يُقرأ ✔ أو يُسمّي الفرق.
 *
 * ── وكلُّ رقمٍ قيمةٌ وعدد ───────────────────────────────────────────────────
 * «ثلاثُ مئةٍ وستُّ فواتير» و«ثلاثةُ ملايين» سؤالان مختلفان: الأوّلُ عملٌ
 * يُنجَز، والثاني مالٌ يُحصَّل. فلا يُعرَض أحدُهما وحدَه. والعددُ وحدتان لا
 * تُجمعان في الكلام: فواتيرُ ضريبيّة وكشوفُ تخريجٍ نقديّة — تُقالان منفصلتين.
 *
 * ── «عمر التأخير» (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) ─────────────────────────────────
 * حلّ محلَّ «المتأخر — بعمر التأخير» و«ما كسر الـ٦٠» معًا: خمسُ شرائحَ للعمر،
 * وفي كلٍّ ثلاثةُ أجزاءٍ للخطورة (طبيعي / متوسط / مرتفع) على مدّة كلّ عميل.
 * وحالةُ الخلاف (تفاوض / قضايا) صارت فلترًا فوق اللوحة لا بطاقات. وقسمُ «الكاش
 * — في موعده / متأخر / بلا مدّة» طُوي فيها: الكاشُ داخلٌ في الشرائح بأجزائها،
 * ويُعزَل بفلتر «نوع الدفع».
 */
import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Paperclip, CalendarClock, ChevronLeft } from 'lucide-react';

export interface Node { count: number; value: number; customers?: number; tax?: number; cash?: number }
type Risk = 'normal' | 'medium' | 'hard';
export type BandKey = 'd1_15' | 'd16_30' | 'd31_60' | 'd61_90' | 'd91_plus';
export interface Tree {
  all: Node;
  byKind: { tax: Node; cash: Node };
  /** شرائحُ العمر — وفي كلٍّ أجزاؤها الثلاثة. و`nodate` ما لا تاريخَ له. */
  ages?: Partial<Record<BandKey, { total: Node } & Record<Risk, Node>>> & { nodate?: { total: Node } };
  risk?: Record<Risk, Node>;
  /** الأنواعُ الأربعة — مستحقٌّ وغيرُ مستحقّ. راجع collectionsReceivablesController. */
  subtypes?: Partial<Record<SubtypeKey, { total: Node; due: Node; notDue: Node }>>;
}
type SubtypeKey = 'deferred_invoice' | 'deferred_cash' | 'cash_3pl' | 'cash_ht';
export interface Check { of: string; diff: number; n: number; ok: boolean }
export interface Query {
  kind?: string; subtype?: string; due?: 'due' | 'notdue';
  band?: string; risk?: string; attach?: 'missing' | 'missing_tax'; term?: 'default';
}
export interface AttachKpi { of: Node; missing: Node; plainTaxMissing: Node }
export interface DefaultTerm extends Node { days: number }

/**
 * البطاقاتُ الأربع بترتيبها: الضريبيُّ أوّلًا ثمّ الثلاثةُ النقديّة. ووحدةُ العدّ:
 * «آجل - فاتورة» فواتيرُ الدفتر، والثلاثةُ كشوفُ تخريج.
 */
const SUBTYPE_CARDS: { key: SubtypeKey; ar: string; en: string; tone: string; invoice: boolean }[] = [
  { key: 'deferred_invoice', ar: 'آجل - فاتورة', en: 'Deferred – invoice', tone: '#475569', invoice: true },
  { key: 'deferred_cash', ar: 'آجل - كاش', en: 'Deferred – cash', tone: '#0d9488', invoice: false },
  { key: 'cash_3pl', ar: 'نقدي - 3PL', en: 'Cash – 3PL', tone: '#14b8a6', invoice: false },
  { key: 'cash_ht', ar: 'نقدي - HT', en: 'Cash – HT', tone: '#5eead4', invoice: false },
];

/** الشرائحُ الخمس — بلا تداخل: الحدُّ الأعلى شامل، والأولى تضمّ عمرَ اليوم. */
export const BANDS: { key: BandKey; ar: string; en: string }[] = [
  { key: 'd1_15', ar: '١ – ١٥ يومًا', en: '1–15 days' },
  { key: 'd16_30', ar: '١٦ – ٣٠ يومًا', en: '16–30 days' },
  { key: 'd31_60', ar: '٣١ – ٦٠ يومًا', en: '31–60 days' },
  { key: 'd61_90', ar: '٦١ – ٩٠ يومًا', en: '61–90 days' },
  { key: 'd91_plus', ar: 'أكثر من ٩٠ يومًا', en: 'Over 90 days' },
];
/** الخطورةُ على مدّة العميل N: طبيعيٌّ حتى N، ومتوسّطٌ حتى N+30، ومرتفعٌ بعدها. */
export const RISKS: { key: Risk; ar: string; en: string; tone: string }[] = [
  { key: 'normal', ar: 'طبيعي', en: 'Normal', tone: '#16a34a' },
  { key: 'medium', ar: 'متوسط', en: 'Medium', tone: '#f59e0b' },
  { key: 'hard', ar: 'مرتفع', en: 'Hard', tone: '#dc2626' },
];
const EMPTY: Node = { count: 0, value: 0, customers: 0, tax: 0, cash: 0 };

const money = (n: number) => Math.round(n || 0).toLocaleString('en-US');
const num = (n?: number) => (n || 0).toLocaleString('en-US');

/** «١٢ فاتورة · ٣ كشف تخريج» — ما في الخانة من كلٍّ، ولا يُقال الصفر. */
export function unitsOf(n: Node | undefined, ar: boolean) {
  const t = (a: string, e: string) => (ar ? a : e);
  const tax = n?.tax ?? (n?.cash ? 0 : n?.count || 0);
  const cash = n?.cash || 0;
  const parts: string[] = [];
  if (tax || !cash) parts.push(`${num(tax)} ${t('فاتورة', 'invoices')}`);
  if (cash) parts.push(`${num(cash)} ${t('كشف تخريج', 'reports')}`);
  return parts.join(' · ');
}

export default function ReceivablesTree({
  tree, checks, ar, onOpen, attachments, defaultTerm, onOpenDefaultTerm,
}: {
  tree: Tree; checks: Check[]; ar: boolean; onOpen: (q: Query, title: string) => void;
  attachments?: AttachKpi; defaultTerm?: DefaultTerm; onOpenDefaultTerm?: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const pct = (n: Node, of: Node) => (of?.value ? Math.round((n.value / of.value) * 1000) / 10 : 0);
  const bad = useMemo(() => checks.filter((c) => !c.ok), [checks]);
  const customers = (n?: Node) => `${num(n?.customers)} ${t('عميل', 'customers')}`;
  const nodate = tree.ages?.nodate?.total;

  return (
    <div className="space-y-6">
      {/* ① كم علينا — والقسمةُ الأولى: ضريبيٌّ ونقديّ */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-700">{t('إجمالي المديونية', 'Total receivables')}</h2>
        {/* كارتٌ واحدٌ طويل: الإجماليُّ فوق، وتحته نصفاه — ضريبيٌّ وكاش —
            ومجموعُهما هو الإجماليُّ نفسُه (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          <button type="button" onClick={() => onOpen({}, t('كلُّ المديونية', 'All receivables'))}
            className="w-full text-center px-4 pt-5 pb-4 hover:bg-slate-50/60 transition-colors">
            <p className="text-[12px] font-medium text-slate-500">{t('كلُّ ما لنا — غيرُ محصَّل', 'All outstanding')}</p>
            <p className="mt-1.5 text-[34px] leading-none font-bold tabular-nums tracking-tight text-slate-900">{money(tree.all.value)}</p>
            {/* العدُّ نوعان لا يُجمعان: فواتيرُ ضريبيّة وكشوفُ تخريجٍ نقديّة. */}
            <p className="mt-1.5 text-[11.5px] text-slate-400 tabular-nums">
              {num(tree.byKind.tax.count)} {t('فاتورة', 'invoices')}
              <span className="text-slate-300"> · </span>
              {num(tree.byKind.cash.count)} {t('كشف تخريج', 'reports')}
              {tree.all.customers != null && <><span className="text-slate-300"> · </span>{customers(tree.all)}</>}
            </p>
          </button>
          {/* شريطُ النسبة: كم من الكلّ ضريبيٌّ وكم كاش — يُقرأ قبل الأرقام. */}
          <div className="mx-4 h-1.5 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden>
            <span style={{ width: `${pct(tree.byKind.tax, tree.all)}%`, background: '#475569' }} />
            <span style={{ width: `${pct(tree.byKind.cash, tree.all)}%`, background: '#14b8a6' }} />
          </div>
          <div className="mt-3 grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
            {([
              ['tax', t('فواتير', 'Invoices'), '#475569', t('المديونية الضريبية', 'Tax receivables'), t('فاتورة', 'invoices')],
              ['cash', t('كاش', 'Cash'), '#14b8a6', t('المديونية الكاش', 'Cash receivables'), t('كشف تخريج', 'reports')],
            ] as const).map(([k, label, tone, title, unit]) => {
              const n = tree.byKind[k];
              const share = pct(n, tree.all);
              return (
                <button key={k} type="button" onClick={() => onOpen({ kind: k }, title)}
                  className="text-center px-3 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
                    {label}
                  </p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums tracking-tight text-slate-900">{money(n.value)}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
                    {num(n.count)} {unit}{share > 0 ? ` · ${share}%` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ② أنواعُ الدفع الأربعة: مستحقٌّ وغيرُ مستحقّ ─────────────────────────
          «ضريبي»/«كاش» بلا نوعٍ جديد لا تدخلها. وكلُّ نصفٍ يُفتَح فتُرى صفوفُه. */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[13px] font-semibold text-slate-700">{t('بأنواع الدفع — مستحق وغير مستحق', 'By payment type — due and not yet due')}</h2>
          <span className="text-[11px] text-slate-400">
            {t('المستحقُّ ما تجاوز موعدَه، ومعه ما لا مدّةَ سدادٍ له — فلا شيءَ يؤجّله',
              'Due = past its due date, plus anything with no credit term — nothing defers it')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {SUBTYPE_CARDS.map((c) => {
            const n = tree.subtypes?.[c.key] || { total: EMPTY, due: EMPTY, notDue: EMPTY };
            const unit = c.invoice ? t('فاتورة', 'invoices') : t('كشف تخريج', 'reports');
            const label = t(c.ar, c.en);
            const half = (k: 'due' | 'notdue', node: Node, title: string) => (
              <button type="button" onClick={() => onOpen({ subtype: c.key, due: k }, `${label} — ${title}`)}
                className="text-center px-2 py-3.5 hover:bg-slate-50/60 transition-colors">
                <p className="text-[11.5px] font-medium text-slate-500">{title}</p>
                <p className="mt-1 text-[19px] font-bold tabular-nums tracking-tight text-slate-900">{money(node.value)}</p>
                <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{num(node.count)} {unit}</p>
              </button>
            );
            return (
              <div key={c.key} className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
                <div className="text-center px-4 pt-3.5 pb-2.5">
                  <p className="text-[12px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.tone }} />
                    {label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                    {money(n.total.value)} · {num(n.total.count)} {unit}
                  </p>
                </div>
                <div className="grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
                  {half('due', n.due, t('مستحق', 'Due'))}
                  {half('notdue', n.notDue, t('غير مستحق', 'Not yet due'))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ③ عمرُ التأخير — خمسُ شرائح، وفي كلٍّ طبيعي / متوسط / مرتفع ────────── */}
      {tree.ages && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[13px] font-semibold text-slate-700">{t('عمر التأخير', 'Age of receivables')}</h2>
            <span className="text-[11px] text-slate-400">
              {t('العمرُ من تسليم الفاتورة للعميل (وإلّا من إصدارها) · الخطورةُ على مدّة كلّ عميل N: طبيعي حتى N، متوسط حتى N+30، مرتفع بعدها',
                'Age from delivery to the customer (else issue) · risk on each customer’s term N: normal ≤ N, medium ≤ N+30, hard beyond')}
            </span>
          </div>
          {/* الخطورةُ في الكلّ — سطرٌ هادئٌ فوق الشرائح، كلُّ جزءٍ يُفتَح. */}
          {tree.risk && (
            <div className="grid grid-cols-3 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden divide-x divide-slate-100 rtl:divide-x-reverse">
              {RISKS.map((r) => (
                <button key={r.key} type="button" onClick={() => onOpen({ risk: r.key }, `${t('الخطورة', 'Risk')} — ${t(r.ar, r.en)}`)}
                  className="text-center px-2 py-3 hover:bg-slate-50/60 transition-colors">
                  <p className="text-[11.5px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: r.tone }} />{t(r.ar, r.en)}
                  </p>
                  <p className="mt-0.5 text-[18px] font-bold tabular-nums tracking-tight text-slate-900">{money(tree.risk![r.key].value)}</p>
                  <p className="text-[11px] text-slate-400 tabular-nums">{customers(tree.risk![r.key])} · {unitsOf(tree.risk![r.key], ar)}</p>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {BANDS.map((b) => {
              const band = tree.ages?.[b.key];
              const total = band?.total || EMPTY;
              const label = t(b.ar, b.en);
              return (
                <div key={b.key} className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
                  <button type="button" onClick={() => onOpen({ band: b.key }, `${t('عمر التأخير', 'Age')} — ${label}`)}
                    className="text-center px-3 pt-3.5 pb-3 hover:bg-slate-50/60 transition-colors">
                    <p className="text-[12px] font-semibold text-slate-700">{label}</p>
                    <p className="mt-1 text-[21px] font-bold tabular-nums tracking-tight text-slate-900">{money(total.value)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{customers(total)} · {unitsOf(total, ar)}</p>
                  </button>
                  <div className="border-t border-slate-100 divide-y divide-slate-100 flex-1">
                    {RISKS.map((r) => {
                      const n = band?.[r.key] || EMPTY;
                      return (
                        <button key={r.key} type="button"
                          onClick={() => onOpen({ band: b.key, risk: r.key }, `${label} — ${t(r.ar, r.en)}`)}
                          className={`w-full text-center px-3 py-2.5 hover:bg-slate-50/60 transition-colors ${n.count ? '' : 'opacity-60'}`}>
                          <p className="text-[11px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: r.tone }} />{t(r.ar, r.en)}
                          </p>
                          <p className="text-[15px] font-bold tabular-nums tracking-tight text-slate-900">{money(n.value)}</p>
                          <p className="text-[10.5px] text-slate-400 tabular-nums">{customers(n)} · {unitsOf(n, ar)}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {/* وما لا تاريخَ له لا عمرَ له — يُقال كي تُجمَع الشرائحُ إلى الإجمالي. */}
          {!!nodate?.count && (
            <button type="button" onClick={() => onOpen({ band: 'nodate' }, t('بلا تاريخ', 'No date'))}
              className="text-[11.5px] text-slate-500 hover:text-slate-900 tabular-nums">
              {t('بلا تاريخ تسليمٍ ولا إصدار', 'No delivery or issue date')}: {money(nodate.value)} · {unitsOf(nodate, ar)}
            </button>
          )}
        </section>
      )}

      {/* ④ ما ينقص الملفَّ: فواتيرُ بلا مرفق، وعملاءُ بلا مدّة سداد ─────────── */}
      {(attachments || defaultTerm) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {attachments && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
              <button type="button" onClick={() => onOpen({ attach: 'missing' }, t('آجل - فاتورة — بلا مرفق', 'Deferred invoice — no attachment'))}
                className="w-full text-center px-4 pt-4 pb-3 hover:bg-slate-50/60 transition-colors">
                <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />{t('«آجل - فاتورة» بلا مرفق', '“Deferred – invoice” with no attachment')}
                </p>
                <p className="mt-1 text-[22px] font-bold tabular-nums tracking-tight text-slate-900">{money(attachments.missing.value)}</p>
                <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
                  {num(attachments.missing.count)} {t('فاتورة', 'invoices')} {t('من', 'of')} {num(attachments.of.count)}
                  <span className="text-slate-300"> · </span>{t('افتحها وارفع من الجدول', 'open and upload from the table')}
                </p>
              </button>
              {!!attachments.plainTaxMissing.count && (
                <button type="button" onClick={() => onOpen({ attach: 'missing_tax' }, t('ضريبي (بلا نوع) — بلا مرفق', 'Tax (no subtype) — no attachment'))}
                  className="w-full border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500 hover:bg-slate-50/60 tabular-nums">
                  {t('ومن «ضريبي» بلا نوعٍ جديد', 'And plain “tax” (no subtype)')}: {num(attachments.plainTaxMissing.count)} {t('فاتورة بلا مرفق', 'with no attachment')} · {money(attachments.plainTaxMissing.value)}
                </button>
              )}
            </div>
          )}
          {defaultTerm && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
              <button type="button" onClick={onOpenDefaultTerm}
                className="w-full text-center px-4 pt-4 pb-3 hover:bg-slate-50/60 transition-colors">
                <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5" />
                  {t(`بمدّة افتراضية ${defaultTerm.days} يومًا — حدّد مدّة العميل`, `On the default ${defaultTerm.days}-day term — set the customer’s term`)}
                </p>
                <p className="mt-1 text-[22px] font-bold tabular-nums tracking-tight text-slate-900">{num(defaultTerm.customers)} <span className="text-[13px] font-medium text-slate-500">{t('عميل', 'customers')}</span></p>
                <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
                  {money(defaultTerm.value)} · {unitsOf(defaultTerm, ar)}
                  <span className="text-slate-300"> · </span>
                  <span className="inline-flex items-center gap-0.5">{t('قائمة العملاء', 'customer list')}<ChevronLeft className={`w-3 h-3 ${ar ? '' : 'rotate-180'}`} /></span>
                </p>
              </button>
              <button type="button" onClick={() => onOpen({ term: 'default' }, t('فواتير على المدّة الافتراضية', 'Invoices on the default term'))}
                className="w-full border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500 hover:bg-slate-50/60">
                {t('افتح فواتيرهم', 'Open their invoices')}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ⑤ وشريطُ التحقّق: الأرقامُ تُطابق نفسَها أو يُقال أين الفرق */}
      <div className={`rounded-xl px-3.5 py-2.5 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1 ${
        bad.length ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
        {bad.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        {bad.length
          ? bad.map((c) => <span key={c.of}>{c.of}: {t('فرق', 'diff')} {money(c.diff)} / {c.n}</span>)
          : <span>{t('الأرقام تُطابق نفسَها: الإجمالي = ضريبي + نقدي = شرائح العمر الخمس، وكلُّ شريحة = طبيعي + متوسط + مرتفع، وكلُّ نوعٍ من الأربعة = مستحق + غير مستحق.',
                     'The numbers reconcile at every level of the tree.')}</span>}
      </div>
    </div>
  );
}
