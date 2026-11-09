'use client';
/**
 * Shipment requests board. `mode="sales"`: what sales asked for and where each request stands (edit, resend, withdraw).
 * `mode="vendors"`: the vendors team's inbox — take a request, place each truck (supplier, truck, driver, purchase
 * price) which turns it into a transport order on the normal serial, or reject it with a reason from the list.
 * Live on `shipmentRequests:changed`, so the three sections showing it never disagree.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, SearchInput, Modal, SearchableSelect, ErrorNotice } from '@/components/hr/HRKit';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import DriverPicker from '@/components/shipment-orders/DriverPicker';
import ShipmentRequestForm from '@/components/shipment-orders/ShipmentRequestForm';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import type { OrderSupplier, OrderVehicle, OrderDriver } from '@/lib/shipmentOrders';
import { REQUEST_STATUS, LOG_LABEL, canAsk, canPlace, type ShipmentRequest, type RequestStatus } from '@/lib/shipmentRequests';
import {
  Truck, MapPin, Calendar, User as UserIcon, CheckCircle2, XCircle, Send, Pencil, Undo2, Hand, Loader2, Plus, Trash2, Copy, History, Package, AlertCircle, Inbox,
} from 'lucide-react';

const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

type Tab = 'open' | RequestStatus | 'all';

export default function ShipmentRequestsBoard({ mode }: { mode: 'sales' | 'vendors' }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const guard = useLatestRequest();
  const [tab, setTab] = useState<Tab>(mode === 'vendors' ? 'open' : 'all');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const h = setTimeout(() => setQd(q), 300); return () => clearTimeout(h); }, [q]);
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<ShipmentRequest[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [openTrucks, setOpenTrucks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState<ShipmentRequest | null>(null);
  const [rejecting, setRejecting] = useState<ShipmentRequest | null>(null);
  const [editing, setEditing] = useState<ShipmentRequest | null>(null);
  const [history, setHistory] = useState<ShipmentRequest | null>(null);
  const [busyId, setBusyId] = useState('');
  const asker = canAsk(user);
  const placer = canPlace(user);

  const load = useCallback(async () => {
    const my = guard.begin();
    const p = new URLSearchParams({ limit: '200' });
    if (tab === 'open') p.set('status', 'pending,in_progress');
    else if (tab !== 'all') p.set('status', tab);
    if (qd.trim()) p.set('q', qd.trim());
    if (mine) p.set(mode === 'vendors' ? 'handler' : 'mine', mode === 'vendors' ? 'me' : '1');
    try {
      const d = await api.get<{ requests: ShipmentRequest[]; byStatus: Record<string, number>; openTrucks: number }>(`/api/shipment-requests?${p}`);
      if (!guard.isCurrent(my)) return;
      setRows(d.requests || []); setByStatus(d.byStatus || {}); setOpenTrucks(d.openTrucks || 0); setError('');
    } catch (e: any) { if (guard.isCurrent(my)) setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    if (guard.isCurrent(my)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qd, mine, mode, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  useSocket('shipmentRequests:changed', useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }, [load]));

  // Opened from a notification: ?id=… opens that request.
  useEffect(() => {
    const id = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null;
    if (!id) return;
    api.get<{ request: ShipmentRequest }>(`/api/shipment-requests/${id}`).then((d) => setHistory(d.request)).catch(() => {});
  }, []);

  const act = async (r: ShipmentRequest, path: string, body?: any, ok?: string) => {
    setBusyId(r._id);
    try { await api.post(`/api/shipment-requests/${r._id}/${path}`, body || {}); if (ok) notify(ok, 'success'); load(); }
    catch (e: any) {
      if (e?.status === 409 && path === 'claim' && await confirm({ title: t('الطلب مع زميل', 'Held by a colleague'), message: `${e.message}. ${t('هل تتولّاه بدلًا منه؟', 'Take it over?')}` })) {
        await api.post(`/api/shipment-requests/${r._id}/claim`, { takeOver: true }).catch(() => {}); load();
      } else notify(e?.message || t('تعذّر التنفيذ', 'Failed'), 'error');
    }
    setBusyId('');
  };

  const counts = { open: (byStatus.pending || 0) + (byStatus.in_progress || 0), ...byStatus } as Record<string, number>;
  const all = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const TABS: [Tab, string, string][] = mode === 'vendors'
    ? [['open', 'المفتوحة', 'Open'], ['pending', 'جديدة', 'New'], ['in_progress', 'قيد الإنجاز', 'In progress'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn'], ['all', 'الكلّ', 'All']]
    : [['all', 'كلّ طلباتي', 'All'], ['open', 'لدى الموردين', 'With vendors'], ['rejected', 'مرفوضة', 'Rejected'], ['completed', 'مكتملة', 'Completed'], ['cancelled', 'مسحوبة', 'Withdrawn']];

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('طلباتٌ مفتوحة', 'Open requests')} value={counts.open || 0} tone="amber" />
        <Stat label={t('شاحناتٌ تنتظر الإسناد', 'Trucks waiting')} value={openTrucks} tone="orange" />
        <Stat label={t('مرفوضة', 'Rejected')} value={byStatus.rejected || 0} tone="red" />
        <Stat label={t('مكتملة', 'Completed')} value={byStatus.completed || 0} tone="green" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {ar ? a : e}<span className="ms-1.5 tabular-nums opacity-70">{k === 'all' ? all : (counts[k] || 0)}</span>
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 ms-1">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[#f37121]" />
          {mode === 'vendors' ? t('التي أعمل عليها', 'Mine') : t('طلباتي أنا فقط', 'Only mine')}
        </label>
        <div className="flex-1 min-w-[200px]"><SearchInput value={q} onChange={setQ} placeholder={t('رقم الطلب، العميل، المدينة، رقم أمر النقل…', 'Request no., customer, city, order no.…')} /></div>
      </div>

      {error && <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />}
      {loading ? <Spinner /> : !rows.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-slate-500">
          <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />{t('لا طلبات هنا', 'No requests here')}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {rows.map((r) => {
            const st = REQUEST_STATUS[r.status];
            const open = ['pending', 'in_progress'].includes(r.status);
            const held = r.handler && String(r.handler) !== String(user?._id);
            const pct = r.trucks ? Math.round((r.placed.length / r.trucks) * 100) : 0;
            return (
              <div key={r._id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${r.status === 'rejected' ? 'border-red-200' : 'border-slate-200'}`}>
                <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60">
                  <span className="font-mono font-extrabold text-slate-900">#{r.number}</span>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${st.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{ar ? st.ar : st.en}</span>
                  {r.resubmits ? <span className="text-[11px] text-slate-500">{t(`أُعيد ${r.resubmits}×`, `resent ${r.resubmits}×`)}</span> : null}
                  <span className="ms-auto text-[11.5px] text-slate-500">{when(r.createdAt)} · {r.createdByName}</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-slate-900 truncate">{r.customerName}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-700"><MapPin className="w-3.5 h-3.5 text-[#f37121]" />{r.fromCity} <span className="text-slate-400">←</span> {r.toCity}{r.branch ? <span className="text-slate-400"> · {r.branch}</span> : null}</p>
                    </div>
                    {r.sellPrice != null && <div className="ms-auto text-end"><p className="text-[11px] text-slate-500">{t('سعر البيع للشاحنة', 'Selling per truck')}</p><p className="text-[17px] font-extrabold tabular-nums text-[#f37121]">{money(r.sellPrice)}</p></div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[12px]">
                    <Chip icon={Truck}>{r.truckType || '—'}{r.truckLength ? ` · ${r.truckLength}` : ''}</Chip>
                    {r.cargoType && <Chip icon={Package}>{r.cargoType}</Chip>}
                    <Chip icon={Calendar}>{t('التحميل', 'Pickup')} {day(r.pickupTime)}</Chip>
                    {r.paymentSubtype && <Chip>{(PAYMENT_SUBTYPES as any)[r.paymentSubtype]?.[ar ? 'ar' : 'en'] || r.paymentSubtype}</Chip>}
                    {r.salesRepName && <Chip icon={UserIcon}>{t('المبيعات', 'Sales')}: {r.salesRepName}</Chip>}
                    {r.handlerName && <Chip icon={Hand}>{t('يعمل عليه', 'Handled by')}: {r.handlerName}</Chip>}
                    {(r.blNumber || r.containerNumber) && <Chip>{[r.blNumber, r.containerNumber].filter(Boolean).join(' · ')}</Chip>}
                  </div>
                  {r.notes && <p className="text-[12.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{r.notes}</p>}
                  <div>
                    <div className="flex items-center justify-between text-[12px] text-slate-600 mb-1">
                      <span>{t(`الشاحنات: أُسندت ${r.placed.length} من ${r.trucks}`, `Trucks placed: ${r.placed.length} of ${r.trucks}`)}</span>
                      {open && <span className="font-semibold text-amber-700">{t(`بقي ${r.open}`, `${r.open} open`)}</span>}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
                    {!!r.placed.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.placed.map((p) => (
                          <Link key={p.order} href={`/system/shipment-orders?q=${p.waybillNumber}`} title={`${p.supplierName} · ${p.vehiclePlate} · ${p.driverName}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5" />{t('أمر نقل', 'Order')} {p.waybillNumber}<span className="font-normal text-emerald-700/80 max-w-[160px] truncate">· {p.supplierName}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  {r.status === 'rejected' && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px]">
                      <p className="font-bold text-red-800 flex items-center gap-1.5"><XCircle className="w-4 h-4" />{t('سبب الرفض', 'Reason')}: {r.rejectReason}</p>
                      {r.rejectNote && <p className="text-red-700 mt-0.5">{r.rejectNote}</p>}
                      <p className="text-red-600/80 mt-0.5 text-[11.5px]">{r.rejectedByName} · {when(r.rejectedAt)}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {mode === 'vendors' && placer && open && (
                      <>
                        <Btn primary onClick={() => setPlacing(r)} icon={CheckCircle2}>{t('إكمال الشحنة', 'Complete')}</Btn>
                        <Btn onClick={() => setRejecting(r)} icon={XCircle} danger>{t('رفض', 'Reject')}</Btn>
                        {!r.handler || held
                          ? <Btn onClick={() => act(r, 'claim', {}, t('تولّيتَ الطلب', 'Taken'))} icon={Hand} busy={busyId === r._id}>{held ? t('تولِّيه بدلًا من زميل', 'Take over') : t('أتولّاه', 'Take it')}</Btn>
                          : <Btn onClick={() => act(r, 'release')} icon={Undo2} busy={busyId === r._id}>{t('تخلٍّ', 'Release')}</Btn>}
                      </>
                    )}
                    {mode === 'sales' && asker && ['pending', 'in_progress', 'rejected'].includes(r.status) && (
                      <>
                        {r.status === 'rejected' && <Btn primary onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل وإعادة الإرسال', 'Amend and resend')}</Btn>}
                        {r.status !== 'rejected' && <Btn onClick={() => setEditing(r)} icon={Pencil}>{t('تعديل', 'Edit')}</Btn>}
                        {r.status === 'rejected' && <Btn onClick={() => act(r, 'resubmit', {}, t('أُعيد الإرسال', 'Resent'))} icon={Send} busy={busyId === r._id}>{t('إعادة الإرسال كما هو', 'Resend as is')}</Btn>}
                        <Btn danger icon={Trash2} busy={busyId === r._id} onClick={async () => {
                          if (await confirm({ title: t('سحب الطلب', 'Withdraw'), message: r.placed.length ? t('أوامرُ النقل المُنشأة تبقى، ويُسحب الباقي فقط.', 'Created transport orders stay; only the rest is withdrawn.') : t('يُسحب الطلب من فريق الموردين.', 'The request is withdrawn.'), tone: 'danger' as any }))
                            act(r, 'cancel', {}, t('سُحب الطلب', 'Withdrawn'));
                        }}>{t('سحب', 'Withdraw')}</Btn>
                      </>
                    )}
                    <button type="button" onClick={() => setHistory(r)} className="ms-auto inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-900"><History className="w-3.5 h-3.5" />{t('السجلّ', 'History')}</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {placing && <PlaceModal req={placing} onClose={() => setPlacing(null)} onDone={() => { setPlacing(null); load(); }} />}
      {rejecting && <RejectModal req={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t(`تعديل طلب الشحنة رقم ${editing.number}`, `Edit request ${editing.number}`)} wide>
          <ShipmentRequestForm editId={editing._id} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t(`سجلّ الطلب رقم ${history.number}`, `Request ${history.number} history`)}>
          <ol className="relative border-s border-slate-200 ms-2 space-y-3">
            {[...history.log].reverse().map((l) => (
              <li key={l._id} className="ms-4">
                <span className="absolute -start-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#f37121] border-2 border-white" />
                <p className="text-[13px] font-semibold text-slate-900">{(LOG_LABEL[l.action] || { ar: l.action, en: l.action })[ar ? 'ar' : 'en']}{l.waybillNumber ? ` ${l.waybillNumber}` : ''}{l.reason ? ` — ${l.reason}` : ''}</p>
                {l.note && <p className="text-[12px] text-slate-600">{l.note}</p>}
                <p className="text-[11px] text-slate-400">{l.byName} · {when(l.at)}</p>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'orange' | 'red' | 'green' }) {
  const c = tone === 'amber' ? 'text-amber-700' : tone === 'orange' ? 'text-[#f37121]' : tone === 'red' ? 'text-red-600' : 'text-emerald-700';
  return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-[12px] font-semibold text-slate-600">{label}</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${c}`}>{value.toLocaleString('en-US')}</p></div>;
}
function Chip({ icon: Icon, children }: { icon?: any; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-slate-700">{Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}{children}</span>;
}
function Btn({ onClick, children, icon: Icon, primary, danger, busy }: { onClick: () => void; children: React.ReactNode; icon?: any; primary?: boolean; danger?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${primary ? 'bg-[#f37121] text-white hover:bg-[#e0641a]' : danger ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : Icon && <Icon className="w-3.5 h-3.5" />}{children}
    </button>
  );
}

type TruckRow = { supplierId: string; supplierName: string; vehicleId: string; newPlate: string; driverName: string; driverPhone: string; buyPrice: string; advanceAmount: string; blNumber: string; containerNumber: string };
const blankTruck = (r: ShipmentRequest): TruckRow => ({ supplierId: '', supplierName: '', vehicleId: '', newPlate: '', driverName: '', driverPhone: '', buyPrice: '', advanceAmount: '', blNumber: r.blNumber || '', containerNumber: r.containerNumber || '' });

/** The vendors half: one row per truck, each becomes a transport order. */
function PlaceModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [rows, setRows] = useState<TruckRow[]>([blankTruck(req)]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const setRow = (i: number, patch: Partial<TruckRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const problems = rows.map((r) => [!r.supplierId && 'supplier', !r.vehicleId && !r.newPlate.trim() && 'vehicle', !r.driverName.trim() && 'driver', !(Number(r.buyPrice) > 0) && 'buy'].filter(Boolean) as string[]);
  const submit = async () => {
    setTried(true);
    if (problems.some((p) => p.length)) { notify(t('أكمِل المورّد والسيارة والسائق وسعر الشراء لكلّ شاحنة', 'Fill supplier, truck, driver and purchase price for each truck'), 'error'); return; }
    setSaving(true);
    try {
      const d = await api.post<{ waybills: number[]; failed: any[] }>(`/api/shipment-requests/${req._id}/place`, {
        trucks: rows.map((r) => ({
          supplierChoice: r.supplierId, ...(r.vehicleId ? { vehicle: r.vehicleId } : { newVehicle: { plate: r.newPlate.trim() } }),
          driverName: r.driverName.trim(), driverPhone: r.driverPhone, buyPrice: Number(r.buyPrice), advanceAmount: r.advanceAmount === '' ? null : Number(r.advanceAmount),
          blNumber: r.blNumber, containerNumber: r.containerNumber,
        })),
      });
      notify(t(`أُنشئت أوامر النقل: ${(d.waybills || []).join('، ')}${d.failed?.length ? ` · تعذّرت ${d.failed.length}` : ''}`, `Transport orders: ${(d.waybills || []).join(', ')}`), d.failed?.length ? 'error' : 'success');
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر الإنشاء', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} wide title={t(`إكمال طلب الشحنة رقم ${req.number}`, `Complete request ${req.number}`)}
      footer={(
        <div className="flex flex-wrap items-center gap-2 w-full">
          <span className="text-[12.5px] text-slate-600">{t(`${rows.length} من ${req.open} شاحنة مفتوحة`, `${rows.length} of ${req.open} open trucks`)}</span>
          <button type="button" onClick={submit} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('إتمام إنشاء الشحنة', 'Create the transport orders')}
          </button>
        </div>
      )}>
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
          <span className="font-bold text-slate-900">{req.customerName}</span>
          <span>{req.fromCity} ← {req.toCity}</span><span>{req.truckType}{req.truckLength ? ` · ${req.truckLength}` : ''}</span>
          <span>{t('التحميل', 'Pickup')} {day(req.pickupTime)}</span>{req.branch && <span>{req.branch}</span>}
        </div>
        {rows.map((r, i) => (
          <TruckEditor key={i} i={i} row={r} miss={tried ? problems[i] : []} onChange={(p) => setRow(i, p)}
            onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, j) => j !== i)) : undefined} ar={ar} />
        ))}
        <div className="flex flex-wrap gap-2">
          {rows.length < req.open && <button type="button" onClick={() => setRows((p) => [...p, blankTruck(req)])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Plus className="w-4 h-4" />{t('شاحنةٌ أخرى', 'Another truck')}</button>}
          {rows.length < req.open && rows[0].supplierId && <button type="button" onClick={() => setRows((p) => [...p, { ...blankTruck(req), supplierId: p[0].supplierId, supplierName: p[0].supplierName, buyPrice: p[0].buyPrice }])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Copy className="w-4 h-4" />{t('شاحنةٌ أخرى من نفس المورّد', 'Another from the same supplier')}</button>}
        </div>
      </div>
    </Modal>
  );
}

function TruckEditor({ i, row, miss, onChange, onRemove, ar }: { i: number; row: TruckRow; miss: string[]; onChange: (p: Partial<TruckRow>) => void; onRemove?: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [sups, setSups] = useState<OrderSupplier[]>([]);
  const [vehs, setVehs] = useState<OrderVehicle[]>([]);
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [supBusy, setSupBusy] = useState(false);
  const supGuard = useLatestRequest();
  const vehGuard = useLatestRequest();
  const searchSup = useCallback(async (q: string) => {
    const my = supGuard.begin(); setSupBusy(true);
    try { const d = await api.get<{ suppliers: OrderSupplier[] }>(`/api/shipment-orders/suppliers?limit=60&fresh=1${q ? `&q=${encodeURIComponent(q)}` : ''}`); if (supGuard.isCurrent(my)) setSups(d.suppliers || []); } catch { /* keep */ }
    if (supGuard.isCurrent(my)) setSupBusy(false);
  }, [supGuard]);
  useEffect(() => { searchSup(''); }, [searchSup]);
  const searchVeh = useCallback(async (q: string) => {
    const my = vehGuard.begin();
    const qs = new URLSearchParams({ limit: '80' });
    if (row.supplierId && !q) qs.set('supplier', row.supplierId);
    if (q) qs.set('q', q);
    try { const d = await api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?${qs}`); if (vehGuard.isCurrent(my)) setVehs(d.vehicles || []); } catch { /* keep */ }
  }, [vehGuard, row.supplierId]);
  useEffect(() => { searchVeh(''); }, [searchVeh]);
  useEffect(() => {
    if (!row.vehicleId && !row.supplierId) { setDrivers([]); return; }
    api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?${row.vehicleId ? `vehicle=${row.vehicleId}` : `supplier=${row.supplierId}`}&limit=200`).then((d) => setDrivers(d.drivers || [])).catch(() => setDrivers([]));
  }, [row.vehicleId, row.supplierId]);
  const bad = (k: string) => miss.includes(k);
  const supOpts = sups.map((s) => ({ value: s._id, label: s.name, hint: s.type === 'freelancer' ? t('سائق فرد', 'Freelancer') : (s.phone || '') }));
  if (row.supplierId && !supOpts.some((o) => o.value === row.supplierId)) supOpts.unshift({ value: row.supplierId, label: row.supplierName || row.supplierId, hint: '' });
  return (
    <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-[#f37121]/15 text-[#f37121] font-bold text-sm flex items-center justify-center">{i + 1}</span>
        <p className="font-bold text-slate-900 text-sm">{t('الشاحنة', 'Truck')} {i + 1}</p>
        {onRemove && <button type="button" onClick={onRemove} className="ms-auto text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('supplier') ? 'text-red-600' : 'text-slate-700'}`}>{t('المورّد', 'Supplier')} *</label>
          <div className={bad('supplier') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.supplierId} searchAfter={0} onSearch={searchSup} loading={supBusy}
              onChange={(v) => onChange({ supplierId: v, supplierName: sups.find((s) => s._id === v)?.name || '', vehicleId: '' })}
              placeholder={t('ابحث عن المورّد', 'Search the supplier')} options={supOpts} />
          </div>
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('vehicle') ? 'text-red-600' : 'text-slate-700'}`}>{t('السيارة (اللوحة)', 'Truck (plate)')} *</label>
          <div className={bad('vehicle') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.vehicleId} searchAfter={0} onSearch={searchVeh}
              onChange={(v) => {
                const veh = vehs.find((x) => x._id === v);
                onChange({ vehicleId: v, newPlate: '', ...(veh?.defaultDriverName && !row.driverName ? { driverName: veh.defaultDriverName, driverPhone: veh.defaultDriverPhone || '' } : {}) });
              }}
              placeholder={t('اختر من سيارات المورّد', "Pick from the supplier's trucks")}
              options={vehs.map((v) => ({ value: v._id, label: v.plate, hint: [v.truckType, v.defaultDriverName].filter(Boolean).join(' · ') }))} />
          </div>
          {!row.vehicleId && <input value={row.newPlate} onChange={(e) => onChange({ newPlate: e.target.value })} placeholder={t('أو اكتب لوحةً جديدة', 'or type a new plate')} className={`${inputCls} mt-1.5`} />}
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('driver') ? 'text-red-600' : 'text-slate-700'}`}>{t('السائق', 'Driver')} *</label>
          <div className={bad('driver') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <DriverPicker value={row.driverName} ar={ar} contextDrivers={drivers} supplierId={row.supplierId} vehicleId={row.vehicleId}
              onPick={(d) => onChange({ driverName: d.name, driverPhone: d.phone || row.driverPhone })} />
          </div>
        </div>
        <div>
          <label className={`block text-[12.5px] font-semibold mb-1 ${bad('buy') ? 'text-red-600' : 'text-slate-700'}`}>{t('سعر الشراء', 'Purchase price')} *</label>
          <input type="number" min={0} value={row.buyPrice} onChange={(e) => onChange({ buyPrice: e.target.value })} className={`${inputCls} ${bad('buy') ? 'border-red-400 bg-red-50' : ''}`} />
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('السلفة', 'Advance')}</label>
          <input type="number" min={0} value={row.advanceAmount} onChange={(e) => onChange({ advanceAmount: e.target.value })} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('البوليصة', 'B/L')}</label><input value={row.blNumber} onChange={(e) => onChange({ blNumber: e.target.value })} className={inputCls} /></div>
          <div><label className="block text-[12.5px] font-semibold mb-1 text-slate-700">{t('الحاوية', 'Container')}</label><input value={row.containerNumber} onChange={(e) => onChange({ containerNumber: e.target.value })} className={inputCls} /></div>
        </div>
      </div>
    </div>
  );
}

/** Reject what is still open, with a reason from the section's list (searchable, extendable in place). */
function RejectModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason) { notify(t('اختر سبب الرفض', 'Pick a reason'), 'error'); return; }
    setSaving(true);
    try { await api.post(`/api/shipment-requests/${req._id}/reject`, { reason, note }); notify(t('رُفض الطلب وأُبلغ فريق المبيعات بالسبب', 'Rejected; sales was told why'), 'success'); onDone(); }
    catch (e: any) { notify(e?.message || t('تعذّر الرفض', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={t(`رفض طلب الشحنة رقم ${req.number}`, `Reject request ${req.number}`)}
      footer={<button type="button" onClick={submit} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}{t('رفض الطلب', 'Reject')}</button>}>
      <div className="space-y-3">
        {!!req.placed.length && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800"><AlertCircle className="w-4 h-4 mt-0.5" />{t(`أُنشئ ${req.placed.length} أمرُ نقل من هذا الطلب ويبقى؛ يُرفض الباقي (${req.open}).`, `${req.placed.length} order(s) already created stay; the remaining ${req.open} are rejected.`)}</p>}
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1.5">{t('سبب الرفض', 'Reason')} *</label>
          <SearchableManagedSelect storeLabel type="sr_reject_reason" value={reason} onChange={setReason} placeholder={t('اختر السبب أو ابحث', 'Pick or search a reason')} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1.5">{t('ملاحظة لفريق المبيعات', 'Note to sales')}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={t('مثلًا: السعر المتاح في السوق 2,800 — أو التحميل بعد يومين', 'e.g. market price is 2,800')} />
        </div>
      </div>
    </Modal>
  );
}
