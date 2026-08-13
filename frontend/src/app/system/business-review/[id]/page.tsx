'use client';
// اجتماع واحد بالكامل — the record and the work it produced.
//
// Three tabs, in the order the meeting actually happens: who is here and what
// we will discuss (الأجندة), what was said (المحضر — the secretary writes it),
// and what somebody now has to DO about it (البنود التنفيذية).
//
// Minutes and actions are deliberately separate things: minutes are the
// discussion, actions are the commitments. Conflating them is how decisions get
// lost inside paragraphs.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  ArrowRight, CalendarDays, MapPin, Users, FileText, ClipboardList, Plus,
  Loader2, Save, Video, Trash2, UserCheck, UserX, Crown, ScrollText, Clock,
  CheckCircle2, AlertTriangle, MessageSquare, Printer, Lock, Unlock,
} from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import { StatusPill, ActionCard, PersonSelect, DueBadge, Progress } from '@/components/system/BusinessReviewKit';
import {
  brMeta, brMeeting, brSaveMinutes, brCreateAction, brUpdateAction, brDelegate,
  brDeleteAction, brUpdateMeeting, brDeleteMeeting, brCompleteMeeting, brReopenMeeting,
  type BrMeta, type BrMeeting, type BrAction, type Lang,
  vocabLabel, vocabColor, fmtDate, fmtDateTime, isoDay, tx, deptLabel,
  attendanceLabel, attendanceColor, ATTENDANCE, OPEN_STATUSES,
} from '@/lib/businessReview';
import { openReportPdf } from '@/lib/reports';

// «السجل الشامل» comes FIRST: open a meeting and you see the whole story — who
// came and when that was recorded, what was said, what was decided, who owes
// what, and how far they've got. The other tabs are where you go to WORK on one
// part of it.
type Tab = 'record' | 'agenda' | 'minutes' | 'actions';

export default function MeetingPage() {
  const params = useParams();
  const router = useRouter();
  const { lang } = useLanguage();
  const { notify, confirm } = useDialog();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);
  const id = String(params?.id || '');

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [meeting, setMeeting] = useState<BrMeeting | null>(null);
  const [actions, setActions] = useState<BrAction[]>([]);
  const [can, setCan] = useState({ edit: false, writeMinutes: false, raiseActions: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('record');
  const [printing, setPrinting] = useState(false);
  const [closing, setClosing] = useState(false);

  // إقفال الاجتماع = «اكتمل». السيرفر هو اللي بيتأكد إن كل البنود والتكليفات
  // اتقفلت، فالواجهة بتوصّل رسالته زي ما هي بدل ما تخمّن الشرط عندها.
  const completeMeeting = async (m: BrMeeting) => {
    const ok = await confirm({
      title: t('Close this meeting?', 'إقفال هذا الاجتماع؟'),
      message: t(
        'Marking it Completed says everything arising from this meeting is finished. It is refused if any action or delegated task is still open.',
        'تحديده كـ«اكتمل» يعني أن كل ما تُرتِّب على هذا الاجتماع قد أُنجِز. ويُرفَض إن بقي بند تنفيذي أو تكليف فرعي مفتوح.'
      ),
      confirmLabel: t('Close it', 'إقفال'),
    });
    if (!ok) return;
    setClosing(true);
    try {
      const r = await brCompleteMeeting(m._id);
      setMeeting(r.meeting);
      notify(t('Meeting closed', 'تم إقفال الاجتماع'), 'success');
      load();
    } catch (e: any) { notify(e?.message || t('Could not close it', 'تعذّر الإقفال'), 'error'); }
    setClosing(false);
  };

  const reopenMeeting = async (m: BrMeeting) => {
    setClosing(true);
    try {
      const r = await brReopenMeeting(m._id);
      setMeeting(r.meeting);
      notify(t('Reopened', 'تم إعادة الفتح'), 'success');
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setClosing(false);
  };

  // The formal minutes, as a PDF — same document the report centre issues, on the
  // company letterhead, with signature lines for the chair and the secretary.
  const printMinutes = async (meetingId: string) => {
    setPrinting(true);
    try {
      const day = isoDay(new Date());
      await openReportPdf('meeting', meetingId, day, day, L);
    } catch (e: any) {
      notify(e?.message || t('Could not generate the minutes', 'تعذّر إصدار المحضر'), 'error');
    }
    setPrinting(false);
  };

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([brMeta().catch(() => null), brMeeting(id)]);
      if (m) setMeta(m);
      setMeeting(d.meeting);
      setActions(d.actions || []);
      setCan(d.can);
      setError('');

    } catch (e: any) {
      setError(e?.message || t('Could not open this meeting', 'تعذّر فتح هذا الاجتماع'));
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lang]);
  useEffect(() => { load(); }, [load]);
  useSocket('br:meeting', load);
  useSocket('br:action', load);

  if (loading) return <Spinner />;
  if (error || !meeting) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => router.push('/system/business-review')}
          className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
          <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('Back', 'رجوع')}
        </button>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'record', label: t('Full record', 'السجل الشامل'), icon: ScrollText },
    { key: 'agenda', label: t('Agenda & attendees', 'الأجندة والحضور'), icon: Users },
    { key: 'minutes', label: t('Minutes', 'محضر الاجتماع'), icon: FileText, badge: meeting.minutes?.length || 0 },
    { key: 'actions', label: t('Actions', 'البنود التنفيذية'), icon: ClipboardList, badge: actions.length },
  ];

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => router.push('/system/business-review')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('All meetings', 'كل الاجتماعات')}
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{meeting.title}</h1>
              <StatusPill statuses={meta?.meetingStatuses} value={meeting.status} lang={L} />
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {vocabLabel(meta?.cadences, meeting.cadence, L)}
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-1">{meeting.refNumber}</p>
            <p className="text-slate-600 text-xs mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-slate-400" />{fmtDateTime(meeting.scheduledAt)}</span>
              {meeting.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{meeting.location}</span>}
              {meeting.meetingLink && (
                <a href={meeting.meetingLink} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#f37121] hover:underline">
                  <Video className="w-3.5 h-3.5" />{t('Join', 'انضمام')}
                </a>
              )}
              {meeting.scribeName && <span>{t('Minuted by', 'كاتب المحضر')}: {meeting.scribeName}</span>}
            </p>
            {meeting.status === 'completed' && meeting.completedAt && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('Closed', 'أُقفل')} {fmtDateTime(meeting.completedAt)}
                {meeting.completedByName ? ` · ${meeting.completedByName}` : ''}
                {meeting.completionNote ? ` · ${meeting.completionNote}` : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => printMinutes(meeting._id)} disabled={printing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-[#f37121] hover:text-[#f37121] disabled:opacity-60">
              {printing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              {t('Print minutes', 'طباعة المحضر')}
            </button>
            {can.edit && meeting.status !== 'cancelled' && (
              meeting.status === 'completed' ? (
                <button type="button" onClick={() => reopenMeeting(meeting)} disabled={closing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:border-slate-400 disabled:opacity-60">
                  <Unlock className="w-3.5 h-3.5" />{t('Reopen', 'إعادة فتح')}
                </button>
              ) : (
                <button type="button" onClick={() => completeMeeting(meeting)} disabled={closing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium disabled:opacity-60">
                  {closing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  {t('Close meeting', 'إقفال الاجتماع')}
                </button>
              )
            )}
            {can.edit && (
              <>
              <select
                value={meeting.status}
                onChange={async (e) => {
                  try {
                    const r = await brUpdateMeeting(meeting._id, { status: e.target.value });
                    setMeeting(r.meeting);
                  } catch (err: any) { notify(err?.message || 'Failed', 'error'); }
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700"
              >
                {meta?.meetingStatuses.map((s) => <option key={s.key} value={s.key}>{lang === 'ar' ? s.ar : s.en}</option>)}
              </select>
              {meta?.me.isExecutive && (
                <button type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('Delete this meeting?', 'حذف هذا الاجتماع؟'),
                      message: t('Its minutes and all its actions are deleted with it.', 'سيتم حذف المحضر وكل البنود التنفيذية معه.'),
                      confirmLabel: t('Delete', 'حذف'), tone: 'danger',
                    });
                    if (!ok) return;
                    try { await brDeleteMeeting(meeting._id); router.push('/system/business-review'); }
                    catch (err: any) { notify(err?.message || 'Failed', 'error'); }
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              </>
            )}
          </div>
        </div>

        {!!meeting.departments?.length && (
          <div className="flex flex-wrap gap-1 mt-3">
            {meeting.departments.map((d) => (
              <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{deptLabel(d, L)}</span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.key} type="button" onClick={() => setTab(x.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${
                tab === x.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              <Icon className="w-4 h-4" />{x.label}
              {!!x.badge && (
                <span className={`text-[10px] px-1.5 rounded-full ${tab === x.key ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>{x.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'record' && meta && (
        <RecordTab meeting={meeting} meta={meta} actions={actions} lang={L}
          onPrint={() => printMinutes(meeting._id)} printing={printing} />
      )}

      {tab === 'agenda' && (
        <AgendaTab meeting={meeting} meta={meta} lang={L} canEdit={can.edit}
          onAttendance={async (userId: string, attendance: string, excuseReason = '') => {
            const attendees = (meeting.attendees || []).map((a) => (a.user === userId
              ? { ...a, attendance, excuseReason }
              : a));
            try {
              const r = await brUpdateMeeting(meeting._id, { attendees });
              setMeeting(r.meeting);
            } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
          }} />
      )}

      {tab === 'minutes' && (
        <MinutesTab meeting={meeting} meta={meta} lang={L} canWrite={can.writeMinutes}
          onSaved={(m: BrMeeting) => { setMeeting(m); notify(t('Minutes saved', 'تم حفظ المحضر'), 'success'); }}
          notify={notify} />
      )}

      {tab === 'actions' && meta && (
        <ActionsTab meeting={meeting} meta={meta} actions={actions} lang={L}
          canRaise={can.raiseActions} onChanged={load} notify={notify} />
      )}
    </div>
  );
}


// ── السجل الشامل ────────────────────────────────────────────────────────────
// Everything about this meeting on one page, in the order it happened: the
// facts, who was in the room (and when that was recorded, and who wasn't and
// why), what was discussed, and every commitment that came out of it — including
// what each manager passed to their own team and how far it has got.
function RecordTab({ meeting, meta, actions, lang, onPrint, printing }: any) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const attendees = meeting.attendees || [];
  const counts = ATTENDANCE.reduce((acc: any, a: any) => {
    acc[a.key] = attendees.filter((x: any) => (x.attendance || 'invited') === a.key).length;
    return acc;
  }, {});
  const open = actions.filter((a: BrAction) => OPEN_STATUSES.includes(a.status));
  const done = actions.filter((a: BrAction) => a.status === 'done');
  const overdue = actions.filter((a: BrAction) => a.isOverdue && OPEN_STATUSES.includes(a.status));
  const allDelegations = actions.flatMap((a: BrAction) => a.delegations || []);

  const Fact = ({ label, value }: { label: string; value: any }) => (
    <div className="border-b border-slate-100 pb-1.5">
      <p className="text-slate-400 text-[10px] uppercase tracking-wide">{label}</p>
      <p className="text-slate-800 text-sm mt-0.5 break-words">{value || '—'}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ① The meeting itself */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">
          {t('Meeting details', 'بيانات الاجتماع')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
          <Fact label={t('Reference', 'الرقم المرجعي')} value={meeting.refNumber} />
          <Fact label={t('Cadence', 'الدورة')} value={vocabLabel(meta.cadences, meeting.cadence, lang)} />
          <Fact label={t('Status', 'الحالة')} value={vocabLabel(meta.meetingStatuses, meeting.status, lang)} />
          <Fact label={t('Scheduled for', 'موعد الانعقاد')} value={fmtDateTime(meeting.scheduledAt)} />
          <Fact label={t('Actually held', 'انعقد فعليًا')} value={meeting.heldAt ? fmtDateTime(meeting.heldAt) : t('Not yet', 'لم ينعقد بعد')} />
          <Fact label={t('Duration', 'المدة')} value={meeting.durationMinutes ? `${meeting.durationMinutes} ${t('min', 'دقيقة')}` : '—'} />
          <Fact label={t('Location', 'المكان')} value={meeting.location} />
          <Fact label={t('Minuted by', 'كاتب المحضر')} value={meeting.scribeName} />
          <Fact label={t('Created by', 'أنشأه')} value={meeting.createdByName} />
          <Fact label={t('Departments', 'الأقسام')}
            value={(meeting.departments || []).map((d: string) => deptLabel(d, lang)).join(' · ')} />
        </div>
        {meeting.summary && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">{t('Summary', 'الخلاصة')}</p>
            <p className="text-slate-800 text-sm whitespace-pre-wrap">{meeting.summary}</p>
          </div>
        )}
      </div>

      {/* ② Attendance — with the WHEN and the WHY */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold">{t('Attendance', 'سجل الحضور')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {ATTENDANCE.map((a) => (
              <span key={a.key} className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${a.color}1f`, color: a.color }}>
                {(lang === 'ar' ? a.ar : a.en)}: {counts[a.key] || 0}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11px]">
                <th className="text-start font-semibold px-3 py-2">{t('Name', 'الاسم')}</th>
                <th className="text-start font-semibold px-3 py-2">{t('Department', 'القسم')}</th>
                <th className="text-start font-semibold px-3 py-2">{t('Attendance', 'الحضور')}</th>
                <th className="text-start font-semibold px-3 py-2">{t('Recorded at', 'وقت التسجيل')}</th>
                <th className="text-start font-semibold px-3 py-2">{t('Reason / note', 'سبب الاعتذار')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attendees.map((a: any) => (
                <tr key={a.user}>
                  <td className="px-3 py-2 text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      {a.name}
                      {a.isChair && <Crown className="w-3.5 h-3.5 text-[#f37121]" />}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{a.department || deptLabel(a.role, lang)}</td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${attendanceColor(a.attendance)}1f`, color: attendanceColor(a.attendance) }}>
                      {attendanceLabel(a.attendance, lang)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">
                    {a.attendanceAt ? fmtDateTime(a.attendanceAt) : '—'}
                    {a.attendanceByName && <span className="block text-slate-400 text-[10px]">{t('by', 'سجّله')} {a.attendanceByName}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{a.excuseReason || '—'}</td>
                </tr>
              ))}
              {!attendees.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400 text-sm">{t('Nobody invited yet.', 'لم تتم دعوة أحد بعد.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ③ Agenda + minutes, side by side — what we meant to discuss, and what we did */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">{t('Agenda', 'جدول الأعمال')}</h3>
          {meeting.agenda?.length ? (
            <ol className="space-y-2">
              {meeting.agenda.map((a: any, i: number) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#f37121]/10 text-[#f37121] text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <span className="text-slate-800 text-sm">{a.title}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-slate-400 text-sm">{t('No agenda was set.', 'لم يُحدَّد جدول أعمال.')}</p>}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">{t('Minutes', 'محضر الاجتماع')}</h3>
          {meeting.minutes?.length ? meeting.minutes.map((m: any, i: number) => (
            <div key={i} className={i ? 'border-t border-slate-100 pt-3 mt-3' : ''}>
              <p className="text-slate-900 font-semibold text-sm">
                {m.heading}
                {m.department && <span className="text-slate-400 font-normal text-[11px] ms-2">{deptLabel(m.department, lang)}</span>}
              </p>
              <p className="text-slate-700 text-sm mt-1 whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </div>
          )) : <p className="text-slate-400 text-sm">{t('The minutes have not been written yet.', 'لم يُكتب المحضر بعد.')}</p>}
        </div>
      </div>

      {/* ④ Everything the meeting committed someone to */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold">{t('Actions & follow-up', 'البنود التنفيذية والمتابعة')}</h3>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t('Total', 'الإجمالي')}: {actions.length}</span>
            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">{t('Open', 'مفتوح')}: {open.length}</span>
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">{t('Overdue', 'متأخر')}: {overdue.length}</span>
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700">{t('Done', 'منجز')}: {done.length}</span>
            {!!allDelegations.length && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                {t('Delegated tasks', 'تكليفات فرعية')}: {allDelegations.length}
              </span>
            )}
          </div>
        </div>

        {actions.length ? (
          <div className="space-y-3">
            {actions.map((a: BrAction) => {
              const color = vocabColor(meta.actionStatuses, a.status);
              const late = a.isOverdue && OPEN_STATUSES.includes(a.status);
              return (
                <div key={a._id} className={`border rounded-xl p-3.5 ${late ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-slate-900 font-semibold text-sm">{a.title}</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        {t('Owner', 'المكلَّف')}: <span className="text-slate-700 font-medium">{a.assigneeName}</span>
                        {a.raisedByName && <> · {t('Requested by', 'بطلب من')}: {a.raisedByName}</>}
                        {a.department && <> · {deptLabel(a.department, lang)}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusPill statuses={meta.actionStatuses} value={a.status} lang={lang} />
                      <DueBadge due={a.dueDate} status={a.status} lang={lang} />
                    </div>
                  </div>

                  {a.description && <p className="text-slate-600 text-xs mt-2 whitespace-pre-wrap">{a.description}</p>}

                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1"><Progress value={a.progress} color={color} /></div>
                    <span className="text-[11px] text-slate-500 tabular-nums w-9 text-end">{a.progress}%</span>
                  </div>

                  {a.completedAt && (
                    <p className="text-[11px] text-green-700 mt-1.5 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t('Completed on', 'اكتمل في')} {fmtDate(a.completedAt)}
                    </p>
                  )}

                  {/* Who the manager passed it to, and where each of them got to */}
                  {!!a.delegations?.length && (
                    <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                      <p className="text-slate-500 text-[11px] font-semibold mb-1.5 inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />{t('Delegated to', 'موزّعة على')}
                      </p>
                      <div className="space-y-1.5">
                        {a.delegations.map((d: any) => (
                          <div key={d._id} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-slate-800 text-xs font-medium">{d.assigneeName}</span>
                              <span className="flex items-center gap-1.5">
                                <StatusPill statuses={meta.actionStatuses} value={d.status} lang={lang} />
                                <DueBadge due={d.dueDate} status={d.status} lang={lang} />
                                <span className="text-[11px] text-slate-500 tabular-nums">{d.progress ?? 0}%</span>
                              </span>
                            </div>
                            {d.title && <p className="text-slate-600 text-[11px] mt-0.5">{d.title}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The action's own history — every status move and note */}
                  {!!a.updates?.length && (
                    <div className="mt-2.5 border-t border-slate-100 pt-2.5 space-y-1">
                      {a.updates.slice().reverse().slice(0, 8).map((u: any, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 text-[11px]">
                          <MessageSquare className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
                          <span className="flex-1">
                            <span className="text-slate-700 font-medium">{u.byName}</span>
                            {u.statusTo && (
                              <span className="text-slate-400">
                                {' · '}{vocabLabel(meta.actionStatuses, u.statusFrom, lang)} → {vocabLabel(meta.actionStatuses, u.statusTo, lang)}
                              </span>
                            )}
                            {u.text && <span className="block text-slate-600">{u.text}</span>}
                          </span>
                          <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(u.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-400 text-sm">{t('No actions were recorded for this meeting.', 'لم تُسجَّل بنود تنفيذية لهذا الاجتماع.')}</p>
        )}
      </div>

      {/* Everything above, on headed paper, ready to sign and file. */}
      <div className="bg-slate-900 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm">{t('Official minutes', 'المحضر الرسمي')}</p>
          <p className="text-slate-400 text-xs mt-0.5">
            {t('This whole record as a PDF on the company letterhead, with signature lines.',
               'كل ما سبق في ملف PDF على ترويسة الشركة، مع خانات التوقيع.')}
          </p>
        </div>
        <button type="button" onClick={onPrint} disabled={printing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#d95f14] disabled:opacity-60 shrink-0">
          {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          {t('Download the minutes (PDF)', 'تحميل المحضر (PDF)')}
        </button>
      </div>
    </div>
  );
}

// ── الأجندة والحضور ─────────────────────────────────────────────────────────
function AgendaTab({ meeting, meta, lang, canEdit, onAttendance }: any) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  // Which row is having a reason typed into it, and what has been typed.
  const [excusing, setExcusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const MARKS = ATTENDANCE.filter((a) => a.key !== 'invited');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">{t('Attendees', 'الحاضرون')}</h3>
        <div className="divide-y divide-slate-100">
          {(meeting.attendees || []).map((a: any) => (
            <div key={a.user} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-slate-900 text-sm font-medium flex items-center gap-1.5">
                    {a.name}
                    {a.isChair && <Crown className="w-3.5 h-3.5 text-[#f37121]" />}
                  </p>
                  <p className="text-slate-400 text-[11px]">{a.department || deptLabel(a.role, lang)}</p>
                </div>
                {canEdit ? (
                  <div className="flex gap-1 shrink-0">
                    {MARKS.map((m) => {
                      const on = a.attendance === m.key;
                      const Icon = m.key === 'attended' ? UserCheck : UserX;
                      return (
                        <button key={m.key} type="button"
                          title={lang === 'ar' ? m.ar : m.en}
                          onClick={() => {
                            // Absent/excused wants a reason — ask for it inline
                            // rather than losing "why" from the record.
                            if (m.key !== 'attended') {
                              setExcusing(a.user);
                              setReason(a.excuseReason || '');
                              onAttendance(a.user, m.key, a.excuseReason || '');
                            } else {
                              setExcusing(null);
                              onAttendance(a.user, m.key, '');
                            }
                          }}
                          className={`p-1.5 rounded-lg border ${on ? 'border-slate-300 bg-slate-100' : 'border-transparent'} hover:bg-slate-50`}
                          style={{ color: on ? m.color : '#cbd5e1' }}>
                          <Icon className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: `${attendanceColor(a.attendance)}1f`, color: attendanceColor(a.attendance) }}>
                    {attendanceLabel(a.attendance, lang)}
                  </span>
                )}
              </div>

              {a.attendanceAt && (
                <p className="text-slate-400 text-[10px] mt-1">
                  {attendanceLabel(a.attendance, lang)} · {fmtDateTime(a.attendanceAt)}
                  {a.attendanceByName ? ` · ${t('by', 'سجّله')} ${a.attendanceByName}` : ''}
                </p>
              )}

              {canEdit && excusing === a.user && a.attendance !== 'attended' && (
                <div className="flex gap-2 mt-1.5">
                  <input value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder={t('Reason for the absence…', 'سبب الغياب أو الاعتذار…')}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800" />
                  <button type="button"
                    onClick={() => { onAttendance(a.user, a.attendance, reason); setExcusing(null); }}
                    className="bg-[#f37121] text-white text-xs rounded-lg px-3">{t('Save', 'حفظ')}</button>
                </div>
              )}
              {a.excuseReason && excusing !== a.user && (
                <p className="text-slate-600 text-[11px] mt-1 bg-slate-50 rounded px-2 py-1">{a.excuseReason}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold inline-block mb-3">{t('Agenda', 'جدول الأعمال')}</h3>
        {meeting.agenda?.length ? (
          <ol className="space-y-2">
            {meeting.agenda.map((a: any, i: number) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#f37121]/10 text-[#f37121] text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span>
                  <span className="block text-slate-800 text-sm">{a.title}</span>
                  {(a.department || a.presenterName) && (
                    <span className="block text-slate-400 text-[11px]">
                      {[a.presenterName, a.department ? deptLabel(a.department, lang) : ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-slate-400 text-sm">{t('No agenda was set.', 'لم يتم تحديد جدول أعمال.')}</p>
        )}
        {meeting.summary && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">{t('Summary', 'الخلاصة')}</p>
            <p className="text-slate-800 text-sm whitespace-pre-wrap">{meeting.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── محضر الاجتماع ───────────────────────────────────────────────────────────
function MinutesTab({ meeting, meta, lang, canWrite, onSaved, notify }: any) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const [rows, setRows] = useState<any[]>(
    meeting.minutes?.length ? meeting.minutes : (canWrite ? [{ heading: '', body: '', department: '' }] : [])
  );
  const [summary, setSummary] = useState(meeting.summary || '');
  const [busy, setBusy] = useState(false);

  const set = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    setBusy(true);
    try {
      const r = await brSaveMinutes(meeting._id, {
        summary,
        minutes: rows.filter((x) => (x.heading || '').trim() || (x.body || '').trim()),
      });
      onSaved(r.meeting);
    } catch (e: any) { notify(e?.message || t('Failed to save', 'تعذّر الحفظ'), 'error'); }
    setBusy(false);
  };

  if (!canWrite) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        {meeting.summary && (
          <div>
            <p className="text-slate-500 text-[11px] uppercase tracking-wide mb-1">{t('Summary', 'الخلاصة')}</p>
            <p className="text-slate-800 text-sm whitespace-pre-wrap">{meeting.summary}</p>
          </div>
        )}
        {meeting.minutes?.length ? meeting.minutes.map((m: any, i: number) => (
          <div key={i} className="border-t border-slate-100 pt-3">
            <p className="text-slate-900 font-semibold text-sm">
              {m.heading}
              {m.department && <span className="text-slate-400 font-normal text-[11px] ms-2">{m.department}</span>}
            </p>
            <p className="text-slate-700 text-sm mt-1 whitespace-pre-wrap">{m.body}</p>
          </div>
        )) : (
          <p className="text-slate-400 text-sm">{t('The minutes have not been written yet.', 'لم يُكتب المحضر بعد.')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold">{t('Write the minutes', 'كتابة المحضر')}</h3>
        <button type="button" disabled={busy} onClick={save}
          className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-3.5 py-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('Save minutes', 'حفظ المحضر')}
        </button>
      </div>

      <label className="block">
        <span className="text-xs text-slate-600">{t('Summary', 'الخلاصة')}</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2}
          placeholder={t('One or two lines on what this round was about', 'سطر أو سطران عن موضوع هذا الاجتماع')}
          className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
      </label>

      {rows.map((r, i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input value={r.heading || ''} onChange={(e) => set(i, 'heading', e.target.value)}
              placeholder={t('Topic', 'الموضوع')}
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 font-medium" />
            <select value={r.department || ''} onChange={(e) => set(i, 'department', e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 max-w-[180px]">
              <option value="">{t('Department…', 'القسم…')}</option>
              {meta?.departments.map((d: string) => <option key={d} value={d}>{deptLabel(d, lang)}</option>)}
            </select>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                className="text-red-500 px-2 text-sm">×</button>
            )}
          </div>
          <textarea value={r.body || ''} onChange={(e) => set(i, 'body', e.target.value)} rows={4}
            placeholder={t('What was discussed and decided…', 'ما تمت مناقشته والقرارات…')}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
        </div>
      ))}

      <button type="button" onClick={() => setRows((x) => [...x, { heading: '', body: '', department: '' }])}
        className="text-[#f37121] text-sm hover:underline">+ {t('Add a topic', 'إضافة موضوع')}</button>

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        {t('Minutes record the discussion. Anything somebody must DO belongs in Actions, where it gets an owner and a due date.',
          'المحضر يسجّل النقاش. أي شيء مطلوب تنفيذه يُسجَّل في «البنود التنفيذية» ليكون له مكلَّف وموعد تسليم.')}
      </p>
    </div>
  );
}

// ── البنود التنفيذية ────────────────────────────────────────────────────────
function ActionsTab({ meeting, meta, actions, lang, canRaise, onChanged, notify }: any) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', assignee: '', raisedBy: '',
    department: meeting.departments?.[0] || '', dueDate: '', priority: 'high',
  });

  // An action lands on someone who was in the room.
  const owners = (meeting.attendees || []).map((a: any) => ({ _id: a.user, name: a.name, role: a.role, department: a.department }));
  // …but the person who ASKED for it may not have been. The GM is usually the
  // one making the request and often can't attend every round, so the "requested
  // by" picker is attendees PLUS the board — never just whoever showed up.
  const requesters = [
    ...owners,
    ...(meta.participants || [])
      .filter((p: any) => p.isExecutive && !owners.some((o: any) => o._id === p._id))
      .map((p: any) => ({ ...p, offRoster: true })),
  ];

  const submit = async () => {
    if (!form.title.trim() || !form.assignee) {
      notify(t('A title and an owner are required', 'عنوان البند والمكلَّف مطلوبان'), 'error');
      return;
    }
    setBusy(true);
    try {
      await brCreateAction(meeting._id, { ...form, title: form.title.trim() });
      setForm({ ...form, title: '', description: '', dueDate: '' });
      setAdding(false);
      onChanged();
    } catch (e: any) { notify(e?.message || t('Failed', 'فشل'), 'error'); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      {canRaise && !adding && (
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-3.5 py-2">
          <Plus className="w-4 h-4" />{t('Record an action', 'تسجيل بند تنفيذي')}
        </button>
      )}

      {adding && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-slate-900 font-semibold text-sm">{t('New action', 'بند تنفيذي جديد')}</p>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('What must be done? *', 'ما المطلوب تنفيذه؟ *')}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
            placeholder={t('Detail (optional)', 'تفاصيل (اختياري)')}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <span className="text-[11px] text-slate-500">{t('Owner *', 'المكلَّف *')}</span>
              <div className="mt-1">
                <PersonSelect people={owners} value={form.assignee} lang={lang}
                  placeholder={t('Pick an attendee…', 'اختر من الحاضرين…')}
                  onChange={(id) => setForm({ ...form, assignee: id })} />
              </div>
            </div>
            <div>
              <span className="text-[11px] text-slate-500">{t('Requested by', 'بطلب من')}</span>
              <div className="mt-1">
                <PersonSelect people={requesters} value={form.raisedBy} lang={lang}
                  placeholder={t('Who asked for it…', 'من طلب هذا البند…')}
                  onChange={(id) => setForm({ ...form, raisedBy: id })} />
              </div>
            </div>
            <label className="block">
              <span className="text-[11px] text-slate-500">{t('Due date', 'موعد التسليم')}</span>
              <input type="date" value={form.dueDate} min={isoDay(new Date())}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">{t('Priority', 'الأولوية')}</span>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800">
                {meta.priorities.map((p: any) => <option key={p.key} value={p.key}>{lang === 'ar' ? p.ar : p.en}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={submit}
              className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {t('Add action', 'إضافة البند')}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 px-2">{t('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      )}

      {actions.map((a: BrAction) => (
        <ActionCard
          key={a._id} action={a} meta={meta} lang={lang}
          canEdit={canRaise}
          canDelegate={a.assignee === meta.me._id || meta.me.canRunMeetings}
          people={meta.people.filter((p: any) => p._id !== meta.me._id)}
          onUpdate={async (v) => { await brUpdateAction(a._id, v); onChanged(); }}
          onDelegate={async (rows) => { await brDelegate(a._id, rows); onChanged(); }}
          onDelete={canRaise ? async () => { await brDeleteAction(a._id); onChanged(); } : undefined}
        />
      ))}

      {!actions.length && !adding && (
        <p className="text-slate-400 text-sm text-center py-10">
          {t('No actions were recorded for this meeting.', 'لم تُسجَّل بنود تنفيذية لهذا الاجتماع.')}
        </p>
      )}
    </div>
  );
}
