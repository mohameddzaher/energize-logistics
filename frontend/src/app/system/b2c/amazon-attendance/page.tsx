'use client';
/**
 * متابعةُ مناديب أمازون — حضورٌ لا أوردرات.
 *
 * مشروعُ أمازون لا هدفَ أوردراتٍ له، فيُتابَع مندوبُه بالحضور: الجميعُ حاضرون
 * افتراضيًّا ويُعلَّم الغائبُ وحدَه (الخادمُ لا يكتب إلّا الغياب — B2CAttendance).
 * تُفتح لمدير مشروع أمازون ومدير القسم ونائبه؛ ويرفض الخادمُ غيرَهم بـ 403.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { UserCheck, ChevronRight, ChevronLeft, Search, Check, X, Loader2, AlertCircle, Lock } from 'lucide-react';

type Row = {
  lt: string; idNumber: string; name: string; projectAr: string; supervisorName: string;
  status: string; present: boolean; onLeave: boolean; monthAbsences: number;
};
type Data = { date: string; today: string; projects: string[]; rows: Row[]; summary: { total: number; present: number; absent: number } };
type Filter = 'all' | 'present' | 'absent';
type SaveState = 'saving' | 'saved' | 'error';

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// ── زرُّ الحضور — مكوّنٌ خارج الصفحة (inline-components-remount) ──
function PresenceToggle({ row, state, onToggle, ar }: { row: Row; state?: SaveState; onToggle: () => void; ar: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={onToggle} disabled={state === 'saving'}
        className={`inline-flex w-28 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[13px] font-bold disabled:opacity-60
          ${row.present ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'}`}>
        {row.present ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {row.present ? (ar ? 'حضر' : 'Present') : (ar ? 'لم يحضر' : 'Absent')}
      </button>
      {row.onLeave && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-sky-700">{ar ? 'في إجازة' : 'On leave'}</span>}
      <span className="w-4">
        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
      </span>
    </span>
  );
}

export default function AmazonAttendancePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [date, setDate] = useState('');
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<Record<string, SaveState>>({});

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const res = await api.get<Data>(`/api/b2c/attendance${date ? `?date=${date}` : ''}`);
      if (!guard.isCurrent(mine)) return;
      setD(res); setForbidden(false); setFailed('');
      if (!date) setDate(res.date);
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      if (e?.status === 403) setForbidden(true);
      else setFailed(e?.message || 'Failed');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [date, guard]);
  useEffect(() => { load(); }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(), 600); }, [load]);
  useSocket('b2c:attendance', soon);
  useSocket('lt:updated', soon);
  useSocket('hr:employee', soon);

  // يُقلَب في الحال ويُعاد إن رفضه الخادم.
  const toggle = useCallback(async (lt: string) => {
    if (!d) return;
    const row = d.rows.find((r) => r.lt === lt);
    if (!row) return;
    const next = !row.present;
    const setPresent = (v: boolean) => setD((old) => {
      if (!old) return old;
      const rows = old.rows.map((r) => (r.lt === lt ? { ...r, present: v } : r));
      const present = rows.filter((r) => r.present).length;
      return { ...old, rows, summary: { total: rows.length, present, absent: rows.length - present } };
    });
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

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = fold(q.trim());
    return d.rows.filter((r) => (filter === 'all' || (filter === 'present' ? r.present : !r.present))
      && (!needle || fold(`${r.name} ${r.idNumber} ${r.supervisorName}`).includes(needle)));
  }, [d, q, filter]);

  const exportCols: ExportColumn[] = useMemo(() => [
    { header: t('رقم الإقامة', 'ID number'), key: 'idNumber' },
    { header: t('اسم المندوب', 'Rep'), key: 'name' },
    { header: t('المشروع', 'Project'), key: 'projectAr' },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName' },
    { header: t('الحضور', 'Attendance'), key: 'present', transform: (v: boolean, r: Row) => (v ? t('حضر', 'Present') : (r.onLeave ? t('في إجازة', 'On leave') : t('لم يحضر', 'Absent'))) },
    { header: t('غياب الشهر', 'Month absences'), key: 'monthAbsences', type: 'number' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ar]);

  if (loading && !d && !forbidden) return <Spinner />;
  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <Lock className="h-8 w-8 text-slate-400" />
        <p className="text-[15px] font-semibold text-slate-700">{t('هذه الصفحة لمدير مشروع أمازون ومدير القسم', 'This page is for the Amazon project manager and the section head')}</p>
      </div>
    );
  }
  if (!d) return <div className="p-8 text-slate-500">{failed || t('تعذّر التحميل', 'Could not load')}</div>;

  const pick = (iso: string) => { if (iso && iso <= d.today) setDate(iso); };
  const pickFilter = (f: Filter) => setFilter((cur) => (cur === f && f !== 'all' ? 'all' : f));

  return (
    <div className="w-full space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<UserCheck className="h-5 w-5" />} title={t('متابعة مناديب أمازون', 'Amazon reps attendance')}
        subtitle={t(`المشاريع: ${d.projects.join('، ')}`, `Projects: ${d.projects.join(', ')}`)} />

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
        <span className="ms-auto">
          <ExportMenu fileName={`amazon-attendance-${d.date}`} lang={ar ? 'ar' : 'en'} variant="subtle"
            options={[
              { key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('حضور أمازون', 'Amazon attendance'), rows, columns: exportCols }] },
              { key: 'all', label: t('الكلّ', 'All'), sheets: [{ name: t('حضور أمازون', 'Amazon attendance'), rows: d.rows, columns: exportCols }] },
            ]} />
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('العدد', 'Total')} value={d.summary.total} onClick={() => pickFilter('all')} active={filter === 'all'} />
        <StatCard label={t('حضر', 'Present')} value={d.summary.present} accent="text-emerald-600" onClick={() => pickFilter('present')} active={filter === 'present'} />
        <StatCard label={t('لم يحضر', 'Absent')} value={d.summary.absent} accent="text-red-600" onClick={() => pickFilter('absent')} active={filter === 'absent'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو رقم الإقامة أو المشرف', 'Search name, ID or supervisor')}
            className="w-72 max-w-full rounded-lg border border-slate-200 bg-white py-2 pe-3 ps-8 text-sm" />
        </div>
        <p className="text-[12.5px] text-slate-500">{t('الجميع حاضرون افتراضيًّا — علِّم مَن لم يحضر فقط.', 'Everyone is present by default — mark only who was absent.')}</p>
        <span className="ms-auto text-[12.5px] font-semibold text-slate-600">{rows.length} {t('مندوبًا', 'reps')}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-900 text-[13px] text-slate-200">
              <tr>
                <th className="w-12 px-2 py-2.5">م</th>
                <th className="px-3 py-2.5 text-start">{t('رقم الإقامة', 'ID number')}</th>
                <th className="px-3 py-2.5 text-start">{t('اسم المندوب', 'Rep')}</th>
                <th className="px-3 py-2.5 text-start">{t('المشرف', 'Supervisor')}</th>
                <th className="bg-[#f37121] px-3 py-2.5 text-white">{t(`الحضور — ${d.date.split('-').reverse().join('/')}`, `Attendance — ${d.date}`)}</th>
                <th className="px-3 py-2.5">{t('غياب الشهر', 'Month absences')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.lt} className={r.present ? 'hover:bg-orange-50/30' : 'bg-red-50/40'}>
                  <td className="px-2 py-1.5 text-center text-[12px] tabular-nums text-slate-400">{i + 1}</td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-600">{r.idNumber || <span className="text-slate-300">{t('بلا إقامة', 'no ID')}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-900">
                    {r.name}
                    {d.projects.length > 1 && <span className="ms-1.5 text-[11px] font-normal text-slate-400">{r.projectAr}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.supervisorName || '—'}</td>
                  <td className="bg-orange-50/40 px-3 py-1 text-center">
                    <PresenceToggle row={r} state={state[r.lt]} ar={ar} onToggle={() => toggle(r.lt)} />
                  </td>
                  <td className={`px-3 py-1.5 text-center font-bold tabular-nums ${r.monthAbsences ? 'text-red-600' : 'text-slate-400'}`}>{r.monthAbsences}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="py-12 text-center text-slate-500">{t('لا توجد نتائج مطابقة', 'No matches')}</td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
