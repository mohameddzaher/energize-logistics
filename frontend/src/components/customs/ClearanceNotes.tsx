'use client';
/**
 * ملاحظاتُ المعاملة — سطرٌ يُضاف، لا خانةٌ تُدهَس.
 *
 * كانت الملاحظةُ خانةً واحدة: من كتب اليومَ محا ما كتبه غيرُه أمس، ولا يُعرف
 * مَن كتب ولا متى. فصارت سجلًّا: لكلّ ملاحظةٍ صاحبُها ووقتُها، والأحدثُ أعلاها
 * وهي نفسُها التي تظهر في عمود «ملاحظات» في الجدول (راجع lastNote في الخادم).
 *
 * وما كُتب في الخانة القديمة يبقى معروضًا أسفلَ السجلّ — لا يُحذف ولا يُحوَّل
 * إلى ملاحظةٍ بصاحبٍ لا نعرفه.
 */
import { useState } from 'react';
import { Loader2, MessageSquarePlus, Trash2 } from 'lucide-react';
import api from '@/lib/api';

export type ClearanceNote = { _id?: string; text: string; byName?: string; at?: string };

export const fmtWhen = (v?: string | null, ar = true) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function ClearanceNotes({ clearance, canEdit, ar, onChanged, notify, compact }: {
  clearance: any; canEdit: boolean; ar: boolean;
  onChanged: () => void; notify: (m: string, tone?: any) => void; compact?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log: ClearanceNote[] = [...(clearance.notesLog || [])].reverse();   // الأحدثُ أعلى

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    try {
      await api.post(`/api/customs-clearance/${clearance._id}/notes`, { text: v });
      setText('');
      onChanged();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy(false);
  };

  const remove = async (id?: string) => {
    if (!id) return;
    try {
      await api.delete(`/api/customs-clearance/${clearance._id}/notes/${id}`);
      onChanged();
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const body = (
    <>
      {canEdit && (
        <div className="flex items-start gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 3 : 2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }}
            placeholder={t('اكتب ملاحظة…', 'Write a note…')}
            className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          <button type="button" onClick={add} disabled={busy || !text.trim()}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold hover:bg-[#e06010] disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquarePlus className="w-4 h-4" />}
            {t('إضافة', 'Add')}
          </button>
        </div>
      )}

      <ul className={`mt-3 space-y-2 ${compact ? 'max-h-64 overflow-y-auto' : ''}`}>
        {log.length === 0 && !clearance.notes && (
          <li className="text-slate-400 text-sm py-4 text-center">{t('لا ملاحظات بعد', 'No notes yet')}</li>
        )}
        {log.map((nt, i) => (
          <li key={nt._id || i} className="group rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <p className="text-[13.5px] text-slate-800 whitespace-pre-wrap">{nt.text}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
              <span>{nt.byName || t('غير معروف', 'unknown')}</span>
              <span>·</span>
              <span>{fmtWhen(nt.at, ar)}</span>
              {canEdit && nt._id && (
                <button type="button" onClick={() => remove(nt._id)} title={t('حذف', 'Delete')}
                  className="ms-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
        {/* الملاحظةُ القديمة — كُتبت قبل السجلّ، فلا صاحبَ لها ولا وقت. */}
        {clearance.notes && (
          <li className="rounded-xl border border-dashed border-slate-200 px-3 py-2">
            <p className="text-[13px] text-slate-600 whitespace-pre-wrap">{clearance.notes}</p>
            <p className="mt-1 text-[11px] text-slate-400">{t('ملاحظة قديمة (قبل سجلّ الملاحظات)', 'Older note (before the notes log)')}</p>
          </li>
        )}
      </ul>
    </>
  );

  if (compact) return body;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><MessageSquarePlus className="w-4 h-4" /></span>
          {t('الملاحظات', 'Notes')}
        </h3>
        {log.length > 0 && <span className="text-[11px] text-slate-400">{log.length}</span>}
      </header>
      <div className="p-5">{body}</div>
    </section>
  );
}
