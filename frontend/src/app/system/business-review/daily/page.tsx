'use client';
// Meetings and department follow-up, one page: the meeting type and its settings, today's meeting, each department as a
// card (its tasks by state and deadline, its part of today's minutes, actions in place), and the past days.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  CalendarClock, FileText, Users, Settings2, CalendarPlus, ListChecks, ChevronLeft, Circle,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';

import BrSeriesModal, { WEEKDAYS } from '@/components/system/BrSeriesModal';
import BrMeetingDepartments from '@/components/system/BrMeetingDepartments';
import { brMeta, brSeriesDay, type BrMeta, type Lang, tx, fmtDate } from '@/lib/businessReview';

const ATT = { attended: ['حضر', 'Present', 'bg-emerald-100 text-emerald-700'], absent: ['لم يحضر', 'Absent', 'bg-red-100 text-red-700'], excused: ['اعتذر', 'Excused', 'bg-amber-100 text-amber-700'], invited: ['مدعو', 'Invited', 'bg-slate-100 text-slate-500'] } as const;

export default function DailyMeetingPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);
  const { notify, confirm } = useDialog();
  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState('');
  const [edit, setEdit] = useState<'' | 'settings' | 'new'>('');
  const [busy, setBusy] = useState(false);
  // A link that names a department (the old board's ?dept=) opens its card.
  const [initialDept, setInitialDept] = useState('');
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('dept'); if (v) setInitialDept(v); }, []);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await api.get<any>(`/api/business-review/daily${series ? `?series=${series}` : ''}`);
      if (mine === seq.current) setD(r);
    } catch (e: any) { if (mine === seq.current) notify(e?.message || t('Could not load', 'تعذّر التحميل'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { brMeta().then(setMeta).catch(() => {}); }, []);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (tick.current) clearTimeout(tick.current); tick.current = setTimeout(() => load(), 400); }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('br:meeting', soon);
  useSocket('br:action', soon);
  useSocket('br:series', soon);

  const createToday = async () => {
    if (!d?.series) return;
    setBusy(true);
    try { const r = await brSeriesDay(d.series._id, d.todayKey); router.push(`/system/business-review/${r.meeting._id}`); }
    catch (e: any) { notify(e?.message || '', 'error'); }
    setBusy(false);
  };

  if (loading) return <Spinner />;
  const s = d?.series;
  const today = d?.today;
  const open = (id: string) => router.push(`/system/business-review/${id}`);

  return (
    <div className="space-y-5">
      <PageHeader icon={<CalendarClock className="w-5 h-5 text-[#f37121]" />}
        title={t('Meetings & department follow-up', 'الاجتماعات ومتابعة الأقسام')}
        subtitle={s
          ? `${s.title} · ${s.time} · ${WEEKDAYS.filter(([k]) => s.weekdays.includes(Number(k))).map(([, en, ar]) => t(en, ar)).join('، ')} · ${s.departments.length} ${t('departments', 'أقسام')} · ${s.attendees.length} ${t('attendees', 'مدعو')}`
          : t('No daily meeting is scheduled yet.', 'لم يُجدول اجتماع يومي بعد.')}>
        <div className="flex items-center gap-2 flex-wrap">
          {d?.canEdit && meta && s && (
            <button type="button" onClick={() => setEdit('settings')}
              className="inline-flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 text-sm font-medium rounded-lg px-3.5 py-2">
              <Settings2 className="w-4 h-4" />{t('Meeting settings', 'إعدادات هذا الاجتماع')}
            </button>
          )}
          {d?.canEdit && meta && (
            <button type="button" onClick={() => setEdit('new')}
              className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg px-3.5 py-2">
              <CalendarPlus className="w-4 h-4" />{t('New meeting type', 'نوع اجتماع جديد')}
            </button>
          )}
        </div>
      </PageHeader>

      {/* One tab per meeting type (daily, weekly managers, ...). */}
      {(d?.list || []).length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-700">{t('Meeting type', 'نوع الاجتماع')}:</span>
          {d.list.map((x: any) => {
            const on = String(x._id) === String(s?._id);
            return (
              <button key={x._id} type="button" onClick={() => setSeries(x._id)}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${on ? 'bg-[#f37121] border-[#f37121] text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                {x.title}{!x.active && <span className="ms-1 text-[11px] opacity-70">({t('paused', 'موقوف')})</span>}
              </button>
            );
          })}
        </div>
      )}

      {s && !today && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
          <CalendarClock className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-slate-700 font-semibold mt-2">
            {d.scheduledToday ? t('Today’s meeting is being prepared.', 'اجتماع اليوم يُجهَّز الآن.') : t('No meeting today — not a scheduled day.', 'لا اجتماع اليوم — ليس من أيام الاجتماع.')}
          </p>
          {d.canEdit && (
            <button type="button" disabled={busy} onClick={createToday}
              className="mt-3 inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50">
              <CalendarPlus className="w-4 h-4" />{t('Hold a meeting today', 'إنشاء اجتماع اليوم')}
            </button>
          )}
        </div>
      )}

      {today && (
        <section className="bg-white border border-orange-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-gradient-to-l from-orange-50 to-white border-b border-orange-100 flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-[#f37121]">{t('Today', 'اجتماع اليوم')} · {today.refNumber}</p>
              <p className="text-lg font-extrabold text-slate-900">{fmtDate(today.scheduledAt)} — {new Date(today.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[12px] font-semibold">
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{t('Minutes', 'المحضر')}: {today.minutesWritten}/{today.minutesTotal} {t('departments', 'أقسام')}</span>
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{t('Tasks', 'البنود')}: {today.tasks}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">{t('Present', 'حضر')}: {today.attendance.attended}/{today.attendance.invited}</span>
                {!!today.attendance.excused && <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700">{t('Excused', 'اعتذر')}: {today.attendance.excused}</span>}
                {!!today.attendance.absent && <span className="px-2 py-0.5 rounded bg-red-50 text-red-700">{t('Absent', 'غاب')}: {today.attendance.absent}</span>}
              </div>
            </div>
            <button type="button" onClick={() => open(today._id)}
              className="w-full sm:w-auto justify-center inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-semibold rounded-lg px-4 py-2.5">
              <FileText className="w-4 h-4" />{t('Open the meeting: minutes, agenda and attendance', 'فتح الاجتماع: المحضر والأجندة والحضور')}
            </button>
          </div>

          <div className="px-4 py-4">
            <p className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{t('Attendance', 'الحضور')}</p>
            <div className="flex flex-wrap gap-1.5">
              {today.attendees.map((a: any, i: number) => {
                const v = ATT[(a.attendance || 'invited') as keyof typeof ATT] || ATT.invited;
                return (
                  <span key={i} className={`text-[11.5px] px-2 py-0.5 rounded-full font-semibold ${v[2]}`} title={a.excuseReason || ''}>
                    {a.name} · {t(v[1], v[0])}
                  </span>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Department follow-up: every task this meeting has raised, by department. Today's meeting, else the latest one. */}
      {s && (today?._id || d.days?.[0]?._id) && meta && (
        <section className="space-y-3">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-[#f37121]" />{t('Department follow-up', 'متابعة الأقسام')}
            {!today && <span className="text-[12px] font-semibold text-slate-500">({t('from the latest meeting', 'من آخر اجتماع')} {fmtDate(d.days[0].scheduledAt)})</span>}
          </h2>
          <BrMeetingDepartments meetingId={String(today?._id || d.days[0]._id)} meta={meta} L={L} notify={notify} initialDept={initialDept}
            minutesLabel={today ? t('Today’s minutes', 'محضر القسم اليوم') : t('Minutes of that day', 'محضر القسم في ذلك اليوم')} />
        </section>
      )}

      {s && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-900">{t('Previous days', 'الأيام السابقة')}</div>
          <div className="divide-y divide-slate-100">
            {(d.days || []).map((m: any) => (
              <button key={m._id} type="button" onClick={() => open(m._id)}
                className="w-full text-start px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="font-bold text-slate-900 tabular-nums w-28">{fmtDate(m.scheduledAt)}</span>
                <span className="text-[12px] text-slate-500">{m.refNumber}</span>
                <span className="text-[12px] text-slate-700">{t('Minutes', 'المحضر')} {m.minutesWritten}/{m.minutesTotal}</span>
                <span className="text-[12px] text-slate-700">{t('Tasks', 'البنود')} {m.tasks}{m.tasks ? ` (${t('done', 'منجز')} ${m.tasksDone})` : ''}</span>
                <span className="text-[12px] text-emerald-700">{t('Present', 'حضر')} {m.attendance.attended}/{m.attendance.invited}</span>
                {m.minutesWritten < m.minutesTotal && <span className="text-[11px] text-amber-700 inline-flex items-center gap-1"><Circle className="w-2.5 h-2.5 fill-current" />{t('Minutes incomplete', 'محضر غير مكتمل')}</span>}
                <ChevronLeft className="w-4 h-4 text-slate-300 ms-auto ltr:rotate-180" />
              </button>
            ))}
            {!(d.days || []).length && <p className="px-4 py-6 text-center text-sm text-slate-400">{t('No previous days yet.', 'لا أيام سابقة بعد.')}</p>}
          </div>
        </section>
      )}

      {edit && meta && (
        <BrSeriesModal meta={meta} L={L} onClose={() => { setEdit(''); load(); }}
          startNew={edit === 'new'} editId={edit === 'settings' ? s?._id : undefined}
          onOpenMeeting={(id) => router.push(`/system/business-review/${id}`)} notify={notify} confirm={confirm} />
      )}
    </div>
  );
}
