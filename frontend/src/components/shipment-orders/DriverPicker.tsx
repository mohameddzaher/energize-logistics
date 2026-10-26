'use client';
// ── خانةُ السائق في إنشاء الشحنة — واحدةٌ للشاحنة الأولى ولـ«+ شاحنة أخرى» ────
// (٢٠٢٦/١٠/٢٦) «بحث برقم جوال السائق زي البحث بالاسم»، و«زر إضافة سائق زي
// المورّد»، ثمّ «تأكّد إن + شاحنة أخرى ماتشنج مع التعديلات». فالخانةُ مكوّنٌ
// واحد يستعمله الصفّان، فلا يفترقان مرّةً أخرى.
//
// بلا كتابة: سوّاقُ الشاحنة/المورّد المختار (`contextDrivers`). ومع الكتابة: بحثٌ
// عند الخادم في السوّاق كلِّهم بالاسم والجوال (كيفما كُتب) والإقامة. والاسمُ غيرُ
// المسجَّل يُكتب ويمضي (`allowCustom`). و«سائق جديد» يسجّله فورًا — ومن كان
// مسجَّلًا بنفس الجوال أو الإقامة يُختار بدل تكراره (`reuse`).
import { useCallback, useState } from 'react';
import { UserPlus, Loader2, Check } from 'lucide-react';
import api from '@/lib/api';
import { SearchableSelect, PhoneSA } from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import type { OrderDriver } from '@/lib/shipmentOrders';

export default function DriverPicker({
  value, onPick, contextDrivers, supplierId, vehicleId, ar, compact, placeholder,
}: {
  value: string;
  /** السائقُ المختار — مسجَّلًا (`_id` ومعه جوّاله) أو اسمًا كُتب كما هو. */
  onPick: (d: { name: string; phone?: string; driver?: OrderDriver }) => void;
  contextDrivers: OrderDriver[];
  supplierId?: string;
  vehicleId?: string;
  ar: boolean;
  compact?: boolean;
  placeholder?: string;
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
    } catch { /* تبقى القائمةُ كما كانت */ }
    finally { if (guard.isCurrent(mine)) setBusy(false); }
  }, [guard]);

  const save = async () => {
    const name = form.name.trim();
    if (!name) { notify(ar ? 'اكتب اسم السائق' : 'Enter the driver name', 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ driver: OrderDriver; existed?: boolean }>('/api/shipment-orders/drivers', {
        name, phone: form.phone.trim(), residenceNumber: form.residenceNumber.trim(), reuse: true,
        ...(supplierId ? { supplier: supplierId } : {}), ...(vehicleId ? { vehicle: vehicleId } : {}),
      });
      onPick({ name: r.driver.name, phone: r.driver.phone, driver: r.driver });
      setAdding(false);
      setForm({ name: '', phone: '', residenceNumber: '' });
      notify(r.existed
        ? (ar ? `السائق مسجَّل من قبل «${r.driver.name}» — اخترناه` : `Already registered as “${r.driver.name}” — selected`)
        : (ar ? `سُجِّل السائق «${r.driver.name}»` : `Driver “${r.driver.name}” registered`), 'success');
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
          placeholder={ar ? 'رقم الإقامة / الهوية (اختياري)' : 'Iqama / ID number (optional)'} dir="ltr" className={inp} />
        <p className="text-[11.5px] text-slate-500">
          {ar ? `يُسجَّل في صفحة السوّاق فورًا${supplierId ? ' على المورّد المختار' : ''} — ومن كان مسجَّلًا بنفس الجوال أو الإقامة يُختار بدل تكراره.`
            : `Registered on the drivers page at once${supplierId ? ' under the chosen supplier' : ''} — an existing driver with the same phone or iqama is picked instead.`}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-900">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={save} disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {ar ? 'حفظ السائق' : 'Save driver'}
          </button>
        </div>
      </div>
    );
  }

  const list = q ? hits : contextDrivers;
  return (
    <div className="flex gap-2">
      <div className="flex-1 min-w-0">
        <SearchableSelect
          value={value} allowCustom searchAfter={0}
          onSearch={search} loading={busy}
          customHint={(x) => (ar ? `استعمل «${x}» كما كُتب` : `Use “${x}” as typed`)}
          onChange={(x) => {
            const d = [...hits, ...contextDrivers].find((y) => y.name === x);
            onPick({ name: x, phone: d?.phone, driver: d });
          }}
          placeholder={placeholder || (ar ? 'يُملأ تلقائياً عند اختيار السيارة' : 'Autofills from the vehicle')}
          searchPlaceholder={ar ? 'الاسم أو الجوال أو رقم الإقامة…' : 'Name, phone or iqama…'}
          emptyLabel={ar ? 'لا نتائج — اكتب الاسم أو سجّله كسائق جديد' : 'No matches — type the name or register a new driver'}
          options={list.map((d) => {
            const exp = (d.driverCardExpiry || '').slice(0, 10);
            const over = exp && new Date(`${exp}T00:00:00`).getTime() < Date.now();
            return {
              value: d.name,
              label: d.name,
              hint: [d.phone, d.residenceNumber, d.nationality].filter(Boolean).join(' · '),
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
