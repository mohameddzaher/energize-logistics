'use client';
// Shipment display modes: table, grid, cards.
// Most users open the section on mobile, where the table scrolls sideways. A card is a full shipment in one box readable at 320 px without scrolling, with its actions: status change (same dialog: cancel reason and receipt upload), call and WhatsApp, a follow-up note, and the waybill. The grid is the same card smaller.
import type { CSSProperties } from 'react';
import {
  Table2, LayoutGrid, Rows3, RefreshCw, Loader2, FileDown, Phone, MessageCircle,
  StickyNote, MessageSquareText, Pencil,
} from 'lucide-react';
import {
  ShipmentOrder, StatusVocab, orderStatus, statusLabel, vocabLabel, fmtDT, money, Lang,
} from '@/lib/shipmentOrders';
import { waLink, telLink } from '@/lib/crm';

export type ViewMode = 'table' | 'grid' | 'cards';
export const VIEW_MODES: ViewMode[] = ['table', 'grid', 'cards'];
export const VIEW_PREF_KEY = 'shipmentOrders.view';
/** Key as returned by the server; the dot is stored as ':' (Mongo does not accept dots in keys). */
export const VIEW_PREF_READ_KEY = 'shipmentOrders:view';

export type FollowUpEntry = { from?: string; to?: string; note?: string; at?: string; byName?: string };

/** Latest written follow-up: the newest log entry that has a note. */
export function lastFollowUp(o: ShipmentOrder): FollowUpEntry | null {
  const log = o.statusLog || [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (String(log[i]?.note || '').trim()) return log[i];
  }
  return null;
}

export function relTime(iso: string | undefined, ar: boolean): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return ar ? 'الآن' : 'just now';
  if (m < 60) return ar ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return ar ? `منذ ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return ar ? `منذ ${d} يوم` : `${d}d ago`;
}

export const orderRef = (o: ShipmentOrder) => String((o as any).reference || o.waybillNumber || '');

/** Status badge: the color of a known status, or the color of one the section added in its settings. */
export function statusPill(o: ShipmentOrder, vocab: StatusVocab[], lang: Lang): { className: string; style?: CSSProperties; label: string } {
  const st = orderStatus(o.status);
  const sv = vocab.find((x) => x.key === o.status) || null;
  return {
    className: st ? `${st.bg} ${st.text}` : 'bg-slate-100 text-slate-700',
    style: st ? undefined : (sv ? { background: `${sv.color}1a`, color: sv.color } : undefined),
    label: sv ? vocabLabel(sv, lang) : statusLabel(o.status, lang),
  };
}

export function ViewSwitcher({ value, onChange, ar }: { value: ViewMode; onChange: (v: ViewMode) => void; ar: boolean }) {
  const items: [ViewMode, string, typeof Table2][] = [
    ['table', ar ? 'جدول' : 'Table', Table2],
    ['grid', ar ? 'شبكة' : 'Grid', LayoutGrid],
    ['cards', ar ? 'بطاقات' : 'Cards', Rows3],
  ];
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1 gap-1 shrink-0" role="tablist" aria-label={ar ? 'طريقة العرض' : 'View mode'}>
      {items.map(([k, label, Icon]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${
            value === k ? 'bg-white text-[#12325C] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          <Icon className="w-4 h-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** All follow-up notes, newest first. */
export function followUpNotes(o: ShipmentOrder) {
  return [...(o.statusLog || [])].filter((l) => String(l?.note || '').trim()).reverse();
}

/** Info line: label in a fixed column and value in a clear font, so the card reads as two ordered columns. */
function InfoRow({ label, children, compact }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`flex items-baseline gap-3 ${compact ? 'py-1.5' : 'py-2.5'}`}>
      <dt className={`shrink-0 text-slate-500 font-medium ${compact ? 'w-16 text-xs' : 'w-24 text-sm'}`}>{label}</dt>
      <dd className={`min-w-0 flex-1 text-slate-900 font-semibold break-words ${compact ? 'text-[13px]' : 'text-[15px] leading-snug'}`}>{children}</dd>
    </div>
  );
}

import { paymentKindLabel } from '@/lib/paymentKind';

/** Who owns the truck, as a word: company, freelancer or our fleet. */
export const ownerKindLabel = (k: unknown, ar: boolean) => (
  { company: ar ? 'شركة' : 'Company', freelancer: ar ? 'فريلانسر' : 'Freelancer', ours: ar ? 'أسطولنا' : 'Our fleet' } as Record<string, string>)[String(k || '')] || '';

export interface OrderCardProps {
  order: ShipmentOrder;
  compact?: boolean;
  ar: boolean;
  lang: Lang;
  vocab: StatusVocab[];
  editor: boolean;
  picked: boolean;
  busy: boolean;
  downloading: boolean;
  onTogglePick: (id: string) => void;
  onOpen: (o: ShipmentOrder) => void;
  onFollowUp: (o: ShipmentOrder) => void;
  onNote: (o: ShipmentOrder) => void;
  onDownload: (o: ShipmentOrder) => void;
  onEdit: (o: ShipmentOrder) => void;
}

/**
 * Shipment card. `compact` = the grid (several columns on wide screens); otherwise the large full-width card.
 * On mobile it needed zoom, so it is laid out in clear sections: header (waybill, status, customer), route in its box, info lines (fixed-width label, 15 px value), notes, then buttons with text labels, not icons alone.
 */
export function OrderCard({
  order: o, compact, ar, lang, vocab, editor, picked, busy, downloading,
  onTogglePick, onOpen, onFollowUp, onNote, onDownload, onEdit,
}: OrderCardProps) {
  const pill = statusPill(o, vocab, lang);
  const notes = followUpNotes(o);
  const fu = notes[0] || null;
  const tripNote = String(o.notes || '').trim();
  const phone = String(o.driverPhone || '').trim();
  const wa = phone ? waLink(phone) : null;
  const tel = phone ? telLink(phone) : null;
  const plate = String((o as any).vehiclePlate || '').trim();
  const pad = compact ? 'px-3' : 'px-4 sm:px-5';
  const bigBtn = compact ? 'min-h-[40px] text-[13px]' : 'min-h-[48px] text-base';
  const smallBtn = compact ? 'min-h-[38px] text-xs' : 'min-h-[46px] text-sm';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const isPlatform = (o as any).source === 'platform';

  return (
    <article
      onClick={() => onOpen(o)}
      className={`bg-white rounded-2xl border shadow-sm cursor-pointer transition hover:shadow-md flex flex-col min-w-0 overflow-hidden ${
        picked ? 'border-[#f37121] ring-2 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
      {/* Header: waybill number and status, then customer */}
      <header className={`${pad} ${compact ? 'pt-3 pb-2.5' : 'pt-4 pb-3'} border-b border-slate-100`}>
        <div className="flex items-center gap-2">
          <label className={`shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 ${compact ? 'w-8 h-8 -ms-1' : 'w-10 h-10 -ms-2'}`}
            onClick={stop}>
            <input type="checkbox" className="w-5 h-5 accent-[#f37121]" checked={picked}
              onChange={() => onTogglePick(o._id)} aria-label={ar ? `تحديد ${orderRef(o)}` : `Select ${orderRef(o)}`} />
          </label>
          <span className={`font-bold font-mono text-[#12325C] ${compact ? 'text-base' : 'text-xl'}`} dir="ltr">{orderRef(o)}</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${isPlatform ? 'bg-slate-100 text-slate-500' : 'bg-orange-50 text-[#f37121]'}`}>
            {isPlatform ? (ar ? 'منصّة' : 'Platform') : (ar ? 'الخاص بنا' : 'Ours')}
          </span>
          <span className={`ms-auto shrink-0 rounded-full font-bold whitespace-nowrap ${compact ? 'text-xs px-2.5 py-1' : 'text-sm px-3.5 py-1.5'} ${pill.className}`}
            style={pill.style}>
            {pill.label}
          </span>
        </div>
        <p className={`text-slate-800 font-semibold break-words mt-1.5 ${compact ? 'text-sm' : 'text-base'}`}>{o.customerName || '—'}</p>
      </header>

      <div className={`flex-1 ${pad} ${compact ? 'py-2.5' : 'py-3.5'} space-y-3`}>
        {/* Route: 'from' above 'to' with two dots and a line; reads correctly in Arabic and English. */}
        <div className={`rounded-xl bg-slate-50 border border-slate-100 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center pt-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#12325C]" />
              <span className={`w-px bg-slate-300 ${compact ? 'h-5' : 'h-7'}`} />
              <span className="w-2.5 h-2.5 rounded-full bg-[#f37121]" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="min-w-0">
                <span className={`inline-block text-slate-500 font-medium ${compact ? 'w-7 text-xs' : 'w-10 text-sm'}`}>{ar ? 'من' : 'From'}</span>
                <span className={`font-bold text-slate-900 break-words ${compact ? 'text-sm' : 'text-[17px]'}`}>{o.fromCity || '—'}</span>
              </p>
              <p className="min-w-0">
                <span className={`inline-block text-slate-500 font-medium ${compact ? 'w-7 text-xs' : 'w-10 text-sm'}`}>{ar ? 'إلى' : 'To'}</span>
                <span className={`font-bold text-slate-900 break-words ${compact ? 'text-sm' : 'text-[17px]'}`}>{o.toCity || '—'}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Info: one line each. */}
        <dl className="divide-y divide-slate-100">
          <InfoRow compact={compact} label={ar ? 'السائق' : 'Driver'}>
            {o.driverName || '—'}
            {/* The ltr number inside a line follows the page direction, so it stays under the name instead of at the far end. */}
            {phone ? <span className={`block font-mono font-medium text-slate-500 ${compact ? 'text-xs' : 'text-sm'}`}><bdi dir="ltr">{phone}</bdi></span> : null}
          </InfoRow>
          <InfoRow compact={compact} label={ar ? 'الشاحنة' : 'Truck'}>
            {o.truckType || '—'}
            {plate ? <span className={`block font-mono font-medium text-slate-500 whitespace-nowrap ${compact ? 'text-xs' : 'text-sm'}`}><bdi dir="ltr">{plate}</bdi></span> : null}
          </InfoRow>
          <InfoRow compact={compact} label={ar ? 'الاستلام' : 'Pickup'}>
            {o.pickupTime ? fmtDT(o.pickupTime, lang) : '—'}
          </InfoRow>
          {paymentKindLabel((o as any).paymentSubtype, ar) || (o as any).paymentMethod ? (
            <InfoRow compact={compact} label={ar ? 'نوع الدفع' : 'Payment'}>
              {paymentKindLabel((o as any).paymentSubtype, ar) || (o as any).paymentMethod}
            </InfoRow>
          ) : null}
          {/* A side the server did not send (sales see no purchase, the vendors team no selling) is absent from the row, so only what came is shown. */}
          {('sellPrice' in o && 'buyPrice' in o) && (o.sellPrice != null || o.buyPrice != null) && (
            <InfoRow compact={compact} label={ar ? 'بيع / شراء' : 'Sell / buy'}>
              <span className="tabular-nums">{money(o.sellPrice)} / {money(o.buyPrice)}</span>
            </InfoRow>
          )}
          {('sellPrice' in o) !== ('buyPrice' in o) && ((o as any).sellPrice ?? (o as any).buyPrice) != null && (
            <InfoRow compact={compact} label={'sellPrice' in o ? (ar ? 'سعر البيع' : 'Selling') : (ar ? 'سعر الشراء' : 'Purchase')}>
              <span className="tabular-nums">{money((o as any).sellPrice ?? (o as any).buyPrice)}</span>
            </InfoRow>
          )}
          {(o as any).supplierName || (o as any).ownerKind ? (
            <InfoRow compact={compact} label={ar ? 'مالك السيارة' : 'Truck owner'}>
              {[ownerKindLabel((o as any).ownerKind, ar), (o as any).supplierName].filter(Boolean).join(' — ')}
            </InfoRow>
          ) : null}
        </dl>

        {tripNote && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
            <p className={`font-bold text-amber-700 flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
              <StickyNote className="w-4 h-4" />{ar ? 'ملاحظة أمر النقل' : 'Transport order note'}
            </p>
            <p className={`text-amber-950 mt-1 break-words whitespace-pre-wrap ${compact ? 'text-xs line-clamp-3' : 'text-[15px] leading-relaxed'}`}>{tripNote}</p>
          </div>
        )}
        {fu && (
          <button type="button" onClick={(e) => { stop(e); onNote(o); }}
            className="w-full text-start rounded-xl bg-sky-50 border border-sky-200 px-3.5 py-2.5 hover:bg-sky-100/70">
            <p className={`font-bold text-sky-800 flex items-center gap-1.5 flex-wrap ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
              <MessageSquareText className="w-4 h-4" />{ar ? 'آخر ملاحظة' : 'Latest note'}
              <span className="font-medium text-sky-700">· {fu.byName || '—'} · {relTime(fu.at, ar)}</span>
            </p>
            <p className={`text-sky-950 mt-1 break-words whitespace-pre-wrap ${compact ? 'text-xs line-clamp-3' : 'text-[15px] leading-relaxed line-clamp-4'}`}>{fu.note}</p>
            {notes.length > 1 && (
              <p className={`mt-1.5 font-semibold text-sky-700 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
                {ar ? `عرض كلّ الملاحظات (${notes.length})` : `View all notes (${notes.length})`}
              </p>
            )}
          </button>
        )}
      </div>

      {/* Buttons: pressing them does not open the details. */}
      <footer onClick={stop} className={`border-t border-slate-100 bg-slate-50/60 ${pad} ${compact ? 'py-2.5' : 'py-3'} space-y-2`}>
        {editor && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onFollowUp(o)} disabled={busy}
              className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#f37121] hover:bg-[#e06010] text-white font-bold disabled:opacity-60 ${bigBtn}`}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
              {ar ? 'تغيير الحالة' : 'Change status'}
            </button>
            <button type="button" onClick={() => onNote(o)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#12325C] font-bold ${bigBtn}`}>
              <MessageSquareText className="w-5 h-5" />
              {ar ? 'الملاحظات' : 'Notes'}{notes.length ? ` (${notes.length})` : ''}
            </button>
          </div>
        )}
        <div className={`grid gap-2 ${editor && !compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          {tel ? (
            <a href={tel} className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 ${smallBtn}`}>
              <Phone className="w-4 h-4" />{ar ? 'اتصال' : 'Call'}
            </a>
          ) : <span className={`inline-flex items-center justify-center rounded-xl bg-slate-100 text-slate-400 ${smallBtn}`}>{ar ? 'لا رقم' : 'No phone'}</span>}
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-50 text-green-700 font-semibold hover:bg-green-100 ${smallBtn}`}>
              <MessageCircle className="w-4 h-4" />{ar ? 'واتساب' : 'WhatsApp'}
            </a>
          ) : <span className={`inline-flex items-center justify-center rounded-xl bg-slate-100 text-slate-400 ${smallBtn}`}>—</span>}
          <button type="button" onClick={() => onDownload(o)} disabled={downloading}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:text-[#f37121] disabled:opacity-50 ${smallBtn}`}>
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {ar ? 'أمر النقل' : 'Transport order'}
          </button>
          {editor && !compact && (
            <button type="button" onClick={() => onEdit(o)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:text-blue-600 ${smallBtn}`}>
              <Pencil className="w-4 h-4" />{ar ? 'تعديل' : 'Edit'}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
