'use client';
// Follow-up notes: a log that can be added to, edited and deleted.
// A note such as 'called the driver, arrives in two hours' is recorded in the shipment log (who, when, what) and does not touch the status; it is not the waybill note printed on the paper. All are shown here to anyone opening the shipment. Edit and delete are for the author or the section manager; the server guards the same rule.
import { useState } from 'react';
import { X, Check, Loader2, Pencil, Trash2, MessageSquareText } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import type { ShipmentOrder } from '@/lib/shipmentOrders';
import { fmtDT, Lang } from '@/lib/shipmentOrders';
import { followUpNotes, orderRef, relTime } from './OrderViews';

const NOTE_MANAGERS = new Set(['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'shipment_orders_manager', 'shipment_orders_team_leader', 'operations_manager', 'operations_team_leader']);

export default function NoteModal({ order, ar, onClose, onSaved }: {
  order: ShipmentOrder;
  ar: boolean;
  onClose: () => void;
  /** The shipment as returned by the server after each change, so the card updates at once. */
  onSaved: (o: ShipmentOrder) => void;
}) {
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const [cur, setCur] = useState<ShipmentOrder>(order);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const notes = followUpNotes(cur);
  const lang: Lang = ar ? 'ar' : 'en';
  const isManager = NOTE_MANAGERS.has(String(user?.role || ''));

  const apply = (o: ShipmentOrder) => { setCur(o); onSaved(o); };

  const add = async () => {
    const note = text.trim();
    if (!note) return;
    setBusy('new');
    try {
      const r = await api.post<{ order: ShipmentOrder }>(`/api/shipment-orders/orders/${cur._id}/note`, { note });
      apply(r.order);
      setText('');
      notify(ar ? 'أُضيفت الملاحظة.' : 'Note added.', 'success');
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر حفظ الملاحظة.' : 'Could not save the note.'), 'error');
    }
    setBusy(null);
  };

  const saveEdit = async () => {
    if (!editing || !editing.text.trim()) return;
    setBusy(editing.id);
    try {
      const r = await api.put<{ order: ShipmentOrder }>(`/api/shipment-orders/orders/${cur._id}/note/${editing.id}`, { note: editing.text.trim() });
      apply(r.order);
      setEditing(null);
      notify(ar ? 'عُدّلت الملاحظة.' : 'Note updated.', 'success');
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر التعديل.' : 'Could not update.'), 'error');
    }
    setBusy(null);
  };

  const remove = async (id: string) => {
    const ok = await confirm(ar ? 'حذف هذه الملاحظة؟' : 'Delete this note?');
    if (!ok) return;
    setBusy(id);
    try {
      const r = await api.delete<{ order: ShipmentOrder }>(`/api/shipment-orders/orders/${cur._id}/note/${id}`);
      apply(r.order);
      notify(ar ? 'حُذفت الملاحظة.' : 'Note deleted.', 'success');
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر الحذف.' : 'Could not delete.'), 'error');
    }
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900">{ar ? 'ملاحظات المتابعة' : 'Follow-up notes'}</p>
            <p className="text-sm text-slate-500 mt-0.5 break-words">
              {ar ? 'أمر نقل' : 'Transport order'} <span className="font-mono font-bold text-slate-700">{orderRef(cur)}</span>
              {cur.customerName ? ` · ${cur.customerName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Adding comes first: it is the most frequent action. */}
          <textarea rows={3} value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
            placeholder={ar ? 'اكتب ملاحظة جديدة… مثلًا: كلّمتُ السائق، يصل بعد ساعتين' : 'Write a new note… e.g. Called the driver, arriving in two hours'}
            className="w-full px-4 py-3 rounded-xl bg-white border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {ar ? 'لا تغيّر الحالة ولا تُطبَع في أمر النقل.' : 'Does not change the status or print on the waybill.'}
            </p>
            <button type="button" onClick={add} disabled={busy === 'new' || !text.trim()}
              className="min-h-[44px] shrink-0 inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#f37121] text-white text-base font-semibold hover:bg-[#e06010] disabled:opacity-50">
              {busy === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {ar ? 'إضافة' : 'Add'}
            </button>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <p className="text-sm font-bold text-slate-700 mb-2">
              {ar ? 'كلّ الملاحظات' : 'All notes'} <span className="text-slate-400 font-normal">({notes.length})</span>
            </p>
            {!notes.length && (
              <p className="text-sm text-slate-400 py-4 text-center">{ar ? 'لا ملاحظات بعد.' : 'No notes yet.'}</p>
            )}
            <ul className="space-y-2">
              {notes.map((n) => {
                const id = String(n._id || '');
                const pureNote = n.from === n.to && !n.fileUrl && !(n.files || []).length;
                const canEdit = !!id && pureNote && (isManager || (!!n.by && String(n.by) === String(user?._id)));
                const isEditing = editing?.id === id;
                return (
                  <li key={id || n.at} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 break-words">{n.byName || (ar ? 'غير معروف' : 'Unknown')}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {fmtDT(n.at, lang)} · {relTime(n.at, ar)}
                          {n.editedAt ? <span className="text-amber-600"> · {ar ? 'عُدّلت' : 'edited'}{n.editedByName ? ` (${n.editedByName})` : ''}</span> : null}
                          {!pureNote ? <span className="text-slate-400"> · {ar ? 'مع تغيير الحالة' : 'with a status change'}</span> : null}
                        </p>
                      </div>
                      {canEdit && !isEditing && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => setEditing({ id, text: n.note || '' })} aria-label={ar ? 'تعديل' : 'Edit'}
                            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-white">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => remove(id)} disabled={busy === id} aria-label={ar ? 'حذف' : 'Delete'}
                            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-white disabled:opacity-50">
                            {busy === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <textarea rows={3} autoFocus value={editing.text} maxLength={500}
                          onChange={(e) => setEditing({ id, text: e.target.value })}
                          className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditing(null)} className="min-h-[40px] px-4 text-sm text-slate-500 hover:text-slate-900">
                            {ar ? 'إلغاء' : 'Cancel'}
                          </button>
                          <button type="button" onClick={saveEdit} disabled={busy === id || !editing.text.trim()}
                            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 rounded-xl bg-[#12325C] text-white text-sm font-semibold disabled:opacity-50">
                            {busy === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {ar ? 'حفظ التعديل' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-base leading-relaxed text-slate-900 whitespace-pre-wrap break-words">{n.note}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
          <button type="button" onClick={onClose} className="min-h-[44px] px-5 rounded-xl border border-slate-200 text-slate-700 text-base font-semibold hover:bg-slate-50">
            <MessageSquareText className="w-4 h-4 inline me-1.5 -mt-0.5" />{ar ? 'تم' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
