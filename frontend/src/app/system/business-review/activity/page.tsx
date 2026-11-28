'use client';
// Business review activity log: every update on any task (who, section, what changed, details, when, and where the task stands now).
// Open to the top roles and the software team, or to anyone given this page on the permissions screen; the server decides.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, Clock, ExternalLink, Paperclip, ArrowLeft, ArrowRight } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { PageHeader, StatCard, SearchInput, Select, Spinner, ErrorNotice } from '@/components/hr/HRKit';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import MonthPicker from '@/components/system/MonthPicker';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { fmtDateTime, fmtDate, type Lang } from '@/lib/businessReview';

type Row = {
  id: string; at: string; kind: string; kindAr: string;
  by: string; byName: string; byRole: string; byRoleAr: string; bySection: string; bySectionAr: string;
  statusFrom: string; statusTo: string; statusFromAr: string; statusToAr: string;
  text: string; files: { fileUrl: string; fileName: string }[];
  part: { _id: string; title: string; assigneeName: string } | null;
  task: { _id: string; title: string; department: string; departmentAr: string; assigneeName: string; status: string; statusAr: string; progress: number; dueDate: string | null; overdue: boolean; meetingRef: string; meetingTitle: string; archived: boolean; shared: boolean };
  link: string;
};
type Payload = { from: string; to: string; rows: Row[]; total: number; kinds: Record<string, string> };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); };
const KIND_TONE: Record<string, string> = {
  status: 'bg-sky-50 text-sky-800 border-sky-200', postpone: 'bg-amber-50 text-amber-800 border-amber-200', note: 'bg-slate-50 text-slate-700 border-slate-200',
  files: 'bg-slate-50 text-slate-700 border-slate-200', created: 'bg-emerald-50 text-emerald-800 border-emerald-200', delegated: 'bg-violet-50 text-violet-800 border-violet-200',
  transfer: 'bg-indigo-50 text-indigo-800 border-indigo-200', share: 'bg-indigo-50 text-indigo-800 border-indigo-200', archived: 'bg-slate-100 text-slate-700 border-slate-300',
};

export default function BusinessReviewActivityPage() {
  const { lang, isRTL } = useLanguage();
  const L = lang as Lang;
  const ar = L === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const guard = useLatestRequest();
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 6 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [dept, setDept] = useState('');
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('');
  const [taskStatus, setTaskStatus] = useState('');

  const load = useCallback(async () => {
    const mine = guard.begin();
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    try {
      const d = await api.get<Payload>(`/api/business-review/activity?${p}`, { timeoutMs: 60000 } as any);
      if (guard.isCurrent(mine)) { setData(d); setError(''); }
    } catch (e: any) { if (guard.isCurrent(mine)) setError(e?.message || 'Request failed'); }
  }, [guard, from, to]);
  useEffect(() => { load(); }, [load]);
  // Any task change anywhere: re-read (the log is the tasks' own history).
  const live = useCallback(() => load(), [load]);
  useSocket('br:action', live);
  useSocket('br:assignment', live);

  const setPeriod = (f: string, tt: string) => { setMonth(''); setDay(''); setFrom(f); setTo(tt); };
  const quick = [
    { k: 'today', label: t('اليوم', 'Today'), f: ymd(today), t: ymd(today) },
    { k: 'yesterday', label: t('أمس', 'Yesterday'), f: ymd(new Date(today.getTime() - 86400000)), t: ymd(new Date(today.getTime() - 86400000)) },
    { k: 'week', label: t('آخر 7 أيام', 'Last 7 days'), f: ymd(new Date(today.getTime() - 6 * 86400000)), t: ymd(today) },
    { k: 'month', label: t('هذا الشهر', 'This month'), f: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), t: ymd(today) },
    { k: '90', label: t('آخر 90 يومًا', 'Last 90 days'), f: ymd(new Date(today.getTime() - 89 * 86400000)), t: ymd(today) },
  ];

  const all = data?.rows || [];
  const opts = useMemo(() => {
    const secs = new Map<string, string>(); const depts = new Map<string, string>(); const people = new Map<string, string>(); const sts = new Map<string, string>();
    for (const r of all) {
      if (r.bySection) secs.set(r.bySection, r.bySectionAr || r.bySection);
      if (r.task.department) depts.set(r.task.department, r.task.departmentAr || r.task.department);
      if (r.by) people.set(r.by, r.byName);
      if (r.task.status) sts.set(r.task.status, r.task.statusAr);
    }
    const sort = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
    return { secs: sort(secs), depts: sort(depts), people: sort(people), sts: sort(sts) };
  }, [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => (!section || r.bySection === section) && (!dept || r.task.department === dept) && (!person || r.by === person)
      && (!kind || r.kind === kind) && (!taskStatus || r.task.status === taskStatus)
      && (!needle || [r.byName, r.text, r.task.title, r.task.assigneeName, r.part?.title, r.task.meetingRef].some((x) => String(x || '').toLowerCase().includes(needle))));
  }, [all, q, section, dept, person, kind, taskStatus]);

  const change = (r: Row) => {
    if (r.statusTo) return `${r.statusFromAr || r.statusFrom || '—'} ← ${r.statusToAr || r.statusTo}`;
    return '';
  };
  const cols: ExportColumn[] = [
    { header: t('التاريخ والوقت', 'Date & time'), key: 'at', width: 18, transform: (v) => fmtDateTime(v) },
    { header: t('الشخص', 'Person'), key: 'byName', width: 22 },
    { header: t('صفته', 'Role'), key: 'byRoleAr', width: 18 },
    { header: t('قسمه', 'His section'), key: 'bySectionAr', width: 18 },
    { header: t('نوع التحديث', 'Update'), key: 'kindAr', width: 16 },
    { header: t('تغيير الحالة', 'Status change'), key: 'statusTo', width: 22, transform: (_v, r) => change(r) },
    { header: t('التفاصيل', 'Details'), key: 'text', width: 50 },
    { header: t('المرفقات', 'Files'), key: 'files', width: 24, transform: (v) => (v || []).map((f: any) => f.fileName).join('، ') },
    { header: t('البند', 'Task'), key: 'task', width: 40, transform: (v) => v?.title || '' },
    { header: t('جزء الفريق', 'Team part'), key: 'part', width: 30, transform: (v) => (v ? `${v.title} — ${v.assigneeName}` : '') },
    { header: t('قسم البند', 'Task department'), key: 'task', width: 18, transform: (v) => v?.departmentAr || '' },
    { header: t('مسؤول البند', 'Task owner'), key: 'task', width: 20, transform: (v) => v?.assigneeName || '' },
    { header: t('حالة البند الآن', 'Task status now'), key: 'task', width: 16, transform: (v) => v?.statusAr || '' },
    { header: t('نسبة الإنجاز', 'Progress'), key: 'task', width: 10, transform: (v) => `${v?.progress ?? 0}%` },
    { header: t('موعد التسليم', 'Due'), key: 'task', width: 13, transform: (v) => fmtDate(v?.dueDate) },
    { header: t('الاجتماع', 'Meeting'), key: 'task', width: 24, transform: (v) => [v?.meetingRef, v?.meetingTitle].filter(Boolean).join(' · ') },
  ];
  const counts = useMemo(() => ({
    total: rows.length,
    status: rows.filter((r) => r.kind === 'status' || r.kind === 'postpone').length,
    done: rows.filter((r) => r.statusTo === 'done').length,
    people: new Set(rows.map((r) => r.by)).size,
    tasks: new Set(rows.map((r) => r.task._id)).size,
  }), [rows]);

  if (!data && !error) return <Spinner />;
  const Arrow = isRTL ? ArrowLeft : ArrowRight;
  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Activity className="w-6 h-6 text-[#f37121]" />} title={t('سجل تحديثات مراجعة الأعمال', 'Business review activity')}
        subtitle={t('كلُّ تحديثٍ على البنود: مَن حدّث، ومن أيّ قسم، وماذا غيّر بالتفصيل، ومتى، وأين يقف البند الآن. اضغط أيَّ سطرٍ لفتح البند.', 'Every update on tasks: who, which section, exactly what changed, when, and where the task stands now. Click a row to open the task.')}>
        <ExportMenu fileName="business-review-activity" lang={L}
          options={[
            { key: 'shown', label: t('المعروض (بعد الفلاتر)', 'Current view (filtered)'), sheets: [{ name: t('سجل التحديثات', 'Activity'), rows, columns: cols }] },
            { key: 'all', label: t('كل الفترة المختارة', 'Whole period'), sheets: [{ name: t('سجل التحديثات', 'Activity'), rows: all, columns: cols }] },
          ]} />
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={load} lang={L} />}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={t('التحديثات', 'Updates')} value={counts.total} accent="text-[#f37121]" onClick={() => setKind('')} active={!kind} />
        <StatCard label={t('تغييرات الحالة', 'Status changes')} value={counts.status} accent="text-sky-700" onClick={() => setKind('status')} active={kind === 'status'} />
        <StatCard label={t('إنجازات', 'Completions')} value={counts.done} accent="text-emerald-600" />
        <StatCard label={t('الأشخاص', 'People')} value={counts.people} />
        <StatCard label={t('البنود', 'Tasks')} value={counts.tasks} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px]"><SearchInput value={q} onChange={setQ} placeholder={t('الشخص، البند، التفاصيل…', 'Person, task, details…')} /></div>
          <Select value={section} onChange={(e) => setSection(e.target.value)} className="!w-auto">
            <option value="">{t('قسم الشخص: الكل', 'Person’s section: all')}</option>
            {opts.secs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="!w-auto">
            <option value="">{t('قسم البند: الكل', 'Task department: all')}</option>
            {opts.depts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={person} onChange={(e) => setPerson(e.target.value)} className="!w-auto">
            <option value="">{t('كل الأشخاص', 'Everyone')}</option>
            {opts.people.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto">
            <option value="">{t('كل أنواع التحديث', 'All updates')}</option>
            {Object.entries(data?.kinds || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} className="!w-auto">
            <option value="">{t('حالة البند الآن: الكل', 'Task status now: all')}</option>
            {opts.sts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-[12px] font-bold text-slate-600 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('الفترة', 'Period')}</span>
          {quick.map((x) => {
            const on = !month && !day && from === x.f && to === x.t;
            return <button key={x.k} type="button" onClick={() => setPeriod(x.f, x.t)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${on ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{x.label}</button>;
          })}
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600">{t('يوم', 'Day')}
            <input type="date" value={day} max={ymd(today)} onChange={(e) => { const v = e.target.value; setDay(v); setMonth(''); if (v) { setFrom(v); setTo(v); } }}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm" /></label>
          <MonthPicker value={month} ar={ar} label={t('شهر', 'Month')}
            onChange={(v: string) => { setMonth(v); setDay(''); if (v) { setFrom(`${v}-01`); setTo(lastDay(v)); } }} />
          <DateRangeFilter from={from} to={to} ar={ar} onFrom={(v) => { setMonth(''); setDay(''); setFrom(v); }} onTo={(v) => { setMonth(''); setDay(''); setTo(v); }} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start">
                {[t('التاريخ والوقت', 'When'), t('الشخص', 'Person'), t('التحديث', 'Update'), t('التفاصيل', 'Details'), t('البند', 'Task'), t('البند الآن', 'Task now'), ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-start font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-orange-50/40">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums">{fmtDateTime(r.at)}</td>
                  <td className="px-3 py-2 min-w-[11rem]">
                    <b className="block text-slate-900">{r.byName || '—'}</b>
                    <span className="block text-[11.5px] text-slate-500">{[r.byRoleAr, r.bySectionAr].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2 min-w-[9rem]">
                    <span className={`inline-block px-2 py-0.5 rounded border text-[11.5px] font-bold ${KIND_TONE[r.kind] || KIND_TONE.note}`}>{r.kindAr}</span>
                    {r.statusTo && <span className="block mt-1 text-[12px] font-semibold text-slate-700">{r.statusFromAr || '—'} <Arrow className="inline w-3 h-3" /> {r.statusToAr}</span>}
                  </td>
                  <td className="px-3 py-2 min-w-[16rem] max-w-[28rem]">
                    {r.text ? <p className="whitespace-pre-wrap text-[13px] text-slate-800">{r.text}</p> : <span className="text-slate-400">—</span>}
                    {!!r.files.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.files.map((f, i) => (
                          <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11.5px] text-slate-700 hover:text-[#f37121]">
                            <Paperclip className="w-3 h-3" />{f.fileName}
                          </a>
                        ))}
                      </div>
                    )}
                    {r.part && <p className="mt-1 text-[11.5px] text-violet-700">{t('جزء الفريق', 'Team part')}: {r.part.title} — {r.part.assigneeName}</p>}
                  </td>
                  <td className="px-3 py-2 min-w-[14rem]">
                    <Link href={r.link} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.task.title}</Link>
                    <span className="block text-[11.5px] text-slate-500">{[r.task.departmentAr, r.task.assigneeName, r.task.meetingRef].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="block text-[12.5px] font-semibold text-slate-800">{r.task.statusAr} · {r.task.progress}%</span>
                    <span className={`block text-[11.5px] ${r.task.overdue ? 'text-red-700 font-bold' : 'text-slate-500'}`}>{t('التسليم', 'Due')}: {fmtDate(r.task.dueDate)}</span>
                    {r.task.archived && <span className="block text-[11px] text-slate-500">{t('في الأرشيف', 'Archived')}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={r.link} title={t('فتح البند', 'Open task')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[12px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]">
                      <ExternalLink className="w-3.5 h-3.5" />{t('فتح', 'Open')}
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">{t('لا تحديثاتَ في هذه الفترة أو بهذه الفلاتر.', 'No updates for this period or filters.')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
