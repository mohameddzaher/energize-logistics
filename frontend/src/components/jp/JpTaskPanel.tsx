'use client';
/**
 * مهامُّ JP لشيءٍ بعينه — تُقرأ وتُضاف من صفحته (صاحبُ الشركة، ٢٠٢٦/١٠/٢٣).
 *
 * «من جوّا المعاملة أعمل JP… بيودّيني لصفحة الـ JP، لا — خلّيني أعملها من نفس
 * المكان». فالصندوقُ يُوضع في صفحة المعاملة والشحنة والموظّف والمركبة… ويكتب
 * المهمّةَ في نافذةٍ فوق الصفحة نفسِها، مربوطةً بما فُتحت منه، فتظهر في خطّة
 * القسم ولوحته في اللحظة (jp:changed). والمهمّةُ تُختار من قائمة القسم
 * (jp_task_<القسم>)، وتُسنَد وتُوقَّت كما في الخطّة.
 *
 * يختفي كلُّه لمن ليس من فريق القسم — الخادمُ يقول ذلك (/api/jp/me ← 403).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import ManagedSelect from '@/components/system/ManagedSelect';
import { Modal, Field, TextInput, TextArea, SearchableSelect, PrimaryButton } from '@/components/hr/HRKit';
import { DuePicker, NO_DUE, dueBody, type Due } from '@/components/jp/JpBoard';
import { type JpTask, type JpMe, deadlineLine, TONE_CLASS, fmtMinutes, jpPagePath } from '@/lib/jp';
import { CalendarCheck, Plus, Check, Clock, ExternalLink } from 'lucide-react';

export default function JpTaskPanel({ section, kind, refId, ar, compact }: {
  section: string; kind: string; refId: string; ar: boolean; compact?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [me, setMe] = useState<JpMe | null>(null);
  const [tasks, setTasks] = useState<JpTask[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.get<{ tasks: JpTask[] }>(`/api/jp/tasks?scope=section&section=${section}&box=all&linkKind=${kind}&linkRef=${refId}`)
      .then((d) => setTasks(d.tasks || []))
      .catch(() => setHidden(true));
  }, [section, kind, refId]);
  useEffect(() => {
    api.get<JpMe>(`/api/jp/me?scope=section&section=${section}`)
      .then((m) => { if (!(m.linkKinds || []).includes(kind)) setHidden(true); else { setMe(m); load(); } })
      .catch(() => setHidden(true));
  }, [section, kind, load]);
  useSocket('jp:changed', useCallback((d: { scope?: string; section?: string }) => { if (d?.section === section) load(); }, [load, section]));

  const done = async (x: JpTask) => {
    setBusy(x._id);
    try { await api.post(`/api/jp/tasks/${x._id}/done`, { done: x.status !== 'done' }); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر', 'Failed'), 'error'); }
    setBusy('');
  };

  if (hidden || !me || tasks === null) return null;
  const now = Date.now();
  const openCount = tasks.filter((x) => x.status !== 'done').length;
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><CalendarCheck className="w-4 h-4" /></span>
          {t('مهامّ خطّة العمل (JP)', 'Work-plan tasks (JP)')}
          {openCount > 0 && <span className="text-slate-500 text-xs font-semibold">{t(`${openCount} مفتوحة`, `${openCount} open`)}</span>}
        </h3>
        <div className="flex items-center gap-1.5">
          <Link href={jpPagePath(section)} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700" title={t('خطّة القسم', 'Section plan')}><ExternalLink className="w-4 h-4" /></Link>
          <button type="button" onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#f37121] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#e06010]">
            <Plus className="w-3.5 h-3.5" />{t('إضافة JP', 'Add JP')}
          </button>
        </div>
      </header>
      {tasks.length === 0 ? (
        <p className={`px-5 text-center text-sm text-slate-400 ${compact ? 'py-3' : 'py-6'}`}>{t('لا مهامّ مربوطة بعد — أضِف من هنا.', 'No linked tasks yet — add one here.')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((x) => {
            const dl = deadlineLine(x, now, ar);
            return (
              <li key={x._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                <button type="button" disabled={!x.can?.complete || busy === x._id} onClick={() => done(x)}
                  title={x.can?.complete ? (x.status === 'done' ? t('إعادة فتح', 'Reopen') : t('تمّت', 'Mark done')) : ''}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${x.status === 'done' ? 'bg-emerald-500 text-white' : x.state === 'overdue' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'} ${x.can?.complete ? 'hover:ring-2 hover:ring-emerald-300' : ''}`}>
                  {x.status === 'done' ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                </button>
                <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${x.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {x.title}{x.kind === 'request' && <span className="ms-1 text-[11px] font-normal text-sky-600">{t('طلب', 'request')}</span>}
                </span>
                <span className="text-[12px] text-slate-600">{x.assignedToName}</span>
                {!!x.expectedMinutes && <span className="text-[12px] text-slate-500">{t('متوقّع', 'est.')} {fmtMinutes(x.expectedMinutes, ar)}</span>}
                <span className={`text-[12px] ${TONE_CLASS[dl.tone]}`}>{dl.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {open && <QuickAdd me={me} section={section} kind={kind} refId={refId} ar={ar} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
    </section>
  );
}

/** نافذةُ الإضافة — فوق الصفحة، لا انتقالَ إلى الخطّة. */
function QuickAdd({ me, section, kind, refId, ar, onClose, onSaved }: {
  me: JpMe; section: string; kind: string; refId: string; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState(String(me.me));
  const [due, setDue] = useState<Due>(NO_DUE);
  const [workDate, setWorkDate] = useState('');
  const [expH, setExpH] = useState('');
  const [expM, setExpM] = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim()) { notify(t('اختر المهمّة', 'Pick the task'), 'error'); return; }
    setSaving(true);
    try {
      const expected = expH === '' && expM === '' ? undefined : Math.round((Number(expH) || 0) * 60 + (Number(expM) || 0));
      await api.post('/api/jp/tasks', {
        scope: 'section', section, title: title.trim(), assignedTo, details: details.trim(), ...dueBody(due),
        ...(workDate ? { workDate } : {}), ...(expected !== undefined ? { expectedMinutes: expected } : {}),
        links: [{ kind, ref: refId }],
      });
      notify(t('أُضيفت المهمّة إلى خطّة القسم', 'Added to the section plan'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error'); }
    setSaving(false);
  };
  const team = me.team || [];
  return (
    <Modal open onClose={onClose} title={t('إضافة JP', 'Add JP')} wide
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <PrimaryButton onClick={save} disabled={saving}>{saving ? t('جارٍ الحفظ…', 'Saving…') : t('إضافة', 'Add')}</PrimaryButton>
      </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('المهمّة *', 'Task *')} span2>
          <ManagedSelect type={`jp_task_${section}`} storeLabel value={title} onChange={(v) => setTitle(v)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </Field>
        <Field label={t('تُسنَد إلى', 'Assign to')}>
          <SearchableSelect value={assignedTo} onChange={setAssignedTo} searchAfter={0}
            searchPlaceholder={t('ابحث بالاسم أو الدور…', 'Search name or role…')}
            options={[
              ...(team.some((m) => String(m._id) === String(me.me)) ? [] : [{ value: String(me.me), label: t('أنا', 'Me') }]),
              ...team.map((m) => ({
                value: String(m._id),
                label: String(m._id) === String(me.me) ? `${m.name} (${t('أنا', 'me')})` : m.name,
                hint: t(m.roleAr, m.roleEn),
                search: [m.nameAr, m.search].filter(Boolean).join(' '),
              })),
            ]} />
        </Field>
        <Field label={t('يوم العمل (اختياري)', 'Work day (optional)')}>
          <TextInput type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </Field>
        <Field label={t('الموعد', 'Deadline')} span2>
          <DuePicker value={due} onChange={setDue} ar={ar} />
        </Field>
        <Field label={t('الوقت المتوقّع (اختياري)', 'Expected time (optional)')}>
          <div className="flex items-center gap-2">
            <TextInput type="number" min={0} value={expH} onChange={(e) => setExpH(e.target.value)} placeholder={t('ساعات', 'hours')} />
            <TextInput type="number" min={0} max={59} value={expM} onChange={(e) => setExpM(e.target.value)} placeholder={t('دقائق', 'minutes')} />
          </div>
        </Field>
        <Field label={t('تفاصيل (اختياري)', 'Details (optional)')} span2>
          <TextArea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('ما المطلوب بالتحديد؟', 'What exactly is needed?')} />
        </Field>
      </div>
    </Modal>
  );
}
