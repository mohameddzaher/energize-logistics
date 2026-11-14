'use client';
/**
 * Completing a sales request, truck by truck. `PlaceModal`: the vendors team picks «مورد» or «فريلانسر», the carrier,
 * one of its trucks (or a new plate) and a registered driver (a new one needs his iqama). `FleetPlaceModal`: the fleet
 * picks one of our trucks and its drivers with the load inputs; the server makes the transport order (supplier
 * «تنشيط») and its linked fleet load. `SourcingModal`: «تحصيل السيارات» records. The pickup/start/arrival times are
 * entered here, not by sales.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Modal, SearchableSelect } from '@/components/hr/HRKit';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import DriverPicker from '@/components/shipment-orders/DriverPicker';
import type { OrderSupplier, OrderVehicle, OrderDriver } from '@/lib/shipmentOrders';
import { outsideHint, offerSupplierLink } from '@/lib/supplierLinks';
import { foldAr } from '@/lib/customerRegistry';
import { vehicleAvailabilityText, seatsOf, type FleetVehicle, type FleetDriver } from '@/lib/fleet';
import { type ShipmentRequest, type SourcingEntry } from '@/lib/shipmentRequests';
import { CheckCircle2, Loader2, Plus, Trash2, Copy, Pencil, Check, X, Building2, User as UserIcon } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
const labelCls = 'block text-[12.5px] font-semibold mb-1 text-slate-700';
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const ymd = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayYmd = () => ymd(new Date().toISOString());
const isoNoon = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);
type Opt = { value: string; label: string; roleAr?: string };
const typesOfReq = (r: ShipmentRequest) => (r.truckTypes?.length ? r.truckTypes : (r.truckType ? [r.truckType] : []));

/** The three times, written once per completion and sent with every truck; which are required comes from the section's form settings. */
type Times = { pickupTime: string; startTime: string; arrivalTime: string };
function useTimes(req: ShipmentRequest) {
  const [times, setTimes] = useState<Times>({ pickupTime: ymd(req.pickupTime) || todayYmd(), startTime: ymd(req.startTime), arrivalTime: ymd(req.arrivalTime) });
  const [labels, setLabels] = useState<Record<string, { ar: string; required: boolean }>>({});
  useEffect(() => {
    api.get<{ fields: { key: string; labelAr: string; required?: boolean; active?: boolean }[] }>('/api/shipment-orders/fields').then((d) => {
      const out: Record<string, { ar: string; required: boolean }> = {};
      for (const f of d.fields || []) if (['pickupTime', 'startTime', 'arrivalTime'].includes(f.key) && f.active !== false) out[f.key] = { ar: f.labelAr, required: !!f.required };
      setLabels(out);
    }).catch(() => {});
  }, []);
  const missing = Object.entries(labels).filter(([k, v]) => v.required && !times[k as keyof Times]).map(([k]) => k);
  const payload = { pickupTime: isoNoon(times.pickupTime), startTime: isoNoon(times.startTime), arrivalTime: isoNoon(times.arrivalTime) };
  return { times, setTimes, labels, missing, payload };
}
function TimesBlock({ t, ar, tried }: { t: ReturnType<typeof useTimes>; ar: boolean; tried: boolean }) {
  const DEF: [keyof Times, string, string][] = [['pickupTime', 'وقت الاستلام', 'Pickup'], ['startTime', 'وقت البداية', 'Start'], ['arrivalTime', 'وقت الوصول', 'Arrival']];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 p-3">
      {DEF.map(([k, a, e]) => {
        const req = t.labels[k]?.required;
        const bad = tried && t.missing.includes(k);
        return (
          <div key={k}>
            <label className={`${labelCls} ${bad ? '!text-red-600' : ''}`}>{ar ? (t.labels[k]?.ar || a) : e}{req && ' *'}</label>
            <input type="date" value={t.times[k]} onChange={(ev) => t.setTimes((p) => ({ ...p, [k]: ev.target.value }))}
              className={`${inputCls} [color-scheme:light] ${bad ? 'border-red-400 bg-red-50' : ''}`} />
          </div>
        );
      })}
    </div>
  );
}

function useOptions(url: string) {
  const [opts, setOpts] = useState<Opt[]>([]);
  useEffect(() => { api.get<{ options: Opt[] }>(url).then((d) => setOpts(d.options || [])).catch(() => {}); }, [url]);
  return opts;
}

function RequestSummary({ req, ar }: { req: ShipmentRequest; ar: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
      <span className="font-bold text-slate-900">{req.customerName}</span>
      <span>{req.fromCity} ← {req.toCity}</span><span>{req.truckType}{req.truckLength ? ` · ${req.truckLength}` : ''}</span>
      {req.branch && <span>{req.branch}</span>}
      <span>{ar ? `تحصيل السيارات ${req.sourced || 0}/${req.trucks}` : `Sourced ${req.sourced || 0}/${req.trucks}`}</span>
    </div>
  );
}

// ── Vendors: «مورد» or «فريلانسر» ───────────────────────────────────────────

type Kind = 'vendor' | 'freelancer';
type TruckRow = {
  kind: Kind; truckType: string; sourcingRep: string; helper: string;
  supplierId: string; supplierName: string; newFreelancer: boolean; flName: string; flPhone: string;
  vehicleId: string; newPlate: string;
  driverId: string; driverName: string; ndName: string; ndPhone: string; ndIqama: string;
  buyPrice: string; advanceAmount: string;
};
const blankTruck = (r: ShipmentRequest, rep = ''): TruckRow => ({
  kind: 'vendor', truckType: typesOfReq(r).length === 1 ? typesOfReq(r)[0] : '', sourcingRep: rep, helper: '',
  supplierId: '', supplierName: '', newFreelancer: false, flName: '', flPhone: '',
  vehicleId: '', newPlate: '', driverId: '', driverName: '', ndName: '', ndPhone: '', ndIqama: '', buyPrice: '', advanceAmount: '',
});
const IQAMA_RE = /^[12]\d{9}$/;

export function PlaceModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const { user } = useAuth();
  const me = String(user?._id || '');
  const reps = useOptions('/api/shipment-orders/sourcing-reps');
  const helpers = useOptions('/api/shipment-requests/team-members?team=helpers');
  const defRep = reps.some((o) => o.value === me) ? me : '';
  const [rows, setRows] = useState<TruckRow[]>([blankTruck(req)]);
  useEffect(() => { if (defRep) setRows((p) => p.map((r) => (r.sourcingRep ? r : { ...r, sourcingRep: defRep }))); }, [defRep]);
  const times = useTimes(req);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const setRow = (i: number, patch: Partial<TruckRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reqTypes = typesOfReq(req);
  const problems = rows.map((r) => {
    const out: string[] = [];
    if (reqTypes.length > 1 && !r.truckType) out.push('type');
    if (r.newFreelancer ? !r.flName.trim() : !r.supplierId) out.push('supplier');
    if (!r.vehicleId && !r.newPlate.trim()) out.push('vehicle');
    const freshDriver = r.newFreelancer || (!r.driverId && r.ndName.trim());
    if (freshDriver ? (!r.ndName.trim() || !IQAMA_RE.test(r.ndIqama.trim())) : !r.driverId) out.push('driver');
    if (!(Number(r.buyPrice) > 0)) out.push('buy');
    return out;
  });
  const submit = async () => {
    setTried(true);
    if (problems.some((p) => p.length) || times.missing.length) {
      notify(t('أكمِل الحقول المحدّدة بالأحمر — والسائقُ الجديد يحتاج رقمَ إقامته', 'Fill the fields in red — a new driver needs his iqama'), 'error');
      return;
    }
    setSaving(true);
    try {
      const d = await api.post<{ waybills: number[]; failed: { message: string }[] }>(`/api/shipment-requests/${req._id}/place`, {
        trucks: rows.map((r) => ({
          kind: r.kind,
          ...(r.newFreelancer ? { newFreelancer: { name: r.flName.trim(), phone: r.flPhone.trim() } } : { supplierChoice: r.supplierId }),
          ...(r.vehicleId ? { vehicle: r.vehicleId } : { newVehicle: { plate: r.newPlate.trim() } }),
          ...(r.newFreelancer || (!r.driverId && r.ndName.trim())
            ? { newDriver: { name: r.ndName.trim(), phone: r.ndPhone.trim(), residenceNumber: r.ndIqama.trim() } }
            : { driverId: r.driverId }),
          truckType: r.truckType || undefined, sourcingRep: r.sourcingRep || null, helper: r.helper || null,
          buyPrice: Number(r.buyPrice), advanceAmount: r.advanceAmount === '' ? null : Number(r.advanceAmount),
          ...times.payload,
        })),
      });
      notify(t(`أُنشئت أوامر النقل: ${(d.waybills || []).join('، ')}${d.failed?.length ? ` · تعذّرت ${d.failed.length}: ${d.failed[0].message}` : ''}`, `Transport orders: ${(d.waybills || []).join(', ')}`), d.failed?.length ? 'error' : 'success');
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
        <RequestSummary req={req} ar={ar} />
        <TimesBlock t={times} ar={ar} tried={tried} />
        {rows.map((r, i) => (
          <TruckEditor key={i} i={i} row={r} reps={reps} helpers={helpers} types={reqTypes} miss={tried ? problems[i] : []} onChange={(p) => setRow(i, p)}
            onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, j) => j !== i)) : undefined} ar={ar} />
        ))}
        <div className="flex flex-wrap gap-2">
          {rows.length < req.open && <button type="button" onClick={() => setRows((p) => [...p, blankTruck(req, defRep)])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Plus className="w-4 h-4" />{t('شاحنةٌ أخرى', 'Another truck')}</button>}
          {rows.length < req.open && rows[0].supplierId && <button type="button" onClick={() => setRows((p) => [...p, { ...blankTruck(req, p[0].sourcingRep), kind: p[0].kind, supplierId: p[0].supplierId, supplierName: p[0].supplierName, buyPrice: p[0].buyPrice }])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Copy className="w-4 h-4" />{t('شاحنةٌ أخرى من نفس المورّد', 'Another from the same supplier')}</button>}
        </div>
      </div>
    </Modal>
  );
}

function TruckEditor({ i, row, reps, helpers, types, miss, onChange, onRemove, ar }: { i: number; row: TruckRow; reps: Opt[]; helpers: Opt[]; types: string[]; miss: string[]; onChange: (p: Partial<TruckRow>) => void; onRemove?: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [sups, setSups] = useState<OrderSupplier[]>([]);
  const [vehs, setVehs] = useState<OrderVehicle[]>([]);
  const [drivers, setDrivers] = useState<OrderDriver[]>([]);
  const [supBusy, setSupBusy] = useState(false);
  const supGuard = useLatestRequest();
  const kind = row.kind;
  const { notify, confirm } = useDialog();
  // Typing in the truck field also searches trucks outside this supplier's register (a truck may work for several suppliers).
  const [vq, setVq] = useState('');
  const [outside, setOutside] = useState<OrderVehicle[]>([]);
  const [vBusy, setVBusy] = useState(false);
  const vGuard = useLatestRequest();
  const searchVeh = useCallback(async (q: string) => {
    setVq(q);
    if (!q.trim() || !row.supplierId) { setOutside([]); return; }
    const my = vGuard.begin(); setVBusy(true);
    try {
      const d = await api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?limit=30&ownership=not_ours&notSupplier=${row.supplierId}&q=${encodeURIComponent(q.trim())}`);
      if (vGuard.isCurrent(my)) setOutside(d.vehicles || []);
    } catch { /* keep */ }
    if (vGuard.isCurrent(my)) setVBusy(false);
  }, [vGuard, row.supplierId]);
  const ownShown = vq.trim() ? vehs.filter((v) => foldAr(`${v.plate} ${v.truckType || ''} ${v.defaultDriverName || ''}`).includes(foldAr(vq.trim()))) : vehs;
  const pickVehicle = async (id: string) => {
    onChange({ vehicleId: id, newPlate: '' });
    const v = outside.find((x) => x._id === id);
    if (!v) return;
    const linked = await offerSupplierLink({ kind: 'vehicle', id, label: v.plate, supplierId: row.supplierId, supplierName: row.supplierName, ar, confirm, notify });
    if (linked) setVehs((p) => [v, ...p]);
    else setVehs((p) => (p.some((x) => x._id === id) ? p : [...p, v]));
  };
  // Approved carriers only, of the chosen kind (another agent's approval: missing status = approved).
  const searchSup = useCallback(async (q: string) => {
    const my = supGuard.begin(); setSupBusy(true);
    try {
      const d = await api.get<{ suppliers: OrderSupplier[] }>(`/api/shipment-orders/suppliers?limit=60&fresh=1&approved=1&type=${kind === 'freelancer' ? 'freelancer' : 'company'}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (supGuard.isCurrent(my)) setSups(d.suppliers || []);
    } catch { /* keep */ }
    if (supGuard.isCurrent(my)) setSupBusy(false);
  }, [supGuard, kind]);
  useEffect(() => { searchSup(''); }, [searchSup]);
  // The carrier's registered trucks and drivers; a freelancer with one of each is filled at once.
  useEffect(() => {
    if (!row.supplierId) { setVehs([]); setDrivers([]); return; }
    let live = true;
    Promise.all([
      api.get<{ vehicles: OrderVehicle[] }>(`/api/shipment-orders/vehicles?supplier=${row.supplierId}&limit=200`).catch(() => ({ vehicles: [] })),
      api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?supplier=${row.supplierId}&limit=200`).catch(() => ({ drivers: [] })),
    ]).then(([v, d]) => {
      if (!live) return;
      setVehs(v.vehicles || []); setDrivers(d.drivers || []);
      if (kind === 'freelancer' && !row.vehicleId && (v.vehicles || []).length === 1) onChange({ vehicleId: v.vehicles[0]._id });
      if (kind === 'freelancer' && !row.driverId && (d.drivers || []).length === 1) onChange({ driverId: (d.drivers[0] as any)._id, driverName: d.drivers[0].name });
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.supplierId]);
  const bad = (k: string) => miss.includes(k);
  const supOpts = sups.map((s) => ({ value: s._id, label: s.name, hint: s.phone || '' }));
  if (row.supplierId && !supOpts.some((o) => o.value === row.supplierId)) supOpts.unshift({ value: row.supplierId, label: row.supplierName || row.supplierId, hint: '' });
  const setKind = (k: Kind) => onChange({ kind: k, supplierId: '', supplierName: '', newFreelancer: false, vehicleId: '', newPlate: '', driverId: '', driverName: '', ndName: '', ndPhone: '', ndIqama: '' });
  const ring = (k: string) => (bad(k) ? 'rounded-lg ring-2 ring-red-400/60' : '');
  const lab = (k: string, a: string, e: string, req = true) => <label className={`${labelCls} ${bad(k) ? '!text-red-600' : ''}`}>{t(a, e)}{req && ' *'}</label>;
  const freshDriverForm = row.newFreelancer || (!row.driverId && !!row.ndName);
  return (
    <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-[#f37121]/15 text-[#f37121] font-bold text-sm flex items-center justify-center">{i + 1}</span>
        <p className="font-bold text-slate-900 text-sm">{t('الشاحنة', 'Truck')} {i + 1}</p>
        {/* First choice: a registered company or an individual freelancer. */}
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 ms-2">
          {([['vendor', 'مورد', 'Vendor', Building2], ['freelancer', 'فريلانسر', 'Freelancer', UserIcon]] as const).map(([k, a, e, Icon]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-[12.5px] font-semibold ${kind === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="w-3.5 h-3.5" />{t(a, e)}</button>
          ))}
        </div>
        {onRemove && <button type="button" onClick={onRemove} className="ms-auto text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t('مسؤول التوريد — مَن جاء بالمورّد ومالك السيارة', 'Sourcing — who found the carrier and truck owner')}</label>
          <SearchableSelect value={row.sourcingRep} searchAfter={0} onChange={(v) => onChange({ sourcingRep: v })}
            placeholder={t('اختر من فرق الموردين أو المبيعات أو العمليات أو البيانات', 'Pick from vendors, sales, operations or data')}
            options={reps.map((o) => ({ value: o.value, label: o.label, hint: o.roleAr || '' }))} />
        </div>
        <div>
          <label className={labelCls}>{t('بمساعدة أحد (اختياري)', 'Helped by (optional)')}</label>
          <SearchableSelect value={row.helper} searchAfter={0} onChange={(v) => onChange({ helper: v })}
            placeholder={t('ابحث عن الزميل', 'Search a colleague')}
            options={[{ value: '', label: t('— بدون —', '— none —') }, ...helpers.filter((o) => o.value !== row.sourcingRep).map((o) => ({ value: o.value, label: o.label, hint: o.roleAr || '' }))]} />
        </div>
        {types.length > 0 && (
          <div className="sm:col-span-2">
            <label className={`${labelCls} ${bad('type') ? '!text-red-600' : ''}`}>{t('نوع الشاحنة المنفَّذ', 'Truck type sent')}{types.length > 1 && ' *'}</label>
            <div className={`flex flex-wrap gap-1.5 ${bad('type') ? 'rounded-lg p-1 ring-2 ring-red-400/60' : ''}`}>
              {types.map((ty) => (
                <button key={ty} type="button" onClick={() => onChange({ truckType: ty })}
                  className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${row.truckType === ty ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#f37121]/50'}`}>{ty}</button>
              ))}
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          {lab('supplier', kind === 'freelancer' ? 'الفريلانسر' : 'المورّد', kind === 'freelancer' ? 'Freelancer' : 'Vendor')}
          {row.newFreelancer ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] p-2.5">
              <input value={row.flName} onChange={(e) => onChange({ flName: e.target.value, ndName: row.ndName || e.target.value })} placeholder={t('اسم الفريلانسر *', 'Freelancer name *')} className={`${inputCls} ${bad('supplier') ? 'border-red-400 bg-red-50' : ''}`} />
              <input value={row.flPhone} onChange={(e) => onChange({ flPhone: e.target.value, ndPhone: row.ndPhone || e.target.value })} placeholder={t('الجوال', 'Phone')} dir="ltr" className={inputCls} />
              <button type="button" onClick={() => onChange({ newFreelancer: false, flName: '', flPhone: '', ndName: '', ndPhone: '', ndIqama: '' })} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-900">{t('الاختيار من المسجَّلين', 'Pick a registered one')}</button>
            </div>
          ) : (
            <>
              <div className={ring('supplier')}>
                <SearchableSelect value={row.supplierId} searchAfter={0} onSearch={searchSup} loading={supBusy}
                  onChange={(v) => onChange({ supplierId: v, supplierName: sups.find((s) => s._id === v)?.name || '', vehicleId: '', driverId: '', driverName: '' })}
                  placeholder={kind === 'freelancer' ? t('ابحث عن الفريلانسر', 'Search the freelancer') : t('ابحث عن المورّد المعتمَد', 'Search an approved vendor')} options={supOpts} />
              </div>
              {kind === 'freelancer' && (
                <button type="button" onClick={() => onChange({ newFreelancer: true, supplierId: '', supplierName: '', vehicleId: '', driverId: '', driverName: '' })} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[#f37121] hover:underline"><Plus className="w-3.5 h-3.5" />{t('فريلانسر جديد', 'New freelancer')}</button>
              )}
            </>
          )}
        </div>
        <div>
          {lab('vehicle', 'السيارة (اللوحة)', 'Truck (plate)')}
          {!row.newFreelancer && (
            <div className={ring('vehicle')}>
              <SearchableSelect value={row.vehicleId} searchAfter={0} disabled={!row.supplierId}
                onChange={pickVehicle} onSearch={searchVeh} loading={vBusy}
                placeholder={row.supplierId ? t('من سيارات المورّد المسجَّلة', "From the carrier's registered trucks") : t('اختر المورّد أوّلًا', 'Pick the carrier first')}
                searchPlaceholder={t('اكتب اللوحة للبحث في كل الشاحنات', 'Type a plate to search every truck')}
                options={[
                  ...ownShown.map((v) => ({ value: v._id, label: v.plate, hint: [v.truckType, v.defaultDriverName].filter(Boolean).join(' · ') })),
                  ...outside.filter((v) => !vehs.some((x) => x._id === v._id)).map((v) => ({ value: v._id, label: v.plate, hint: [outsideHint(v, ar), v.truckType].filter(Boolean).join(' · ') })),
                ]} />
            </div>
          )}
          {!row.vehicleId && <input value={row.newPlate} onChange={(e) => onChange({ newPlate: e.target.value })} placeholder={row.newFreelancer ? t('لوحة سيارته *', 'His truck plate *') : t('أو أضِف لوحةً جديدة على هذا المورّد', 'or add a new plate for this carrier')} className={`${inputCls} mt-1.5 ${bad('vehicle') ? 'border-red-400 bg-red-50' : ''}`} />}
        </div>
        <div>
          {lab('driver', 'السائق', 'Driver')}
          {freshDriverForm ? (
            <div className="space-y-1.5 rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] p-2.5">
              <input value={row.ndName} onChange={(e) => onChange({ ndName: e.target.value })} placeholder={t('اسم السائق *', 'Driver name *')} className={inputCls} />
              <input value={row.ndPhone} onChange={(e) => onChange({ ndPhone: e.target.value })} placeholder={t('جوال السائق', 'Driver phone')} dir="ltr" className={inputCls} />
              <input value={row.ndIqama} onChange={(e) => onChange({ ndIqama: e.target.value })} placeholder={t('رقم الإقامة / الهوية *', 'Iqama / ID *')} dir="ltr"
                className={`${inputCls} ${bad('driver') && !IQAMA_RE.test(row.ndIqama.trim()) ? 'border-red-400 bg-red-50' : ''}`} />
              <p className="text-[11px] text-slate-500">{t('رقمُ الإقامة مطلوبٌ للسائق الجديد: عشرةُ أرقامٍ يبدأ بـ 1 أو 2.', 'Iqama required: 10 digits starting with 1 or 2.')}</p>
              {!row.newFreelancer && <button type="button" onClick={() => onChange({ ndName: '', ndPhone: '', ndIqama: '' })} className="text-[12px] font-semibold text-slate-500 hover:text-slate-900">{t('الاختيار من المسجَّلين', 'Pick a registered driver')}</button>}
            </div>
          ) : (
            <>
              <div className={ring('driver')}>
                <DriverPicker value={row.driverName} ar={ar} contextDrivers={drivers} supplierId={row.supplierId} supplierName={row.supplierName} vehicleId={row.vehicleId} requireIqama registeredOnly
                  placeholder={t('من سائقي المورّد المسجَّلين', "From the carrier's registered drivers")}
                  onPick={(d) => onChange({ driverName: d.name, driverId: (d.driver as any)?._id || '' })} />
              </div>
            </>
          )}
        </div>
        <div>
          {lab('buy', 'سعر الشراء', 'Purchase price')}
          <input type="number" min={0} value={row.buyPrice} onChange={(e) => onChange({ buyPrice: e.target.value })} className={`${inputCls} ${bad('buy') ? 'border-red-400 bg-red-50' : ''}`} />
        </div>
        <div>
          <label className={labelCls}>{t('السلفة', 'Advance')}</label>
          <input type="number" min={0} value={row.advanceAmount} onChange={(e) => onChange({ advanceAmount: e.target.value })} className={inputCls} />
        </div>
      </div>
    </div>
  );
}

// ── Fleet: our own trucks ───────────────────────────────────────────────────

type FleetRow = { vehicle: string; driver: string; secondDriver: string; price: string; driverExpense: string; fridayBonus: boolean; rentType: string; loadType: string; expectedArrival: string; notes: string; helper: string; truckType: string };
const blankFleet = (r: ShipmentRequest): FleetRow => ({ vehicle: '', driver: '', secondDriver: '', price: '', driverExpense: '', fridayBonus: false, rentType: '', loadType: '', expectedArrival: '', notes: '', helper: '', truckType: typesOfReq(r).length === 1 ? typesOfReq(r)[0] : '' });

export function FleetPlaceModal({ req, onClose, onDone }: { req: ShipmentRequest; onClose: () => void; onDone: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const helpers = useOptions('/api/shipment-requests/team-members?team=helpers');
  const [rows, setRows] = useState<FleetRow[]>([blankFleet(req)]);
  const times = useTimes(req);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    Promise.all([
      api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles').catch(() => ({ vehicles: [] })),
      api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers').catch(() => ({ drivers: [] })),
    ]).then(([v, d]) => { setVehicles(v.vehicles || []); setDrivers(d.drivers || []); });
  }, []);
  const setRow = (i: number, patch: Partial<FleetRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reqTypes = typesOfReq(req);
  const problems = rows.map((r) => [reqTypes.length > 1 && !r.truckType && 'type', !r.vehicle && 'vehicle', !r.driver && 'driver', !(Number(r.price) > 0) && 'price'].filter(Boolean) as string[]);
  const submit = async () => {
    setTried(true);
    if (problems.some((p) => p.length) || times.missing.length) { notify(t('أكمِل السيارة والسائق وإيجار السيارة والأوقات المطلوبة', 'Fill truck, driver, rent and required times'), 'error'); return; }
    setSaving(true);
    try {
      const d = await api.post<{ waybills: number[]; failed: { message: string }[] }>(`/api/shipment-requests/${req._id}/fleet-place`, {
        trucks: rows.map((r) => ({
          vehicle: r.vehicle, driver: r.driver, secondDriver: r.secondDriver || null, price: Number(r.price),
          driverExpense: r.driverExpense === '' ? 0 : Number(r.driverExpense), fridayBonus: r.fridayBonus,
          rentType: r.rentType, loadType: r.loadType, expectedArrival: r.expectedArrival ? new Date(r.expectedArrival).toISOString() : null,
          notes: r.notes, helper: r.helper || null, truckType: r.truckType || undefined, ...times.payload,
        })),
      });
      notify(t(`أُنشئت أوامر النقل وحمولات الأسطول: ${(d.waybills || []).join('، ')}${d.failed?.length ? ` · تعذّرت ${d.failed.length}: ${d.failed[0].message}` : ''}`, `Orders and fleet loads: ${(d.waybills || []).join(', ')}`), d.failed?.length ? 'error' : 'success');
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر الإنشاء', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} wide title={t(`إكمال الطلب رقم ${req.number} على سياراتنا`, `Complete request ${req.number} on our trucks`)}
      footer={(
        <div className="flex flex-wrap items-center gap-2 w-full">
          <span className="text-[12.5px] text-slate-600">{t(`${rows.length} من ${req.open} شاحنة مفتوحة`, `${rows.length} of ${req.open} open trucks`)}</span>
          <button type="button" onClick={submit} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('إنشاء أمر النقل والحمولة', 'Create order and load')}
          </button>
        </div>
      )}>
      <div className="space-y-3">
        <RequestSummary req={req} ar={ar} />
        <p className="text-[12px] text-slate-500">{t('يُنشأ أمرُ نقلٍ بمورّد «تنشيط» وحمولةٌ مرتبطةٌ في إدارة الأسطول؛ العميل والمسار وسعر البيع من الطلب.', 'A transport order with supplier «تنشيط» and its linked fleet load are created; customer, route and selling price come from the request.')}</p>
        <TimesBlock t={times} ar={ar} tried={tried} />
        {rows.map((r, i) => (
          <FleetTruckEditor key={i} i={i} row={r} vehicles={vehicles} drivers={drivers} helpers={helpers} types={reqTypes} taken={rows.filter((_, j) => j !== i).map((x) => x.vehicle)}
            miss={tried ? problems[i] : []} onChange={(p) => setRow(i, p)} onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, j) => j !== i)) : undefined} ar={ar} />
        ))}
        {rows.length < req.open && <button type="button" onClick={() => setRows((p) => [...p, blankFleet(req)])} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]"><Plus className="w-4 h-4" />{t('شاحنةٌ أخرى', 'Another truck')}</button>}
      </div>
    </Modal>
  );
}

function FleetTruckEditor({ i, row, vehicles, drivers, helpers, types, taken, miss, onChange, onRemove, ar }: { i: number; row: FleetRow; vehicles: FleetVehicle[]; drivers: FleetDriver[]; helpers: Opt[]; types: string[]; taken: string[]; miss: string[]; onChange: (p: Partial<FleetRow>) => void; onRemove?: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const bad = (k: string) => miss.includes(k);
  const vehicle = vehicles.find((v) => v._id === row.vehicle) || null;
  const plateOf = (d: FleetDriver) => {
    const vid = typeof d.vehicle === 'object' ? (d.vehicle as any)?._id : d.vehicle;
    return vehicles.find((v) => v._id === vid)?.plate || '';
  };
  const driverOpts = (other: string) => drivers.filter((d) => d._id !== other).map((d) => ({ value: d._id, label: d.name, hint: [plateOf(d) ? t(`على ${plateOf(d)}`, `on ${plateOf(d)}`) : t('بدون سيارة', 'unassigned'), d.working ? t('يعمل', 'working') : t('لا يعمل', 'off')].join(' · ') }));
  const pickVehicle = (id: string) => {
    const v = vehicles.find((x) => x._id === id);
    const [first, second] = seatsOf(v);
    onChange({ vehicle: id, driver: first?._id || row.driver, secondDriver: second?._id || '' });
  };
  const isFriday = new Date().getDay() === 5;
  const lab = (k: string, a: string, e: string, req = false) => <label className={`${labelCls} ${bad(k) ? '!text-red-600' : ''}`}>{t(a, e)}{req && ' *'}</label>;
  return (
    <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-[#f37121]/15 text-[#f37121] font-bold text-sm flex items-center justify-center">{i + 1}</span>
        <p className="font-bold text-slate-900 text-sm">{t('الشاحنة', 'Truck')} {i + 1}</p>
        {onRemove && <button type="button" onClick={onRemove} className="ms-auto text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="sm:col-span-2 lg:col-span-3">
          {lab('vehicle', 'السيارة من سياراتنا', 'Our truck', true)}
          <div className={bad('vehicle') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.vehicle} onChange={pickVehicle} searchAfter={0}
              placeholder={t('اكتب اللوحة أو اسم السائق أو المدينة…', 'Plate, driver or city…')}
              options={vehicles.filter((v) => !taken.includes(v._id)).map((v) => ({
                value: v._id, label: v.plate, badge: vehicleAvailabilityText(v, ar ? 'ar' : 'en'),
                tone: (v.trip ? (v.atDestination ? 'info' : 'busy') : 'ok') as 'ok' | 'busy' | 'info',
                hint: [(v.drivers || []).map((d) => d.name).join(' + ') || t('بدون سائق', 'no driver'), v.trailerType].filter(Boolean).join(' · '),
              }))} />
          </div>
          {vehicle?.trip && (
            <p className={`mt-1.5 rounded-lg border px-3 py-2 text-[12px] ${vehicle.atDestination ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {t(`عليها أمر نقل ${vehicle.trip.waybillNumber} — ${vehicle.trip.fromCity || ''} ← ${vehicle.trip.toCity || ''}`, `On order ${vehicle.trip.waybillNumber} — ${vehicle.trip.fromCity || ''} → ${vehicle.trip.toCity || ''}`)}{vehicle.atDestination ? t(' (وصلت — تفريغ)', ' (arrived — unloading)') : ''}
            </p>
          )}
        </div>
        {types.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={`${labelCls} ${bad('type') ? '!text-red-600' : ''}`}>{t('نوع الشاحنة المنفَّذ', 'Truck type sent')}{types.length > 1 && ' *'}</label>
            <div className="flex flex-wrap gap-1.5">
              {types.map((ty) => (
                <button key={ty} type="button" onClick={() => onChange({ truckType: ty })}
                  className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${row.truckType === ty ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{ty}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          {lab('driver', 'السائق الأول', 'First driver', true)}
          <div className={bad('driver') ? 'rounded-lg ring-2 ring-red-400/60' : ''}>
            <SearchableSelect value={row.driver} onChange={(v) => onChange({ driver: v })} searchAfter={0} placeholder={t('اختر السائق', 'Pick the driver')} options={driverOpts(row.secondDriver)} />
          </div>
        </div>
        <div>
          {lab('second', 'السائق الثاني (اختياري)', 'Second driver (optional)')}
          <SearchableSelect value={row.secondDriver} onChange={(v) => onChange({ secondDriver: v })} searchAfter={0} placeholder={t('— بدون —', '— none —')}
            options={[{ value: '', label: t('— بدون —', '— none —') }, ...driverOpts(row.driver)]} />
        </div>
        <div>
          {lab('price', 'إيجار السيارة', 'Vehicle rent', true)}
          <input type="number" min={0} value={row.price} onChange={(e) => onChange({ price: e.target.value })} className={`${inputCls} ${bad('price') ? 'border-red-400 bg-red-50' : ''}`} />
        </div>
        <div>
          <label className={labelCls}>{t('مصروف السائق (السلفة)', 'Driver expense (advance)')}</label>
          <input type="number" min={0} value={row.driverExpense} onChange={(e) => onChange({ driverExpense: e.target.value })} className={inputCls} placeholder="0" />
        </div>
        <div className="flex items-end">
          <button type="button" onClick={() => onChange({ fridayBonus: !row.fridayBonus })}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border ${row.fridayBonus ? 'bg-emerald-500/15 border-emerald-300 text-emerald-800' : isFriday ? 'bg-amber-500/15 border-amber-300 text-amber-800' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
            {row.fridayBonus ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}{t('بونص الجمعة للسائق', 'Friday driver bonus')}
          </button>
        </div>
        <div>
          <label className={labelCls}>{t('نوع الإيجار', 'Rent type')}</label>
          <SearchableManagedSelect type="fleet_rent_type" value={row.rentType} onChange={(v) => onChange({ rentType: v })} placeholder={t('اختر', 'Choose')} />
        </div>
        <div>
          <label className={labelCls}>{t('نوع الحمولة', 'Load type')}</label>
          <SearchableManagedSelect type="fleet_load_type" value={row.loadType} onChange={(v) => onChange({ loadType: v })} placeholder={t('اختر', 'Choose')} />
        </div>
        <div>
          <label className={labelCls}>{t('متوقع الوصول (اختياري)', 'Expected arrival (optional)')}</label>
          <input type="datetime-local" value={row.expectedArrival} onChange={(e) => onChange({ expectedArrival: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t('بمساعدة أحد (اختياري)', 'Helped by (optional)')}</label>
          <SearchableSelect value={row.helper} searchAfter={0} onChange={(v) => onChange({ helper: v })} placeholder={t('ابحث عن الزميل', 'Search a colleague')}
            options={[{ value: '', label: t('— بدون —', '— none —') }, ...helpers.map((o) => ({ value: o.value, label: o.label, hint: o.roleAr || '' }))]} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>{t('ملاحظات', 'Notes')}</label>
          <input value={row.notes} onChange={(e) => onChange({ notes: e.target.value })} className={inputCls} />
        </div>
      </div>
    </div>
  );
}

// ── «تحصيل السيارات» ────────────────────────────────────────────────────────

export function SourcingModal({ req, team, canLead, onClose, onChanged }: { req: ShipmentRequest; team: 'vendors' | 'fleet'; canLead: boolean; onClose: () => void; onChanged: (r: ShipmentRequest) => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const { user } = useAuth();
  const me = String(user?._id || '');
  // «بمساعدة» may be anyone in sales, operations (vendors and follow-up included), the data team or the fleet.
  const members = useOptions('/api/shipment-requests/team-members?team=helpers');
  const [count, setCount] = useState('1');
  const [helper, setHelper] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; count: string; helper: string } | null>(null);
  const entries = useMemo(() => [...(req.sourcing || [])].sort((a, b) => +new Date(b.at) - +new Date(a.at)), [req.sourcing]);
  const sourced = req.sourced || 0;
  const run = async (fn: () => Promise<{ request: ShipmentRequest }>, ok: string) => {
    setBusy(true);
    try { const d = await fn(); onChanged(d.request); notify(ok, 'success'); setEdit(null); } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setBusy(false);
  };
  const add = () => run(() => api.post(`/api/shipment-requests/${req._id}/sourcing`, { count: Number(count), helper: helper || null, note, team }), t('سُجِّل التحصيل', 'Recorded'))
    .then(() => { setCount('1'); setHelper(''); setNote(''); });
  const canEdit = (e: SourcingEntry) => String(e.by) === me || canLead;
  const open = ['pending', 'in_progress', 'completed'].includes(req.status);
  return (
    <Modal open onClose={onClose} title={t(`تحصيل السيارات — الطلب رقم ${req.number}`, `Trucks sourced — request ${req.number}`)}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {([[t('المطلوب', 'Asked'), req.trucks, 'text-slate-900'], [t('حُصِّلت', 'Sourced'), sourced, 'text-emerald-700'], [t('متبقّية', 'Remaining'), Math.max(0, req.trucks - sourced), 'text-amber-700']] as const).map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-slate-200 py-2"><p className="text-[11.5px] text-slate-500">{l}</p><p className={`text-xl font-extrabold tabular-nums ${c}`}>{v}</p></div>
          ))}
        </div>
        <p className="text-[11.5px] text-slate-500">{t('سجلُّ متابعةٍ فقط؛ أعمدةُ الإنجاز تبقى عدَّ أوامر النقل الفعليّة.', 'A follow-up aid only; the progress columns still count real transport orders.')}</p>
        {open && (
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-sm font-bold text-slate-900">{t('حصّلتُ سيارات لهذا الطلب', 'I sourced trucks for this request')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block"><span className="mb-1 block text-[12px] font-bold text-slate-600">{t('عدد السيارات', 'Cars')} *</span>
              <input type="number" min={1} max={25} value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} placeholder={t('العدد', 'Count')} /></label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-[12px] font-bold text-slate-600">{t('بمساعدة مَن؟ (اختياري)', 'Helped by whom? (optional)')}</span>
                <SearchableSelect value={helper} searchAfter={0} onChange={setHelper} placeholder={t('بمساعدة شخصٍ آخر (اختياري)', 'Helped by someone (optional)')}
                  options={[{ value: '', label: t('— بدون —', '— none —') }, ...members.filter((o) => o.value !== me).map((o) => ({ value: o.value, label: o.label, hint: o.roleAr || '' }))]} />
              </div>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={t('ملاحظة (اختياري)', 'Note (optional)')} />
            <button type="button" onClick={add} disabled={busy || !(Number(count) >= 1)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{t('تسجيل', 'Record')}
            </button>
          </div>
        )}
        {!entries.length ? <p className="py-4 text-center text-sm text-slate-500">{t('لا تسجيلات بعد', 'No records yet')}</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {entries.map((e) => (
              <li key={e._id} className="px-3 py-2.5 text-[13px]">
                {edit?.id === e._id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="number" min={1} max={25} value={edit.count} onChange={(ev) => setEdit({ ...edit, count: ev.target.value })} className={`${inputCls} !w-20`} />
                    <div className="min-w-[180px] flex-1">
                      <SearchableSelect value={edit.helper} searchAfter={0} onChange={(v) => setEdit({ ...edit, helper: v })} placeholder={t('بمساعدة', 'Helped by')}
                        options={[{ value: '', label: t('— بدون —', '— none —') }, ...members.map((o) => ({ value: o.value, label: o.label }))]} />
                    </div>
                    <button type="button" disabled={busy} onClick={() => run(() => api.put(`/api/shipment-requests/${req._id}/sourcing/${e._id}`, { count: Number(edit.count), helper: edit.helper || null, team }), t('حُفظ', 'Saved'))} className="p-1.5 text-emerald-700"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setEdit(null)} className="p-1.5 text-slate-400"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold text-slate-900">{e.byName}</span>
                    <span className="rounded bg-emerald-50 px-1.5 font-bold tabular-nums text-emerald-800">{e.count}</span>
                    {e.helperName && <span className="text-slate-600">{t('بمساعدة', 'with')} {e.helperName}</span>}
                    <span className="text-[11.5px] text-slate-400">{when(e.at)}{e.editedAt ? t(' · عُدِّل', ' · edited') : ''}</span>
                    {canEdit(e) && (
                      <span className="ms-auto flex gap-1">
                        <button type="button" onClick={() => setEdit({ id: e._id, count: String(e.count), helper: String(e.helper || '') })} className="p-1 text-slate-400 hover:text-slate-800"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" disabled={busy} onClick={async () => { if (await confirm({ title: t('حذف التسجيل', 'Delete record'), message: t('يُحذف هذا التسجيل من تحصيل السيارات.', 'This record is removed.'), tone: 'danger' as any })) run(() => api.delete(`/api/shipment-requests/${req._id}/sourcing/${e._id}?team=${team}`), t('حُذف', 'Deleted')); }} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </span>
                    )}
                    {e.note && <p className="w-full text-[12px] text-slate-600">{e.note}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-400">{t('تاريخ التحميل', 'Pickup')}: {day(req.pickupTime)}</p>
      </div>
    </Modal>
  );
}
