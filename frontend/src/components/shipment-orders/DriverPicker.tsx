'use client';
// Driver field in shipment creation: one for the first truck and for 'add another truck'. A single component used by both rows so they cannot drift.
// Without typing: drivers of the chosen truck/supplier (`contextDrivers`). With typing: server search across all drivers by name, mobile (any format) and residency. An unregistered name is written and proceeds (`allowCustom`). 'New driver' registers at once, and one already registered with the same mobile or residency is picked instead of duplicated (`reuse`).
import { useCallback, useState } from 'react';
import { UserPlus, Loader2, Check } from 'lucide-react';
import api from '@/lib/api';
import { SearchableSelect, PhoneSA } from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import type { OrderDriver } from '@/lib/shipmentOrders';
import { isLinkedTo, outsideHint, offerSupplierLink } from '@/lib/supplierLinks';

// '0' is not a value: the imported driver register holds '0' and '-' where there is no value, in mobile, residency and operating card date. They displayed as '0' beside the name, 'card until 0', and filled the shipment mobile with '0'. A masked blank is treated as blank, and a date is a date or nothing.
export const realVal = (v: unknown) => {
  const t = String(v ?? '').trim();
  return /^(0+|-+|null|undefined|nan|n\/a)$/i.test(t) ? '' : t;
};
const realDate = (v: unknown) => {
  const t = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
};

export default function DriverPicker({
  value, onPick, contextDrivers, supplierId, supplierName, vehicleId, ar, compact, placeholder, requireIqama, registeredOnly,
}: {
  value: string;
  /** Selected driver: registered (`_id` with mobile) or a name typed as is. */
  onPick: (d: { name: string; phone?: string; driver?: OrderDriver }) => void;
  contextDrivers: OrderDriver[];
  supplierId?: string;
  /** Named in the «ربط بالمورد؟» question when a driver from outside its register is picked. */
  supplierName?: string;
  vehicleId?: string;
  ar: boolean;
  compact?: boolean;
  placeholder?: string;
  /** A new driver must carry his iqama number (completing a sales request). */
  requireIqama?: boolean;
  /** Only registered drivers: no typed name used as is. */
  registeredOnly?: boolean;
}) {
  const { notify } = useDialog();
  const guard = useLatestRequest();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<OrderDriver[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', residenceNumber: '' });
  const [saving, setSaving] = useState(false);

  const search = useCallback(async (term: string) => {
    setQ(term);
    if (!term) { setHits([]); return; }
    const mine = guard.begin();
    setBusy(true);
    try {
      const d = await api.get<{ drivers: OrderDriver[] }>(`/api/shipment-orders/drivers?limit=40&q=${encodeURIComponent(term)}`);
      if (guard.isCurrent(mine)) setHits(d.drivers || []);
    } catch { /* The list stays as it was. */ }
    finally { if (guard.isCurrent(mine)) setBusy(false); }
  }, [guard]);

  // 'Already exists' is a warning, not a silent pick: the server returns the existing driver if it matches a mobile, residency or folded name. Name alone may be another person (many with the same name), so adding is allowed; mobile and residency identify one man, who is not registered twice.
  const { confirm } = useDialog();
  // A driver from outside the chosen supplier's register is still picked; linking him is offered once.
  const pick = (p: { name: string; phone?: string; driver?: OrderDriver }) => {
    onPick(p);
    const d = p.driver as (OrderDriver & { _id?: string }) | undefined;
    if (supplierId && d?._id && !isLinkedTo(d, supplierId) && !contextDrivers.some((c: any) => c._id === d._id)) {
      offerSupplierLink({ kind: 'driver', id: d._id, label: d.name, supplierId, supplierName: supplierName || '', ar, confirm, notify });
    }
  };
  const save = async (force = false) => {
    const name = form.name.trim();
    if (!name) { notify(ar ? 'اكتب اسم السائق' : 'Enter the driver name', 'error'); return; }
    const iq = form.residenceNumber.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, '');
    if (requireIqama && !/^[12]\d{9}$/.test(iq)) { notify(ar ? 'رقمُ الإقامة/الهوية مطلوب: عشرةُ أرقامٍ يبدأ بـ 1 أو 2' : 'Iqama/ID required: 10 digits starting with 1 or 2', 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ driver: OrderDriver; existed?: boolean; matchedBy?: string }>('/api/shipment-orders/drivers', {
        name, phone: form.phone.trim(), residenceNumber: form.residenceNumber.trim(), reuse: true, ...(force ? { force: true } : {}),
        ...(supplierId ? { supplier: supplierId } : {}), ...(vehicleId ? { vehicle: vehicleId } : {}),
      });
      if (r.existed) {
        setSaving(false);
        const by = r.matchedBy === 'phone' ? (ar ? 'بنفس رقم الجوال' : 'with the same phone')
          : r.matchedBy === 'iqama' ? (ar ? 'بنفس رقم الإقامة' : 'with the same iqama') : (ar ? 'بنفس الاسم' : 'with the same name');
        const info = [realVal(r.driver.phone), realVal(r.driver.residenceNumber)].filter(Boolean).join(' · ');
        const useExisting = await confirm({
          title: ar ? 'هذا السائق موجود بالفعل' : 'This driver already exists',
          message: ar
            ? `«${r.driver.name}» مسجَّل ${by}${info ? ` (${info})` : ''}. نختاره بدل إضافته مرّةً ثانية؟`
            : `“${r.driver.name}” is registered ${by}${info ? ` (${info})` : ''}. Pick him instead of adding him again?`,
          confirmLabel: ar ? 'اختيار الموجود' : 'Pick existing',
          cancelLabel: r.matchedBy === 'name' ? (ar ? 'شخص آخر — أضفه' : 'Different person — add') : (ar ? 'رجوع' : 'Back'),
        });
        if (useExisting) {
          pick({ name: r.driver.name, phone: realVal(r.driver.phone) || undefined, driver: r.driver });
          setAdding(false);
          setForm({ name: '', phone: '', residenceNumber: '' });
        } else if (r.matchedBy === 'name') {
          await save(true);
        }
        return;
      }
      onPick({ name: r.driver.name, phone: realVal(r.driver.phone) || undefined, driver: r.driver });
      setAdding(false);
      setForm({ name: '', phone: '', residenceNumber: '' });
      notify(ar ? `سُجِّل السائق «${r.driver.name}»` : `Driver “${r.driver.name}” registered`, 'success');
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر تسجيل السائق' : 'Could not register the driver'), 'error'); }
    setSaving(false);
  };

  const inp = `w-full px-3 ${compact ? 'py-1.5 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-white border border-slate-200`;

  if (adding) {
    return (
      <div className="rounded-xl border border-[#f37121]/30 bg-[#f37121]/[0.04] p-3 space-y-2">
        <input value={form.name} autoFocus onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          placeholder={ar ? 'اسم السائق *' : 'Driver name *'} className={inp} />
        <PhoneSA compact={compact} value={form.phone} onChange={(v) => setForm((x) => ({ ...x, phone: v }))} />
        <input value={form.residenceNumber} onChange={(e) => setForm((v) => ({ ...v, residenceNumber: e.target.value }))}
          placeholder={requireIqama ? (ar ? 'رقم الإقامة / الهوية *' : 'Iqama / ID number *') : (ar ? 'رقم الإقامة / الهوية (اختياري)' : 'Iqama / ID number (optional)')} dir="ltr" className={inp} />
        <p className="text-[11.5px] text-slate-500">
          {ar ? `يُسجَّل في صفحة السوّاق فورًا${supplierId ? ' على المورّد المختار' : ''} — ومن كان مسجَّلًا بنفس الجوال أو الإقامة يُختار بدل تكراره.`
            : `Registered on the drivers page at once${supplierId ? ' under the chosen supplier' : ''} — an existing driver with the same phone or iqama is picked instead.`}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-900">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={() => save()} disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {ar ? 'حفظ السائق' : 'Save driver'}
          </button>
        </div>
      </div>
    );
  }

  // Searching reads every driver: the supplier's own come first, the rest are marked as outside its register.
  const list = q && supplierId ? [...hits.filter((d) => isLinkedTo(d, supplierId)), ...hits.filter((d) => !isLinkedTo(d, supplierId))] : q ? hits : contextDrivers;
  return (
    <div className="flex gap-2">
      <div className="flex-1 min-w-0">
        <SearchableSelect
          value={value} allowCustom={!registeredOnly} searchAfter={0}
          onSearch={search} loading={busy}
          customHint={(x) => (ar ? `استعمل «${x}» كما كُتب` : `Use “${x}” as typed`)}
          onChange={(x) => {
            const d = [...hits, ...contextDrivers].find((y) => y.name === x);
            if (registeredOnly && !d) return;
            pick({ name: x, phone: realVal(d?.phone) || undefined, driver: d });
          }}
          placeholder={placeholder || (ar ? 'يُملأ تلقائياً عند اختيار السيارة' : 'Autofills from the vehicle')}
          searchPlaceholder={supplierId
            ? (ar ? 'اكتب الاسم أو الجوال أو الإقامة للبحث في كل السائقين' : 'Type a name, phone or iqama to search every driver')
            : (ar ? 'الاسم أو الجوال أو رقم الإقامة…' : 'Name, phone or iqama…')}
          emptyLabel={ar ? 'لا نتائج — اكتب الاسم أو سجّله كسائق جديد' : 'No matches — type the name or register a new driver'}
          options={list.map((d) => {
            const exp = realDate(d.driverCardExpiry);
            const over = exp && new Date(`${exp}T00:00:00`).getTime() < Date.now();
            return {
              value: d.name,
              label: d.name,
              hint: [supplierId && q && !isLinkedTo(d, supplierId) ? outsideHint(d, ar) : '', d.phone, d.residenceNumber, d.nationality].map(realVal).filter(Boolean).join(' · ') || undefined,
              badge: exp
                ? (over ? (ar ? `بطاقة التشغيل منتهية ${exp}` : `Driver card expired ${exp}`)
                  : (ar ? `بطاقة التشغيل حتى ${exp}` : `Card valid to ${exp}`))
                : undefined,
              tone: (exp ? (over ? 'busy' : 'ok') : undefined) as 'busy' | 'ok' | undefined,
            };
          })} />
      </div>
      <button type="button" onClick={() => { setAdding(true); setForm({ name: '', phone: '', residenceNumber: '' }); }}
        className={`shrink-0 flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2.5 text-sm'} rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 font-semibold`}
        title={ar ? 'تسجيل سائق جديد' : 'Register a new driver'}>
        <UserPlus className="w-4 h-4" /> {!compact && <span className="hidden sm:inline">{ar ? 'سائق جديد' : 'New driver'}</span>}
      </button>
    </div>
  );
}
