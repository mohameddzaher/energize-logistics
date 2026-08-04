'use client';
// Shared pieces for اجتماعات مراجعة الأعمال.
//
// The same action card appears on the meeting page, the manager's board and the
// board-wide register, and the same task card on both the manager's and the
// employee's view — so they live here once, and every screen stays consistent
// as the module grows.
import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import {
  CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronRight, Users, Send,
  Loader2, MessageSquare, Trash2, Search,
} from 'lucide-react';
import {
  type BrAction, type BrDelegation, type Vocab, type BrPerson, type Lang,
  vocabLabel, vocabColor, fmtDate, fmtDateTime, dueLabel, TONE_CLASS, OPEN_STATUSES, tx,
} from '@/lib/businessReview';

/**
 * A person picker you can type into. Replaces the old pattern of a separate
 * "filter the names" input next to a plain <select> — one control, and it
 * actually works when there are forty people to choose from.
 */
export function PersonSelect({
  people, value, onChange, placeholder, lang, exclude,
}: {
  people: BrPerson[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  lang: Lang;
  exclude?: string[];
}) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const skip = new Set(exclude || []);
  const chosen = people.find((p) => p._id === value);
  const s = q.trim().toLowerCase();
  const list = people.filter((p) => !skip.has(p._id)
    && (!s || `${p.name} ${p.department || ''} ${p.role}`.toLowerCase().includes(s)));

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => { setOpen((v) => !v); setQ(''); }}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-start">
        <span className={chosen ? 'text-slate-900 truncate' : 'text-slate-400 truncate'}>
          {chosen ? chosen.name : (placeholder || t('Pick a person…', 'اختر شخصًا…'))}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="relative border-b border-slate-100">
            <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('Type a name…', 'اكتب اسمًا…')}
              className="w-full ps-8 pe-2 py-2 text-sm text-slate-800 focus:outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {list.map((p) => (
              <button key={p._id} type="button"
                onClick={() => { onChange(p._id); setOpen(false); setQ(''); }}
                className={`w-full text-start px-3 py-2 text-sm hover:bg-slate-50 ${p._id === value ? 'bg-[#f37121]/10' : ''}`}>
                <span className="block text-slate-900 truncate">{p.name}</span>
                {(p.department || p.jobTitle) && (
                  <span className="block text-[11px] text-slate-400 truncate">{p.jobTitle || p.department}</span>
                )}
              </button>
            ))}
            {!list.length && <p className="px-3 py-3 text-xs text-slate-400">{t('No match', 'لا توجد نتائج')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A coloured status pill driven by the server's own vocabulary. */
export function StatusPill({ statuses, value, lang }: { statuses?: Vocab[]; value: string; lang: Lang }) {
  const color = vocabColor(statuses, value);
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: `${color}1f`, color }}>
      {vocabLabel(statuses, value, lang)}
    </span>
  );
}

export function PriorityPill({ priorities, value, lang }: { priorities?: Vocab[]; value: string; lang: Lang }) {
  const color = vocabColor(priorities, value);
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: `${color}1f`, color }}>
      {vocabLabel(priorities, value, lang)}
    </span>
  );
}

export function DueBadge({ due, status, lang }: { due?: string | null; status: string; lang: Lang }) {
  if (!due || !OPEN_STATUSES.includes(status)) {
    return <span className="text-[11px] text-slate-400">{fmtDate(due)}</span>;
  }
  const d = dueLabel(due, lang);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[11px] text-slate-500">{fmtDate(due)}</span>
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TONE_CLASS[d.tone]}`}>{d.text}</span>
    </span>
  );
}

export function Progress({ value, color = '#f37121' }: { value: number; color?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </div>
  );
}

/** The small "report progress" form used by both actions and delegated tasks. */
export function ProgressForm({
  status, progress, statuses, lang, busy, onSubmit, onCancel,
}: {
  status: string; progress: number; statuses?: Vocab[]; lang: Lang; busy?: boolean;
  onSubmit: (v: { status: string; progress: number; note: string }) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(status);
  const [p, setP] = useState(progress);
  const [note, setNote] = useState('');
  const t = (en: string, ar: string) => tx(lang, en, ar);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5 mt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-slate-500">{t('Status', 'الحالة')}</span>
          <select value={s} onChange={(e) => setS(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800">
            {(statuses || []).map((x) => <option key={x.key} value={x.key}>{lang === 'ar' ? x.ar : x.en}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500">{t('Progress', 'نسبة الإنجاز')}: {p}%</span>
          <input type="range" min={0} max={100} step={5} value={p} onChange={(e) => setP(Number(e.target.value))}
            className="w-full mt-2 accent-[#f37121]" />
        </label>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
        placeholder={t('What happened? (optional)', 'ما الذي تم؟ (اختياري)')}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => onSubmit({ status: s, progress: p, note })}
          className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {t('Save update', 'حفظ التحديث')}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 px-2">{t('Cancel', 'إلغاء')}</button>
      </div>
    </div>
  );
}

/** The update log — who said what, and when the status moved. */
export function UpdateLog({ updates, statuses, lang }: { updates?: any[]; statuses?: Vocab[]; lang: Lang }) {
  if (!updates?.length) return null;
  return (
    <div className="mt-2 border-t border-slate-100 pt-2 space-y-1.5">
      {updates.slice().reverse().slice(0, 12).map((u, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px]">
          <MessageSquare className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="text-slate-700 font-medium">{u.byName}</span>
            {u.statusTo && (
              <span className="text-slate-400">
                {' · '}{vocabLabel(statuses, u.statusFrom, lang)} → {vocabLabel(statuses, u.statusTo, lang)}
              </span>
            )}
            {u.progress != null && <span className="text-slate-400">{' · '}{u.progress}%</span>}
            {u.text && <p className="text-slate-600 mt-0.5">{u.text}</p>}
          </div>
          <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(u.at)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A manager splitting their action across their team. Several rows because
 * "assign to more than one" was an explicit requirement — each row becomes its
 * own task that only that person will ever see.
 */
export function DelegateForm({
  people, defaultDue, priorities, lang, busy, onSubmit, onCancel,
}: {
  people: BrPerson[]; defaultDue?: string | null; priorities?: Vocab[]; lang: Lang; busy?: boolean;
  onSubmit: (rows: { assignee: string; title: string; instructions: string; dueDate: string; priority: string }[]) => void;
  onCancel: () => void;
}) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const due = defaultDue ? new Date(defaultDue).toISOString().slice(0, 10) : '';
  const blank = () => ({ assignee: '', title: '', instructions: '', dueDate: due, priority: 'medium' });
  const [rows, setRows] = useState([blank()]);

  const set = (i: number, k: string, v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  // Nobody should be given the same action twice.
  const takenBy = (i: number) => rows.filter((_, j) => j !== i).map((x) => x.assignee).filter(Boolean);
  const valid = rows.filter((r) => r.assignee && r.title.trim());

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-[#f37121]" />
        <p className="text-slate-800 text-sm font-semibold">{t('Delegate to your team', 'توزيع المهمة على الفريق')}</p>
      </div>

      {rows.map((r, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <PersonSelect
              people={people} value={r.assignee} lang={lang}
              exclude={takenBy(i)}
              placeholder={t('Pick a team member…', 'اختر موظفًا…')}
              onChange={(id) => set(i, 'assignee', id)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={r.dueDate} onChange={(e) => set(i, 'dueDate', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
              <select value={r.priority} onChange={(e) => set(i, 'priority', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800">
                {(priorities || []).map((p) => <option key={p.key} value={p.key}>{lang === 'ar' ? p.ar : p.en}</option>)}
              </select>
            </div>
          </div>
          <input value={r.title} onChange={(e) => set(i, 'title', e.target.value)}
            placeholder={t('What exactly should this person do? *', 'ما المطلوب من هذا الموظف تحديدًا؟ *')}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
          <textarea value={r.instructions} onChange={(e) => set(i, 'instructions', e.target.value)} rows={2}
            placeholder={t('Instructions (optional)', 'تعليمات (اختياري)')}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
          {rows.length > 1 && (
            <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
              className="text-red-600 text-[11px] inline-flex items-center gap-1">
              <Trash2 className="w-3 h-3" />{t('Remove', 'حذف')}
            </button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((r) => [...r, blank()])}
          className="text-[#f37121] text-xs hover:underline">+ {t('Another person', 'موظف آخر')}</button>
        <span className="flex-1" />
        <button type="button" disabled={busy || !valid.length} onClick={() => onSubmit(valid)}
          className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {t(`Assign to ${valid.length}`, `إسناد إلى ${valid.length}`)}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 px-2">{t('Cancel', 'إلغاء')}</button>
      </div>
    </div>
  );
}

/**
 * One action, as seen by a manager (their own) or the board (anyone's).
 * `canDelegate` is what turns it into a manager's working card rather than a
 * read-only register row.
 */
export function ActionCard({
  action, meta, lang, canDelegate, canEdit, people, onUpdate, onDelegate, onDelete, showMeeting,
}: {
  action: BrAction;
  meta: { actionStatuses?: Vocab[]; priorities?: Vocab[] };
  lang: Lang;
  canDelegate?: boolean;
  canEdit?: boolean;
  people?: BrPerson[];
  onUpdate?: (v: { status: string; progress: number; note: string }) => Promise<void>;
  onDelegate?: (rows: any[]) => Promise<void>;
  onDelete?: () => void;
  showMeeting?: boolean;
}) {
  const { lang: _l } = useLanguage();
  const { confirm } = useDialog();
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'' | 'update' | 'delegate'>('');
  const [busy, setBusy] = useState(false);
  const overdue = action.isOverdue && OPEN_STATUSES.includes(action.status);
  const color = vocabColor(meta.actionStatuses, action.status);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); setMode(''); } finally { setBusy(false); }
  };

  return (
    <div className={`bg-white border rounded-xl p-4 shadow-sm ${overdue ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-slate-400">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
            </button>
            <p className="text-slate-900 font-semibold text-sm">{action.title}</p>
            <StatusPill statuses={meta.actionStatuses} value={action.status} lang={lang} />
            <PriorityPill priorities={meta.priorities} value={action.priority} lang={lang} />
            {overdue && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" />{t('Overdue', 'متأخر')}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-1">
            {t('Owner', 'المكلَّف')}: <span className="text-slate-700 font-medium">{action.assigneeName}</span>
            {action.raisedByName && <> · {t('Requested by', 'بطلب من')}: {action.raisedByName}</>}
            {showMeeting && action.meetingRef && <> · {action.meetingRef}</>}
          </p>
        </div>
        <div className="text-end shrink-0">
          <DueBadge due={action.dueDate} status={action.status} lang={lang} />
          <p className="text-slate-400 text-[11px] mt-1">{action.progress}%</p>
        </div>
      </div>

      <div className="mt-2"><Progress value={action.progress} color={color} /></div>

      {!!action.delegations?.length && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          {action.delegations.map((d) => (
            <span key={d._id} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {d.assigneeName} · {vocabLabel(meta.actionStatuses, d.status, lang)}
              {d.isOverdue && OPEN_STATUSES.includes(d.status) && <span className="text-red-600"> ⚠</span>}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {action.description && <p className="text-slate-700 text-xs whitespace-pre-wrap mb-2">{action.description}</p>}
          <p className="text-[11px] text-slate-400">
            {action.meetingTitle && <>{t('From', 'من اجتماع')}: {action.meetingTitle} · </>}
            {t('Created', 'أُنشئ')}: {fmtDate((action as any).createdAt)}
            {action.completedAt && <> · {t('Completed', 'اكتمل')}: {fmtDate(action.completedAt)}</>}
          </p>

          {!!action.delegations?.length && (
            <div className="mt-2 space-y-1.5">
              <p className="text-slate-700 text-xs font-semibold">{t('Delegated work', 'التكليفات الفرعية')}</p>
              {action.delegations.map((d) => (
                <div key={d._id} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-800 font-medium">{d.assigneeName}</span>
                    <span className="flex items-center gap-1.5">
                      <StatusPill statuses={meta.actionStatuses} value={d.status} lang={lang} />
                      <DueBadge due={d.dueDate} status={d.status} lang={lang} />
                    </span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{d.title}</p>
                </div>
              ))}
            </div>
          )}

          <UpdateLog updates={action.updates} statuses={meta.actionStatuses} lang={lang} />
        </div>
      )}

      {(onUpdate || (canDelegate && onDelegate) || (canEdit && onDelete)) && mode === '' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onUpdate && (
            <button type="button" onClick={() => setMode('update')}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
              <Clock className="w-3.5 h-3.5" />{t('Report progress', 'تحديث الحالة')}
            </button>
          )}
          {canDelegate && onDelegate && (
            <button type="button" onClick={() => setMode('delegate')}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
              <Users className="w-3.5 h-3.5" />{t('Delegate', 'توزيع على الفريق')}
            </button>
          )}
          {canEdit && onDelete && (
            <button type="button"
              onClick={async () => {
                const ok = await confirm({
                  title: t('Delete this action?', 'حذف هذا البند؟'),
                  message: t('Its delegated tasks are removed too.', 'سيتم حذف التكليفات الفرعية معه.'),
                  confirmLabel: t('Delete', 'حذف'), tone: 'danger',
                });
                if (ok) onDelete();
              }}
              className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 text-xs rounded-lg px-2.5 py-1.5 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />{t('Delete', 'حذف')}
            </button>
          )}
        </div>
      )}

      {mode === 'update' && onUpdate && (
        <ProgressForm status={action.status} progress={action.progress} statuses={meta.actionStatuses}
          lang={lang} busy={busy} onCancel={() => setMode('')}
          onSubmit={(v) => run(() => onUpdate(v))} />
      )}
      {mode === 'delegate' && onDelegate && (
        <DelegateForm people={people || []} defaultDue={action.dueDate} priorities={meta.priorities}
          lang={lang} busy={busy} onCancel={() => setMode('')}
          onSubmit={(rows) => run(() => onDelegate(rows))} />
      )}
    </div>
  );
}

/** One delegated task — the employee's view of their own work. */
export function TaskCard({
  task, meta, lang, onUpdate, showAssignee,
}: {
  task: BrDelegation;
  meta: { actionStatuses?: Vocab[]; priorities?: Vocab[] };
  lang: Lang;
  onUpdate?: (v: { status: string; progress: number; note: string }) => Promise<void>;
  showAssignee?: boolean;
}) {
  const t = (en: string, ar: string) => tx(lang, en, ar);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const overdue = task.isOverdue && OPEN_STATUSES.includes(task.status);
  const color = vocabColor(meta.actionStatuses, task.status);

  return (
    <div className={`bg-white border rounded-xl p-4 shadow-sm ${overdue ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-slate-400">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
            </button>
            <p className="text-slate-900 font-semibold text-sm">{task.title}</p>
            <StatusPill statuses={meta.actionStatuses} value={task.status} lang={lang} />
            <PriorityPill priorities={meta.priorities} value={task.priority} lang={lang} />
            {overdue && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" />{t('Overdue', 'متأخرة')}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-1">
            {showAssignee
              ? <>{t('Assigned to', 'المكلَّف')}: <span className="text-slate-700 font-medium">{task.assigneeName}</span></>
              : <>{t('From', 'من')}: <span className="text-slate-700 font-medium">{task.assignedByName}</span></>}
            {task.department && <> · {task.department}</>}
          </p>
        </div>
        <div className="text-end shrink-0">
          <DueBadge due={task.dueDate} status={task.status} lang={lang} />
          <p className="text-slate-400 text-[11px] mt-1">{task.progress}%</p>
        </div>
      </div>

      <div className="mt-2"><Progress value={task.progress} color={color} /></div>

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {task.instructions && <p className="text-slate-700 text-xs whitespace-pre-wrap">{task.instructions}</p>}
          <UpdateLog updates={task.updates} statuses={meta.actionStatuses} lang={lang} />
        </div>
      )}

      {onUpdate && !editing && (
        <button type="button" onClick={() => setEditing(true)}
          className="mt-3 inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
          <Clock className="w-3.5 h-3.5" />{t('Report progress', 'تحديث الحالة')}
        </button>
      )}
      {onUpdate && editing && (
        <ProgressForm status={task.status} progress={task.progress} statuses={meta.actionStatuses}
          lang={lang} busy={busy} onCancel={() => setEditing(false)}
          onSubmit={async (v) => { setBusy(true); try { await onUpdate(v); setEditing(false); } finally { setBusy(false); } }} />
      )}
    </div>
  );
}
