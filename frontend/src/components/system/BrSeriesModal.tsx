'use client';
// Recurring business review meetings (the daily meeting): list, open or create today's meeting, and create or edit a schedule.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Repeat, Plus, Trash2, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/hr/HRKit';
import { useSocket } from '@/hooks/useSocket';
import {
  brSeriesList, brCreateSeries, brUpdateSeries, brDeleteSeries, brSeriesDay,
  type BrMeta, type Lang, tx, deptLabel, isoDay,
} from '@/lib/businessReview';

export const WEEKDAYS = [['0', 'Sun', 'الأحد'], ['1', 'Mon', 'الإثنين'], ['2', 'Tue', 'الثلاثاء'], ['3', 'Wed', 'الأربعاء'], ['4', 'Thu', 'الخميس'], ['5', 'Fri', 'الجمعة'], ['6', 'Sat', 'السبت']] as const;

export default function BrSeriesModal({ meta, L, onClose, onOpenMeeting, notify, confirm, startNew, editId }: {
  meta: BrMeta; L: Lang; onClose: () => void; onOpenMeeting: (id: string) => void; notify: any; confirm: any;
  /** Open straight on an empty form (a new meeting type) or on one schedule's settings. */
  startNew?: boolean; editId?: string;
}) {
  const t = (en: string, ar: string) => tx(L, en, ar);
  const [list, setList] = useState<any[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(() => brSeriesList().then((d) => { setList(d.series); setCanEdit(d.canEdit); return d.series; }).catch(() => { setList([]); return []; }), []);
  const opened = useRef(false);
  useEffect(() => {
    load().then((rows: any[]) => {
      if (opened.current) return;
      opened.current = true;
      if (startNew) setForm(blankNew());
      else if (editId) { const x = rows.find((r) => r._id === editId); if (x) setForm({ ...x, attendees: x.attendees.map(String) }); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useSocket('br:series', load);
  useSocket('br:meeting', load);

  // A new meeting type starts empty except for the board, which attends every forum.
  const blankNew = () => ({
    title: '', cadence: 'weekly', time: '10:00', durationMinutes: 60, weekdays: [0],
    departments: [] as string[], attendees: meta.participants.filter((p) => p.isExecutive).map((p) => p._id), location: '', active: true,
  });
  const blank = () => ({
    title: t('Daily meeting', 'الاجتماع اليومي'), time: '09:00', durationMinutes: 30, weekdays: [0, 1, 2, 3, 4],
    departments: [] as string[], attendees: meta.participants.filter((p) => p.isExecutive).map((p) => p._id), location: '', active: true,
  });

  const save = async () => {
    if (!form?.title?.trim()) { notify(t('Name it', 'اكتب اسم الاجتماع'), 'error'); return; }
    if (!form.departments.length) { notify(t('Pick the departments', 'اختر الأقسام'), 'error'); return; }
    setSaving(true);
    try {
      if (form._id) await brUpdateSeries(form._id, form); else await brCreateSeries(form);
      notify(t('Saved', 'تم الحفظ'), 'success');
      setForm(null); load();
    } catch (e: any) { notify(e?.message || t('Could not save', 'تعذّر الحفظ'), 'error'); }
    setSaving(false);
  };
  const openDay = async (s: any) => {
    try { const d = await brSeriesDay(s._id, isoDay(new Date())); onOpenMeeting(d.meeting._id); } catch (e: any) { notify(e?.message || '', 'error'); }
  };
  const remove = async (s: any) => {
    const ok = await confirm({ title: t('Stop this schedule?', 'إيقاف هذا الاجتماع الدوري؟'),
      message: t('Past meetings and their minutes stay.', 'الاجتماعات السابقة ومحاضرها تبقى كما هي.'), confirmLabel: t('Stop', 'إيقاف'), tone: 'danger' });
    if (!ok) return;
    try { await brDeleteSeries(s._id); load(); } catch (e: any) { notify(e?.message || '', 'error'); }
  };
  const toggle = (key: 'weekdays' | 'departments' | 'attendees', v: any) =>
    setForm((f: any) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x: any) => x !== v) : [...f[key], v] }));
  // Choosing a department invites its head.
  const pickDept = (d: string) => {
    setForm((f: any) => {
      const adding = !f.departments.includes(d);
      const heads = meta.participants.filter((p) => p.section === d && /_manager$/.test(p.role));
      return {
        ...f,
        departments: adding ? [...f.departments, d] : f.departments.filter((x: string) => x !== d),
        attendees: adding ? [...new Set([...f.attendees, ...heads.map((h) => h._id)])] : f.attendees,
      };
    });
  };
  const people = meta.participants.filter((p) => `${p.name} ${p.role}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Modal open onClose={onClose} wide="xl" title={t('Recurring meetings', 'الاجتماعات الدورية')}>
      {!form && (
        <>
          <p className="text-sm text-slate-600">
            {t('A recurring meeting creates its own meeting every scheduled day, with minutes split by department and its own tasks.',
              'الاجتماع الدوري يُنشئ اجتماعه كل يوم مجدول تلقائيًّا، بمحضر مقسوم على الأقسام وبنود تنفيذية خاصة به.')}
          </p>
          {list === null ? <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> : (
            <div className="space-y-2">
              {list.map((s) => (
                <div key={s._id} className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
                  <Repeat className="w-5 h-5 text-[#f37121]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">{s.title} {!s.active && <span className="text-[11px] text-slate-400">({t('paused', 'موقوف')})</span>}</p>
                    <p className="text-xs text-slate-500">
                      {s.time} · {WEEKDAYS.filter(([k]) => s.weekdays.includes(Number(k))).map(([, en, ar]) => t(en, ar)).join('، ')}
                      {' · '}{s.departments.length} {t('departments', 'أقسام')} · {s.attendees.length} {t('attendees', 'مدعو')}
                    </p>
                  </div>
                  <button type="button" onClick={() => openDay(s)}
                    className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-semibold rounded-lg px-3 py-1.5">
                    <FileText className="w-3.5 h-3.5" />{s.today ? t('Open today’s meeting', 'فتح اجتماع اليوم') : t('Create today’s meeting', 'إنشاء اجتماع اليوم')}
                  </button>
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => setForm({ ...s, attendees: s.attendees.map(String) })} className="text-xs font-semibold text-slate-600 px-2 py-1.5 border border-slate-200 rounded-lg">{t('Edit', 'تعديل')}</button>
                      <button type="button" onClick={() => remove(s)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" aria-label="delete"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              ))}
              {!list.length && <p className="text-sm text-slate-500 text-center py-4">{t('No recurring meetings yet.', 'لا توجد اجتماعات دورية بعد.')}</p>}
            </div>
          )}
          {canEdit && (
            <button type="button" onClick={() => setForm(blank())}
              className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg px-3.5 py-2">
              <Plus className="w-4 h-4" />{t('New recurring meeting', 'اجتماع دوري جديد')}
            </button>
          )}
        </>
      )}

      {form && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">{t('Name', 'اسم الاجتماع')}</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">{t('Time', 'الوقت')}</span>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">{t('Minutes', 'المدة (دقيقة)')}</span>
              <input type="number" min={5} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) || 30 })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm" />
            </label>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-600">{t('Repeats', 'التكرار')}</span>
              {([['daily', 'Daily', 'يومي'], ['weekly', 'Weekly', 'أسبوعي']] as const).map(([k, en, ar]) => (
                <button key={k} type="button"
                  onClick={() => setForm({ ...form, cadence: k, weekdays: k === 'daily' ? [0, 1, 2, 3, 4] : [form.weekdays?.[0] ?? 0] })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${(form.cadence || 'daily') === k ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{t(en, ar)}</button>
              ))}
            </div>
            <p className="text-xs font-semibold text-slate-600 mb-1.5">{(form.cadence || 'daily') === 'weekly' ? t('Meeting day(s)', 'يوم الاجتماع') : t('Days', 'الأيام')}</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(([k, en, ar]) => {
                const on = form.weekdays.includes(Number(k));
                return <button key={k} type="button" onClick={() => toggle('weekdays', Number(k))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${on ? 'bg-[#f37121] border-[#f37121] text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{t(en, ar)}</button>;
              })}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1.5">{t('Departments (each gets its own section of the minutes)', 'الأقسام (لكل قسم جزء خاص في المحضر)')}</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.departments.map((d) => {
                const on = form.departments.includes(d);
                return <button key={d} type="button" onClick={() => pickDept(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{deptLabel(d, L)}</button>;
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-xs font-semibold text-slate-600">{t('Attendees', 'المدعوون')} ({form.attendees.length})</p>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search…', 'بحث…')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs w-44" />
            </div>
            <div className="max-h-56 overflow-y-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {people.map((p) => {
                const on = form.attendees.includes(p._id);
                return (
                  <label key={p._id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${on ? 'border-[#f37121] bg-orange-50' : 'border-slate-200 bg-white'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle('attendees', p._id)} className="accent-[#f37121]" />
                    <span className="min-w-0"><span className="font-semibold text-slate-800 block truncate">{p.name}</span><span className="text-slate-400 truncate block">{[(p as any).roleAr || p.role, p.jobTitle].filter(Boolean).join(' · ')}</span></span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">{t('Location', 'المكان')}</span>
            <input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={save}
              className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('Save', 'حفظ')}
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-sm text-slate-500 px-3">{t('Back', 'رجوع')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
