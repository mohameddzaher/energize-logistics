'use client';
// ── ملاحظةُ متابعة بلا تغيير حالة ──────────────────────────────────────────
// «كلّمتُ السائق: يصل بعد ساعتين» — تُقيَّد في سجلّ الشحنة (مَن، متى، ماذا)
// ولا تمسّ الحالة. وهي غيرُ «ملاحظة البوليصة» التي تُطبَع في الورقة.
import { useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import type { ShipmentOrder } from '@/lib/shipmentOrders';
import { lastFollowUp, orderRef, relTime } from './OrderViews';

export default function NoteModal({ order, ar, onClose, onSaved }: {
  order: ShipmentOrder;
  ar: boolean;
  onClose: () => void;
  /** الشحنةُ كما ردّها الخادم بعد القيد — لتتحدّث البطاقةُ فورًا. */
  onSaved: (o: ShipmentOrder) => void;
}) {
  const { notify } = useDialog();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const prev = lastFollowUp(order);

  const save = async () => {
    const note = text.trim();
    if (!note) { notify(ar ? 'اكتب الملاحظة.' : 'Write the note.', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ order: ShipmentOrder }>(`/api/shipment-orders/orders/${order._id}/note`, { note });
      onSaved(r.order);
      notify(ar ? 'حُفظت الملاحظة.' : 'Note saved.', 'success');
      onClose();
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر حفظ الملاحظة.' : 'Could not save the note.'), 'error');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-slate-900">{ar ? 'ملاحظة متابعة' : 'Follow-up note'}</p>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              {ar ? 'بوليصة' : 'Waybill'} <span className="font-mono font-bold">{orderRef(order)}</span>
              {order.customerName ? ` · ${order.customerName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {prev && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2">
              <p className="text-[11px] font-bold text-sky-700">
                {ar ? 'آخر متابعة' : 'Latest follow-up'}
                <span className="font-normal text-sky-600"> {prev.byName ? `· ${prev.byName} ` : ''}· {relTime(prev.at, ar)}</span>
              </p>
              <p className="text-[13px] text-sky-950 mt-0.5 whitespace-pre-wrap break-words">{prev.note}</p>
            </div>
          )}
          <textarea rows={4} autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
            placeholder={ar ? 'مثلًا: كلّمتُ السائق، يصل بعد ساعتين…' : 'e.g. Called the driver, arriving in two hours…'}
            className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          <p className="text-[11px] text-slate-400">
            {ar ? 'تُقيَّد في سجلّ الشحنة ولا تغيّر حالتها، ولا تُطبَع في البوليصة.' : 'Logged in the shipment history; does not change the status or print on the waybill.'}
          </p>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 text-slate-500 hover:text-slate-900 text-sm">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button type="button" onClick={save} disabled={busy || !text.trim()}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#f37121] text-white text-sm font-semibold hover:bg-[#e06010] disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {ar ? 'حفظ الملاحظة' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}
