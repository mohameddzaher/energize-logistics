'use client';
// ── طرقُ عرض الشحنات: جدول · شبكة · بطاقات ─────────────────────────────────
// أكثرُ من يفتح القسمَ يفتحه من الجوّال، والجدولُ هناك يُسحَب يمينًا ويسارًا.
// فالبطاقةُ شحنةٌ كاملةٌ في مربّعٍ واحد يُقرأ على عرض ٣٢٠ بكسل بلا سحب، وعليها
// ما يُفعَل بها: تغييرُ الحالة (بالنافذة نفسِها: سببُ الإلغاء ورفعُ السند)،
// والاتّصالُ وواتساب، وملاحظةُ متابعة، والبوليصة. والشبكةُ البطاقةُ نفسُها أصغر.
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
/** المفتاحُ كما يردّه الخادم — النقطةُ تُحفَظ ‹:› (مونغو لا يقبلها في المفاتيح). */
export const VIEW_PREF_READ_KEY = 'shipmentOrders:view';

export type FollowUpEntry = { from?: string; to?: string; note?: string; at?: string; byName?: string };

/** آخرُ متابعةٍ مكتوبة: أحدثُ قيدٍ في السجلّ له ملاحظة. */
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

/** الرسالةُ الجاهزة للسائق — نفسُها في الجدول والبطاقة. */
export const driverMessage = (o: ShipmentOrder, ar: boolean) => (ar
  ? `السلام عليكم، بخصوص البوليصة رقم ${orderRef(o)}${o.fromCity ? ` (${o.fromCity} — ${o.toCity || ''})` : ''}`
  : `Hello, regarding waybill ${orderRef(o)}${o.fromCity ? ` (${o.fromCity} — ${o.toCity || ''})` : ''}`);

/** شارةُ الحالة: لونُ الحالة المعروفة، أو لونُ ما زاده القسمُ من إعداداته. */
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

function Field({ label, children, compact }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`${compact ? 'text-[10.5px]' : 'text-[11px]'} text-slate-400 font-medium`}>{label}</p>
      <div className={`${compact ? 'text-[12.5px]' : 'text-sm'} text-slate-900 font-semibold break-words`}>{children}</div>
    </div>
  );
}

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
 * بطاقةُ شحنة. `compact` = الشبكة (أعمدةٌ عدّة على الشاشة الواسعة)، وبدونها
 * البطاقةُ الكبيرةُ بعرض الشاشة — أزرارُها ٤٤ بكسل فأكثر ليُضغَط عليها بالإبهام.
 */
export function OrderCard({
  order: o, compact, ar, lang, vocab, editor, picked, busy, downloading,
  onTogglePick, onOpen, onFollowUp, onNote, onDownload, onEdit,
}: OrderCardProps) {
  const pill = statusPill(o, vocab, lang);
  const fu = lastFollowUp(o);
  const tripNote = String(o.notes || '').trim();
  const phone = String(o.driverPhone || '').trim();
  const wa = phone ? waLink(phone, driverMessage(o, ar)) : null;
  const tel = phone ? telLink(phone) : null;
  const plate = String((o as any).vehiclePlate || '').trim();
  const btn = compact ? 'min-h-[40px] px-2.5 text-xs' : 'min-h-[44px] px-3.5 text-sm';
  const iconBtn = compact ? 'w-10 h-10' : 'w-11 h-11';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <article
      onClick={() => onOpen(o)}
      className={`bg-white rounded-2xl border shadow-sm cursor-pointer transition hover:shadow-md flex flex-col min-w-0 ${
        picked ? 'border-[#f37121] ring-1 ring-[#f37121]/40' : 'border-slate-200 hover:border-slate-300'}`}>
      {/* الرأس: المرجعُ والمصدرُ والحالة، ومربّعُ التحديد للبوالص الجماعيّة. */}
      <header className={`flex items-start gap-2.5 border-b border-slate-100 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
        <label className={`shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 ${compact ? 'w-8 h-8' : 'w-10 h-10 -ms-1.5'}`}
          onClick={stop}>
          <input type="checkbox" className="w-4 h-4 accent-[#f37121]" checked={picked}
            onChange={() => onTogglePick(o._id)} aria-label={ar ? `تحديد ${orderRef(o)}` : `Select ${orderRef(o)}`} />
        </label>
        <div className="min-w-0 flex-1">
          <p className={`font-bold font-mono text-[#12325C] break-all ${compact ? 'text-sm' : 'text-base'}`}>
            {orderRef(o)}
            <span className={`ms-2 align-middle inline-block rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold ${
              (o as any).source === 'platform' ? 'bg-slate-100 text-slate-500' : 'bg-orange-50 text-[#f37121]'}`}>
              {(o as any).source === 'platform' ? (ar ? 'منصّة' : 'Platform') : (ar ? 'الخاص بنا' : 'Ours')}
            </span>
          </p>
          <p className={`text-slate-700 font-medium break-words ${compact ? 'text-xs' : 'text-[13px]'} mt-0.5`}>{o.customerName || '—'}</p>
        </div>
        <span className={`shrink-0 rounded-full font-semibold whitespace-nowrap ${compact ? 'text-[10.5px] px-2 py-0.5' : 'text-xs px-2.5 py-1'} ${pill.className}`}
          style={pill.style}>
          {pill.label}
        </span>
      </header>

      <div className={`flex-1 ${compact ? 'px-3 py-2.5 space-y-2' : 'px-4 py-3 space-y-3'}`}>
        {/* «من» و«إلى» سطران موسومان — السهمُ في سطرٍ واحد يُقرأ عكسَه في العربيّة. */}
        <div className="grid grid-cols-2 gap-3">
          <Field compact={compact} label={ar ? 'من' : 'From'}>{o.fromCity || '—'}</Field>
          <Field compact={compact} label={ar ? 'إلى' : 'To'}>{o.toCity || '—'}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field compact={compact} label={ar ? 'السائق' : 'Driver'}>
            {o.driverName || '—'}
            {phone ? <span className="block text-[11px] text-slate-400 font-mono font-normal" dir="ltr">{phone}</span> : null}
          </Field>
          <Field compact={compact} label={ar ? 'الشاحنة' : 'Truck'}>
            {o.truckType || '—'}
            {plate ? <span className="block text-[11px] text-slate-400 font-mono font-normal" dir="ltr">{plate}</span> : null}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field compact={compact} label={ar ? 'وقت الاستلام' : 'Pickup'}>
            <span className="font-medium">{o.pickupTime ? fmtDT(o.pickupTime, lang) : '—'}</span>
          </Field>
          <Field compact={compact} label={ar ? 'الحمولة' : 'Cargo'}>{o.cargoType || '—'}</Field>
        </div>
        {/* المالُ كما في الجدول: يراه من يرى الجدول. */}
        {(o.sellPrice != null || o.buyPrice != null) && (
          <Field compact={compact} label={ar ? 'بيع / شراء' : 'Sell / buy'}>
            <span className="tabular-nums">{money(o.sellPrice)} / {money(o.buyPrice)}</span>
          </Field>
        )}

        {tripNote && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
              <StickyNote className="w-3.5 h-3.5" />{ar ? 'ملاحظة البوليصة' : 'Waybill note'}
            </p>
            <p className={`text-amber-900 mt-0.5 break-words whitespace-pre-wrap ${compact ? 'text-xs line-clamp-3' : 'text-[13px]'}`}>{tripNote}</p>
          </div>
        )}
        {fu && (
          <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2">
            <p className="text-[11px] font-bold text-sky-700 flex items-center gap-1 flex-wrap">
              <MessageSquareText className="w-3.5 h-3.5" />{ar ? 'آخر متابعة' : 'Latest follow-up'}
              <span className="font-normal text-sky-600">
                {fu.byName ? `· ${fu.byName} ` : ''}· {relTime(fu.at, ar)}
              </span>
            </p>
            <p className={`text-sky-950 mt-0.5 break-words whitespace-pre-wrap ${compact ? 'text-xs line-clamp-3' : 'text-[13px]'}`}>{fu.note}</p>
          </div>
        )}
      </div>

      {/* صفُّ الإجراءات — لا يفتح التفاصيلَ إذا ضُغط. */}
      <footer onClick={stop}
        className={`flex flex-wrap items-center gap-2 border-t border-slate-100 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
        {editor && (
          <button type="button" onClick={() => onFollowUp(o)} disabled={busy}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#f37121] hover:bg-[#e06010] text-white font-semibold disabled:opacity-60 ${btn}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {ar ? 'تغيير الحالة' : 'Change status'}
          </button>
        )}
        {editor && (
          <button type="button" onClick={() => onNote(o)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#12325C] font-semibold ${btn}`}>
            <MessageSquareText className="w-4 h-4" />
            {ar ? 'ملاحظة' : 'Note'}
          </button>
        )}
        <div className="flex items-center gap-2 ms-auto">
          {tel && (
            <a href={tel} title={ar ? 'اتصال بالسائق' : 'Call driver'} aria-label={ar ? 'اتصال بالسائق' : 'Call driver'}
              className={`${iconBtn} rounded-xl flex items-center justify-center bg-blue-500/15 text-blue-600 hover:bg-blue-500/30`}>
              <Phone className="w-5 h-5" />
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="WhatsApp"
              className={`${iconBtn} rounded-xl flex items-center justify-center bg-green-500/15 text-green-600 hover:bg-green-500/30`}>
              <MessageCircle className="w-5 h-5" />
            </a>
          )}
          <button type="button" onClick={() => onDownload(o)} disabled={downloading}
            title={ar ? 'تحميل البوليصة PDF' : 'Download waybill PDF'} aria-label={ar ? 'تحميل البوليصة PDF' : 'Download waybill PDF'}
            className={`${iconBtn} rounded-xl flex items-center justify-center bg-slate-100 text-slate-600 hover:text-[#f37121] hover:bg-slate-200 disabled:opacity-50`}>
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
          </button>
          {editor && !compact && (
            <button type="button" onClick={() => onEdit(o)}
              title={ar ? 'تعديل' : 'Edit'} aria-label={ar ? 'تعديل' : 'Edit'}
              className={`${iconBtn} rounded-xl flex items-center justify-center bg-slate-100 text-slate-600 hover:text-blue-600 hover:bg-slate-200`}>
              <Pencil className="w-5 h-5" />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
