'use client';
/**
 * خطّةُ العمل (JP) — شاشةٌ واحدةٌ للقسم ولخطّة الإدارة.
 *
 * ── سطرٌ واحدٌ يكفي ────────────────────────────────────────────────────────
 * المهمّةُ تُكتب في سطر: ما المطلوب، ومن ينفّذه، ومتى. وكلُّ ما عدا ذلك
 * (التفاصيل، طريقةُ التواصل، المشروع، المرفق) اختياريٌّ ومطويّ — يُفتَح لمن
 * يحتاجه ولا يقف في طريق من لا يحتاجه.
 *
 * ── والصلاحيّةُ من الخادم ──────────────────────────────────────────────────
 * كلُّ مهمّةٍ تحمل `can` (أيُّ الأزرار يجوز)، و`/me` تقول أهو مديرٌ أم عضو.
 * فلا قائمةَ أدوارٍ هنا: ما يُعرَض هو ما يقبله الخادم.
 *
 * ── والمكوِّناتُ الفرعيّةُ خارج جسم الرسم ─────────────────────────────────
 * مكوِّنٌ يُعرَّف داخل الرسم يُهدَم ويُبنى مع كلّ ضغطة مفتاح فتضيع الكتابة.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import {
  type JpScope, type JpMe, type JpTask, type JpProject, type JpAction,
  ACTION_WORDS, deadlineLine, TONE_CLASS, fileToDataUrl, contactHref, qs, jpId,
} from '@/lib/jp';
import { Spinner, PageHeader, Modal, Field, TextInput, TextArea, Select, PrimaryButton } from '@/components/hr/HRKit';
import {
  CalendarCheck, Plus, Check, Paperclip, Trash2, Pencil, FolderKanban, Clock, ChevronDown,
  Phone, MessageCircle, MapPin, Mail, Users, MoreHorizontal, X, Send, CornerDownLeft, Loader2, MessageSquare, ArrowRight, ArrowLeft,
} from 'lucide-react';

const ACTION_ICON: Record<string, React.ReactNode> = {
  call: <Phone className="w-3.5 h-3.5" />, whatsapp: <MessageCircle className="w-3.5 h-3.5" />,
  visit: <MapPin className="w-3.5 h-3.5" />, email: <Mail className="w-3.5 h-3.5" />,
  meeting: <Users className="w-3.5 h-3.5" />, other: <MoreHorizontal className="w-3.5 h-3.5" />,
};

/** الموعدُ كما يختاره من يكتب: بلا موعد، أو بيوم، أو بساعات. */
interface Due { kind: '' | 'date' | 'hours'; date: string; hours: string }
const NO_DUE: Due = { kind: '', date: '', hours: '' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dueBody = (d: Due) => (d.kind === 'date' ? { deadlineKind: 'date', deadlineDate: d.date }
  : d.kind === 'hours' ? { deadlineKind: 'hours', deadlineHours: Number(d.hours) } : { deadlineKind: '' });

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors whitespace-nowrap ${
        on ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
      {children}
    </button>
  );
}

/** اختيارُ الموعد بضغطة: اليوم، غدًا، بعد ساعة… أو تاريخٌ وعددُ ساعاتٍ بعينهما. */
function DuePicker({ value, onChange, ar }: { value: Due; onChange: (d: Due) => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const isHours = (h: string) => value.kind === 'hours' && value.hours === h;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip on={value.kind === ''} onClick={() => onChange(NO_DUE)}>{t('بلا موعد', 'No deadline')}</Chip>
      {['1', '2', '4', '8'].map((h) => (
        <Chip key={h} on={isHours(h)} onClick={() => onChange({ kind: 'hours', date: '', hours: h })}>
          {t(h === '1' ? 'خلال ساعة' : h === '2' ? 'خلال ساعتين' : `خلال ${h} ساعات`, `In ${h}h`)}
        </Chip>
      ))}
      <Chip on={value.kind === 'date' && value.date === today} onClick={() => onChange({ kind: 'date', date: today, hours: '' })}>{t('اليوم', 'Today')}</Chip>
      <Chip on={value.kind === 'date' && value.date === tomorrow} onClick={() => onChange({ kind: 'date', date: tomorrow, hours: '' })}>{t('غدًا', 'Tomorrow')}</Chip>
      <input type="date" value={value.kind === 'date' ? value.date : ''} min={today}
        onChange={(e) => onChange(e.target.value ? { kind: 'date', date: e.target.value, hours: '' } : NO_DUE)}
        className="px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[12.5px] text-slate-700" aria-label={t('تاريخ الموعد', 'Deadline date')} />
      <span className="inline-flex items-center gap-1 text-[12.5px] text-slate-500">
        <input type="number" min={1} max={720} inputMode="numeric" placeholder={t('ساعات', 'hours')}
          value={value.kind === 'hours' && !['1', '2', '4', '8'].includes(value.hours) ? value.hours : ''}
          onChange={(e) => onChange(e.target.value ? { kind: 'hours', date: '', hours: e.target.value } : NO_DUE)}
          className="w-20 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700" aria-label={t('عدد الساعات', 'Hours')} />
      </span>
    </div>
  );
}

interface Draft {
  title: string; assignedTo: string; due: Due; details: string; action: JpAction; contact: string; project: string;
  files: { dataUrl: string; fileName: string }[];
}
const blankDraft = (assignedTo = '', project = ''): Draft => ({
  title: '', assignedTo, due: NO_DUE, details: '', action: '', contact: '', project, files: [],
});

/** حقولُ «تفاصيل أكثر» — يقرؤها سطرُ الإضافة ونافذةُ التعديل. */
function MoreFields({ d, set, projects, ar, allowFiles }: {
  d: Draft; set: (p: Partial<Draft>) => void; projects: JpProject[]; ar: boolean; allowFiles: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const pick = async (list: FileList | null) => {
    if (!list) return;
    const got = await Promise.all([...list].slice(0, 5).map(fileToDataUrl));
    set({ files: [...d.files, ...got].slice(0, 5) });
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label={t('تفاصيل (اختياري)', 'Details (optional)')} span2>
        <TextArea rows={2} value={d.details} onChange={(e) => set({ details: e.target.value })} placeholder={t('ما المطلوب بالتحديد؟', 'What exactly is needed?')} />
      </Field>
      <Field label={t('طريقة التواصل (اختياري)', 'Contact method (optional)')}>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ACTION_WORDS) as Exclude<JpAction, ''>[]).map((k) => (
            <Chip key={k} on={d.action === k} onClick={() => set({ action: d.action === k ? '' : k })}>
              <span className="inline-flex items-center gap-1">{ACTION_ICON[k]}{ar ? ACTION_WORDS[k].ar : ACTION_WORDS[k].en}</span>
            </Chip>
          ))}
        </div>
      </Field>
      <Field label={t('مع مَن؟ اسمٌ أو رقم (اختياري)', 'With whom? name or number (optional)')}>
        <TextInput value={d.contact} onChange={(e) => set({ contact: e.target.value })} placeholder={t('مثال: مدير مشتريات شركة… · 05XXXXXXXX', 'e.g. Purchasing manager at… · 05XXXXXXXX')} />
      </Field>
      {projects.length > 0 && (
        <Field label={t('المشروع (اختياري)', 'Project (optional)')}>
          <Select value={d.project} onChange={(e) => set({ project: e.target.value })}>
            <option value="">{t('بلا مشروع', 'No project')}</option>
            {projects.filter((p) => p.status === 'active' || p._id === d.project).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
      {allowFiles && (
        <Field label={t('مرفقات (اختياري)', 'Attachments (optional)')}>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:border-[#f37121]">
            <Paperclip className="w-4 h-4" />{t('أرفِق ملفًّا', 'Attach a file')}
            <input type="file" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          </label>
          {d.files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {d.files.map((f, i) => (
                <li key={`${f.fileName}-${i}`} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{f.fileName}</span>
                  <button type="button" onClick={() => set({ files: d.files.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-600" aria-label={t('إزالة', 'Remove')}><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}
    </div>
  );
}

function TaskCard({ task, now, ar, busy, onDone, onReopen, onEdit, onDelete, onAttach, onRemoveFile, onHandDown, onComment, meId }: {
  task: JpTask; now: number; ar: boolean; busy: boolean; meId: string;
  onComment: (t: JpTask, text: string) => Promise<boolean>;
  onDone: (t: JpTask) => void; onReopen: (t: JpTask) => void; onEdit: (t: JpTask) => void; onDelete: (t: JpTask) => void;
  onAttach: (t: JpTask, f: File) => void; onRemoveFile: (t: JpTask, id: string) => void; onHandDown: (t: JpTask) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const dl = deadlineLine(task, now, ar);
  const done = task.status === 'done';
  const href = contactHref(task.action, task.contact);
  const mine = jpId(task.assignedTo) === meId;
  // التعليقاتُ مطويّةٌ حتى تُطلَب — والمكتوبُ حالةُ هذه البطاقة وحدَها.
  const [showComments, setShowComments] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const comments = task.comments || [];
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    if (await onComment(task, text.trim())) setText('');
    setSending(false);
  };
  return (
    <li className={`bg-white border rounded-2xl p-4 shadow-sm transition-colors ${
      task.state === 'overdue' ? 'border-red-200' : done ? 'border-slate-200 opacity-80' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3">
        {/* الإتمامُ بضغطة — ولمن يجوز له وحدَه. */}
        <button type="button" disabled={!task.can.complete || busy}
          onClick={() => (done ? onReopen(task) : onDone(task))}
          title={done ? t('إرجاعها مفتوحة', 'Reopen') : t('تمّت', 'Mark done')}
          className={`mt-0.5 w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
            done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500'} ${
            !task.can.complete ? 'opacity-40 cursor-not-allowed' : ''}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Check className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-[14.5px] font-semibold leading-snug ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{task.title}</p>
            <div className="flex items-center gap-1 shrink-0">
              {task.canHandDown && !done && (
                <button type="button" onClick={() => onHandDown(task)} title={t('إسنادها إلى موظّفٍ في قسمي', 'Assign to someone on my team')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-orange-50"><CornerDownLeft className="w-4 h-4" /></button>
              )}
              {task.can.edit && (
                <button type="button" onClick={() => onEdit(task)} title={t('تعديل', 'Edit')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
              )}
              {task.can.remove && (
                <button type="button" onClick={() => onDelete(task)} title={t('حذف', 'Delete')} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          </div>

          {task.details && <p className="mt-1 text-[13px] text-slate-600 whitespace-pre-wrap">{task.details}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
            <span className={`inline-flex items-center gap-1 ${TONE_CLASS[dl.tone]}`}><Clock className="w-3.5 h-3.5" />{dl.text}</span>
            <span className={`px-2 py-0.5 rounded-full font-medium ${task.kind === 'task' ? 'bg-slate-900 text-white' : 'bg-sky-50 text-sky-700'}`}>
              {task.kind === 'task' ? t('مهمّة', 'Task') : t('طلب', 'Request')}
            </span>
            <span className="text-slate-500">
              {mine ? t(`من ${task.createdByName}`, `From ${task.createdByName}`) : t(`إلى ${task.assignedToName}`, `To ${task.assignedToName}`)}
            </span>
            {task.project && <span className="inline-flex items-center gap-1 text-slate-500"><FolderKanban className="w-3.5 h-3.5" />{task.project.name}</span>}
            {task.fromManagement && <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium">{t('من خطّة الإدارة', 'From management plan')}</span>}
          </div>

          {(task.action || task.contact) && (
            <div className="mt-2 inline-flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[12.5px] text-slate-700">
              {task.action && <span className="inline-flex items-center gap-1 font-semibold">{ACTION_ICON[task.action]}{ar ? ACTION_WORDS[task.action as Exclude<JpAction, ''>].ar : ACTION_WORDS[task.action as Exclude<JpAction, ''>].en}</span>}
              {task.contact && (href
                ? <a href={href} target="_blank" rel="noreferrer" className="text-[#f37121] font-semibold hover:underline"><bdi>{task.contact}</bdi></a>
                : <span><bdi>{task.contact}</bdi></span>)}
            </div>
          )}

          {!!task.handedTo?.length && (
            <p className="mt-2 text-[12px] text-slate-500">
              {t('أُسنِدت في القسم إلى: ', 'Assigned within the section to: ')}
              {task.handedTo.map((h, i) => (
                <span key={h._id} className={h.state === 'done' ? 'text-emerald-700 font-semibold' : h.state === 'overdue' ? 'text-red-600 font-semibold' : 'text-slate-700 font-semibold'}>
                  {i ? '، ' : ''}{h.name} ({h.state === 'done' ? t('تمّت', 'done') : h.state === 'overdue' ? t('متأخّرة', 'late') : t('قائمة', 'open')})
                </span>
              ))}
            </p>
          )}

          {done && task.doneNote && <p className="mt-2 text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap">{task.doneNote}</p>}

          {(task.attachments.length > 0 || task.can.attach) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {task.attachments.map((a) => (
                <span key={a._id} className={`inline-flex items-center gap-1 ps-2 pe-1 py-1 rounded-lg border text-[12px] ${a.phase === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-white border-slate-200 text-slate-700'}`}>
                  <Paperclip className="w-3 h-3" />
                  <a href={a.fileUrl} target="_blank" rel="noreferrer" className="max-w-[160px] truncate hover:underline">{a.fileName || t('ملف', 'File')}</a>
                  {(task.can.edit || a.uploadedBy === meId) && (
                    <button type="button" onClick={() => onRemoveFile(task, a._id)} className="text-slate-400 hover:text-red-600" aria-label={t('حذف المرفق', 'Remove file')}><X className="w-3 h-3" /></button>
                  )}
                </span>
              ))}
              {task.can.attach && (
                <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-slate-300 text-[12px] text-slate-500 cursor-pointer hover:border-[#f37121] hover:text-[#f37121]">
                  <Paperclip className="w-3 h-3" />{t('إرفاق', 'Attach')}
                  <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(task, f); e.target.value = ''; }} />
                </label>
              )}
            </div>
          )}

          {(comments.length > 0 || task.can.comment) && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowComments((v) => !v)}
                className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900">
                <MessageSquare className="w-3.5 h-3.5" />
                {comments.length ? t(`التعليقات (${comments.length})`, `Comments (${comments.length})`) : t('أضف تعليقًا', 'Add a comment')}
              </button>
              {showComments && (
                <div className="mt-2 space-y-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
                  {comments.map((c) => (
                    <div key={c._id} className="text-[12.5px]">
                      <span className="font-semibold text-slate-800">{c.byName}</span>
                      <span className="mx-1.5 text-[11px] text-slate-400">{new Date(c.at).toLocaleString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                      <p className="text-slate-700 whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))}
                  {task.can.comment && (
                    <div className="flex gap-2">
                      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                        placeholder={t('اكتب تعليقًا…', 'Write a comment…')}
                        className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                      <button type="button" onClick={send} disabled={sending || !text.trim()}
                        className="px-3 py-2 rounded-lg bg-slate-900 text-white text-[12.5px] font-semibold disabled:opacity-40">{t('إرسال', 'Send')}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

type Box = 'mine' | 'sent' | 'all';
type Status = '' | 'open' | 'overdue' | 'done';

function JpBoardInner({ scope, section }: { scope: JpScope; section?: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { confirm, notify } = useDialog();
  const q = qs(scope, section);
  // ── المشروعُ صفحةٌ لها رابط ───────────────────────────────────────────────
  // فتحُ مشروعٍ يغيّر الرابط (`?project=`): زرُّ الرجوع يعود منه، والرابطُ يُرسَل.
  const router = useRouter();
  const pathname = usePathname() || '';
  const project = useSearchParams()?.get('project') || '';
  const setProject = useCallback((id: string) => { router.push(id ? `${pathname}?project=${id}` : pathname); }, [router, pathname]);

  const [me, setMe] = useState<JpMe | null>(null);
  const [denied, setDenied] = useState('');
  const [tasks, setTasks] = useState<JpTask[]>([]);
  const [counts, setCounts] = useState({ all: 0, open: 0, overdue: 0, done: 0, mine: 0, sent: 0 });
  const [projects, setProjects] = useState<JpProject[]>([]);
  const [box, setBox] = useState<Box>('mine');
  const [status, setStatus] = useState<Status>('open');
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<JpTask | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft());
  const [doneFor, setDoneFor] = useState<JpTask | null>(null);
  const [doneNote, setDoneNote] = useState('');
  const [doneFile, setDoneFile] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [projForm, setProjForm] = useState<{ _id?: string; name: string; description: string; endDate: string } | null>(null);
  const [handing, setHanding] = useState<{ task?: JpTask; project?: JpProject } | null>(null);
  const [handTo, setHandTo] = useState('');
  // قسمُ المدير الذي يُنزل إليه — يقوله الخادمُ مع مهامّ خطّة الإدارة.
  const [mySection, setMySection] = useState('');
  const [myTeam, setMyTeam] = useState<{ _id: string; name: string; roleAr: string; roleEn: string; isManager?: boolean }[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const { begin, isCurrent } = useLatestRequest();

  // العدُّ التنازليُّ يتحرّك: «بقي ٢٠ د» تصير «بقي ١٩ د» بلا إعادة تحميل.
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let alive = true;
    api.get<JpMe>(`/api/jp/me?${q}`).then((d) => {
      if (!alive) return;
      setMe(d);
      // المديرُ يبدأ على الكلّ: هو يتابع الفريق. والموظّفُ على ما عليه.
      setBox(d.canManage ? 'all' : 'mine');
      setDraft(blankDraft(d.canManage ? '' : d.me));
    }).catch((e: { message?: string }) => { if (alive) { setDenied(e?.message || t('تعذّر التحميل', 'Could not load')); setLoading(false); } });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const load = useCallback(async () => {
    if (!me) return;
    const token = begin();
    try {
      const p = new URLSearchParams(q);
      // داخل المشروع تُعرَض مهامُّه كلُّها (ممّا يراه السائل) لا صندوقٌ منها.
      p.set('box', project ? 'all' : box);
      if (status) p.set('status', status);
      if (project) p.set('project', project);
      if (assignee) p.set('assignee', assignee);
      const [a, b] = await Promise.all([
        api.get<{ tasks: JpTask[]; counts: typeof counts; mySection?: string | null }>(`/api/jp/tasks?${p.toString()}`),
        api.get<{ projects: JpProject[] }>(`/api/jp/projects?${q}`),
      ]);
      if (!isCurrent(token)) return;
      setTasks(a.tasks || []); setCounts(a.counts); setProjects(b.projects || []); setMySection(a.mySection || '');
    } catch (e) {
      if (isCurrent(token)) notify((e as { message?: string })?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally {
      if (isCurrent(token)) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, q, box, status, project, assignee]);
  useEffect(() => { load(); }, [load]);
  // داخل المشروع تُعرَض كلُّ حالاته أوّلًا: ما تمّ جزءٌ من صورته.
  useEffect(() => { setStatus(project ? '' : 'open'); }, [project]);

  // حيّة: أيُّ تغييرٍ في هذه الخطّة يعيد القراءة.
  useSocket('jp:changed', useCallback((d: { scope?: string; section?: string }) => {
    if (!d || (d.scope === scope && (scope === 'management' || d.section === section))) load();
  }, [load, scope, section]));

  const say = (e: unknown) => notify((e as { message?: string })?.message || t('تعذّر الحفظ', 'Could not save'), 'error');
  const patchDraft = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);
  const patchEdit = useCallback((p: Partial<Draft>) => setEditDraft((d) => ({ ...d, ...p })), []);

  const add = async () => {
    if (!me || saving) return;
    if (!draft.title.trim()) { titleRef.current?.focus(); return; }
    if (!draft.assignedTo) { notify(t('اختر من يُسنَد إليه', 'Choose who it is for'), 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/jp/tasks', {
        scope, section, title: draft.title, assignedTo: draft.assignedTo, details: draft.details,
        action: draft.action, contact: draft.contact, project: draft.project || project || undefined,
        files: draft.files, ...dueBody(draft.due),
      });
      // يبقى المُسنَد إليه والمشروع: من يكتب خمسَ مهامَّ لشخصٍ واحد لا يختاره خمسَ مرّات.
      setDraft((d) => ({ ...blankDraft(d.assignedTo, d.project), due: d.due }));
      titleRef.current?.focus();
      load();
    } catch (e) { say(e); } finally { setSaving(false); }
  };

  const startEdit = (task: JpTask) => {
    setEditing(task);
    setEditDraft({
      title: task.title, assignedTo: jpId(task.assignedTo), details: task.details || '', action: task.action,
      contact: task.contact || '', project: task.project?._id || '', files: [],
      due: task.deadlineKind === 'date' && task.deadlineAt ? { kind: 'date', date: ymd(new Date(task.deadlineAt)), hours: '' }
        // موعدٌ بالساعات لا يُعاد عدُّه عند فتح التعديل: يبقى كما هو ما لم يُغيَّر.
        : NO_DUE,
    });
  };
  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const keepHours = editing.deadlineKind === 'hours' && editDraft.due.kind === '';
      await api.patch(`/api/jp/tasks/${editing._id}`, {
        title: editDraft.title, assignedTo: editDraft.assignedTo, details: editDraft.details, action: editDraft.action,
        contact: editDraft.contact, project: editDraft.project || null, ...(keepHours ? {} : dueBody(editDraft.due)),
      });
      setEditing(null); load();
    } catch (e) { say(e); } finally { setSaving(false); }
  };

  const confirmDone = async () => {
    if (!doneFor) return;
    setBusyId(doneFor._id);
    try {
      await api.post(`/api/jp/tasks/${doneFor._id}/done`, { done: true, note: doneNote, file: doneFile || undefined });
      setDoneFor(null); setDoneNote(''); setDoneFile(null); load();
    } catch (e) { say(e); } finally { setBusyId(''); }
  };
  const reopen = async (task: JpTask) => {
    setBusyId(task._id);
    try { await api.post(`/api/jp/tasks/${task._id}/done`, { done: false }); load(); } catch (e) { say(e); } finally { setBusyId(''); }
  };
  const remove = async (task: JpTask) => {
    if (!(await confirm({ message: t(`حذفُ «${task.title}»؟`, `Delete “${task.title}”?`), confirmLabel: t('حذف', 'Delete') }))) return;
    try { await api.delete(`/api/jp/tasks/${task._id}`); load(); } catch (e) { say(e); }
  };
  const attach = async (task: JpTask, file: File) => {
    setBusyId(task._id);
    try { await api.post(`/api/jp/tasks/${task._id}/attachments`, await fileToDataUrl(file)); load(); } catch (e) { say(e); } finally { setBusyId(''); }
  };
  const comment = async (task: JpTask, text: string) => {
    try { await api.post(`/api/jp/tasks/${task._id}/comments`, { text }); load(); return true; } catch (e) { say(e); return false; }
  };
  const removeFile = async (task: JpTask, id: string) => {
    try { await api.delete(`/api/jp/tasks/${task._id}/attachments/${id}`); load(); } catch (e) { say(e); }
  };

  const saveProject = async () => {
    if (!projForm) return;
    setSaving(true);
    try {
      if (projForm._id) await api.patch(`/api/jp/projects/${projForm._id}`, projForm);
      else await api.post('/api/jp/projects', { scope, section, ...projForm });
      setProjForm(null);
      const d = await api.get<JpMe>(`/api/jp/me?${q}`); setMe(d);
      load();
    } catch (e) { say(e); } finally { setSaving(false); }
  };
  const toggleProject = async (p: JpProject) => {
    try { await api.patch(`/api/jp/projects/${p._id}`, { status: p.status === 'active' ? 'closed' : 'active' }); load(); } catch (e) { say(e); }
  };
  const deleteProject = async (p: JpProject) => {
    if (!(await confirm({ message: t(`حذفُ مشروع «${p.name}»؟ مهامُّه تبقى بلا مشروع.`, `Delete project “${p.name}”? Its tasks stay, without a project.`), confirmLabel: t('حذف', 'Delete') }))) return;
    try { await api.delete(`/api/jp/projects/${p._id}`); if (project === p._id) setProject(''); else load(); } catch (e) { say(e); }
  };

  // ── الإنزال: مديرُ القسم يُسند ما كُلِّف به إلى موظّفٍ عنده ───────────────
  const openHand = async (h: { task?: JpTask; project?: JpProject }) => {
    setHanding(h); setHandTo('');
    if (myTeam.length) return;
    try {
      const d = await api.get<JpMe>(`/api/jp/me?scope=section&section=${encodeURIComponent(mySection)}`);
      setMyTeam(d.team.filter((m) => m._id !== d.me));
    } catch (e) { say(e); }
  };
  const doHand = async () => {
    if (!handing || !handTo) return;
    setSaving(true);
    try {
      const r = handing.task
        ? await api.post<{ created: number }>(`/api/jp/tasks/${handing.task._id}/hand-down`, { assignedTo: handTo })
        : await api.post<{ created: number }>(`/api/jp/projects/${handing.project!._id}/hand-down`, { assignedTo: handTo });
      notify(t(`أُسنِدت ${r.created} مهمّةً في قسمك`, `${r.created} task(s) assigned in your section`), 'success');
      setHanding(null); load();
    } catch (e) { say(e); } finally { setSaving(false); }
  };

  const teamOptions = useMemo(() => (me ? me.team : []), [me]);

  if (denied) {
    return <div className="py-20 text-center text-slate-500 text-sm" dir={isRTL ? 'rtl' : 'ltr'}>{denied}</div>;
  }
  if (!me) return <Spinner />;

  const management = scope === 'management';
  const current = project ? projects.find((p) => p._id === project) || null : null;
  // من عليه مهامُّ في المشروع وكم — ممّا يراه السائل.
  const people = current ? [...tasks.reduce((m, x) => m.set(x.assignedToName, (m.get(x.assignedToName) || 0) + 1), new Map<string, number>())] : [];
  const boxes: { key: Box; label: string; n?: number }[] = [
    { key: 'mine', label: t('المُسنَدة إليّ', 'Assigned to me'), n: counts.mine },
    { key: 'sent', label: t('ما أسندتُه', 'Assigned by me'), n: counts.sent },
    ...(me.canManage ? [{ key: 'all' as Box, label: management ? t('كلُّ المديرين', 'All managers') : t('كلُّ الفريق', 'Whole team') }] : []),
  ];
  const whoLabel = me.canManage ? t('إلى مَن؟', 'For whom?') : t('لي أو لزميل', 'Me or a colleague');

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<CalendarCheck className="w-6 h-6 text-[#f37121]" />}
        title={management ? t('خطّة الإدارة', 'Management plan') : t(`خطّة العمل — ${me.sectionAr}`, `Work plan — ${me.sectionEn}`)}
        subtitle={management
          ? t('مهامُّ الإدارة العليا إلى مديري الأقسام، وطلباتُ المديرين فيما بينهم', 'Top management tasks to department heads, and requests between heads')
          : me.canManage ? t('أسنِد المهامَّ إلى فريقك وتابِعها من مكانٍ واحد', 'Assign work to your team and follow it in one place')
            : t('ما أُسنِد إليك، وما تطلبه من نفسك أو من زملائك', 'What is assigned to you, and what you ask of yourself or colleagues')}
      >
        {me.canManage && (
          <button type="button" onClick={() => setProjForm({ name: '', description: '', endDate: '' })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:border-[#f37121]/60">
            <FolderKanban className="w-4 h-4" />{t('مشروع جديد', 'New project')}
          </button>
        )}
      </PageHeader>

      {/* ── سطرُ الإضافة ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row gap-2.5">
          <input ref={titleRef} value={draft.title} onChange={(e) => patchDraft({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={me.canManage ? t('ما المهمّة؟ اكتبها واضغط Enter', 'What is the task? Type and press Enter') : t('ما الطلب؟ اكتبه واضغط Enter', 'What is the request? Type and press Enter')}
            className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          <select value={draft.assignedTo} onChange={(e) => patchDraft({ assignedTo: e.target.value })} aria-label={whoLabel}
            className="lg:w-60 px-3 py-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800">
            <option value="">{whoLabel}</option>
            {!me.canManage && !teamOptions.some((m) => m._id === me.me) && <option value={me.me}>{t('لنفسي', 'Myself')}</option>}
            {teamOptions.map((m) => (
              <option key={m._id} value={m._id}>{m._id === me.me ? t(`${m.name} (أنا)`, `${m.name} (me)`) : `${m.name} — ${ar ? m.roleAr : m.roleEn}`}</option>
            ))}
          </select>
          <PrimaryButton onClick={add} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {me.canManage ? t('إسناد', 'Assign') : t('إرسال', 'Send')}
          </PrimaryButton>
        </div>
        <DuePicker value={draft.due} onChange={(due) => patchDraft({ due })} ar={ar} />
        <button type="button" onClick={() => setMore((v) => !v)} className="inline-flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-slate-900">
          <ChevronDown className={`w-4 h-4 transition-transform ${more ? 'rotate-180' : ''}`} />
          {more ? t('إخفاء التفاصيل', 'Hide details') : t('تفاصيل أكثر: طريقة التواصل، مشروع، مرفق', 'More: contact method, project, attachment')}
        </button>
        {more && <MoreFields d={draft} set={patchDraft} projects={current ? [] : projects} ar={ar} allowFiles />}
        {current && <p className="text-[12px] text-slate-500">{t(`تُضاف إلى مشروع «${current.name}».`, `Added to project “${current.name}”.`)}</p>}
      </div>

      {/* ── صفحةُ المشروع ─────────────────────────────────────────────────── */}
      {current && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <button type="button" onClick={() => setProject('')} className="inline-flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-slate-900">
                {isRTL ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{t('كلُّ المشروعات', 'All projects')}
              </button>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-extrabold text-slate-900">
                <FolderKanban className="w-5 h-5 text-[#f37121]" />{current.name}
                {current.status === 'closed' && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold">{t('مغلق', 'Closed')}</span>}
              </h2>
              {current.description && <p className="mt-1 text-[13px] text-slate-600 whitespace-pre-wrap">{current.description}</p>}
              <p className="mt-1.5 text-[12px] text-slate-500">
                {current.createdByName ? t(`أنشأه ${current.createdByName}`, `Created by ${current.createdByName}`) : ''}
                {current.endDate ? ` · ${t('ينتهي في', 'Ends')} ${new Date(current.endDate).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </p>
            </div>
            {me.canManage && (
              <div className="flex items-center gap-2 text-[12.5px]">
                <button type="button" onClick={() => setProjForm({ _id: current._id, name: current.name, description: current.description || '', endDate: current.endDate ? String(current.endDate).slice(0, 10) : '' })} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-[#f37121]/60">{t('تعديل', 'Edit')}</button>
                <button type="button" onClick={() => toggleProject(current)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-[#f37121]/60">{current.status === 'active' ? t('إغلاق المشروع', 'Close project') : t('إعادة فتح', 'Reopen')}</button>
                <button type="button" onClick={() => deleteProject(current)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">{t('حذف', 'Delete')}</button>
              </div>
            )}
            {management && !me.canManage && !!mySection && (
              <button type="button" onClick={() => openHand({ project: current })} className="px-3 py-1.5 rounded-lg border border-[#f37121]/40 text-[#f37121] text-[12.5px] font-semibold">{t('إسنادُ مهامّي فيه إلى موظّف', 'Assign my tasks to staff')}</button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 rtl:divide-x-reverse">
            {[
              [t('المهامّ', 'Tasks'), String(current.total || 0), 'text-slate-900'],
              [t('تمّت', 'Done'), String(current.done || 0), 'text-emerald-600'],
              [t('متأخّرة', 'Late'), String(current.overdue || 0), current.overdue ? 'text-red-600' : 'text-slate-400'],
              [t('الإنجاز', 'Progress'), `${current.total ? Math.round(((current.done || 0) / current.total) * 100) : 0}%`, 'text-slate-900'],
            ].map(([label, value, tone]) => (
              <div key={label} className="px-5 py-3">
                <p className="text-[11.5px] text-slate-500">{label}</p>
                <p className={`text-xl font-extrabold tabular-nums ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="h-1.5 bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${current.total ? Math.round(((current.done || 0) / current.total) * 100) : 0}%` }} /></div>
          {people.length > 0 && (
            <div className="px-5 py-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100">
              <span className="text-[12px] text-slate-500 me-1">{t('المشاركون:', 'People:')}</span>
              {people.map(([name, n]) => <span key={name} className="px-2.5 py-1 rounded-full bg-slate-100 text-[12px] text-slate-700">{name} <span className="tabular-nums text-slate-400">{n}</span></span>)}
            </div>
          )}
        </section>
      )}

      {/* ── المشروعات ─────────────────────────────────────────────────────── */}
      {!current && projects.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          <button type="button" onClick={() => setProject('')}
            className={`shrink-0 px-4 py-2.5 rounded-xl border text-sm font-semibold ${project === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
            {t('الكلّ', 'All')}
          </button>
          {projects.map((p) => {
            const pct = p.total ? Math.round(((p.done || 0) / p.total) * 100) : 0;
            const on = project === p._id;
            return (
              <div key={p._id} className={`shrink-0 w-56 rounded-xl border p-3 ${on ? 'border-[#f37121] bg-orange-50/50' : 'border-slate-200 bg-white'} ${p.status === 'closed' ? 'opacity-60' : ''}`}>
                <button type="button" onClick={() => setProject(p._id)} className="w-full text-start" title={t('افتح المشروع', 'Open project')}>
                  <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-slate-900 truncate"><FolderKanban className="w-4 h-4 text-[#f37121] shrink-0" />{p.name}</p>
                  <p className="mt-1 text-[11.5px] text-slate-500 tabular-nums">
                    {t(`${p.done || 0} من ${p.total || 0} تمّت`, `${p.done || 0} of ${p.total || 0} done`)}
                    {!!p.overdue && <span className="text-red-600 font-semibold"> · {t(`${p.overdue} متأخّرة`, `${p.overdue} late`)}</span>}
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                </button>
                <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                  {me.canManage && (
                    <>
                      <button type="button" onClick={() => setProjForm({ _id: p._id, name: p.name, description: p.description || '', endDate: p.endDate ? String(p.endDate).slice(0, 10) : '' })} className="text-slate-500 hover:text-slate-900">{t('تعديل', 'Edit')}</button>
                      <button type="button" onClick={() => toggleProject(p)} className="text-slate-500 hover:text-slate-900">{p.status === 'active' ? t('إغلاق', 'Close') : t('إعادة فتح', 'Reopen')}</button>
                      <button type="button" onClick={() => deleteProject(p)} className="text-slate-400 hover:text-red-600">{t('حذف', 'Delete')}</button>
                    </>
                  )}
                  {management && !me.canManage && !!mySection && (
                    <button type="button" onClick={() => openHand({ project: p })} className="text-[#f37121] font-semibold hover:underline">{t('إسنادُ مهامّي فيه إلى موظّف', 'Assign my tasks to staff')}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── الفلاتر ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {!current && boxes.map((b) => (
          <Chip key={b.key} on={box === b.key} onClick={() => setBox(b.key)}>
            {b.label}{b.n ? <span className="ms-1.5 tabular-nums opacity-80">{b.n}</span> : null}
          </Chip>
        ))}
        {!current && <span className="w-px h-5 bg-slate-200 mx-1" />}
        <Chip on={status === 'open'} onClick={() => setStatus('open')}>{t('القائمة', 'Open')}</Chip>
        <Chip on={status === 'overdue'} onClick={() => setStatus('overdue')}>{t('المتأخّرة', 'Late')}</Chip>
        <Chip on={status === 'done'} onClick={() => setStatus('done')}>{t('التي تمّت', 'Done')}</Chip>
        <Chip on={status === ''} onClick={() => setStatus('')}>{t('الكلّ', 'All')}</Chip>
        {me.canManage && (box === 'all' || !!current) && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t('الموظّف', 'Person')}
            className="ms-auto px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[12.5px] text-slate-700">
            <option value="">{management ? t('كلُّ المديرين', 'All managers') : t('كلُّ الموظّفين', 'Everyone')}</option>
            {teamOptions.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {/* ── المهامّ ───────────────────────────────────────────────────────── */}
      {loading ? <Spinner /> : tasks.length === 0 ? (
        <div className="py-16 text-center bg-white border border-dashed border-slate-200 rounded-2xl">
          <CalendarCheck className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">{status === 'open' ? t('لا مهامَّ قائمة هنا', 'Nothing open here') : t('لا شيء يطابق هذا الاختيار', 'Nothing matches')}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {tasks.map((task) => (
            <TaskCard key={task._id} task={task} now={now} ar={ar} busy={busyId === task._id} meId={me.me}
              onDone={(x) => { setDoneFor(x); setDoneNote(''); setDoneFile(null); }} onReopen={reopen}
              onEdit={startEdit} onDelete={remove} onAttach={attach} onRemoveFile={removeFile}
              onHandDown={(x) => openHand({ task: x })} onComment={comment} />
          ))}
        </ul>
      )}

      {/* ── الإتمام: الملاحظةُ والملفُّ اختياريّان ─────────────────────────── */}
      <Modal open={!!doneFor} onClose={() => setDoneFor(null)} title={t('إتمام المهمّة', 'Complete task')}
        footer={(
          <>
            <button type="button" onClick={() => setDoneFor(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={confirmDone} disabled={!!busyId}><Check className="w-4 h-4" />{t('تمّت', 'Done')}</PrimaryButton>
          </>
        )}>
        <p className="text-[14px] font-semibold text-slate-900">{doneFor?.title}</p>
        <Field label={t('ملاحظة (اختياري)', 'Note (optional)')}>
          <TextArea rows={3} value={doneNote} onChange={(e) => setDoneNote(e.target.value)} placeholder={t('ماذا تمّ؟', 'What was done?')} />
        </Field>
        <Field label={t('ملفٌّ يثبت الإتمام (اختياري)', 'Proof file (optional)')}>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:border-[#f37121]">
            <Paperclip className="w-4 h-4" />{doneFile ? doneFile.fileName : t('أرفِق ملفًّا', 'Attach a file')}
            <input type="file" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setDoneFile(await fileToDataUrl(f)); e.target.value = ''; }} />
          </label>
        </Field>
      </Modal>

      {/* ── التعديل ───────────────────────────────────────────────────────── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('تعديل', 'Edit')} wide
        footer={(
          <>
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={saveEdit} disabled={saving}>{t('حفظ', 'Save')}</PrimaryButton>
          </>
        )}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('المطلوب', 'What is needed')} span2><TextInput value={editDraft.title} onChange={(e) => patchEdit({ title: e.target.value })} /></Field>
          <Field label={t('إلى مَن', 'For whom')}>
            <Select value={editDraft.assignedTo} onChange={(e) => patchEdit({ assignedTo: e.target.value })}>
              {teamOptions.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              {!teamOptions.some((m) => m._id === editDraft.assignedTo) && <option value={editDraft.assignedTo}>{editing?.assignedToName}</option>}
            </Select>
          </Field>
        </div>
        <Field label={editing?.deadlineKind === 'hours' ? t('الموعد — اتركه كما هو أو اختر جديدًا', 'Deadline — leave as is or pick a new one') : t('الموعد', 'Deadline')}>
          <DuePicker value={editDraft.due} onChange={(due) => patchEdit({ due })} ar={ar} />
        </Field>
        <MoreFields d={editDraft} set={patchEdit} projects={projects} ar={ar} allowFiles={false} />
      </Modal>

      {/* ── المشروع ───────────────────────────────────────────────────────── */}
      <Modal open={!!projForm} onClose={() => setProjForm(null)} title={projForm?._id ? t('تعديل المشروع', 'Edit project') : t('مشروع جديد', 'New project')}
        footer={(
          <>
            <button type="button" onClick={() => setProjForm(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={saveProject} disabled={saving || !projForm?.name.trim()}><Plus className="w-4 h-4" />{t('حفظ', 'Save')}</PrimaryButton>
          </>
        )}>
        {projForm && (
          <>
            <Field label={t('اسم المشروع', 'Project name')}><TextInput autoFocus value={projForm.name} onChange={(e) => setProjForm({ ...projForm, name: e.target.value })} placeholder={t('مثال: حملة رمضان', 'e.g. Ramadan campaign')} /></Field>
            <Field label={t('وصف (اختياري)', 'Description (optional)')}><TextArea rows={2} value={projForm.description} onChange={(e) => setProjForm({ ...projForm, description: e.target.value })} /></Field>
            <Field label={t('ينتهي في (اختياري)', 'Ends on (optional)')}><TextInput type="date" value={projForm.endDate} onChange={(e) => setProjForm({ ...projForm, endDate: e.target.value })} /></Field>
            <p className="text-[12px] text-slate-500">{t('بعد الحفظ اختر المشروعَ من الشريط ثمّ اكتب مهامَّه في السطر أعلاه.', 'After saving, pick the project in the strip, then add its tasks in the line above.')}</p>
          </>
        )}
      </Modal>

      {/* ── الإنزال إلى موظّفٍ في قسمي ────────────────────────────────────── */}
      <Modal open={!!handing} onClose={() => setHanding(null)} title={t('إسنادٌ إلى موظّفٍ في قسمي', 'Assign to someone on my team')}
        footer={(
          <>
            <button type="button" onClick={() => setHanding(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={doHand} disabled={saving || !handTo}><CornerDownLeft className="w-4 h-4" />{t('إسناد', 'Assign')}</PrimaryButton>
          </>
        )}>
        <p className="text-[14px] font-semibold text-slate-900">{handing?.task?.title || handing?.project?.name}</p>
        <p className="text-[12.5px] text-slate-500">
          {t('تُنشأ مهمّةٌ في خطّة قسمك باسمك أنت. الموظّفُ يراها مهمّةً منك، والأصلُ يبقى عليك أمام الإدارة.',
            'A task is created in your section plan under your name. The employee sees it as coming from you; the original stays yours.')}
        </p>
        <Field label={t('الموظّف', 'Employee')}>
          <Select value={handTo} onChange={(e) => setHandTo(e.target.value)}>
            <option value="">{t('اختر', 'Choose')}</option>
            {myTeam.filter((m) => !m.isManager).map((m) => <option key={m._id} value={m._id}>{m.name} — {ar ? m.roleAr : m.roleEn}</option>)}
          </Select>
        </Field>
      </Modal>
    </div>
  );
}

// `useSearchParams` يحتاج حدَّ تعليقٍ عند البناء الثابت — يُوضَع هنا مرّةً، لا في ستّين صفحة.
export default function JpBoard(props: { scope: JpScope; section?: string }) {
  return <Suspense fallback={<Spinner />}><JpBoardInner {...props} /></Suspense>;
}
