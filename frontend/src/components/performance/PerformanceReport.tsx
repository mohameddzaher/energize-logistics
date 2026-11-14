'use client';
/**
 * The general manager's detailed review: every evaluation inside the chosen period (a quarter includes its monthly
 * evaluations, a year all of them), filterable by department, person and status, each row opening on its full form:
 * criteria, weights, scores, notes, evaluator, percentage, band and bonus. Reads GET /api/performance/report.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { periodKey, BAND_STYLES, bonusLabel, pct, score5, type Period, type Lang } from '@/lib/performance';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { ChevronDown, ChevronUp, Search, Users } from 'lucide-react';

type Criterion = { key: string; titleAr?: string; title?: string; groupAr?: string; weight?: number; score: number | null; note: string };
type Row = {
  _id: string; employee: string; employeeName: string; jobTitle: string; department: string; departmentKey: string;
  evaluatorName: string; periodKey: string; periodLabel: string; evaluationDate: string; status: 'draft' | 'submitted';
  weightedScore: number | null; percentage: number | null; band: string | null; bonusMultiplier: number | null; notes: string;
  criteria: Criterion[];
};
type Report = {
  periodLabel: string;
  totals: { count: number; submitted: number; people: number; avgPercentage: number | null; bonus: number };
  departments: { key: string; name: string }[];
  evaluations: Row[];
};

const BANDS: Record<string, { ar: string; en: string; color: string }> = {
  not_eligible: { ar: 'غير مستحِق', en: 'Not eligible', color: 'red' },
  good: { ar: 'جيد', en: 'Good', color: 'amber' },
  very_good: { ar: 'جيد جدًّا', en: 'Very good', color: 'blue' },
  excellent: { ar: 'ممتاز', en: 'Excellent', color: 'emerald' },
};

export default function PerformanceReport({ period, lang }: { period: Period; lang: Lang }) {
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [data, setData] = useState<Report | null>(null);
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const my = guard.begin();
    const qs = new URLSearchParams({ period: periodKey(period) });
    if (dept) qs.set('department', dept);
    if (status) qs.set('status', status);
    try {
      const d = await api.get<Report>(`/api/performance/report?${qs}`);
      if (guard.isCurrent(my)) setData(d);
    } catch { /* keep last good */ }
  }, [guard, period, dept, status]);
  useEffect(() => { load(); }, [load]);
  useSocket('performance:updated', useCallback(() => load(), [load]));

  // The name/job search narrows what arrived; department and status are asked of the server.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = data?.evaluations || [];
    return term ? all.filter((r) => `${r.employeeName} ${r.jobTitle} ${r.evaluatorName}`.toLowerCase().includes(term)) : all;
  }, [data, q]);

  const bandChip = (b: string | null) => {
    if (!b || !BANDS[b]) return <span className="text-slate-300">—</span>;
    const s = BAND_STYLES[BANDS[b].color] || BAND_STYLES.slate;
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text} ${s.border}`}>{ar ? BANDS[b].ar : BANDS[b].en}</span>;
  };

  // One sheet of evaluations and one of every criterion, so the file carries the full detail shown on screen.
  const evalCols: ExportColumn[] = [
    { header: t('الموظف', 'Employee'), key: 'employeeName', width: 26 }, { header: t('الوظيفة', 'Job'), key: 'jobTitle', width: 20 },
    { header: t('القسم', 'Department'), key: 'department', width: 20 }, { header: t('الفترة', 'Period'), key: 'periodLabel', width: 14 },
    { header: t('المقيِّم', 'Evaluator'), key: 'evaluatorName', width: 20 }, { header: t('تاريخ التقييم', 'Date'), key: 'evaluationDate', width: 12 },
    { header: t('الحالة', 'Status'), key: 'status', width: 10, transform: (v: any) => (v === 'submitted' ? t('مكتمل', 'Submitted') : t('مسودة', 'Draft')) },
    { header: t('الدرجة من 5', 'Score /5'), key: 'weightedScore', type: 'number' }, { header: t('النسبة %', '%'), key: 'percentage', type: 'number' },
    { header: t('التصنيف', 'Band'), key: 'band', transform: (v: any) => (v && BANDS[v] ? (ar ? BANDS[v].ar : BANDS[v].en) : '') },
    { header: t('البونص (رواتب)', 'Bonus (salaries)'), key: 'bonusMultiplier', type: 'number' }, { header: t('ملاحظات المقيِّم', 'Notes'), key: 'notes', width: 30 },
  ];
  const critRows = rows.flatMap((r) => r.criteria.map((c) => ({
    employeeName: r.employeeName, department: r.department, periodLabel: r.periodLabel,
    criterion: (ar ? c.titleAr : c.title) || c.titleAr || c.title || c.key, group: c.groupAr || '', weight: c.weight, score: c.score, note: c.note,
  })));
  const critCols: ExportColumn[] = [
    { header: t('الموظف', 'Employee'), key: 'employeeName', width: 26 }, { header: t('القسم', 'Department'), key: 'department', width: 20 },
    { header: t('الفترة', 'Period'), key: 'periodLabel', width: 14 }, { header: t('المؤشر', 'Criterion'), key: 'criterion', width: 34 },
    { header: t('المجموعة', 'Group'), key: 'group', width: 18 }, { header: t('الوزن %', 'Weight %'), key: 'weight', type: 'number' },
    { header: t('الدرجة من 5', 'Score /5'), key: 'score', type: 'number' }, { header: t('ملاحظة', 'Note'), key: 'note', width: 30 },
  ];
  const tot = data?.totals;
  const sel = 'border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-[#f37121]';

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
        <Users className="w-5 h-5 text-[#f37121]" />
        <p className="font-bold text-slate-900">{t('تفاصيل التقييمات', 'Evaluation details')}</p>
        <span className="text-xs text-slate-500">
          {data ? t(`${data.periodLabel} · ${tot?.count ?? 0} تقييم لـ ${tot?.people ?? 0} شخص · المتوسّط ${pct(tot?.avgPercentage)} · البونص ${tot?.bonus ?? 0} راتب`,
            `${tot?.count ?? 0} evaluations of ${tot?.people ?? 0} people · avg ${pct(tot?.avgPercentage)} · bonus ${tot?.bonus ?? 0} salaries`) : ''}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={sel}>
            <option value="">{t('كلّ الأقسام', 'All departments')}</option>
            {(data?.departments || []).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            <option value="">{t('كلّ الحالات', 'Any status')}</option>
            <option value="submitted">{t('مكتمل', 'Submitted')}</option>
            <option value="draft">{t('مسودة', 'Draft')}</option>
          </select>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('بحث بالاسم أو الوظيفة أو المقيِّم…', 'Name, job or evaluator…')}
              className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-56 focus:outline-none focus:border-[#f37121]" />
          </div>
          <ExportMenu fileName={`performance-details-${periodKey(period)}`} lang={ar ? 'ar' : 'en'} label={t('تصدير Excel', 'Export Excel')}
            options={[{ key: 'shown', label: t(`المعروض (${rows.length})`, `Shown (${rows.length})`), sheets: [
              { name: t('التقييمات', 'Evaluations'), rows, columns: evalCols },
              { name: t('المؤشرات', 'Criteria'), rows: critRows, columns: critCols },
            ] }]} />
        </div>
      </div>
      <ScrollX>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
              {[t('الموظف', 'Employee'), t('القسم', 'Department'), t('الفترة', 'Period'), t('المقيِّم', 'Evaluator'), t('الدرجة', 'Score'), t('النسبة', '%'), t('التصنيف', 'Band'), t('البونص', 'Bonus'), t('الحالة', 'Status'), ''].map((h, i) => (
                <th key={i} className="px-3 py-2.5 font-semibold text-start whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!rows.length && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">{t('لا تقييماتٍ في هذه الفترة بهذا الفلتر.', 'No evaluations for this period and filter.')}</td></tr>
            )}
            {rows.map((r) => {
              const isOpen = open === r._id;
              return [
                <tr key={r._id} onClick={() => setOpen(isOpen ? null : r._id)} className="cursor-pointer hover:bg-orange-50/40">
                  <td className="px-3 py-2 whitespace-nowrap"><p className="font-semibold text-slate-900">{r.employeeName}</p><p className="text-[11px] text-slate-500">{r.jobTitle}</p></td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{r.department || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{r.periodLabel}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{r.evaluatorName || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{score5(r.weightedScore)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums font-semibold">{pct(r.percentage)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{bandChip(r.band)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{bonusLabel(r.bonusMultiplier, lang)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.status === 'submitted' ? t('مكتمل', 'Submitted') : t('مسودة', 'Draft')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                </tr>,
                isOpen && (
                  <tr key={`${r._id}-d`} className="bg-slate-50">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="text-[12px] text-slate-500 mb-2">
                        {t('تاريخ التقييم', 'Date')}: {r.evaluationDate || '—'} · {t('المقيِّم', 'Evaluator')}: {r.evaluatorName || '—'}
                      </div>
                      <table className="w-full text-[12.5px] bg-white rounded-lg border border-slate-200">
                        <thead><tr className="text-slate-500 border-b border-slate-200">
                          <th className="px-3 py-1.5 text-start">{t('المؤشر', 'Criterion')}</th>
                          <th className="px-3 py-1.5 text-start">{t('الوزن', 'Weight')}</th>
                          <th className="px-3 py-1.5 text-start">{t('الدرجة من 5', 'Score /5')}</th>
                          <th className="px-3 py-1.5 text-start">{t('ملاحظة', 'Note')}</th>
                        </tr></thead>
                        <tbody>
                          {r.criteria.map((c) => (
                            <tr key={c.key} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-1.5"><span className="font-semibold text-slate-800">{(ar ? c.titleAr : c.title) || c.titleAr || c.title}</span>{c.groupAr && <span className="ms-2 text-[11px] text-slate-400">{c.groupAr}</span>}</td>
                              <td className="px-3 py-1.5 tabular-nums">{c.weight != null ? `${c.weight}%` : '—'}</td>
                              <td className="px-3 py-1.5 tabular-nums font-semibold">{c.score ?? '—'}</td>
                              <td className="px-3 py-1.5 text-slate-600">{c.note || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.notes && <p className="mt-2 text-[12.5px] text-slate-700"><span className="font-semibold">{t('ملاحظات المقيِّم', 'Evaluator notes')}:</span> {r.notes}</p>}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}
