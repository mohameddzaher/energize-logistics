'use client';
/**
 * مدخلات الأوردرات — للإدخال وحدَه (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * يكتب مديرُ المشروع هنا أوردراتِ كلّ مندوبٍ بدل الإكسيل: الاسمُ ورقمُ الإقامة
 * والمشروعُ وخانةُ اليوم، لا غير. والإجماليّاتُ والأهدافُ والتقييمُ والمشرفون
 * مكانُها لوحةُ B2C وتحليلُ الأوردرات — لا هذه الصفحة.
 *
 * ولا يرى مديرُ المشروع إلّا مناديبَ المشاريع المُسندة إليه (يحسمه الخادم —
 * utils/b2cEntry)، فإن نُقل مندوبٌ إلى مشروعه ظهر عنده في الحال (`lt:updated`).
 * والخانةُ تُحفَظ عند الخروج منها، وEnter ينزل إلى المندوب التالي كما في الإكسيل.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { CalendarDays, ChevronRight, ChevronLeft, Search, Check, Loader2, AlertCircle, X, Sheet } from 'lucide-react';
import OrderSheetsPanel from '@/components/b2c/OrderSheetsPanel';

type Row = { lt: string; idNumber: string; name: string; projectAr: string; status: string; ended: boolean; orders: number | null; unit: string;
  /** أمازون: حضورٌ لا أوردرات — `present` افتراضُه «حضر». */
  mode?: 'orders' | 'attendance'; present?: boolean };
type Data = { date: string; today: string; rows: Row[]; scope: string[] | null };

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// ── حضورُ مندوب أمازون — زرٌّ يقلب «حضر» ⇄ «لم يحضر» (مكوّنٌ خارج الصفحة أيضًا) ──
function AttendanceCell({ row, state, onToggle, ar }: {
  row: Row; state?: 'saving' | 'saved' | 'error'; onToggle: () => void; ar: boolean;
}) {
  const present = row.present !== false;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={onToggle} disabled={row.ended || state === 'saving'}
        title={ar ? 'اضغط للتبديل' : 'Click to toggle'}
        className={`inline-flex w-24 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[13px] font-bold disabled:opacity-60
          ${present ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'}`}>
        {present ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {present ? (ar ? 'حضر' : 'Present') : (ar ? 'لم يحضر' : 'Absent')}
      </button>
      <span className="w-4">
        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
      </span>
    </span>
  );
}

// ── خانةُ اليوم — مكوّنٌ خارج الصفحة كي لا تُهدَم مع كلّ ضغطة (inline-components-remount) ──
function OrderCell({ row, value, state, onChange, onCommit, onNav, inputRef }: {
  row: Row; value: string; state?: 'saving' | 'saved' | 'error';
  onChange: (v: string) => void; onCommit: () => void; onNav: (dir: 1 | -1) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input ref={inputRef} inputMode="numeric" value={value} disabled={row.ended}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); onCommit(); onNav(1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); onCommit(); onNav(-1); }
        }}
        placeholder={row.unit === 'شحنة' ? 'شحنات' : '—'}
        className={`w-24 rounded-md border px-2 py-1.5 text-center text-[15px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/60
          ${state === 'error' ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'} disabled:bg-slate-50`} />
      <span className="w-4">
        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
      </span>
    </span>
  );
}

export default function B2COrderEntryPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [date, setDate] = useState('');
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fProject, setFProject] = useState('');
  // ما يكتبه المستخدم ولم يُحفظ بعد — لا يكتب فوقه ردٌّ من الخادم.
  const [vals, setVals] = useState<Record<string, string>>({});
  const dirty = useRef<Set<string>>(new Set());
  const [state, setState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [sheetsOpen, setSheetsOpen] = useState(false);

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await api.get<Data>(`/api/b2c/entry${date ? `?date=${date}` : ''}`);
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
  }, [date, guard, notify]);
  useEffect(() => { load(); }, [load]);

  // مندوبٌ نُقل إلى مشروعٍ مُسندٍ إليك يظهر هنا في الحال، ومستخدمان على الجدول يريان بعضَهما.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(), 600); }, [load]);
  useSocket('b2c:order:upserted', soon);
  useSocket('lt:updated', soon);
  useSocket('b2c:entry:scope', soon);
  useSocket('hr:employee', soon);
  useSocket('b2c:attendance', soon);

  // حضورُ أمازون: يُقلَب في الحال ويُعاد إن رفضه الخادم.
  const toggleAttendance = useCallback(async (lt: string) => {
    if (!d) return;
    const row = d.rows.find((r) => r.lt === lt);
    if (!row) return;
    const next = row.present === false;
    const setPresent = (v: boolean) => setD((old) => (old ? { ...old, rows: old.rows.map((r) => (r.lt === lt ? { ...r, present: v } : r)) } : old));
    setPresent(next);
    setState((s) => ({ ...s, [lt]: 'saving' }));
    try {
      await api.put('/api/b2c/attendance', { lt, dateKey: d.date, present: next });
      setState((s) => ({ ...s, [lt]: 'saved' }));
    } catch (e: any) {
      setPresent(!next);
      setState((s) => ({ ...s, [lt]: 'error' }));
      notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error');
    }
  }, [d, notify]);

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
    } catch (e: any) {
      setState((s) => ({ ...s, [lt]: 'error' }));
      notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error');
    }
  }, [d, vals, notify]);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = fold(q.trim());
    return d.rows.filter((r) => (!needle || fold(`${r.name} ${r.idNumber} ${r.projectAr}`).includes(needle)) && (!fProject || r.projectAr === fProject));
  }, [d, q, fProject]);
  const order = rows.filter((r) => r.mode !== 'attendance').map((r) => r.lt);
  const nav = (lt: string, dir: 1 | -1) => {
    const next = order[order.indexOf(lt) + dir];
    if (next) { const el = inputs.current.get(next); el?.focus(); el?.select(); }
  };

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{t('تعذّر التحميل', 'Could not load')}</div>;

  const projects = [...new Set(d.rows.map((r) => r.projectAr))];
  const pick = (iso: string) => { if (iso && iso <= d.today) setDate(iso); };

  return (
    <div className="w-full space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarDays className="h-5 w-5" />} title={t('مدخلات الأوردرات', 'Orders entry')}
        subtitle={d.scope === null
          ? t('جميع المشاريع — اكتب عدد أوردرات كل مندوب في خانة اليوم', 'All projects — type each rep’s orders for the day')
          : t(`المشاريع المُسندة إليك: ${d.scope.join('، ') || 'لم يُسنَد إليك مشروعٌ بعد'}`, `Your projects: ${d.scope.join(', ') || 'none assigned yet'}`)} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="text-[13px] font-bold text-slate-700">{t('اليوم', 'Day')}</span>
        <button type="button" onClick={() => pick(shift(d.date, -1))} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50" title={t('اليوم السابق', 'Previous day')}>
          {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <input type="date" value={d.date} max={d.today} onChange={(e) => pick(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
        <button type="button" disabled={d.date >= d.today} onClick={() => pick(shift(d.date, 1))} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40" title={t('اليوم التالي', 'Next day')}>
          {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {d.date !== d.today && <button type="button" onClick={() => pick(d.today)} className="rounded-lg bg-[#12325c] px-3 py-1.5 text-[12px] font-semibold text-white">{t('اليوم الحالي', 'Today')}</button>}
        <div className="relative ms-2">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو رقم الإقامة أو المشروع', 'Search name, ID or project')}
            className="w-72 max-w-full rounded-lg border border-slate-200 py-2 pe-3 ps-8 text-sm" />
        </div>
        {projects.length > 1 && (
          <select value={fProject} onChange={(e) => setFProject(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
            <option value="">{t('جميع المشاريع', 'All projects')}</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <span className="ms-auto text-[12.5px] font-semibold text-slate-600">{rows.length} {t('مندوبًا', 'reps')}</span>
        {/* مسؤولو القسم وحدَهم (نطاقُهم كلُّ المشاريع) — والخادمُ يرفض غيرَهم أيضًا */}
        {d.scope === null && (
          <button type="button" onClick={() => setSheetsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-800 hover:bg-emerald-100">
            <Sheet className="h-4 w-4" />{t('شيتات جوجل', 'Google Sheets')}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-[13px] text-slate-200">
            <tr>
              <th className="w-12 px-2 py-2.5">م</th>
              <th className="px-3 py-2.5 text-start">{t('رقم الإقامة', 'ID number')}</th>
              <th className="px-3 py-2.5 text-start">{t('اسم المندوب', 'Rep')}</th>
              <th className="px-3 py-2.5">{t('المشروع', 'Project')}</th>
              <th className="bg-[#f37121] px-3 py-2.5 text-white">{t(`عدد الأوردرات — ${d.date.split('-').reverse().join('/')}`, `Orders — ${d.date}`)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.lt} className={r.ended ? 'bg-slate-50 text-slate-400' : 'hover:bg-orange-50/30'}>
                <td className="px-2 py-1.5 text-center text-[12px] tabular-nums text-slate-400">{i + 1}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600">{r.idNumber || <span className="text-slate-300">{t('بلا إقامة', 'no ID')}</span>}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-900">
                  {r.name}
                  {r.status && r.status !== 'يعمل' && <span className="ms-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600">{r.status}</span>}
                </td>
                <td className="px-3 py-1.5 text-center">{r.projectAr}</td>
                <td className="bg-orange-50/40 px-3 py-1 text-center">
                  {r.mode === 'attendance' ? (
                    <AttendanceCell row={r} state={state[r.lt]} ar={ar} onToggle={() => toggleAttendance(r.lt)} />
                  ) : (
                  <OrderCell row={r} value={vals[r.lt] ?? ''} state={state[r.lt]}
                    inputRef={(el) => { if (el) inputs.current.set(r.lt, el); else inputs.current.delete(r.lt); }}
                    onChange={(v) => { dirty.current.add(r.lt); setVals((s) => ({ ...s, [r.lt]: v })); setState((s) => { const n = { ...s }; delete n[r.lt]; return n; }); }}
                    onCommit={() => save(r.lt)} onNav={(dir) => nav(r.lt, dir)} />
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="py-12 text-center text-slate-500">
                {d.scope && !d.scope.length
                  ? t('لم يُسنَد إليك مشروعٌ بعد — يُسنِده نائب مدير القطاع من «موظفو النقل الخفيف ← مشاريع المشرفين»', 'No project assigned to you yet')
                  : t('لا توجد نتائج مطابقة', 'No matches')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {d.scope === null && <OrderSheetsPanel open={sheetsOpen} onClose={() => setSheetsOpen(false)} ar={ar} />}
    </div>
  );
}
