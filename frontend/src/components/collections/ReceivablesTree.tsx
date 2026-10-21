'use client';
/**
 * المديونيّة كشجرة — ومن كلّ عقدةٍ تُفتَح صفوفُها.
 *
 * ── لماذا شجرةٌ لا بطاقاتٌ متجاورة ─────────────────────────────────────────
 * «علينا عشرون مليونًا» رقمٌ لا يُعمَل به. والذي يُعمَل به: منه كذا في موعده
 * وكذا تأخّر، ومن المتأخّر كذا كسر الستّين يومًا، ومن ذاك كذا خرج إلى القضاء.
 * فكلُّ عقدةٍ ابنةُ ما فوقها، ومجموعُ الأبناء = الأب. والشاشةُ تقول ذلك صريحًا:
 * شريطُ التحقّق أسفلها يُقرأ ✔ أو يُسمّي الفرق — فلا يُجمَع باليد للتأكّد.
 *
 * ── وكلُّ رقمٍ عددٌ وقيمة ───────────────────────────────────────────────────
 * «ثلاثُ مئةٍ وستُّ فواتير» و«ثلاثةُ ملايين» سؤالان مختلفان: الأوّلُ عملٌ
 * يُنجَز، والثاني مالٌ يُحصَّل. فلا يُعرَض أحدُهما وحدَه.
 */
import { useMemo } from 'react';
import { ChevronRight, AlertTriangle, CheckCircle2, Scale, Handshake, HelpCircle, Clock } from 'lucide-react';

export interface Node { count: number; value: number }
export interface Tree {
  all: Node;
  byKind: { tax: Node; cash: Node };
  tax: {
    within: Node; late: Node; noterm: Node;
    bands: { d1_30: Node; d31_60: Node; d60_plus: Node };
    over60: { negotiating: Node; legal: Node; unclassified: Node };
  };
  cash: { within: Node; late: Node; noterm: Node };
}
export interface Check { of: string; diff: number; n: number; ok: boolean }
export interface Query { kind?: string; dueState?: string; lateBand?: string; issue?: string }

const money = (n: number) => Math.round(n || 0).toLocaleString('en-US');

/**
 * بطاقةٌ واحدة: عنوانٌ وعددٌ وقيمة، تُفتَح بالضغط.
 *
 * ── هادئةٌ ومتوسّطة ─────────────────────────────────────────────────────────
 * كانت لكلّ بطاقةٍ حافّةٌ علويّةٌ ملوّنةٌ عريضة ورقمٌ بلونها، فصارت الشاشةُ
 * صفوفَ ألوانٍ يتنافس كلٌّ منها على العين. فاللونُ نقطةٌ صغيرةٌ بجانب العنوان،
 * والرقمُ بالحبر الداكن إلّا ما يستحقّ الإنذار، والمحتوى في الوسط.
 */
function Card({
  label, hint, node, tone, onClick, big, share, alarm,
}: {
  label: string; hint?: string; node: Node; tone: string; onClick?: () => void; big?: boolean; share?: number;
  /** رقمٌ يُقرأ إنذارًا — يأخذ لونَه بدل الحبر. */
  alarm?: boolean;
}) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick}
      className={`group w-full h-full bg-white border border-slate-200 rounded-2xl px-4 py-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors ${
        onClick ? 'hover:border-slate-300 hover:bg-slate-50/60 cursor-pointer' : ''}`}>
      <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
        {label}
      </p>
      <p className={`mt-1.5 font-bold tabular-nums tracking-tight ${big ? 'text-[28px]' : 'text-[22px]'} ${alarm ? '' : 'text-slate-900'}`}
        style={alarm ? { color: tone } : undefined}>
        {money(node?.value || 0)}
      </p>
      <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
        {(node?.count || 0).toLocaleString('en-US')} فاتورة
        {share != null && share > 0 ? <span className="text-slate-300"> · </span> : null}
        {share != null && share > 0 ? `${share}%` : ''}
      </p>
      {hint ? <p className="text-[10.5px] text-slate-400 mt-1">{hint}</p> : null}
    </Comp>
  );
}

export default function ReceivablesTree({
  tree, checks, ar, onOpen,
}: {
  tree: Tree; checks: Check[]; ar: boolean; onOpen: (q: Query, title: string) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const pct = (n: Node, of: Node) => (of?.value ? Math.round((n.value / of.value) * 1000) / 10 : 0);
  const bad = useMemo(() => checks.filter((c) => !c.ok), [checks]);

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
            <p className="mt-1.5 text-[11.5px] text-slate-400 tabular-nums">{(tree.all.count || 0).toLocaleString('en-US')} فاتورة</p>
          </button>
          {/* شريطُ النسبة: كم من الكلّ ضريبيٌّ وكم كاش — يُقرأ قبل الأرقام. */}
          <div className="mx-4 h-1.5 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden>
            <span style={{ width: `${pct(tree.byKind.tax, tree.all)}%`, background: '#475569' }} />
            <span style={{ width: `${pct(tree.byKind.cash, tree.all)}%`, background: '#14b8a6' }} />
          </div>
          <div className="mt-3 grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 rtl:divide-x-reverse">
            {([
              ['tax', t('فواتير ضريبية', 'Tax invoices'), '#475569', t('المديونية الضريبية', 'Tax receivables')],
              ['cash', t('فواتير كاش', 'Cash invoices'), '#14b8a6', t('المديونية الكاش', 'Cash receivables')],
            ] as const).map(([k, label, tone, title]) => {
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
                    {(n.count || 0).toLocaleString('en-US')} فاتورة{share > 0 ? ` · ${share}%` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ② الضريبيُّ: في موعده / متأخّر / بلا مدّة */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[13px] font-semibold text-slate-700">{t('الفواتير الضريبية — بالاستحقاق', 'Tax invoices — by due state')}</h2>
          <span className="text-[11px] text-slate-400">
            {t('المدّةُ تُعَدّ من تاريخ التسليم + مدّةِ سداد العميل', 'The term runs from the delivery date + the customer’s credit days')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card label={t('مستحق في مواعيده', 'Within term')} node={tree.tax.within} tone="#16a34a"
            hint={t('لم يحِنْ موعدُه بعد', 'Not yet due')}
            share={pct(tree.tax.within, tree.byKind.tax)}
            onClick={() => onOpen({ kind: 'tax', dueState: 'within' }, t('مستحق في مواعيده', 'Within term'))} />
          <Card label={t('متأخر عن موعده', 'Past due')} alarm node={tree.tax.late} tone="#dc2626"
            share={pct(tree.tax.late, tree.byKind.tax)}
            onClick={() => onOpen({ kind: 'tax', dueState: 'late' }, t('متأخر عن موعده', 'Past due'))} />
          <Card label={t('بلا مدّة سداد محفوظة', 'No credit term on file')} node={tree.tax.noterm} tone="#64748b"
            hint={t('لا موعدَ له حتى تُكتب مدّةُ العميل', 'No due date until the customer’s term is set')}
            share={pct(tree.tax.noterm, tree.byKind.tax)}
            onClick={() => onOpen({ kind: 'tax', dueState: 'noterm' }, t('بلا مدّة سداد', 'No term'))} />
        </div>
      </section>

      {/* ③ والمتأخّرُ بشرائحه */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-700">{t('المتأخر — بعُمر التأخير', 'Past due — by how late')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card label={t('متأخر ١ – ٣٠ يومًا', 'Late 1–30 days')} node={tree.tax.bands.d1_30} tone="#f59e0b"
            share={pct(tree.tax.bands.d1_30, tree.tax.late)}
            onClick={() => onOpen({ kind: 'tax', lateBand: 'd1_30' }, t('متأخر ١–٣٠', 'Late 1–30'))} />
          <Card label={t('متأخر ٣١ – ٦٠ يومًا', 'Late 31–60 days')} node={tree.tax.bands.d31_60} tone="#ea580c"
            share={pct(tree.tax.bands.d31_60, tree.tax.late)}
            onClick={() => onOpen({ kind: 'tax', lateBand: 'd31_60' }, t('متأخر ٣١–٦٠', 'Late 31–60'))} />
          <Card label={t('كسر الـ ٦٠ يومًا', 'Over 60 days late')} alarm node={tree.tax.bands.d60_plus} tone="#b91c1c"
            hint={t('هذه هي المشكلة — صنِّفها تحت', 'This is the problem — classify it below')}
            share={pct(tree.tax.bands.d60_plus, tree.tax.late)}
            onClick={() => onOpen({ kind: 'tax', lateBand: 'd60_plus' }, t('كسر الـ٦٠ يومًا', 'Over 60'))} />
        </div>
      </section>

      {/* ④ وما كسر الستّين: أفي اليد أم في القضاء؟ */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <h2 className="text-[13px] font-semibold text-slate-700">
            {t('ما كسر الـ٦٠ — أمشكلةٌ نتفاوض فيها أم وصلت القضاء؟', 'Over 60 — negotiated, or gone to court?')}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5"><Handshake className="w-3.5 h-3.5" />{t('مشكلة قائمة — يُتفاوض فيها', 'Negotiating')}</p>
            <button type="button" onClick={() => onOpen({ kind: 'tax', lateBand: 'd60_plus', issue: 'negotiating' }, t('تحت التفاوض', 'Negotiating'))}
              className="mt-1.5 block mx-auto text-[22px] font-bold tabular-nums tracking-tight text-slate-900 hover:underline">{money(tree.tax.over60.negotiating.value)}</button>
            <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">{tree.tax.over60.negotiating.count} فاتورة</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5"><Scale className="w-3.5 h-3.5" />{t('وصلت القضايا', 'Legal')}</p>
            <button type="button" onClick={() => onOpen({ kind: 'tax', lateBand: 'd60_plus', issue: 'legal' }, t('قضايا', 'Legal'))}
              className="mt-1.5 block mx-auto text-[22px] font-bold tabular-nums tracking-tight text-[#9a3412] hover:underline">{money(tree.tax.over60.legal.value)}</button>
            <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">{tree.tax.over60.legal.count} فاتورة</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-[12px] font-medium text-slate-500 inline-flex items-center justify-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" />{t('لم يُصنَّف بعد', 'Not classified yet')}</p>
            <button type="button" onClick={() => onOpen({ kind: 'tax', lateBand: 'd60_plus', issue: 'none' }, t('غير مصنّف', 'Unclassified'))}
              className="mt-1.5 block mx-auto text-[22px] font-bold tabular-nums tracking-tight text-slate-900 hover:underline">{money(tree.tax.over60.unclassified.value)}</button>
            <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
              {tree.tax.over60.unclassified.count} فاتورة · {t('افتحها وصنِّف عميلَها', 'open and classify its customer')}
            </p>
          </div>
        </div>
      </section>

      {/* ⑤ والنقديُّ سطرٌ واحد: يُحصَّل عند التسليم فلا مواعيدَ له */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Clock className="w-4 h-4 text-teal-600" />
          <h2 className="text-[13px] font-semibold text-slate-700">{t('الكاش', 'Cash')}</h2>
          <span className="text-[11px] text-slate-400">
            {t('يُحصَّل عند التسليم، فأكثرُه بلا مدّةِ سدادٍ محفوظة', 'Collected on delivery, so most carries no credit term')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card label={t('في موعده', 'Within term')} node={tree.cash.within} tone="#16a34a"
            onClick={() => onOpen({ kind: 'cash', dueState: 'within' }, t('كاش — في موعده', 'Cash — within term'))} />
          <Card label={t('متأخر', 'Past due')} node={tree.cash.late} tone="#dc2626"
            onClick={() => onOpen({ kind: 'cash', dueState: 'late' }, t('كاش — متأخر', 'Cash — late'))} />
          <Card label={t('بلا مدّة سداد', 'No term')} node={tree.cash.noterm} tone="#64748b"
            onClick={() => onOpen({ kind: 'cash', dueState: 'noterm' }, t('كاش — بلا مدّة', 'Cash — no term'))} />
        </div>
      </section>

      {/* ⑥ وشريطُ التحقّق: الأرقامُ تُطابق نفسَها أو يُقال أين الفرق */}
      <div className={`rounded-xl px-3.5 py-2.5 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1 ${
        bad.length ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
        {bad.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        {bad.length
          ? bad.map((c) => <span key={c.of}>{c.of}: {t('فرق', 'diff')} {money(c.diff)} / {c.n}</span>)
          : <span>{t('الأرقام تُطابق نفسَها: الإجمالي = ضريبي + نقدي، والضريبي = في موعده + متأخر + بلا مدّة، والمتأخر = شرائحه، وما كسر الـ٦٠ = تفاوض + قضايا + غير مصنّف.',
                     'The numbers reconcile at every level of the tree.')}</span>}
      </div>
    </div>
  );
}
