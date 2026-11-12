'use client';
/**
 * Customer profile: everything known about a customer on one screen.
 * Customer data is edited in place. Routes are one table: every route worked or agreed, with its agreed price, tiers and trips, so a route worked with no agreed price (or priced but never worked) stands out. One component opened by the sales, operations and shipment-orders pages (see CustomersRegister).
 */
import { useState, useEffect, useCallback, useMemo, type ReactNode, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Spinner, ErrorNotice, PrimaryButton, Modal, Tabs, SearchableSelect,
} from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import CustomerPresence from '@/components/system/CustomerPresence';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';
import MonthPicker from '@/components/system/MonthPicker';
import DateRangeFilter from '@/components/system/DateRangeFilter';
import PortalAccountCard from '@/components/system/PortalAccountCard';
import { FormField, optionLabel, Lang, prefList, statusLabel as orderStatusLabel, orderStatus } from '@/lib/shipmentOrders';
import PrefMultiSelect from '@/components/customers/PrefMultiSelect';
import {
  canEditCustomers, canEditRoutePrices, ProfilePayload, RunRoute, AgreedRoute, PriceTier, tiersText, foldAr, fmtDay, fmtNum, priceSourceLabel,
} from '@/lib/customerRegistry';
import {
  ArrowRight, ArrowLeft, Pencil, KeyRound, Phone, Mail, Search, ChevronLeft, ChevronRight, Route,
  Hash, MapPin, Truck, Wallet, CalendarRange, BadgeCheck, CalendarClock, CalendarCheck, ClipboardList, Inbox, Signpost,
  Check, X, Loader2, Plus, Trash2, UserRound, ChevronDown,
} from 'lucide-react';

const SHEET_LIMIT = 50;

// `filter`: the column has a server-side Excel-style filter (GET /api/customer-registry/:id/trip-filters).
const SHEET_COLS: { key: string; ar: string; en: string; date?: boolean; num?: boolean; money?: boolean; filter?: boolean }[] = [
  { key: 'reportNumber', ar: 'رقم أمر النقل', en: 'Report #', filter: true },
  { key: 'reportDate', ar: 'التاريخ', en: 'Date', date: true },
  { key: 'fromLocation', ar: 'من', en: 'From', filter: true },
  { key: 'toLocation', ar: 'إلى', en: 'To', filter: true },
  { key: 'branch', ar: 'الفرع', en: 'Branch', filter: true },
  { key: 'carOwner', ar: 'المالك', en: 'Owner', filter: true },
  { key: 'carNumber', ar: 'المركبة', en: 'Vehicle', filter: true },
  { key: 'driverName', ar: 'السائق', en: 'Driver', filter: true },
  { key: 'applicationStatus', ar: 'حالة الشحنة', en: 'Application', filter: true },
  { key: 'executionStatus', ar: 'حالة التنفيذ', en: 'Execution', filter: true },
  { key: 'paymentMethod', ar: 'طريقة الدفع', en: 'Payment', filter: true },
  { key: 'purchaseValue', ar: 'قيمة الشراء', en: 'Purchase', num: true, money: true },
];

type TripPeriodMode = '' | 'this_month' | 'last_month' | 'month' | 'range';
type TripPeriod = { mode: TripPeriodMode; month: string; from: string; to: string };
const NO_PERIOD: TripPeriod = { mode: '', month: '', from: '', to: '' };

/** Query params for the period; the server resolves this/last month on the Riyadh calendar. */
const periodParams = (p: TripPeriod): Record<string, string> => {
  if (p.mode === 'this_month' || p.mode === 'last_month') return { preset: p.mode };
  if (p.mode === 'month' && p.month) return { month: p.month };
  if (p.mode === 'range' && (p.from || p.to)) return { ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}) };
  return {};
};

/**
 * Period bar of the customer file: all time, this month, last month, a chosen month, or a from/to range. Module-level so its inputs keep focus.
 * Takes the state setter, not a value callback: the range clear button sets from and to back to back, and a callback over a stale value would restore the first.
 */
function TripPeriodBar({ value, setValue, ar }: {
  value: TripPeriod; setValue: (fn: (p: TripPeriod) => TripPeriod) => void; ar: boolean;
}) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const opts: [TripPeriodMode, string, string][] = [
    ['', 'كلّ المدّة', 'All time'], ['this_month', 'هذا الشهر', 'This month'], ['last_month', 'الشهر الماضي', 'Last month'],
    ['month', 'شهر محدّد', 'A month'], ['range', 'من — إلى', 'Custom range'],
  ];
  const pick = (m: TripPeriodMode) => setValue((p) => {
    if (m === 'month') return { ...NO_PERIOD, mode: 'month', month: p.month || thisMonth };
    if (m === 'range') return { ...NO_PERIOD, mode: 'range', from: p.from, to: p.to };
    return { ...NO_PERIOD, mode: m };
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold">
        {opts.map(([m, a, e]) => (
          <button key={m || 'all'} type="button" onClick={() => pick(m)}
            className={`px-2.5 py-2 transition-colors ${value.mode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {ar ? a : e}
          </button>
        ))}
      </div>
      {value.mode === 'month' && (
        <MonthPicker ar={ar} allowEmpty={false} value={value.month}
          onChange={(v) => setValue(() => ({ ...NO_PERIOD, mode: 'month', month: v }))} />
      )}
      {value.mode === 'range' && (
        <DateRangeFilter ar={ar} from={value.from} to={value.to}
          onFrom={(v) => setValue((p) => ({ ...p, from: v }))} onTo={(v) => setValue((p) => ({ ...p, to: v }))} />
      )}
    </div>
  );
}

/** Route price tiers by vehicle count, e.g. 1-5 vehicles at one price, 6-10 at another; the count is what the customer requests on the route. The private operations price writes the top tier to the manifest, since a manifest is a single vehicle. Defined outside the page body because a component defined inside a render remounts and loses typed input. */
function TierEditor({ customerId, route, ar, onClose, onSaved }: {
  customerId: string; route: RunRoute; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  type Row = { min: string; max: string; price: string };
  const [rows, setRows] = useState<Row[]>(() => ((route.tiers || []).length
    ? (route.tiers as PriceTier[]).map((t) => ({ min: String(t.minTrucks), max: t.maxTrucks == null ? '' : String(t.maxTrucks), price: String(t.price) }))
    : [{ min: '1', max: '', price: '' }]));
  const [saving, setSaving] = useState(false);
  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  // A new tier starts after the end of the last one, so the count is not typed twice.
  const add = () => setRows((rs) => {
    const last = rs[rs.length - 1];
    const next = last && last.max ? String(Number(last.max) + 1) : '';
    return [...rs, { min: next, max: '', price: '' }];
  });
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/customer-registry/${customerId}/route-tiers`, {
        fromCity: route.from, toCity: route.to,
        tiers: rows.filter((r) => r.min || r.max || r.price)
          .map((r) => ({ minTrucks: Number(r.min), maxTrucks: r.max === '' ? null : Number(r.max), price: Number(r.price) })),
      });
      notify(ar ? 'حُفظت شرائحُ السعر' : 'Price tiers saved', 'success');
      onSaved();
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error');
    } finally { setSaving(false); }
  };
  const num = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
  return (
    <Modal open onClose={onClose} title={ar ? 'السعر بعدد السيارات' : 'Price by truck count'}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving}>{ar ? 'حفظ' : 'Save'}</PrimaryButton>
        </>
      )}>
      <p className="text-[14px] font-bold text-slate-900">{route.from} ← {route.to}</p>
      <p className="text-[12.5px] text-slate-500">
        {ar ? 'السعرُ للسيارة الواحدة، بحسب عدد السيارات التي يطلبها العميل على هذا المسار. اترك «إلى» فارغةً في آخر شريحةٍ لتعني «فما فوق». و«التشغيل — خاصّ» يكتب للأمر نقل أعلى سعرٍ هنا (أمر النقل سيارةٌ واحدة ولا يُعرَف منه العدد)، ويُعدَّل هناك بيده.'
          : 'Price per truck, by how many trucks the customer orders on this route. Leave “to” empty on the last tier for “and above”. Operations — private applies the highest price here to each sheet (a sheet is one truck, the count is unknown) and it can be corrected there.'}
      </p>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 text-[11.5px] text-slate-500">
          <span>{ar ? 'من عدد' : 'From'}</span><span>{ar ? 'إلى عدد' : 'To'}</span><span>{ar ? 'سعر السيارة' : 'Price per truck'}</span><span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 items-center">
            <input type="number" min={1} inputMode="numeric" value={r.min} onChange={(e) => set(i, { min: e.target.value })} className={num} aria-label={ar ? 'من عدد' : 'From'} />
            <input type="number" min={1} inputMode="numeric" value={r.max} onChange={(e) => set(i, { max: e.target.value })} className={num} placeholder={ar ? 'فما فوق' : 'and above'} aria-label={ar ? 'إلى عدد' : 'To'} />
            <input type="number" min={0} inputMode="decimal" value={r.price} onChange={(e) => set(i, { price: e.target.value })} className={num} aria-label={ar ? 'سعر السيارة' : 'Price per truck'} />
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600" aria-label={ar ? 'حذف الشريحة' : 'Remove tier'}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="text-[13px] font-semibold text-[#f37121] hover:underline">{ar ? '+ شريحة أخرى' : '+ Another tier'}</button>
      {!!route.tiersBy && <p className="text-[11.5px] text-slate-400">{ar ? `آخر تعديل: ${route.tiersBy} — ${fmtDay(route.tiersAt)}` : `Last edited: ${route.tiersBy} — ${fmtDay(route.tiersAt)}`}</p>}
    </Modal>
  );
}

/** Shipment-form preferences autofilled for this customer; same keys and lists as the create form. */
const DEFAULT_KEYS: [string, string, string][] = [
  ['truckType', 'نوع الشاحنة', 'Truck type'],
  ['cargoType', 'نوع الحمولة', 'Cargo type'],
  ['paymentMethod', 'طريقة الدفع', 'Payment method'],
  ['driverRentType', 'نوع تأجير السائق', 'Driver rent type'],
  ['branch', 'الفرع', 'Branch'],
];

type RouteStatus = 'all' | 'priced' | 'no_price' | 'idle';

/** One row of the unified routes table: a route worked (from the sheets), agreed (price list), or both. */
interface URow {
  key: string; from: string; to: string;
  worked: boolean; agreed: boolean; priced: boolean;
  sheets: number; purchase?: number; lastAt: string | null;
  price: number | null; priceAt: string | null; priceSource: string; hits: number;
  tiers: PriceTier[]; tiersAt?: string | null; tiersBy?: string;
}

const routeKeyOf = (from: string, to: string) => `${foldAr(from)}→${foldAr(to)}`;

const statusLabel = (r: URow, ar: boolean, filtered: boolean): string => {
  if (r.worked && !r.priced) return ar ? 'بلا سعر متّفق' : 'No agreed price';
  if (!r.worked) return filtered ? (ar ? 'لا رحلات في الفترة' : 'No trips in period') : (ar ? 'لم يُعمل عليه' : 'Never worked');
  return ar ? 'مُسعَّر' : 'Priced';
};

/** A multi-value preference saved on each add or remove. Module-level so its busy state survives re-renders. */
function InlinePrefs({ value, options, editable, ar, onSave }: {
  value: string[]; options: { value: string; label: string }[]; editable: boolean; ar: boolean; onSave: (next: string[]) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const change = async (next: string[]) => { setBusy(true); await onSave(next); setBusy(false); };
  return <PrefMultiSelect value={value} options={options} disabled={!editable} busy={busy} ar={ar} onChange={change} />;
}

/** One figure in the KPI strip. Cells draw their own top/start border so a short last row leaves no grey gap. */
function KpiCell({ icon, label, value, tone = 'text-slate-900', sub }: {
  icon: ReactNode; label: string; value: ReactNode; tone?: string; sub?: ReactNode;
}) {
  return (
    <div className="min-w-0 border-t border-s border-slate-200 px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
        <span className="text-slate-400 shrink-0">{icon}</span>
        <span className="line-clamp-2 leading-snug" title={label}>{label}</span>
      </p>
      <div className={`mt-1.5 text-xl sm:text-2xl font-bold leading-tight tabular-nums break-words ${tone}`}>{value}</div>
      {sub}
    </div>
  );
}

/** Title row of a card or tab: name, row count, optional hint, then its own tools. */
function SectionBar({ icon, title, count, hint, children }: {
  icon: ReactNode; title: string; count?: number; hint?: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/70">
      <div className="min-w-0 lg:flex-1">
        <p className="flex items-center gap-2 font-bold text-slate-900 text-[14.5px]">
          <span className="text-[#f37121]">{icon}</span>
          {title}
          {count != null && (
            <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[11.5px] font-semibold text-slate-600 tabular-nums">
              {count.toLocaleString('en-US')}
            </span>
          )}
        </p>
        {hint && <p className="mt-0.5 text-[12px] text-slate-500">{hint}</p>}
      </div>
      {children && <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 lg:justify-end lg:shrink-0 whitespace-nowrap [&>*]:shrink-0">{children}</div>}
    </div>
  );
}

/** Local search box. Module-level so the input keeps focus while typing. */
function SearchBox({ value, onChange, placeholder, wide }: {
  value: string; onChange: (v: string) => void; placeholder: string; wide?: boolean;
}) {
  return (
    <div className="relative flex-1 sm:flex-none min-w-[10rem]">
      <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full ${wide ? 'sm:w-72' : 'sm:w-48'} ps-8 pe-2 py-2 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-900 focus:outline-none focus:border-[#f37121] focus:ring-2 focus:ring-[#f37121]/20`} />
    </div>
  );
}

/** Empty table body: what is missing and, when a filter caused it, the way back. */
function EmptyRow({ colSpan, title, hint, action }: {
  colSpan: number; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center"><Inbox className="w-5 h-5" /></span>
          <p className="text-[13.5px] font-semibold text-slate-700">{title}</p>
          {hint && <p className="text-[12px] text-slate-500 max-w-sm">{hint}</p>}
          {action}
        </div>
      </td>
    </tr>
  );
}

const inputCls = 'w-full px-2.5 py-1.5 rounded-lg border border-[#f37121] bg-white text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/25';

/**
 * A customer field shown as text and edited where it stands: click, type, Enter (Ctrl+Enter for notes) saves, Esc cancels.
 * A select saves on pick. Module-level so the input keeps focus while typing.
 */
function InlineField({ label, value, display, editable, kind = 'text', options, required, dir, ar, onSave, wide }: {
  label: string; value: string; display?: ReactNode; editable: boolean;
  kind?: 'text' | 'textarea' | 'select'; options?: { value: string; label: string }[];
  required?: boolean; dir?: 'ltr' | 'rtl'; ar: boolean; onSave: (v: string) => Promise<boolean>; wide?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = async (v: string) => {
    const next = kind === 'textarea' ? v : v.trim();
    if (required && !next.trim()) return;
    if (next === value) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
    if (e.key === 'Enter' && (kind !== 'textarea' || e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(draft); }
  };
  const empty = <span className="text-slate-400 font-normal">{editable ? (ar ? 'أضف…' : 'Add…') : '—'}</span>;

  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2 lg:col-span-4' : ''}`}>
      <p className="text-[11.5px] font-semibold text-slate-500 mb-1">{label}{required && editable ? ' *' : ''}</p>
      {kind === 'select' && editable ? (
        <div className="relative">
          <select value={value} disabled={saving} onChange={(e) => commit(e.target.value)}
            className="w-full appearance-none px-2.5 py-1.5 pe-7 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-900 hover:border-slate-300 focus:outline-none focus:border-[#f37121] focus:ring-2 focus:ring-[#f37121]/20 disabled:opacity-60">
            <option value="">—</option>
            {/* A saved value stays visible even if it left the list, so it is not silently wiped. */}
            {value && !(options || []).some((o) => o.value === value) && <option value={value}>{value}</option>}
            {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 absolute top-1/2 -translate-y-1/2 end-2 pointer-events-none" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 end-2 pointer-events-none" />}
        </div>
      ) : editing ? (
        <div className="flex items-start gap-1.5">
          {kind === 'textarea' ? (
            <textarea autoFocus rows={3} onFocus={(e) => e.currentTarget.select()} value={draft} dir={dir} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} className={inputCls} />
          ) : (
            <input autoFocus onFocus={(e) => e.currentTarget.select()} value={draft} dir={dir} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} className={inputCls} />
          )}
          <button type="button" onClick={() => commit(draft)} disabled={saving || (required && !draft.trim())}
            aria-label={ar ? 'حفظ' : 'Save'} title={ar ? 'حفظ' : 'Save'}
            className="shrink-0 p-1.5 rounded-lg bg-[#f37121] text-white hover:bg-[#e06010] disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button type="button" onClick={() => { setDraft(value); setEditing(false); }} disabled={saving}
            aria-label={ar ? 'إلغاء' : 'Cancel'} title={ar ? 'إلغاء' : 'Cancel'}
            className="shrink-0 p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : editable ? (
        <button type="button" onClick={() => setEditing(true)} title={ar ? 'انقر للتعديل' : 'Click to edit'}
          className="group w-full flex items-start justify-between gap-2 px-2.5 py-1.5 -mx-px rounded-lg border border-transparent text-start hover:border-slate-200 hover:bg-slate-50">
          <span className={`min-w-0 text-[13.5px] font-semibold text-slate-900 break-words ${kind === 'textarea' ? 'whitespace-pre-wrap' : ''}`} dir={dir}>
            {value ? (display ?? value) : empty}
          </span>
          <Pencil className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-300 group-hover:text-[#f37121]" />
        </button>
      ) : (
        <p className={`px-2.5 py-1.5 text-[13.5px] font-semibold text-slate-900 break-words ${kind === 'textarea' ? 'whitespace-pre-wrap' : ''}`} dir={dir}>
          {value ? (display ?? value) : empty}
        </p>
      )}
    </div>
  );
}

/** Agreed price cell: click to type a price, Enter saves, Esc cancels; an empty value clears the price. */
function InlinePrice({ value, editable, ar, onSave }: {
  value: number | null; editable: boolean; ar: boolean; onSave: (v: number | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const shown = value == null
    ? <span className="text-amber-700 font-semibold">{ar ? 'بلا سعر' : 'no price'}</span>
    : <span className="font-semibold text-slate-900">{fmtNum(value)}</span>;
  if (!editable) return shown;
  const commit = async () => {
    const t = draft.trim();
    const next = t === '' ? null : Number(t);
    if (next != null && (!Number.isFinite(next) || next < 0)) return;
    if (next === value) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  };
  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true); }}
        title={ar ? 'انقر لتعديل السعر' : 'Click to edit the price'}
        className="group inline-flex items-center gap-1.5 px-2 py-1 -my-1 rounded-md hover:bg-orange-50">
        {shown}<Pencil className="w-3 h-3 text-slate-300 group-hover:text-[#f37121]" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus onFocus={(e) => e.currentTarget.select()} type="number" min={0} inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-24 px-2 py-1 rounded-md border border-[#f37121] bg-white text-[13px] text-end tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/25"
        aria-label={ar ? 'السعر' : 'Price'} />
      <button type="button" onClick={commit} disabled={saving} aria-label={ar ? 'حفظ' : 'Save'}
        className="p-1 rounded-md bg-[#f37121] text-white hover:bg-[#e06010] disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label={ar ? 'إلغاء' : 'Cancel'}
        className="p-1 rounded-md text-slate-400 hover:text-slate-900"><X className="w-3.5 h-3.5" /></button>
    </span>
  );
}

/** Adds an agreed route from the profile. A route already in the list gets the new price instead of a duplicate row. */
function AddRouteForm({ cities, ar, onAdd, onClose }: {
  cities: { value: string; label: string }[]; ar: boolean;
  onAdd: (from: string, to: string, price: number | null) => Promise<boolean>; onClose: () => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const ok = !!from.trim() && !!to.trim() && (price === '' || Number(price) >= 0);
  const submit = async () => {
    if (!ok || saving) return;
    setSaving(true);
    const done = await onAdd(from.trim(), to.trim(), price === '' ? null : Number(price));
    setSaving(false);
    if (done) { setFrom(''); setTo(''); setPrice(''); }
  };
  const sel = (v: string, set: (x: string) => void, ph: string) => (
    <SearchableSelect value={v} onChange={set} searchAfter={0} allowCustom options={cities}
      placeholder={ph} searchPlaceholder={ar ? 'اكتب أو ابحث…' : 'Type or search…'}
      customHint={(t) => (ar ? `استعمل «${t}»` : `Use “${t}”`)} />
  );
  return (
    <div className="px-4 py-3 border-b border-slate-100 bg-orange-50/40">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem_auto] gap-2 items-end">
        <div className="min-w-0"><p className="text-[11.5px] font-semibold text-slate-500 mb-1">{ar ? 'من' : 'From'}</p>{sel(from, setFrom, ar ? 'من…' : 'From…')}</div>
        <div className="min-w-0"><p className="text-[11.5px] font-semibold text-slate-500 mb-1">{ar ? 'إلى' : 'To'}</p>{sel(to, setTo, ar ? 'إلى…' : 'To…')}</div>
        <div>
          <p className="text-[11.5px] font-semibold text-slate-500 mb-1">{ar ? 'السعر' : 'Price'}</p>
          <input type="number" min={0} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-end tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={submit} disabled={!ok || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'إضافة' : 'Add'}
          </PrimaryButton>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{ar ? 'إغلاق' : 'Close'}</button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerProfile({ id, basePath }: { id: string; basePath: string }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const guard = useLatestRequest();
  const rcf = useColumnFilters<URow>();
  const ocf = useColumnFilters<any>();

  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('routes');
  // Tiers of the open route are editable by the operations manager and the system admin only.
  const [tierRoute, setTierRoute] = useState<RunRoute | null>(null);
  const [routeQ, setRouteQ] = useState('');
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('all');
  const [adding, setAdding] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [fields, setFields] = useState<FormField[]>([]);

  // Trip filters, applied on the server: period, search and per-column values. They drive the cards, routes and trips together.
  const [period, setPeriod] = useState<TripPeriod>(NO_PERIOD);
  const [tripQ, setTripQ] = useState('');
  const [tripQd, setTripQd] = useState('');
  const [tripCf, setTripCf] = useState<Record<string, Set<string>>>({});
  const [cfOpts, setCfOpts] = useState<Record<string, { values: ColumnFilterOption[]; truncated: boolean }>>({});
  const [cfBusy, setCfBusy] = useState<Record<string, boolean>>({});
  useEffect(() => { const t = setTimeout(() => setTripQd(tripQ.trim()), 300); return () => clearTimeout(t); }, [tripQ]);

  const filterQs = useCallback((extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...periodParams(period), ...(tripQd ? { q: tripQd } : {}), ...extra });
    for (const [f, set] of Object.entries(tripCf)) set.forEach((v) => qs.append(`cf_${f}`, v));
    return qs;
  }, [period, tripQd, tripCf]);
  const filterSig = filterQs().toString();
  // A new filter starts from the first page; staying on page 7 of a narrower result shows an empty table.
  useEffect(() => { setPage(1); }, [filterSig]);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = filterQs({ page: String(page), limit: String(SHEET_LIMIT) });
      const d = await api.get<ProfilePayload>(`/api/customer-registry/${id}?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setData(d);
      setError('');
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, [id, page, guard, filterQs]);

  useEffect(() => { load(); }, [load]);
  // Every write (here, the register, another user) emits this event; the file re-reads so all open screens agree.
  useSocket('shipmentOrders:customers', useCallback(() => load(), [load]));

  // Same option lists the shipment-create form reads: cities for routes, values for the preferences.
  useEffect(() => {
    api.get<{ fields: FormField[] }>('/api/customer-registry/options').then((d) => setFields(d.fields || [])).catch(() => {});
  }, []);
  const optionsOf = useCallback((key: string) => (fields.find((f) => f.key === key)?.options || [])
    .map((o) => ({ value: o.key, label: optionLabel(o, lang as Lang) })), [fields, lang]);
  const cityOptions = useMemo(() => optionsOf('fromCity'), [optionsOf]);

  const optsGuard = useLatestRequest();
  const fetchCfOpts = useCallback(async (field: string, q2 = '') => {
    const mine = optsGuard.begin();
    setCfBusy((p) => ({ ...p, [field]: true }));
    try {
      const d = await api.get<any>(`/api/customer-registry/${id}/trip-filters?${filterQs({ field, ...(q2 ? { q2 } : {}) })}`);
      if (optsGuard.isCurrent(mine)) {
        const f = d?.filters?.[0];
        setCfOpts((p) => ({ ...p, [field]: { values: f?.values || [], truncated: !!f?.truncated } }));
      }
    } catch { /* keep the previous list */ }
    setCfBusy((p) => ({ ...p, [field]: false }));
  }, [id, filterQs, optsGuard]);
  const setTripFilter = (field: string, set: Set<string>) => setTripCf((prev) => {
    const next = { ...prev };
    if (set.size) next[field] = set; else delete next[field];
    return next;
  });
  const tripFiltersOn = !!(period.mode || tripQd || Object.keys(tripCf).length);
  const clearTripFilters = () => { setPeriod(NO_PERIOD); setTripQ(''); setTripQd(''); setTripCf({}); };

  const money = !!data && data.analysis.purchaseTotal !== undefined;
  const editor = canEditCustomers(user);
  const priceEditor = canEditRoutePrices(user);
  const filtered = !!data?.filtered;

  /** Partial save on the registry endpoint; the server keeps every field not sent and emits the live event. */
  const putCustomer = useCallback(async (patch: Record<string, any>, okMsg?: string): Promise<boolean> => {
    try {
      await api.put(`/api/customer-registry/${id}`, patch);
      notify(okMsg || (ar ? 'تم الحفظ' : 'Saved'), 'success');
      load();
      return true;
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error');
      return false;
    }
  }, [id, ar, notify, load]);

  // The price list is saved whole, as the edit dialog did; the server carries tiers over by route key.
  const saveRoutes = useCallback((routes: AgreedRoute[], okMsg?: string) => putCustomer({
    routes: routes.filter((r) => r.fromCity && r.toCity).map((r) => ({
      fromCity: r.fromCity, toCity: r.toCity, price: r.price == null ? null : Number(r.price),
      ...(r.at ? { at: r.at } : {}), ...(r.source ? { source: r.source } : {}), ...(r.hits ? { hits: r.hits } : {}),
    })),
  }, okMsg), [putCustomer]);

  const setRoutePrice = useCallback((from: string, to: string, price: number | null) => {
    const list = [...(data?.customer.routes || [])];
    const k = routeKeyOf(from, to);
    const i = list.findIndex((r) => routeKeyOf(r.fromCity, r.toCity) === k);
    // A price typed by hand is dated today with source "manual", so it wins as the latest agreed price.
    const stamp = { price, at: new Date().toISOString(), source: 'manual' };
    if (i >= 0) list[i] = { ...list[i], ...stamp };
    else list.unshift({ fromCity: from, toCity: to, hits: 1, ...stamp });
    return saveRoutes(list, ar ? 'حُفظ السعر' : 'Price saved');
  }, [data, saveRoutes, ar]);

  const removeRoute = useCallback(async (r: URow) => {
    const ok = await confirm({
      title: ar ? 'حذف السعر المتّفق عليه' : 'Remove agreed price',
      message: ar ? `يُحذف المسار ${r.from} ← ${r.to} من قائمة الأسعار المتّفق عليها. لا تتأثّر الرحلات المسجّلة.`
        : `${r.from} → ${r.to} will be removed from the agreed price list. Recorded trips are not affected.`,
      tone: 'danger', confirmLabel: ar ? 'حذف' : 'Remove',
    });
    if (!ok) return;
    await saveRoutes((data?.customer.routes || []).filter((x) => routeKeyOf(x.fromCity, x.toCity) !== r.key), ar ? 'حُذف المسار' : 'Route removed');
  }, [confirm, ar, saveRoutes, data]);

  // Routes worked (sheets) and routes agreed (price list) joined by the folded city pair.
  const urows = useMemo((): URow[] => {
    if (!data) return [];
    const m = new Map<string, URow>();
    for (const r of data.routes) {
      const key = routeKeyOf(r.from, r.to);
      m.set(key, {
        key, from: r.from, to: r.to, worked: (r.sheets || 0) > 0, agreed: false, priced: false,
        sheets: r.sheets || 0, purchase: r.purchase, lastAt: r.lastAt,
        price: r.price, priceAt: r.priceAt, priceSource: r.priceSource || '', hits: 0,
        tiers: r.tiers || [], tiersAt: r.tiersAt, tiersBy: r.tiersBy,
      });
    }
    for (const a of data.customer.routes) {
      const key = routeKeyOf(a.fromCity, a.toCity);
      const ex = m.get(key);
      const tiers = ((a as AgreedRoute & { tiers?: PriceTier[] }).tiers) || [];
      if (ex) {
        Object.assign(ex, { agreed: true, price: a.price, priceAt: a.at || null, priceSource: a.source || '', hits: a.hits || 1, tiers: ex.tiers.length ? ex.tiers : tiers });
      } else {
        m.set(key, {
          key, from: a.fromCity, to: a.toCity, worked: false, agreed: true, priced: false,
          sheets: 0, purchase: money ? 0 : undefined, lastAt: null,
          price: a.price, priceAt: a.at || null, priceSource: a.source || '', hits: a.hits || 1,
          tiers,
        });
      }
    }
    const rows = Array.from(m.values());
    for (const r of rows) {
      r.priced = r.price != null || r.tiers.length > 0;
    }
    // Worked routes first, busiest on top; agreed-only routes after, newest price first.
    return rows.sort((x, y) => (y.sheets - x.sheets) || (new Date(y.priceAt || 0).getTime() - new Date(x.priceAt || 0).getTime()));
  }, [data, money]);

  const statusCounts = useMemo(() => ({
    all: urows.length,
    priced: urows.filter((r) => r.worked && r.priced).length,
    no_price: urows.filter((r) => r.worked && !r.priced).length,
    idle: urows.filter((r) => !r.worked).length,
  }), [urows]);

  const ucols = useMemo(() => ([
    { key: 'from', ar: 'من', en: 'From' },
    { key: 'to', ar: 'إلى', en: 'To' },
    { key: 'status', ar: 'الحالة', en: 'Status' },
    { key: 'sheets', ar: 'الرحلات', en: 'Trips', num: true },
    { key: 'lastAt', ar: 'آخر رحلة', en: 'Last trip', date: true },
    ...(money ? [
      { key: 'purchase', ar: 'قيمة الشراء', en: 'Purchase', num: true },
    ] : []),
    { key: 'price', ar: 'السعر المتّفق', en: 'Agreed price', num: true },
    { key: 'tiers', ar: 'السعر بعدد السيارات', en: 'Price by truck count' },
    { key: 'priceAt', ar: 'تاريخ السعر', en: 'Price date', date: true },
    { key: 'priceSource', ar: 'مصدر السعر', en: 'Price source' },
    { key: 'hits', ar: 'تكرار', en: 'Seen', num: true },
  ] as { key: string; ar: string; en: string; num?: boolean; date?: boolean }[]), [money]);

  const ucell = useCallback((r: URow, key: string): string => {
    switch (key) {
      case 'status': return statusLabel(r, ar, filtered);
      case 'lastAt': case 'priceAt': return r[key] ? fmtDay(r[key]) : '';
      case 'sheets': return fmtNum(r.sheets);
      case 'purchase': case 'price': return r[key] == null ? '' : fmtNum(r[key]);
      case 'priceSource': return priceSourceLabel(r.priceSource, ar);
      case 'tiers': return tiersText(r.tiers, ar);
      case 'hits': return r.agreed ? String(r.hits || 1) : '';
      default: return String((r as any)[key] ?? '');
    }
  }, [ar, filtered]);
  const ugetters = useMemo(() => Object.fromEntries(ucols.map((c) => [c.key, (r: URow) => ucell(r, c.key)])), [ucols, ucell]);

  const routesSearched = useMemo(() => {
    const s = foldAr(routeQ);
    return urows.filter((r) => {
      if (routeStatus === 'priced' && !(r.worked && r.priced)) return false;
      if (routeStatus === 'no_price' && !(r.worked && !r.priced)) return false;
      if (routeStatus === 'idle' && r.worked) return false;
      return !s || foldAr(`${r.from} ${r.to}`).includes(s);
    });
  }, [urows, routeQ, routeStatus]);
  const routesShown = useMemo(() => rcf.apply(routesSearched, ugetters), [rcf, routesSearched, ugetters]);

  const ogetters = useMemo((): Record<string, (o: any) => any> => ({
    // The platform reference when there is one, else our waybill number; the same rule as the shipment-orders list.
    number: (o) => String(o.reference || o.waybillNumber || ''), createdAt: (o) => fmtDay(o.createdAt),
    fromCity: (o) => o.fromCity, toCity: (o) => o.toCity, truckType: (o) => o.truckType, supplierName: (o) => o.supplierName,
    vehiclePlate: (o) => o.vehiclePlate, salesRepName: (o) => o.salesRepName,
    sellPrice: (o) => (o.sellPrice == null ? '' : fmtNum(o.sellPrice)), status: (o) => orderStatusLabel(o.status, lang as Lang),
  }), [lang]);
  const orderCols = useMemo(() => ([
    ['number', 'رقم أمر النقل', 'Order no.'], ['createdAt', 'تاريخ الإنشاء', 'Created'], ['fromCity', 'من', 'From'], ['toCity', 'إلى', 'To'],
    ['truckType', 'نوع الشاحنة', 'Truck type'], ['supplierName', 'المورد', 'Supplier'], ['vehiclePlate', 'المركبة', 'Vehicle'],
    ['salesRepName', 'مندوب المبيعات', 'Sales rep'],
    ...(money ? [['sellPrice', 'سعر البيع', 'Selling price', true]] : []),
    ['status', 'الحالة', 'Status'],
  ] as [string, string, string, boolean?][]), [money]);
  const orderExportCols: ExportColumn[] = useMemo(() => orderCols.map(([k, la, le, num]) => ({
    header: ar ? la : le, key: k, type: num ? 'number' : 'text', transform: (_v: any, r: any) => (k === 'sellPrice' ? r.sellPrice : ogetters[k](r)),
  } as ExportColumn)), [orderCols, ar, ogetters]);
  const ordersShown = useMemo(() => ocf.apply(data?.orders || [], ogetters), [ocf, data, ogetters]);

  const routeExportCols: ExportColumn[] = useMemo(() => ucols.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key,
    type: c.num ? 'number' : c.date ? 'date' : 'text',
    ...(c.key === 'status' || c.key === 'priceSource' || c.key === 'tiers' ? { transform: (_v: any, r: any) => ucell(r as URow, c.key) } : {}),
  } as ExportColumn)), [ucols, ar, ucell]);

  const agreedExportCols: ExportColumn[] = useMemo(() => ([
    { header: ar ? 'من' : 'From', key: 'fromCity', width: 22 },
    { header: ar ? 'إلى' : 'To', key: 'toCity', width: 22 },
    { header: ar ? 'السعر' : 'Price', key: 'price', type: 'number' },
    { header: ar ? 'تاريخ السعر' : 'Price date', key: 'at', type: 'date' },
    { header: ar ? 'المصدر' : 'Source', key: 'source', transform: (v: any) => priceSourceLabel(v, ar) },
  ]), [ar]);

  const sheetCols = useMemo(() => SHEET_COLS.filter((c) => !c.money || money), [money]);
  const sheetExportCols: ExportColumn[] = useMemo(() => sheetCols.map((c) => ({
    header: ar ? c.ar : c.en, key: c.key, type: c.num ? 'number' : c.date ? 'date' : 'text',
  })), [sheetCols, ar]);

  const scope = exportScopeLabels(ar);

  if (loading) return <Spinner />;
  if (error) return <div className="p-6"><ErrorNotice error={error} lang={lang} onRetry={load} /></div>;
  if (!data) return <div className="text-slate-500 p-8">{ar ? 'العميل غير موجود' : 'Not found'}</div>;

  const c = data.customer;
  const a = data.analysis;
  // The server sends the code; the shared payload type predates it.
  const code = String((c as { customerCode?: string }).customerCode || '');
  const initial = Array.from(c.name.trim())[0] || '?';
  const defaults: Record<string, string[]> = Object.fromEntries(DEFAULT_KEYS.map(([k]) => [k, prefList(c.defaults?.[k])]));
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const th = 'px-3 py-3 font-semibold whitespace-nowrap';
  const td = 'px-3 py-2.5 whitespace-nowrap';
  const pricedPct = a.routesCount ? Math.round((a.pricedRoutes / a.routesCount) * 100) : 0;
  const pricedFull = a.pricedRoutes >= a.routesCount;
  const clearBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick}
      className="mt-1 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] text-[12.5px] font-semibold hover:bg-[#f37121]/20">
      {ar ? 'مسح الفلاتر' : 'Clear filters'}
    </button>
  );
  const pageFrom = data.sheets.total ? (data.sheets.page - 1) * SHEET_LIMIT + 1 : 0;
  const pageTo = Math.min(data.sheets.page * SHEET_LIMIT, data.sheets.total);
  const routeFiltersOn = !!routeQ || routeStatus !== 'all' || rcf.count > 0;
  const statusChips: [RouteStatus, string, string, string][] = [
    ['all', 'الكل', 'All', 'text-slate-700'],
    ['priced', 'مُسعَّرة', 'Priced', 'text-emerald-700'],
    ['no_price', 'بلا سعر متّفق', 'No agreed price', 'text-amber-700'],
    ['idle', filtered ? 'لا رحلات في الفترة' : 'لم يُعمل عليها', filtered ? 'No trips in period' : 'Never worked', 'text-slate-600'],
  ];

  return (
    <div className="space-y-4 sm:space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link href={basePath} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-[#f37121]">
        <Back className="w-4 h-4" /> {ar ? 'سجلّ العملاء' : 'Customer register'}
      </Link>

      {/* Identity: who the customer is, how to reach them, and the file's actions. */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="h-1 bg-[#f37121]" />
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-xl bg-[#f37121]/10 text-[#f37121] flex items-center justify-center text-xl sm:text-2xl font-extrabold">
              {initial}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 break-words">{c.name}</h1>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold border ${c.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {c.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-600">
                {code && (
                  <span className="inline-flex items-center gap-1" title={ar ? 'كود العميل' : 'Customer code'}>
                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-800 tabular-nums" dir="ltr">{code}</span>
                  </span>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-[#f37121]">
                    <Phone className="w-3.5 h-3.5 text-slate-400" /><span dir="ltr" className="tabular-nums">{c.phone}</span>
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-[#f37121] min-w-0">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span dir="ltr" className="truncate">{c.email}</span>
                  </a>
                )}
              </div>
              {a.branches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />{ar ? 'الفروع' : 'Branches'}
                  </span>
                  {a.branches.map((b) => (
                    <span key={b} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[12px] font-medium">{b}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
            <button type="button" onClick={() => setPortalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium">
              <KeyRound className="w-4 h-4" /> {ar ? 'حساب البوابة' : 'Portal login'}
            </button>
          </div>
        </div>
      </section>

      {/* The same customer in the other sections. */}
      <CustomerPresence reg="shipment" id={String(c._id)} ar={ar} onChanged={load} />

      {/* Customer data, edited where it is read. */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <SectionBar icon={<UserRound className="w-4 h-4" />} title={ar ? 'بيانات العميل' : 'Customer details'}
          hint={editor ? (ar ? 'انقر على أيّ حقلٍ لتعديله؛ يُحفظ التعديل فورًا ويظهر في كلّ الأقسام.' : 'Click any field to edit it; changes save at once and show in every section.') : undefined} />
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
            <InlineField label={ar ? 'الاسم' : 'Name'} value={c.name} editable={editor} required ar={ar}
              onSave={(v) => putCustomer({ name: v })} />
            <InlineField label={ar ? 'الجوال' : 'Phone'} value={c.phone || ''} editable={editor} dir="ltr" ar={ar}
              onSave={(v) => putCustomer({ phone: v })} />
            <InlineField label={ar ? 'البريد' : 'Email'} value={c.email || ''} editable={editor} dir="ltr" ar={ar}
              onSave={(v) => putCustomer({ email: v })} />
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-slate-500 mb-1">{ar ? 'كود العميل' : 'Customer code'}</p>
              <p className="px-2.5 py-1.5 text-[13.5px] font-semibold text-slate-900 tabular-nums"><span dir="ltr">{code || '—'}</span></p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-[12.5px] font-bold text-slate-800">{ar ? 'التفضيلات المعتمدة' : 'Agreed preferences'}</p>
            <p className="text-[11.5px] text-slate-500 mb-3">
              {ar ? 'يمكن اختيار أكثر من قيمة. القيمة الوحيدة تُملأ تلقائيًّا في أمر النقل، والقيم المتعدّدة تُعرَض أوّلًا للاختيار منها.'
                : 'Several values allowed. A single value is filled on the transport order; several are offered first to choose from.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-x-4 gap-y-3">
              {DEFAULT_KEYS.map(([k, la, le]) => (
                <div key={k} className="min-w-0">
                  <p className="text-[11.5px] font-semibold text-slate-500 mb-1">{ar ? la : le}</p>
                  <InlinePrefs value={defaults[k]} options={optionsOf(k)} editable={editor} ar={ar}
                    onSave={(next) => putCustomer({ defaults: { ...defaults, [k]: next } })} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <InlineField wide kind="textarea" label={ar ? 'ملاحظات' : 'Notes'} value={c.notes || ''} editable={editor} ar={ar}
              onSave={(v) => putCustomer({ notes: v })} />
          </div>
        </div>
      </section>

      {/* Period and search drive every figure and table below. */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-3 sm:p-4 space-y-2">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2">
            <div className="max-w-full overflow-x-auto">
              <TripPeriodBar value={period} setValue={setPeriod} ar={ar} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={tripQ} onChange={setTripQ} wide
                placeholder={ar ? 'بحث: رقم، سائق، مركبة، مدينة…' : 'Search: number, driver, vehicle, city…'} />
              {tripFiltersOn && (
                <button type="button" onClick={clearTripFilters}
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-semibold">
                  {ar ? 'مسح الفلاتر' : 'Clear filters'}
                </button>
              )}
            </div>
          </div>
          {/* States what the figures cover, so a filtered total is not read as the customer's whole history. */}
          {data.filtered && (
            <p className="text-[12px] text-slate-600 bg-[#f37121]/5 border border-[#f37121]/20 rounded-lg px-3 py-2">
              {ar ? 'الأرقام والمسارات والرحلات أدناه بحسب الفلاتر المختارة' : 'Figures, routes and trips below follow the chosen filters'}
              {data.period && (
                <span className="font-semibold text-slate-800 tabular-nums">
                  {' — '}{data.period.from ? fmtDay(`${data.period.from}T12:00:00`) : (ar ? 'البداية' : 'start')}
                  {ar ? ' إلى ' : ' to '}{data.period.to ? fmtDay(`${data.period.to}T12:00:00`) : (ar ? 'اليوم' : 'today')}
                </span>
              )}
              {Object.keys(tripCf).length > 0 && (
                <span>{ar ? ` · فلاتر أعمدة الرحلات: ${Object.keys(tripCf).length}` : ` · trip column filters: ${Object.keys(tripCf).length}`}</span>
              )}
            </p>
          )}
        </div>
        <div className="border-t border-slate-200 overflow-hidden">
          <div className={`-mt-px -ms-px grid grid-cols-2 md:grid-cols-4 ${money ? 'xl:grid-cols-8' : 'xl:grid-cols-7'}`}>
            <KpiCell icon={<Truck className="w-3.5 h-3.5" />} label={ar ? 'الرحلات (أوامر نقل)' : 'Trips (sheets)'}
              value={a.sheets.toLocaleString('en-US')} tone="text-[#f37121]" />
            {money && <KpiCell icon={<Wallet className="w-3.5 h-3.5" />} label={ar ? 'قيمة الشراء' : 'Purchase total'} value={fmtNum(a.purchaseTotal)} tone="text-violet-700" />}
            <KpiCell icon={<Signpost className="w-3.5 h-3.5" />} label={ar ? 'المسارات المنفّذة' : 'Routes worked'}
              value={(a.routesWorked ?? data.routes.length).toLocaleString('en-US')} />
            <KpiCell icon={<CalendarRange className="w-3.5 h-3.5" />} label={ar ? 'أشهر النشاط' : 'Active months'}
              value={(a.activeMonths ?? a.monthly.length).toLocaleString('en-US')} />
            <KpiCell icon={<Route className="w-3.5 h-3.5" />} label={ar ? 'مسارات متّفق عليها' : 'Agreed routes'}
              value={a.routesCount.toLocaleString('en-US')} tone="text-blue-700" />
            <KpiCell icon={<BadgeCheck className="w-3.5 h-3.5" />} label={ar ? 'منها مُسعَّرة' : 'Priced'}
              value={a.pricedRoutes.toLocaleString('en-US')} tone={pricedFull ? 'text-emerald-700' : 'text-amber-700'}
              sub={a.routesCount > 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${pricedFull ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pricedPct}%` }} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{pricedPct}%</span>
                </div>
              ) : undefined} />
            {/* Dates are set smaller than the figures; at full size they wrap to two lines. */}
            <KpiCell icon={<CalendarClock className="w-3.5 h-3.5" />} label={ar ? 'أوّل عمل' : 'First work'}
              value={<span className="text-lg">{fmtDay(a.firstAt)}</span>} />
            <KpiCell icon={<CalendarCheck className="w-3.5 h-3.5" />} label={ar ? 'آخر عمل' : 'Last work'}
              value={<span className="text-lg">{fmtDay(a.lastAt)}</span>} />
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-2 sm:px-3 pt-1">
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'routes', label: ar ? 'المسارات والأسعار' : 'Routes & prices', badge: urows.length },
            { key: 'sheets', label: ar ? 'الرحلات' : 'Trips', badge: data.sheets.total },
            // Stays while open: a period with no orders must not drop the tab the user is on.
            ...(a.orders || tab === 'orders' ? [{ key: 'orders', label: ar ? 'أوامر النقل' : 'Transport orders', badge: a.orders }] : []),
          ]} />
        </div>

        {tab === 'routes' && (
          <>
            <SectionBar icon={<Route className="w-4 h-4" />} title={ar ? 'المسارات والأسعار المتّفق عليها' : 'Routes and agreed prices'} count={routesShown.length}
              hint={ar ? 'كلّ مسارٍ عمل عليه العميل أو له سعرٌ متّفق عليه، في صفٍّ واحد.'
                : 'Every route the customer ran or has an agreed price for, in one row.'}>
              <ClearColumnFilters count={rcf.count} onClear={rcf.clear} ar={ar} />
              <SearchBox value={routeQ} onChange={setRouteQ} placeholder={ar ? 'بحث في المسارات…' : 'Search routes…'} />
              <ExportMenu fileName={`customer-routes-${c.name}`} lang={ar ? 'ar' : 'en'}
                options={[
                  { key: 'shown', label: scope.shown, sheets: [{ name: ar ? 'المسارات' : 'Routes', rows: routesShown as any[], columns: routeExportCols }] },
                  { key: 'all', label: scope.all, sheets: [{ name: ar ? 'المسارات' : 'Routes', rows: urows as any[], columns: routeExportCols }] },
                  { key: 'prices', label: ar ? 'قائمة الأسعار المتّفق عليها' : 'Agreed price list', sheets: [{ name: ar ? 'الأسعار' : 'Prices', rows: c.routes as any[], columns: agreedExportCols }] },
                ]} />
              {priceEditor && !adding && (
                <PrimaryButton onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> {ar ? 'إضافة مسار' : 'Add route'}</PrimaryButton>
              )}
            </SectionBar>
            {priceEditor && adding && (
              <AddRouteForm cities={cityOptions} ar={ar} onClose={() => setAdding(false)}
                onAdd={(f, t, p) => setRoutePrice(f, t, p)} />
            )}
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-slate-100">
              {statusChips.map(([k, la, le, tone]) => (
                <button key={k} type="button" onClick={() => setRouteStatus(k)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] font-semibold transition-colors ${
                    routeStatus === k ? 'bg-slate-900 border-slate-900 text-white' : `bg-white border-slate-200 hover:border-slate-300 ${tone}`}`}>
                  {ar ? la : le}
                  <span className={`tabular-nums ${routeStatus === k ? 'text-slate-300' : 'text-slate-400'}`}>{statusCounts[k]}</span>
                </button>
              ))}
            </div>
            <ScrollX>
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                    {ucols.map((col) => (
                      <th key={col.key} className={`${th} ${col.num ? 'text-end' : 'text-start'}`}>
                        <span className="inline-flex items-center gap-1">
                          {ar ? col.ar : col.en}
                          {rcf.header(col.key, routesSearched, ugetters[col.key], ar)}
                        </span>
                      </th>
                    ))}
                    {priceEditor && <th className={th}><span className="sr-only">{ar ? 'إجراءات' : 'Actions'}</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routesShown.map((r) => {
                    const noPrice = r.worked && !r.priced;
                    return (
                      <tr key={r.key} className={`hover:bg-slate-50 ${noPrice ? 'bg-amber-50/60' : !r.worked ? 'bg-slate-50/70' : ''}`}>
                        {ucols.map((col) => {
                          if (col.key === 'from' || col.key === 'to') {
                            return <td key={col.key} className={`${td} font-semibold ${r.worked ? 'text-slate-900' : 'text-slate-600'}`}>{r[col.key] || '—'}</td>;
                          }
                          if (col.key === 'status') {
                            const cls = noPrice ? 'bg-amber-100 text-amber-800 border-amber-200'
                              : !r.worked ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                            return (
                              <td key={col.key} className={td}>
                                <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${cls}`}>{statusLabel(r, ar, filtered)}</span>
                              </td>
                            );
                          }
                          if (col.key === 'price') {
                            return (
                              <td key={col.key} className={`${td} text-end tabular-nums`}>
                                <InlinePrice value={r.price} editable={priceEditor} ar={ar} onSave={(p) => setRoutePrice(r.from, r.to, p)} />
                              </td>
                            );
                          }
                          if (col.key === 'tiers') {
                            return (
                              <td key={col.key} className={td}>
                                <span className="inline-flex items-center gap-1.5">
                                  {r.tiers.map((t, j) => (
                                    <span key={j} className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11.5px] font-semibold tabular-nums"
                                      title={ar ? 'سعرُ السيارة الواحدة' : 'Price per truck'}>
                                      {tiersText([t], ar)}
                                    </span>
                                  ))}
                                  {!r.tiers.length && <span className="text-slate-300">—</span>}
                                  {data.canEditTiers && (
                                    <button type="button"
                                      onClick={() => setTierRoute({ from: r.from, to: r.to, tiers: r.tiers, tiersAt: r.tiersAt, tiersBy: r.tiersBy } as RunRoute)}
                                      className="p-1 rounded-md text-slate-400 hover:text-[#f37121] hover:bg-orange-50"
                                      title={ar ? 'تعديل شرائح السعر' : 'Edit price tiers'} aria-label={ar ? 'تعديل شرائح السعر' : 'Edit price tiers'}>
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </span>
                              </td>
                            );
                          }
                          const v = ucell(r, col.key);
                          const tone = col.num ? 'text-slate-800' : 'text-slate-600';
                          return <td key={col.key} className={`${td} ${col.num ? 'text-end tabular-nums' : ''} ${tone}`}>{v || <span className="text-slate-300">—</span>}</td>;
                        })}
                        {priceEditor && (
                          <td className={`${td} text-end`}>
                            {r.agreed && (
                              <button type="button" onClick={() => removeRoute(r)}
                                className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title={ar ? 'حذف من الأسعار المتّفق عليها' : 'Remove from agreed prices'} aria-label={ar ? 'حذف من الأسعار المتّفق عليها' : 'Remove from agreed prices'}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!routesShown.length && (
                    <EmptyRow colSpan={ucols.length + (priceEditor ? 1 : 0)}
                      title={urows.length ? (ar ? 'لا توجد مسارات مطابقة' : 'No matching routes') : (ar ? 'لا توجد مسارات بعد' : 'No routes yet')}
                      hint={urows.length ? undefined : (priceEditor
                        ? (ar ? 'تظهر المسارات هنا عند تسجيل رحلاتٍ للعميل، أو أضف سعرًا متّفقًا عليه من «إضافة مسار».' : 'Routes appear as trips are recorded, or add an agreed price with “Add route”.')
                        : (ar ? 'تظهر المسارات هنا عند تسجيل رحلاتٍ لهذا العميل.' : 'Routes appear here once trips are recorded for this customer.'))}
                      action={urows.length && routeFiltersOn ? clearBtn(() => { setRouteQ(''); setRouteStatus('all'); rcf.clear(); }) : undefined} />
                  )}
                </tbody>
              </table>
            </ScrollX>
          </>
        )}

        {tab === 'sheets' && (
          <>
            <SectionBar icon={<Truck className="w-4 h-4" />} title={ar ? 'الرحلات' : 'Trips'} count={data.sheets.total}>
              <ClearColumnFilters count={Object.keys(tripCf).length} onClear={() => setTripCf({})} ar={ar} />
              <ExportMenu fileName={`customer-trips-${c.name}`} lang={ar ? 'ar' : 'en'}
                options={[{ key: 'page', label: scope.page, sheets: [{ name: ar ? 'الرحلات' : 'Trips', rows: data.sheets.rows, columns: sheetExportCols }] }]} />
            </SectionBar>
            <ScrollX>
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                    {sheetCols.map((col) => (
                      <th key={col.key} className={`${th} ${col.num ? 'text-end' : 'text-start'}`}>
                        <span className="inline-flex items-center gap-1">
                          {ar ? col.ar : col.en}
                          {/* Server-side values: the table is paginated, so the loaded page holds only some of them. */}
                          {col.filter && (
                            <ColumnFilter field={col.key} selected={tripCf[col.key] || new Set()}
                              onChange={(set) => setTripFilter(col.key, set)}
                              onOpen={() => fetchCfOpts(col.key)}
                              options={cfOpts[col.key]?.values || []} truncated={!!cfOpts[col.key]?.truncated}
                              loading={!!cfBusy[col.key]} onQuery={(q) => fetchCfOpts(col.key, q)}
                              lang={ar ? 'ar' : 'en'} />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.sheets.rows.map((s: any) => (
                    <tr key={s._id} className="hover:bg-slate-50 even:bg-slate-50/50">
                      {sheetCols.map((col) => (
                        <td key={col.key} className={`${td} ${col.num ? 'text-end tabular-nums font-semibold text-slate-900' : col.key === 'reportNumber' ? 'font-semibold text-slate-900 tabular-nums' : 'text-slate-700'}`}>
                          {col.date ? fmtDay(s[col.key]) : col.num ? fmtNum(s[col.key]) : (s[col.key] || '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!data.sheets.rows.length && (
                    <EmptyRow colSpan={sheetCols.length}
                      title={tripFiltersOn ? (ar ? 'لا توجد رحلات ضمن الفلاتر المختارة' : 'No trips match the chosen filters') : (ar ? 'لا توجد رحلات' : 'No trips')}
                      action={tripFiltersOn ? clearBtn(clearTripFilters) : undefined} />
                  )}
                </tbody>
              </table>
            </ScrollX>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 text-[12.5px]">
              <span className="text-slate-500 tabular-nums">
                {ar ? `عرض ${pageFrom}–${pageTo} من ${data.sheets.total.toLocaleString('en-US')}` : `Showing ${pageFrom}–${pageTo} of ${data.sheets.total.toLocaleString('en-US')}`}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={data.sheets.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label={ar ? 'الصفحة السابقة' : 'Previous page'}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
                  {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
                <span className="text-slate-700 font-medium tabular-nums">{ar ? `صفحة ${data.sheets.page} من ${data.sheets.pages}` : `Page ${data.sheets.page} of ${data.sheets.pages}`}</span>
                <button type="button" disabled={data.sheets.page >= data.sheets.pages} onClick={() => setPage((p) => p + 1)}
                  aria-label={ar ? 'الصفحة التالية' : 'Next page'}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:text-[#f37121]">
                  {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'orders' && (
          <>
            {/* The tab badge carries the count, so the bar states what the list is instead of repeating the number. */}
            <SectionBar icon={<ClipboardList className="w-4 h-4" />} title={ar ? 'أوامر النقل المنشأة لهذا العميل' : 'Transport orders created for this customer'}
              hint={ar
                ? `أوامر النقل المسجّلة للعميل في قسم «طلبات الشحنات»${a.orders > data.orders.length ? `؛ يُعرَض أحدث ${data.orders.length} من ${a.orders.toLocaleString('en-US')}` : ''}.`
                : `Transport orders recorded for the customer in Shipment Orders${a.orders > data.orders.length ? `; latest ${data.orders.length} of ${a.orders.toLocaleString('en-US')} shown` : ''}.`}>
              <ClearColumnFilters count={ocf.count} onClear={ocf.clear} ar={ar} />
              <ExportMenu fileName={`customer-transport-orders-${c.name}`} lang={ar ? 'ar' : 'en'}
                options={[{ key: 'shown', label: scope.shown, sheets: [{ name: ar ? 'أوامر النقل' : 'Transport orders', rows: ordersShown, columns: orderExportCols }] }]} />
            </SectionBar>
            <ScrollX>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-[11.5px]">
                    {orderCols.map(([k, la, le, num]) => (
                      <th key={k} className={`${th} ${num ? 'text-end' : 'text-start'}`}>
                        <span className="inline-flex items-center gap-1">{ar ? la : le}{ocf.header(k, data.orders, ogetters[k], ar)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!ordersShown.length && (
                    <EmptyRow colSpan={orderCols.length} title={ar ? 'لا توجد أوامر نقل' : 'No transport orders'}
                      hint={ocf.count ? undefined : (ar ? 'تظهر هنا أوامر النقل التي تُنشأ لهذا العميل في قسم «طلبات الشحنات».' : 'Transport orders created for this customer in Shipment Orders appear here.')}
                      action={ocf.count ? clearBtn(ocf.clear) : undefined} />
                  )}
                  {ordersShown.map((o: any) => {
                    const st = orderStatus(o.status);
                    return (
                      <tr key={o._id} className="hover:bg-slate-50 even:bg-slate-50/50">
                        <td className={`${td} font-bold text-slate-900 tabular-nums`}><span dir="ltr">{ogetters.number(o) || '—'}</span></td>
                        <td className={`${td} text-slate-600 tabular-nums`}>{fmtDay(o.createdAt)}</td>
                        <td className={`${td} font-semibold text-slate-800`}>{o.fromCity || '—'}</td>
                        <td className={`${td} font-semibold text-slate-800`}>{o.toCity || '—'}</td>
                        <td className={`${td} text-slate-700`}>{o.truckType || '—'}</td>
                        <td className={`${td} text-slate-700`}>{o.supplierName || '—'}</td>
                        <td className={`${td} text-slate-700 tabular-nums`}>{o.vehiclePlate || '—'}</td>
                        <td className={`${td} text-slate-700`}>{o.salesRepName || '—'}</td>
                        {money && <td className={`${td} text-end tabular-nums font-semibold text-slate-900`}>{o.sellPrice == null ? '—' : fmtNum(o.sellPrice)}</td>}
                        <td className={td}>
                          {o.status
                            ? <span className={`px-2 py-0.5 rounded-md text-[12px] font-semibold ${st ? `${st.bg} ${st.text}` : 'bg-slate-100 text-slate-700'}`}>{orderStatusLabel(o.status, lang as Lang)}</span>
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          </>
        )}
      </section>

      {tierRoute && (
        <TierEditor customerId={String(c._id)} route={tierRoute} ar={ar}
          onClose={() => setTierRoute(null)} onSaved={() => { setTierRoute(null); load(); }} />
      )}

      <Modal open={portalOpen} onClose={() => setPortalOpen(false)} title={ar ? 'حساب بوابة العملاء' : 'Customer portal account'}>
        <PortalAccountCard source="shipment_order_customer" refId={c._id} name={c.name} bare />
      </Modal>
    </div>
  );
}
