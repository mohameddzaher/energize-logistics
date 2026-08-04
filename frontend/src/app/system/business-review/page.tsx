'use client';
// اجتماعات مراجعة الأعمال — the meetings list, and the section's front door.
//
// What you see depends on who you are, and the page says so rather than showing
// an empty screen: the board and the secretariat see every round, a department
// manager sees the rounds they sat in, and an employee is pointed at their own
// delegated work — which is all they have here by design.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  CalendarDays, Plus, Users, MapPin, Loader2, Search, ClipboardList,
  AlertTriangle, CheckCircle2, ArrowRight, X,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { KpiTile } from '@/components/system/Scorecard';
import { StatusPill } from '@/components/system/BusinessReviewKit';
import {
  brMeta, brMeetings, brCreateMeeting, brDashboard, MEETING_BUCKETS,
  type BrMeta, type BrMeeting, type Lang,
  vocabLabel, fmtDateTime, isoDay, tx, deptLabel,
} from '@/lib/businessReview';

export default function BusinessReviewPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const L = lang as Lang;
  const t = (en: string, ar: string) => tx(L, en, ar);

  const [meta, setMeta] = useState<BrMeta | null>(null);
  const [meetings, setMeetings] = useState<BrMeeting[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [participant, setParticipant] = useState(true);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cadence, setCadence] = useState('');
  const [status, setStatus] = useState('');
  // الوعاء اللي البطاقات بتوديك عليه — «مكتملة» / «لسه مفتوحة» / «قادمة» / «ملغاة».
  const [bucket, setBucket] = useState('');
  const [counts, setCounts] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, list, d] = await Promise.all([
        brMeta().catch(() => null),
        brMeetings({ cadence, status, bucket }).catch(() => ({ meetings: [], canRunMeetings: false, participant: false } as any)),
        brDashboard().catch(() => null),
      ]);
      if (m) setMeta(m);
      setMeetings(list.meetings || []);
      if (list.counts) setCounts(list.counts);
      setParticipant(list.participant !== false);
      setDash(d);
    } catch { /* keep whatever was on screen */ }
    setLoading(false);
  }, [cadence, status, bucket]);
  useEffect(() => { load(); }, [load]);
  useSocket('br:meeting', load);
  useSocket('br:action', load);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return meetings;
    return meetings.filter((m) => `${m.title} ${m.refNumber} ${m.location || ''}`.toLowerCase().includes(s));
  }, [meetings, q]);

  if (loading) return <Spinner />;

  // ── An employee's front door: their own work, nothing else ────────────────
  if (!participant) {
    return (
      <div className="space-y-5">
        <PageHeader
          icon={<CalendarDays className="w-5 h-5 text-[#f37121]" />}
          title={t('Business Review', 'مراجعة الأعمال')}
        />
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-slate-700 text-sm mt-3 font-medium">
            {t('Your tasks from the review meetings are here.', 'المهام المُسندة إليك من اجتماعات المراجعة تظهر هنا.')}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            {t('The meetings themselves are between the department heads and the board.',
              'الاجتماعات نفسها تخص مديري الأقسام والإدارة.')}
          </p>
          {dash?.mine?.tasks && (
            <div className="flex justify-center gap-3 mt-4">
              <span className="text-xs text-slate-600">{t('Open', 'مفتوحة')}: <b>{dash.mine.tasks.open}</b></span>
              <span className="text-xs text-red-600">{t('Overdue', 'متأخرة')}: <b>{dash.mine.tasks.overdue}</b></span>
              <span className="text-xs text-green-600">{t('Done', 'منجزة')}: <b>{dash.mine.tasks.done}</b></span>
            </div>
          )}
          <button type="button" onClick={() => router.push('/system/business-review/my-tasks')}
            className="mt-5 inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-4 py-2">
            {t('Open my tasks', 'فتح مهامي')}<ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    );
  }

  const canRun = !!meta?.me?.canRunMeetings;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<CalendarDays className="w-5 h-5 text-[#f37121]" />}
        title={t('Business Review Meetings', 'اجتماعات مراجعة الأعمال')}
        subtitle={t(
          'The standing forum between the department heads and the board — minutes, decisions and the actions they produce.',
          'المنتدى الدوري بين مديري الأقسام والإدارة — المحاضر والقرارات والبنود التنفيذية الناتجة عنها.'
        )}
      >
        {canRun && (
          <button type="button" onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-3.5 py-2">
            <Plus className="w-4 h-4" />{t('Schedule a meeting', 'جدولة اجتماع')}
          </button>
        )}
      </PageHeader>

      {/* Meetings first, then what I owe. A freshly-scheduled meeting used to
          leave every tile on zero, because they all counted ACTIONS. */}
      {dash?.mine && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiTile label={t('My meetings', 'اجتماعاتي')} value={dash.mine.meetings?.total ?? 0}
            accent="#6366f1"
            sub={`${dash.mine.meetings?.upcoming ?? 0} ${t('upcoming', 'قادم')} · ${dash.mine.meetings?.held ?? 0} ${t('held', 'انعقد')}`}
            icon={<CalendarDays className="w-4 h-4" />} />
          <KpiTile label={t('My open actions', 'بنودي المفتوحة')} value={dash.mine.actions.open}
            accent="#0ea5e9" sub={`${dash.mine.actions.done} ${t('completed', 'منجز')}`}
            icon={<ClipboardList className="w-4 h-4" />} />
          <KpiTile label={t('My overdue', 'المتأخر عليّ')} value={dash.mine.actions.overdue}
            accent="#ef4444" icon={<AlertTriangle className="w-4 h-4" />} />
          <KpiTile label={t('Tasks given to me', 'مهام مُسندة إليّ')} value={dash.mine.tasks.open}
            accent="#f37121" sub={`${dash.mine.tasks.overdue} ${t('overdue', 'متأخرة')}`}
            icon={<Users className="w-4 h-4" />} />
          {dash.overview
            ? <KpiTile label={t('Company completion', 'نسبة الإنجاز العامة')} value={`${dash.overview.completionRate}%`}
                accent="#16a34a" sub={`${dash.overview.open} ${t('open', 'مفتوح')} · ${dash.overview.overdue} ${t('overdue', 'متأخر')}`}
                icon={<CheckCircle2 className="w-4 h-4" />} />
            : <KpiTile label={t('My completed', 'أنجزتها')} value={dash.mine.actions.done}
                accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />}
        </div>
      )}

      {!!dash?.upcoming?.length && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-700 text-xs font-semibold mb-2">{t('Coming up', 'اجتماعات قادمة')}</p>
          <div className="flex flex-wrap gap-2">
            {dash.upcoming.map((m: any) => (
              <button key={m._id} type="button" onClick={() => router.push(`/system/business-review/${m._id}`)}
                className="text-start bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 hover:border-[#f37121]">
                <span className="block text-slate-900 text-xs font-semibold">{m.title}</span>
                <span className="block text-slate-500 text-[11px]">
                  {fmtDateTime(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* بطاقات بتفلتر — تدوس على «مكتملة» تشوف المكتملة بس. الأرقام محسوبة على
          كل اجتماعاتك مش على الصفحة المعروضة، فهي بتوصف الشغل مش الفلتر. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {MEETING_BUCKETS.map((b) => {
          const active = bucket === b.key;
          const n = counts ? (counts as any)[b.countKey] ?? 0 : 0;
          return (
            <button key={b.key || 'all'} type="button"
              onClick={() => { setBucket(b.key); setStatus(''); }}
              className={`text-start rounded-xl border p-3 transition-colors ${
                active ? 'bg-white border-[#f37121] shadow-sm ring-1 ring-[#f37121]/30' : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
              <span className="block text-2xl font-extrabold leading-none" style={{ color: b.color }}>{n}</span>
              <span className="block text-[11px] text-slate-500 mt-1.5">{lang === 'ar' ? b.ar : b.en}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search meetings…', 'ابحث في الاجتماعات…')}
            className="w-full ps-8 pe-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
        </div>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)}
          className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700">
          <option value="">{t('All cadences', 'كل الدورات')}</option>
          {meta?.cadences.map((c) => <option key={c.key} value={c.key}>{lang === 'ar' ? c.ar : c.en}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value) setBucket(''); }}
          className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700">
          <option value="">{t('All statuses', 'كل الحالات')}</option>
          {meta?.meetingStatuses.map((c) => <option key={c.key} value={c.key}>{lang === 'ar' ? c.ar : c.en}</option>)}
        </select>
        {(bucket || status || cadence) && (
          <button type="button" onClick={() => { setBucket(''); setStatus(''); setCadence(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 hover:text-slate-800">
            {t('Clear', 'إلغاء الفلترة')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map((m) => (
          <button key={m._id} type="button" onClick={() => router.push(`/system/business-review/${m._id}`)}
            className="text-start bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-slate-900 font-semibold text-sm">{m.title}</p>
                <p className="text-slate-400 text-[11px] mt-0.5">{m.refNumber}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {vocabLabel(meta?.cadences, m.cadence, L)}
                </span>
                <StatusPill statuses={meta?.meetingStatuses} value={m.status} lang={L} />
              </div>
            </div>
            <p className="text-slate-600 text-xs mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-slate-400" />{fmtDateTime(m.scheduledAt)}</span>
              {m.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{m.location}</span>}
              <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-slate-400" />{m.attendees?.length || 0}</span>
            </p>
            {!!m.departments?.length && (
              <div className="flex flex-wrap gap-1 mt-2">
                {m.departments.slice(0, 5).map((d) => (
                  <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{deptLabel(d, L)}</span>
                ))}
              </div>
            )}
            {!!m.actions?.total && (
              <p className="text-[11px] mt-2">
                <span className="text-slate-500">{t('Actions', 'البنود')}: </span>
                <span className="text-slate-900 font-semibold">{m.actions.total}</span>
                {m.actions.open > 0 && <span className="text-amber-600"> · {m.actions.open} {t('still open', 'مفتوح')}</span>}
              </p>
            )}
          </button>
        ))}
        {!filtered.length && (
          <p className="text-slate-400 text-sm text-center py-12 lg:col-span-2">
            {t('No meetings yet.', 'لا توجد اجتماعات بعد.')}
          </p>
        )}
      </div>

      {showNew && meta && (
        <NewMeetingModal meta={meta} lang={L} onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); load(); router.push(`/system/business-review/${id}`); }}
          notify={notify} />
      )}
    </div>
  );
}

function NewMeetingModal({
  meta, lang, onClose, onCreated, notify,
}: {
  meta: BrMeta; lang: Lang; onClose: () => void;
  onCreated: (id: string) => void; notify: (m: string, t?: any) => void;
}) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const now = new Date();
  const [form, setForm] = useState({
    title: '', cadence: 'weekly',
    date: isoDay(now), time: '10:00',
    durationMinutes: 60, location: '', meetingLink: '',
  });
  const [departments, setDepartments] = useState<string[]>([]);
  // The board (the GM) is in the room by default — they are who most actions
  // come from, and having to remember to tick them every week is how they end
  // up missing from the record.
  const execIds = meta.participants.filter((p) => p.isExecutive).map((p) => p._id);
  const [attendees, setAttendees] = useState<string[]>(execIds);
  const [chair, setChair] = useState(execIds[0] || '');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [agenda, setAgenda] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    if (!form.title.trim()) { notify(t('A title is required', 'العنوان مطلوب'), 'error'); return; }
    if (!attendees.length) { notify(t('Invite at least one person', 'أضف حاضرًا واحدًا على الأقل'), 'error'); return; }
    setBusy(true);
    try {
      const r = await brCreateMeeting({
        title: form.title.trim(),
        cadence: form.cadence,
        scheduledAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
        durationMinutes: Number(form.durationMinutes) || 60,
        location: form.location, meetingLink: form.meetingLink,
        departments,
        attendees: attendees.map((id) => ({ user: id, isChair: id === chair })),
        agenda: agenda.filter((a) => a.trim()).map((a, i) => ({ title: a.trim(), order: i })),
      });
      onCreated(r.meeting._id);
    } catch (e: any) {
      notify(e?.message || t('Could not create the meeting', 'تعذّر إنشاء الاجتماع'), 'error');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-slate-900 font-bold">{t('Schedule a review meeting', 'جدولة اجتماع مراجعة')}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">{t('Title *', 'عنوان الاجتماع *')}</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('e.g. Weekly business review', 'مثال: اجتماع مراجعة الأعمال الأسبوعي')}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
          </label>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">{t('Cadence', 'الدورة')}</span>
              <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}
                className="w-full mt-1 px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800">
                {meta.cadences.map((c) => <option key={c.key} value={c.key}>{lang === 'ar' ? c.ar : c.en}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">{t('Date', 'التاريخ')}</span>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full mt-1 px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">{t('Time', 'الوقت')}</span>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="w-full mt-1 px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">{t('Minutes', 'المدة (دقيقة)')}</span>
              <input type="number" min={15} step={15} value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                className="w-full mt-1 px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">{t('Location', 'المكان')}</span>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">{t('Meeting link', 'رابط الاجتماع')}</span>
              <input value={form.meetingLink} onChange={(e) => setForm({ ...form, meetingLink: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
          </div>

          <div>
            <p className="text-xs text-slate-600 mb-1.5">{t('Departments covered', 'الأقسام المشمولة')}</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {meta.departments.map((d) => (
                <button key={d} type="button" onClick={() => toggle(departments, setDepartments, d)}
                  className={`text-[11px] px-2 py-1 rounded-lg border ${departments.includes(d)
                    ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
                  {deptLabel(d, lang)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-600 mb-1.5">
              {t('Attendees *', 'الحاضرون *')}
              <span className="text-slate-400"> — {t('department heads and the board', 'مديرو الأقسام والإدارة')}</span>
            </p>
            <div className="relative mb-1.5">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-slate-400" />
              <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)}
                placeholder={t('Search by name, department or role…', 'ابحث بالاسم أو القسم أو المسمى…')}
                className="w-full ps-8 pe-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
            </div>
            <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-slate-100">
              {meta.participants.filter((p) => {
                const q2 = peopleQuery.trim().toLowerCase();
                // Somebody already ticked stays visible, or a search would seem
                // to un-invite them.
                if (attendees.includes(p._id)) return true;
                return !q2 || `${p.name} ${p.department || ''} ${p.jobTitle || ''} ${p.role}`.toLowerCase().includes(q2);
              }).map((p) => (
                <label key={p._id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={attendees.includes(p._id)}
                    onChange={() => toggle(attendees, setAttendees, p._id)} className="accent-[#f37121]" />
                  <span className="flex-1 text-sm text-slate-800">
                    {p.name}
                    {p.isExecutive && <span className="text-[10px] text-[#f37121] ms-1.5">{t('Board', 'الإدارة')}</span>}
                  </span>
                  <span className="text-[11px] text-slate-400">{p.department || deptLabel(p.role, lang)}</span>
                  {attendees.includes(p._id) && (
                    <button type="button" onClick={(e) => { e.preventDefault(); setChair(chair === p._id ? '' : p._id); }}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${chair === p._id ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {t('Chair', 'رئيس الاجتماع')}
                    </button>
                  )}
                </label>
              ))}
              {!meta.participants.length && (
                <p className="px-3 py-3 text-xs text-slate-400">{t('No department heads found.', 'لا يوجد مديرو أقسام.')}</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-600 mb-1.5">{t('Agenda', 'جدول الأعمال')}</p>
            <div className="space-y-1.5">
              {agenda.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input value={a} onChange={(e) => setAgenda((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder={`${t('Item', 'بند')} ${i + 1}`}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
                  {agenda.length > 1 && (
                    <button type="button" onClick={() => setAgenda((x) => x.filter((_, j) => j !== i))}
                      className="text-red-500 text-xs px-2">×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setAgenda((x) => [...x, ''])}
                className="text-[#f37121] text-xs hover:underline">+ {t('Add item', 'إضافة بند')}</button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button type="button" onClick={onClose} className="text-slate-500 text-sm px-3 py-2">{t('Cancel', 'إلغاء')}</button>
          <button type="button" disabled={busy} onClick={submit}
            className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('Schedule', 'جدولة')}
          </button>
        </div>
      </div>
    </div>
  );
}
