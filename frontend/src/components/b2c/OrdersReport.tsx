'use client';
/**
 * تقريرُ تحقيق المناديب — في لوحة B2C (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * ما كان في رأس شيت «تقرير تحقيق المناديب»: عددُ المناديب حسب الجهة، وتوزيعُهم على
 * المشاريع، وملخّصُ التحقيق حسب المشرف والمشروع، ثمّ جدولُ المناديب بإجماليّاتهم
 * وأهدافهم وتقييمهم. يُقرأ من مدخلات الأوردرات (GET …/entry?report=1) ويتحدّث مع
 * كلّ إدخال. وصفحةُ الإدخال نفسُها لا تحمل شيئًا منه.
 *
 * والأرقامُ تفتح ما وراءها: كلُّ رقمٍ في الكروت والجدولين يُفلتر جدولَ المناديب على مَن
 * عُدّوا فيه بأعيانهم، ثمّ ينزل إليه. و«بلا مشرف» / «بلا مشروع» فلترٌ لا مسحُ فلتر.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Search, X } from 'lucide-react';

type Row = {
  lt: string; idNumber: string; name: string; projectAr: string; supervisorName: string; kind: string; status: string; ended: boolean;
  orders: number | null; total: number; workedDays: number; target: number | null; pct: number | null; evaluation: string; expected: number; unit: string;
};
type Report = {
  date: string; from: string; to: string; today: string; rows: Row[];
  cards: { reps: Record<string, number>; byProject: Record<string, any>[]; dayTotal: number; dayEntered: number; periodTotal: number; onLeave: number };
  summary: { supervisor: string; project: string; reps: number; achieved: number; near: number; far: number; shipments: number; rate: number | null }[];
  summaryTotal: { reps: number; achieved: number; near: number; far: number; shipments: number; rate: number | null };
  projects: { nameAr: string; monthlyTarget: number; dailyTarget: number }[];
};

const KINDS = ['كفالة', 'فري لانسر', 'يوزرات'];
const EVALS = ['حقق', 'قريب', 'بعيد', 'شحنات', 'لا طلبات'];
const EVAL_CLS: Record<string, string> = {
  'حقق': 'bg-emerald-100 text-emerald-800', 'قريب': 'bg-amber-100 text-amber-800', 'بعيد': 'bg-red-100 text-red-700',
  'شحنات': 'bg-sky-100 text-sky-800', 'لا طلبات': 'bg-slate-100 text-slate-500',
};
const pctTxt = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// «بلا مشرف» و«بلا مشروع» فلترٌ له قيمة — لا فراغٌ يمسح الفلتر فيعرض الجميع.
const NONE = '__none__';
// حالاتُ الكروت العلويّة: كلُّ كرتٍ يفتح مناديبَه في الجدول.
type CardState = '' | 'entered' | 'notEntered' | 'hasOrders' | 'onLeave';
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

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

export default function OrdersReport({ url }: { url: string }) {
  const [d, setD] = useState<Report | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [fProject, setFProject] = useState('');
  const [fSup, setFSup] = useState('');
  const [fKind, setFKind] = useState('');
  const [fEval, setFEval] = useState('');
  const [fState, setFState] = useState<CardState>('');
  // ما يُعَدّ في الكروت والملخّص هم مَن على رأس العمل — فالضغطُ عليها يعرضهم وحدَهم،
  // لا المنتهين معهم، وإلّا لم يطابق عددُ الجدول الرقمَ الذي ضُغط.
  const [onlyWorking, setOnlyWorking] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const reveal = () => setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  const load = useCallback(() => {
    const p = new URLSearchParams({ report: '1' });
    if (to) { p.set('to', to); p.set('date', to); }
    if (from) p.set('from', from);
    api.get<Report>(`${url}?${p}`).then(setD).catch(() => {});
  }, [url, from, to]);
  useEffect(() => { load(); }, [load]);
  useSocket('b2c:order:upserted', load);
  useSocket('lt:updated', load);
  useSocket('b2c:entry:scope', load);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = fold(q.trim());
    return d.rows.filter((r) => (!needle || fold(`${r.name} ${r.idNumber} ${r.projectAr} ${r.supervisorName}`).includes(needle))
      && (!onlyWorking || !r.ended)
      && (!fProject || (fProject === NONE ? !r.projectAr : r.projectAr === fProject))
      && (!fSup || (fSup === NONE ? !r.supervisorName : r.supervisorName === fSup))
      && (!fKind || r.kind === fKind) && (!fEval || r.evaluation === fEval)
      && (!fState
        || (fState === 'entered' && r.orders != null)
        || (fState === 'notEntered' && !r.ended && r.orders == null)
        || (fState === 'hasOrders' && r.total > 0)
        || (fState === 'onLeave' && r.status === 'إجازة')));
  }, [d, q, fProject, fSup, fKind, fEval, fState, onlyWorking]);

  if (!d) return null;
  const sups = [...new Set(d.rows.map((r) => r.supervisorName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const anyFilter = !!(q || fProject || fSup || fKind || fEval || fState || onlyWorking);
  const clear = () => { setQ(''); setFProject(''); setFSup(''); setFKind(''); setFEval(''); setFState(''); setOnlyWorking(false); };
  // ضغطُ رقمٍ = فلترٌ واحدٌ واضح: يمسح ما قبله، ويعرض مَن عُدّوا فيه، وينزل إليهم.
  const pick = (next: { project?: string; sup?: string; kind?: string; evaluation?: string; state?: CardState }) => {
    setQ(''); setFProject(next.project ?? ''); setFSup(next.sup ?? ''); setFKind(next.kind ?? '');
    setFEval(next.evaluation ?? ''); setFState(next.state ?? ''); setOnlyWorking(next.state !== 'entered' && next.state !== 'hasOrders');
    reveal();
  };
  const keyOf = (v: string, none: string) => (!v || v === none ? NONE : v);
  const cols: ExportColumn[] = [
    { header: 'رقم الإقامة', key: 'idNumber', width: 14 }, { header: 'الاسم', key: 'name', width: 28 },
    { header: 'المشروع', key: 'projectAr', width: 14 }, { header: 'المشرف', key: 'supervisorName', width: 22 }, { header: 'الجهة', key: 'kind', width: 12 },
    { header: `إجمالي ${d.from} – ${d.to}`, key: 'total', width: 14 }, { header: 'أيام الاحتساب', key: 'workedDays', width: 10 },
    { header: 'الهدف', key: 'target', width: 10 }, { header: 'النسبة من الهدف', key: 'pct', width: 10, transform: (v: any) => (v == null ? '' : Math.round(v * 100)) },
    { header: 'التقييم', key: 'evaluation', width: 12 }, { header: 'المتوقع للشهر', key: 'expected', width: 12 },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-extrabold text-slate-800">تقرير تحقيق المناديب</h2>
        <span className="ms-3 text-[12.5px] font-semibold text-slate-600">الفترة</span>
        <input type="date" value={d.from} max={d.to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm" />
        <span className="text-slate-400">←</span>
        <input type="date" value={d.to} max={d.today} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm" />
        <span className="ms-auto text-[11.5px] text-slate-500">
          الهدف اليومي: {d.projects.filter((p) => p.monthlyTarget).map((p) => `${p.nameAr} ${p.dailyTarget}`).join(' · ')} · امازون بالشحنات
        </span>
        <ExportMenu fileName={`b2c-report-${d.to}`} lang="ar" options={[{ key: 'shown', label: 'تصدير المعروض', sheets: [{ name: 'التقرير', rows, columns: cols }] }]} />
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        <Card label="إجمالي المناديب" value={d.cards.reps.total} onClick={() => pick({})} active={onlyWorking && !fKind && !fProject && !fSup && !fEval && !fState} />
        {KINDS.map((k) => <Card key={k} label={k} value={d.cards.reps[k] || 0} onClick={() => (fKind === k ? clear() : pick({ kind: k }))} active={fKind === k} tone="#334155" />)}
        <Card label={`أوردرات يوم ${dm(d.date)}`} value={d.cards.dayTotal} sub={`أُدخلت لـ ${d.cards.dayEntered} مندوبًا`} tone="#f37121"
          onClick={() => (fState === 'entered' ? clear() : pick({ state: 'entered' }))} active={fState === 'entered'} />
        <Card label="لم تُدخَل أوردراتهم" value={d.rows.filter((r) => !r.ended && r.orders == null).length} sub={`يوم ${dm(d.date)}`} tone="#dc2626"
          onClick={() => (fState === 'notEntered' ? clear() : pick({ state: 'notEntered' }))} active={fState === 'notEntered'} />
        <Card label={`إجمالي ${dm(d.from)} – ${dm(d.to)}`} value={d.cards.periodTotal} tone="#16a34a"
          onClick={() => (fState === 'hasOrders' ? clear() : pick({ state: 'hasOrders' }))} active={fState === 'hasOrders'} />
        <Card label="في إجازة" value={d.cards.onLeave} tone="#0284c7"
          onClick={() => (fState === 'onLeave' ? clear() : pick({ state: 'onLeave' }))} active={fState === 'onLeave'} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[13px] font-extrabold text-slate-800">توزيع المناديب على المشاريع والجهات</p>
          <table className="w-full text-center text-[12.5px]">
            <thead><tr className="text-slate-500"><th className="py-1 text-start">المشروع</th><th>الإجمالي</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.cards.byProject.map((p) => (
                <tr key={p.project}>
                  <td className="py-1.5 text-start"><button type="button" onClick={() => pick({ project: keyOf(p.project, '') })} className={`font-bold ${fProject === keyOf(p.project, '') && !fKind ? 'text-[#f37121]' : 'text-slate-800 hover:text-[#f37121]'}`}>{p.project || 'بلا مشروع'}</button></td>
                  <td className="font-bold tabular-nums"><button type="button" onClick={() => pick({ project: keyOf(p.project, '') })} className="tabular-nums hover:text-[#f37121]">{p.total}</button></td>
                  {KINDS.map((k) => <td key={k}><button type="button" onClick={() => pick({ project: keyOf(p.project, ''), kind: k })} className={`tabular-nums hover:text-[#f37121] ${fProject === keyOf(p.project, '') && fKind === k ? 'font-bold text-[#f37121]' : ''}`}>{p[k] || 0}</button></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[13px] font-extrabold text-slate-800">ملخّص التحقيق حسب المشرف والمشروع</p>
          <table className="w-full text-center text-[12.5px]">
            <thead><tr className="text-slate-500">
              <th className="py-1 text-start">المشرف</th><th>المشروع</th><th>المناديب</th><th>حقّق</th><th>قريب</th><th>بعيد</th><th>نسبة التحقيق</th><th>شحنات امازون</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.summary.map((s) => (
                <tr key={`${s.supervisor}|${s.project}`}
                  className={`cursor-pointer hover:bg-slate-50 ${fSup === keyOf(s.supervisor, '—') && fProject === keyOf(s.project, '') ? 'bg-orange-50' : ''}`}
                  onClick={() => pick({ sup: keyOf(s.supervisor, '—'), project: keyOf(s.project, '') })}>
                  <td className="py-1.5 text-start font-semibold text-slate-800">{s.supervisor === '—' ? 'بلا مشرف' : s.supervisor}</td><td>{s.project || 'بلا مشروع'}</td><td className="tabular-nums">{s.reps}</td>
                  {(['achieved', 'near', 'far'] as const).map((k, i) => (
                    <td key={k}><button type="button" onClick={(e) => { e.stopPropagation(); pick({ sup: keyOf(s.supervisor, '—'), project: keyOf(s.project, ''), evaluation: ['حقق', 'قريب', 'بعيد'][i] }); }}
                      className={`tabular-nums hover:underline ${['text-emerald-700', 'text-amber-700', 'text-red-700'][i]}`}>{s[k]}</button></td>
                  ))}
                  <td className="font-bold tabular-nums">{pctTxt(s.rate)}</td>
                  <td className="tabular-nums">{s.shipments
                    ? <button type="button" onClick={(e) => { e.stopPropagation(); pick({ sup: keyOf(s.supervisor, '—'), project: keyOf(s.project, ''), evaluation: 'شحنات' }); }} className="hover:underline">{s.shipments}</button>
                    : '—'}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-extrabold">
                <td className="py-1.5 text-start" colSpan={2}>الإجمالي</td>
                <td className="tabular-nums"><button type="button" onClick={() => pick({})} className="hover:underline">{d.summaryTotal.reps}</button></td>
                <td className="tabular-nums text-emerald-700"><button type="button" onClick={() => pick({ evaluation: 'حقق' })} className="hover:underline">{d.summaryTotal.achieved}</button></td>
                <td className="tabular-nums text-amber-700"><button type="button" onClick={() => pick({ evaluation: 'قريب' })} className="hover:underline">{d.summaryTotal.near}</button></td>
                <td className="tabular-nums text-red-700"><button type="button" onClick={() => pick({ evaluation: 'بعيد' })} className="hover:underline">{d.summaryTotal.far}</button></td><td className="tabular-nums">{pctTxt(d.summaryTotal.rate)}</td><td className="tabular-nums">{d.summaryTotal.shipments || '—'}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-slate-400">حقّق: بلغ هدفه · قريب: من ٨٠٪ إلى ما دون هدفه · بعيد: دون ٨٠٪. الهدف = الهدف اليومي للمشروع × أيام الاحتساب (الأيام التي فيها أوردرات). وأمازون بأيّام الحضور: هدفُها أيّامُ المشروع في الشهر (٢٦) بنسبة ما انقضى منه.</p>
        </div>
      </div>

      <div ref={tableRef} className="flex scroll-mt-20 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو رقم الإقامة أو المشروع أو المشرف" className="w-72 max-w-full rounded-lg border border-slate-200 py-2 pe-3 ps-8 text-sm" />
        </div>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">جميع المشاريع</option>{[...new Set(d.rows.map((r) => r.projectAr).filter(Boolean))].map((p) => <option key={p} value={p}>{p}</option>)}
          {d.rows.some((r) => !r.projectAr) && <option value={NONE}>بلا مشروع</option>}
        </select>
        <select value={fSup} onChange={(e) => setFSup(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">جميع المشرفين</option>{sups.map((s) => <option key={s} value={s}>{s}</option>)}
          {d.rows.some((r) => !r.supervisorName) && <option value={NONE}>بلا مشرف</option>}
        </select>
        <select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">جميع الجهات</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={fEval} onChange={(e) => setFEval(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">جميع التقييمات</option>{EVALS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {fState && (
          <span className="rounded-lg bg-orange-50 px-2 py-1 text-[12px] font-semibold text-[#f37121]">
            {{ entered: `أُدخلت أوردراتهم يوم ${dm(d.date)}`, notEntered: `لم تُدخَل أوردراتهم يوم ${dm(d.date)}`, hasOrders: 'لهم أوردرات في الفترة', onLeave: 'في إجازة' }[fState]}
          </span>
        )}
        {onlyWorking && <span className="rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600">على رأس العمل</span>}
        {anyFilter && <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800"><X className="h-3.5 w-3.5" />مسح الفلاتر</button>}
        <span className="ms-auto text-[12.5px] font-semibold text-slate-700">{rows.length} مندوبًا</span>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-[12.5px] text-slate-200">
            <tr>
              {['رقم الإقامة', 'الاسم', 'المشروع', 'المشرف', 'الجهة', `إجمالي ${dm(d.from)}–${dm(d.to)}`, 'أيام الاحتساب', 'الهدف', 'النسبة', 'التقييم', 'المتوقع للشهر'].map((h, i) => (
                <th key={h} className={`px-2 py-2.5 ${i < 2 ? 'text-start' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.lt} className={r.ended ? 'bg-slate-50 text-slate-400' : ''}>
                <td className="px-2 py-1.5 text-[12.5px] tabular-nums text-slate-600">{r.idNumber || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-900">{r.name}</td>
                <td className="px-2 py-1.5 text-center text-[12.5px]">{r.projectAr}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center text-[12.5px] text-slate-600">{r.supervisorName || '—'}</td>
                <td className="px-2 py-1.5 text-center text-[12px] text-slate-600">{r.kind}</td>
                <td className="px-2 py-1.5 text-center font-bold tabular-nums">{r.total}{r.unit === 'يوم' && <span className="ms-1 text-[10.5px] font-normal text-slate-400">يوم حضور</span>}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.workedDays}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.target ?? '—'}{r.unit === 'يوم' && r.target != null && <span className="ms-1 text-[10.5px] text-slate-400">يوم</span>}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{pctTxt(r.pct)}</td>
                <td className="px-2 py-1.5 text-center"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${EVAL_CLS[r.evaluation] || ''}`}>{r.evaluation}</span></td>
                <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{r.unit === 'شحنة' ? '—' : r.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
