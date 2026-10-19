'use client';
/**
 * مدخلات الأوردرات — جدولٌ كالشيت (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * الأوردراتُ تُكتب على النظام لا في شيتات جوجل. لكلّ مندوبٍ سطرٌ: اسمُه ورقمُ
 * إقامته ومشروعُه ومشرفُه وجهتُه، وبجانبه خانةُ اليوم يُكتب فيها الرقم. وفوق
 * الجدول كروتُ الشيت نفسُها: عددُ المناديب بالجهة، وتوزيعُهم على المشاريع، وملخّصُ
 * التحقيق حسب المشرف والمشروع.
 *
 * ومديرُ المشروع أو المشرف يرى مشاريعَه وحدَها (يحسمه الخادم — utils/b2cEntry)،
 * وما يُكتب هنا يصل تحليلَ الأوردرات ولوحةَ B2C في اللحظة (`b2c:order:upserted`).
 *
 * والخانةُ تُحفَظ عند الخروج منها أو بـEnter، وEnter ينزل إلى المندوب التالي كما
 * في الإكسيل. ولا يُكتب ردٌّ قديمٌ فوق ما يكتبه المستخدمُ الآن (راجع `dirty`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { CalendarDays, ChevronRight, ChevronLeft, Search, Check, Loader2, AlertCircle, X } from 'lucide-react';

type Row = {
  lt: string; idNumber: string; name: string; projectAr: string; cityAr: string; supervisorName: string; kind: string;
  status: string; ended: boolean; orders: number | null; total: number; workedDays: number;
  target: number | null; pct: number | null; evaluation: string; expected: number; unit: string;
};
type Data = {
  date: string; from: string; to: string; today: string; rows: Row[];
  cards: { reps: Record<string, number>; byProject: Record<string, any>[]; dayTotal: number; dayEntered: number; periodTotal: number; onLeave: number };
  summary: { supervisor: string; project: string; reps: number; achieved: number; near: number; far: number; noOrders: number; shipments: number; total: number; rate: number | null }[];
  summaryTotal: { reps: number; achieved: number; near: number; far: number; shipments: number; total: number; rate: number | null };
  projects: { nameAr: string; monthlyTarget: number; dailyTarget: number }[];
  scope: string[] | null;
};

const KINDS = ['كفالة', 'فري لانسر', 'يوزرات'];
const EVALS = ['حقق', 'قريب', 'بعيد', 'شحنات', 'لا طلبات'];
const EVAL_CLS: Record<string, string> = {
  'حقق': 'bg-emerald-100 text-emerald-800', 'قريب': 'bg-amber-100 text-amber-800', 'بعيد': 'bg-red-100 text-red-700',
  'شحنات': 'bg-sky-100 text-sky-800', 'لا طلبات': 'bg-slate-100 text-slate-500',
};
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pctTxt = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// ── خانةُ اليوم — مكوّنٌ خارج الصفحة كي لا تُهدَم مع كلّ ضغطة (inline-components-remount) ──
function OrderCell({ row, value, state, onChange, onCommit, onNav, inputRef, disabled }: {
  row: Row; value: string; state?: 'saving' | 'saved' | 'error'; disabled: boolean;
  onChange: (v: string) => void; onCommit: () => void; onNav: (dir: 1 | -1) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input ref={inputRef} inputMode="numeric" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); onCommit(); onNav(1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); onCommit(); onNav(-1); }
        }}
        placeholder={row.unit === 'شحنة' ? 'شحنات' : '—'}
        className={`w-20 rounded-md border px-2 py-1.5 text-center text-[14px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/60
          ${state === 'error' ? 'border-red-400 bg-red-50' : value === '' ? 'border-slate-200 bg-amber-50/60' : 'border-slate-200 bg-white'} disabled:bg-slate-50`} />
      <span className="w-4">
        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
      </span>
    </span>
  );
}

function Card({ label, value, sub, onClick, active, tone = '#12325c' }: { label: string; value: React.ReactNode; sub?: string; onClick?: () => void; active?: boolean; tone?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`rounded-xl border bg-white px-3 py-2.5 text-start shadow-sm transition ${active ? 'border-[#f37121] ring-2 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'} disabled:cursor-default`}>
      <p className="text-2xl font-extrabold tabular-nums leading-none" style={{ color: tone }}>{value}</p>
      <p className="mt-1.5 text-[12px] font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-[10.5px] text-slate-400">{sub}</p>}
    </button>
  );
}

export default function B2COrderEntryPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fProject, setFProject] = useState('');
  const [fSup, setFSup] = useState('');
  const [fKind, setFKind] = useState('');
  const [fEval, setFEval] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  // ما يكتبه المستخدم ولم يُحفظ بعد — لا يكتب فوقه ردٌّ من الخادم.
  const [vals, setVals] = useState<Record<string, string>>({});
  const dirty = useRef<Set<string>>(new Set());
  const [state, setState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const p = new URLSearchParams();
      if (date) p.set('date', date);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const res = await api.get<Data>(`/api/b2c/entry${p.toString() ? `?${p}` : ''}`);
      if (!guard.isCurrent(mine)) return;
      setD(res);
      if (!date) setDate(res.date);
      setVals((old) => {
        const n: Record<string, string> = {};
        for (const r of res.rows) n[r.lt] = dirty.current.has(r.lt) ? (old[r.lt] ?? '') : (r.orders == null ? '' : String(r.orders));
        return n;
      });
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [date, from, to, guard, notify]);
  useEffect(() => { load(); }, [load]);

  // تحليلُ الأوردرات واللوحةُ وهذه الشاشةُ تسمع الحدثَ نفسَه — ومستخدمان على الجدول يريان بعضَهما.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(), 600); }, [load]);
  useSocket('b2c:order:upserted', soon);
  useSocket('lt:updated', soon);
  useSocket('b2c:entry:scope', soon);
  useSocket('hr:employee', soon);

  const save = useCallback(async (lt: string) => {
    if (!d || !dirty.current.has(lt)) return;
    const v = vals[lt] ?? '';
    const prev = d.rows.find((r) => r.lt === lt)?.orders;
    if ((prev == null ? '' : String(prev)) === v) { dirty.current.delete(lt); return; }
    setState((s) => ({ ...s, [lt]: 'saving' }));
    try {
      await api.put('/api/b2c/entry', { lt, dateKey: d.date, orders: v === '' ? null : Number(v) });
      dirty.current.delete(lt);
      setState((s) => ({ ...s, [lt]: 'saved' }));
      soon();
    } catch (e: any) {
      setState((s) => ({ ...s, [lt]: 'error' }));
      notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error');
    }
  }, [d, vals, notify, soon]);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = fold(q.trim());
    return d.rows.filter((r) => (!needle || fold(`${r.name} ${r.idNumber} ${r.projectAr} ${r.supervisorName} ${r.kind} ${r.evaluation}`).includes(needle))
      && (!fProject || r.projectAr === fProject) && (!fSup || r.supervisorName === fSup)
      && (!fKind || r.kind === fKind) && (!fEval || r.evaluation === fEval)
      && (!onlyMissing || (vals[r.lt] ?? '') === ''));
  }, [d, q, fProject, fSup, fKind, fEval, onlyMissing, vals]);
  const order = rows.map((r) => r.lt);
  const nav = (lt: string, dir: 1 | -1) => {
    const i = order.indexOf(lt); const next = order[i + dir];
    if (next) { const el = inputs.current.get(next); el?.focus(); el?.select(); }
  };

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{t('تعذّر التحميل', 'Could not load')}</div>;

  const sups = [...new Set(d.rows.map((r) => r.supervisorName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const projectsShown = [...new Set(d.rows.map((r) => r.projectAr))];
  const anyFilter = !!(q || fProject || fSup || fKind || fEval || onlyMissing);
  const clear = () => { setQ(''); setFProject(''); setFSup(''); setFKind(''); setFEval(''); setOnlyMissing(false); };
  const shownDay = rows.reduce((s, r) => s + (Number(vals[r.lt] || 0) || 0), 0);
  const isToday = d.date === d.today;

  const cols: ExportColumn[] = [
    { header: t('رقم الإقامة', 'ID'), key: 'idNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 28 },
    { header: t('المشروع', 'Project'), key: 'projectAr', width: 14 },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName', width: 22 },
    { header: t('الجهة', 'Type'), key: 'kind', width: 12 },
    { header: `${t('أوردرات', 'Orders')} ${d.date}`, key: 'orders', width: 12 },
    { header: t('إجمالي الفترة', 'Period total'), key: 'total', width: 12 },
    { header: t('أيام الاحتساب', 'Counted days'), key: 'workedDays', width: 10 },
    { header: t('هدفه', 'Target'), key: 'target', width: 10 },
    { header: t('٪ من الهدف', '% of target'), key: 'pct', width: 10, transform: (v: any) => (v == null ? '' : Math.round(v * 100)) },
    { header: t('التقييم', 'Evaluation'), key: 'evaluation', width: 12 },
    { header: t('المتوقع للشهر', 'Expected month'), key: 'expected', width: 12 },
  ];

  return (
    <div className="w-full space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="h-5 w-5" />} title={t('مدخلات الأوردرات', 'Orders entry')}
        subtitle={d.scope === null
          ? t('كل المشاريع — اكتب أوردرات كل مندوب في خانة اليوم', 'All projects — type each rep’s orders in the day cell')
          : t(`مشاريعك: ${d.scope.join('، ') || 'لم يُسنَد لك مشروع بعد'}`, `Your projects: ${d.scope.join(', ') || 'none assigned yet'}`)}>
        <ExportMenu fileName={`b2c-orders-${d.date}`} lang={lang as 'ar' | 'en'} options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: d.date, rows, columns: cols }] }]} />
      </PageHeader>

      {/* ── اليومُ والفترة ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="text-[13px] font-bold text-slate-700">{t('يوم الإدخال', 'Entry day')}</span>
        <button type="button" onClick={() => { setDate(shift(d.date, -1)); setTo(''); setFrom(''); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50" title={t('اليوم السابق', 'Previous day')}>
          {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <input type="date" value={d.date} max={d.today} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setTo(''); setFrom(''); } }}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
        <button type="button" disabled={d.date >= d.today} onClick={() => { setDate(shift(d.date, 1)); setTo(''); setFrom(''); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40" title={t('اليوم التالي', 'Next day')}>
          {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {!isToday && <button type="button" onClick={() => { setDate(d.today); setTo(''); setFrom(''); }} className="rounded-lg bg-[#12325c] px-3 py-1.5 text-[12px] font-semibold text-white">{t('اليوم', 'Today')}</button>}
        <span className="ms-3 text-[13px] font-bold text-slate-700">{t('فترة الإجماليات', 'Totals period')}</span>
        <input type="date" value={d.from} max={d.to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        <span className="text-slate-400">←</span>
        <input type="date" value={d.to} max={d.today} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        <span className="ms-auto text-[12px] text-slate-500">{t(`الهدف اليومي: ${d.projects.filter((p) => p.monthlyTarget).map((p) => `${p.nameAr} ${p.dailyTarget}`).join(' · ')} · امازون شحنات`, 'Daily targets per project')}</span>
      </div>

      {/* ── الكروت — كالشيت ── */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        <Card label={t('إجمالي المناديب', 'Total reps')} value={d.cards.reps.total} onClick={() => setFKind('')} active={!fKind && anyFilter === false} />
        {KINDS.map((k) => <Card key={k} label={k} value={d.cards.reps[k] || 0} onClick={() => setFKind(fKind === k ? '' : k)} active={fKind === k} tone="#334155" />)}
        <Card label={t(`أوردرات يوم ${dm(d.date)}`, `Orders on ${d.date}`)} value={d.cards.dayTotal} sub={t(`مُدخَل لـ ${d.cards.dayEntered} مندوب`, `${d.cards.dayEntered} reps entered`)} tone="#f37121" />
        <Card label={t('لم يُدخَل لهم اليوم', 'Not entered today')} value={d.rows.filter((r) => !r.ended && r.orders == null).length} onClick={() => setOnlyMissing((v) => !v)} active={onlyMissing} tone="#dc2626" />
        <Card label={t(`إجمالي ${dm(d.from)} – ${dm(d.to)}`, 'Period total')} value={d.cards.periodTotal} tone="#16a34a" />
        <Card label={t('في إجازة', 'On leave')} value={d.cards.onLeave} tone="#0284c7" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* توزيعُ المناديب على المشاريع والجهات */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[13px] font-extrabold text-slate-800">{t('توزيع المناديب على المشاريع والجهات', 'Reps by project and type')}</p>
          <table className="w-full text-center text-[12.5px]">
            <thead><tr className="text-slate-500"><th className="py-1 text-start">{t('المشروع', 'Project')}</th><th>{t('الإجمالي', 'Total')}</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.cards.byProject.map((p) => (
                <tr key={p.project}>
                  <td className="py-1.5 text-start"><button type="button" onClick={() => setFProject(fProject === p.project ? '' : p.project)} className={`font-bold ${fProject === p.project ? 'text-[#f37121]' : 'text-slate-800 hover:text-[#f37121]'}`}>{p.project}</button></td>
                  <td className="font-bold tabular-nums">{p.total}</td>
                  {KINDS.map((k) => (
                    <td key={k}><button type="button" onClick={() => { setFProject(p.project); setFKind(k); }} className="tabular-nums hover:text-[#f37121]">{p[k] || 0}</button></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* ملخّصُ التحقيق حسب المشرف والمشروع */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[13px] font-extrabold text-slate-800">{t('ملخص التحقيق حسب المشرف والمشروع', 'Achievement by supervisor and project')}</p>
          <table className="w-full text-center text-[12.5px]">
            <thead><tr className="text-slate-500">
              <th className="py-1 text-start">{t('المشرف', 'Supervisor')}</th><th>{t('المشروع', 'Project')}</th><th>{t('المناديب', 'Reps')}</th>
              <th>{t('حقق', 'Met')}</th><th>{t('قريب', 'Near')}</th><th>{t('بعيد', 'Far')}</th><th>{t('نسبة التحقيق', 'Rate')}</th><th>{t('شحنات امازون', 'Shipments')}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.summary.map((s) => (
                <tr key={`${s.supervisor}|${s.project}`} className="cursor-pointer hover:bg-slate-50" onClick={() => { setFSup(s.supervisor === '—' ? '' : s.supervisor); setFProject(s.project); setFEval(''); }}>
                  <td className="py-1.5 text-start font-semibold text-slate-800">{s.supervisor}</td><td>{s.project}</td><td className="tabular-nums">{s.reps}</td>
                  <td><button type="button" onClick={(e) => { e.stopPropagation(); setFSup(s.supervisor); setFProject(s.project); setFEval('حقق'); }} className="tabular-nums text-emerald-700 hover:underline">{s.achieved}</button></td>
                  <td><button type="button" onClick={(e) => { e.stopPropagation(); setFSup(s.supervisor); setFProject(s.project); setFEval('قريب'); }} className="tabular-nums text-amber-700 hover:underline">{s.near}</button></td>
                  <td><button type="button" onClick={(e) => { e.stopPropagation(); setFSup(s.supervisor); setFProject(s.project); setFEval('بعيد'); }} className="tabular-nums text-red-700 hover:underline">{s.far}</button></td>
                  <td className="font-bold tabular-nums">{pctTxt(s.rate)}</td><td className="tabular-nums">{s.shipments || '—'}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-extrabold">
                <td className="py-1.5 text-start" colSpan={2}>{t('الإجمالي', 'Total')}</td><td className="tabular-nums">{d.summaryTotal.reps}</td>
                <td className="tabular-nums text-emerald-700">{d.summaryTotal.achieved}</td><td className="tabular-nums text-amber-700">{d.summaryTotal.near}</td>
                <td className="tabular-nums text-red-700">{d.summaryTotal.far}</td><td className="tabular-nums">{pctTxt(d.summaryTotal.rate)}</td><td className="tabular-nums">{d.summaryTotal.shipments || '—'}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-slate-400">{t('حقق: وصل لهدفه · قريب: من 80% · بعيد: أقل. الهدف = هدف المشروع اليومي × أيام الاحتساب (أيام فيها طلبات).', 'Met ≥ target · Near ≥ 80% · Far below. Target = project daily target × days with orders.')}</p>
        </div>
      </div>

      {/* ── البحثُ والفلاتر ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث: اسم، رقم إقامة، مشروع، مشرف…', 'Search name, ID, project, supervisor…')}
            className="w-72 max-w-full rounded-lg border border-slate-200 py-2 pe-3 ps-8 text-sm" />
        </div>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{t('كل المشاريع', 'All projects')}</option>{projectsShown.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fSup} onChange={(e) => setFSup(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{t('كل المشرفين', 'All supervisors')}</option>{sups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{t('كل الجهات', 'All types')}</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={fEval} onChange={(e) => setFEval(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{t('كل التقييمات', 'All evaluations')}</option>{EVALS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-slate-700">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="accent-[#f37121]" />
          {t('اللي لسه متدخلش اليوم', 'Not entered yet')}
        </label>
        {anyFilter && <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800"><X className="h-3.5 w-3.5" />{t('مسح الفلاتر', 'Clear')}</button>}
        <span className="ms-auto text-[12.5px] font-semibold text-slate-700">{rows.length} {t('مندوب', 'reps')} · {t(`أوردرات المعروض اليوم: ${shownDay}`, `Shown today: ${shownDay}`)}</span>
      </div>

      {/* ── الجدول ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-[12.5px] text-slate-200">
            <tr>
              <th className="px-2 py-2.5">م</th>
              <th className="px-2 py-2.5 text-start">{t('رقم الإقامة', 'ID')}</th>
              <th className="px-2 py-2.5 text-start">{t('الاسم', 'Name')}</th>
              <th className="px-2 py-2.5">{t('المشروع', 'Project')}</th>
              <th className="px-2 py-2.5">{t('المشرف', 'Supervisor')}</th>
              <th className="px-2 py-2.5">{t('الجهة', 'Type')}</th>
              <th className="bg-[#f37121] px-2 py-2.5 text-white">{t(`أوردرات ${dm(d.date)}`, `Orders ${d.date}`)}</th>
              <th className="px-2 py-2.5">{t(`إجمالي ${dm(d.from)}–${dm(d.to)}`, 'Period total')}</th>
              <th className="px-2 py-2.5">{t('أيام الاحتساب', 'Days')}</th>
              <th className="px-2 py-2.5">{t('هدفه', 'Target')}</th>
              <th className="px-2 py-2.5">%</th>
              <th className="px-2 py-2.5">{t('التقييم', 'Evaluation')}</th>
              <th className="px-2 py-2.5">{t('المتوقع للشهر', 'Expected')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.lt} className={r.ended ? 'bg-slate-50 text-slate-400' : r.status === 'إجازة' ? 'bg-sky-50/40' : 'hover:bg-orange-50/30'}>
                <td className="px-2 py-1.5 text-center text-[12px] tabular-nums text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5 text-[12.5px] tabular-nums text-slate-600">{r.idNumber || <span className="text-slate-300">{t('بلا إقامة', 'no ID')}</span>}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-900">
                  {r.name}
                  {r.status && r.status !== 'يعمل' && <span className="ms-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600">{r.status}</span>}
                </td>
                <td className="px-2 py-1.5 text-center text-[12.5px]">{r.projectAr}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center text-[12.5px] text-slate-600">{r.supervisorName || '—'}</td>
                <td className="px-2 py-1.5 text-center text-[12px] text-slate-600">{r.kind}</td>
                <td className="bg-orange-50/40 px-2 py-1 text-center">
                  <OrderCell row={r} value={vals[r.lt] ?? ''} state={state[r.lt]} disabled={r.ended}
                    inputRef={(el) => { if (el) inputs.current.set(r.lt, el); else inputs.current.delete(r.lt); }}
                    onChange={(v) => { dirty.current.add(r.lt); setVals((s) => ({ ...s, [r.lt]: v })); setState((s) => { const n = { ...s }; delete n[r.lt]; return n; }); }}
                    onCommit={() => save(r.lt)} onNav={(dir) => nav(r.lt, dir)} />
                </td>
                <td className="px-2 py-1.5 text-center font-bold tabular-nums">{r.total}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.workedDays}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.target ?? '—'}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{pctTxt(r.pct)}</td>
                <td className="px-2 py-1.5 text-center"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${EVAL_CLS[r.evaluation] || ''}`}>{r.evaluation}</span></td>
                <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{r.unit === 'شحنة' ? '—' : r.expected}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={13} className="py-12 text-center text-slate-500">{d.scope && !d.scope.length ? t('لم يُسنَد لك مشروع بعد — يُسنده نائب مدير القطاع من «موظفي النقل الخفيف»', 'No project assigned to you yet') : t('لا نتائج تطابق الفلاتر', 'Nothing matches')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
