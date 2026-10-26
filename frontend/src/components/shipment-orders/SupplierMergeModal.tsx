'use client';
// ── دمجُ مورّدَين (٢٠٢٦/١٠/٢٦) ──────────────────────────────────────────────
// «فيه اتنين مورد بنفس الاسم… دول نفس الشخص، وحّدهم وضيف بياناتهم على بعض».
// يُختار المورّدُ الآخر (المكرَّرُ باسمه أوّلًا)، ويُختار أيُّهما يبقى، ثمّ يدمج
// الخادمُ: الخاناتُ الفارغةُ تُملأ، والمختلفةُ تُضاف إلى الملاحظات، وتنتقل
// الشاحناتُ والسائقون والشحناتُ إلى الباقي (POST /suppliers/:id/merge).
import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, GitMerge, Search } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import type { OrderSupplier } from '@/lib/shipmentOrders';

/** يطوي الاسم: التشكيل والهمزات والتاء المربوطة والمسافات — «اللوجيستيه» = «اللوجستية» تقريبًا. */
export const supplierNameKey = (v?: string) => String(v || '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, ' ').trim().toLowerCase();

const FIELDS: [keyof OrderSupplier | string, string, string][] = [
  ['phone', 'الهاتف', 'Phone'], ['commercialRegister', 'السجل التجاري', 'CR'], ['iban', 'الآيبان', 'IBAN'],
  ['managerName', 'المدير', 'Manager'], ['ownerName', 'المالك', 'Owner'], ['email', 'البريد', 'Email'],
];

export default function SupplierMergeModal({ supplier, all, ar, onClose, onDone }: {
  supplier: OrderSupplier;
  /** المورّدون المحمَّلون في الصفحة — منهم يُقترح المكرَّر. */
  all: OrderSupplier[];
  ar: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirm } = useDialog();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<OrderSupplier[]>([]);
  const [other, setOther] = useState<OrderSupplier | null>(null);
  const [keepId, setKeepId] = useState<string>(supplier._id);
  const [busy, setBusy] = useState(false);

  const twins = useMemo(() => {
    const k = supplierNameKey(supplier.name);
    return all.filter((s) => s._id !== supplier._id && supplierNameKey(s.name) === k);
  }, [all, supplier]);

  useEffect(() => { if (twins.length === 1 && !other) setOther(twins[0]); }, [twins, other]);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      api.get<{ suppliers: OrderSupplier[] }>(`/api/shipment-orders/suppliers?limit=30&q=${encodeURIComponent(term)}`)
        .then((d) => { if (live) setFound((d.suppliers || []).filter((s) => s._id !== supplier._id)); })
        .catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, supplier._id]);

  // يبقى افتراضًا مَن له شاحناتٌ أكثر — هو المعروفُ في الشحنات.
  useEffect(() => {
    if (!other) return;
    setKeepId((other.vehicleCount || 0) > (supplier.vehicleCount || 0) ? other._id : supplier._id);
  }, [other, supplier]);

  const pair = other ? [supplier, other] : [];
  const keep = pair.find((s) => s._id === keepId) || supplier;
  const drop = pair.find((s) => s._id !== keepId) || null;

  const run = async () => {
    if (!other || !drop) return;
    const ok = await confirm(ar
      ? `دمج «${drop.name}» في «${keep.name}»؟ تنتقل شاحناته وسائقوه وشحناته، وتُضاف بياناته، ولا يُتراجَع عن الدمج.`
      : `Merge “${drop.name}” into “${keep.name}”? Its trucks, drivers and shipments move over and its details are added. This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post<{ moved: { orders: number; vehicles: number; drivers: number } }>(
        `/api/shipment-orders/suppliers/${keep._id}/merge`, { from: drop._id });
      notify(ar
        ? `تم الدمج — انتقل ${r.moved.vehicles} شاحنة و${r.moved.drivers} سائق و${r.moved.orders} شحنة`
        : `Merged — moved ${r.moved.vehicles} trucks, ${r.moved.drivers} drivers, ${r.moved.orders} shipments`, 'success');
      onDone();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر الدمج' : 'Merge failed'), 'error'); }
    setBusy(false);
  };

  const Card = ({ s }: { s: OrderSupplier }) => {
    const on = s._id === keepId;
    return (
      <button type="button" onClick={() => setKeepId(s._id)}
        className={`text-start rounded-xl border-2 p-3 transition-colors ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
        <p className={`text-[11px] font-bold mb-1 ${on ? 'text-emerald-700' : 'text-slate-400'}`}>
          {on ? (ar ? 'يبقى' : 'Keep') : (ar ? 'يُدمَج فيه' : 'Merged in')}
        </p>
        <p className="font-bold text-slate-900 break-words">{s.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {ar ? `${s.vehicleCount || 0} شاحنة · ${s.driverCount || 0} سائق` : `${s.vehicleCount || 0} trucks · ${s.driverCount || 0} drivers`}
        </p>
        <dl className="mt-2 space-y-0.5">
          {FIELDS.map(([k, a, e]) => {
            const v = String((s as any)[k] || '').trim();
            return v ? (
              <div key={String(k)} className="flex gap-2 text-[12px]">
                <dt className="text-slate-400 shrink-0">{ar ? a : e}</dt>
                <dd className="text-slate-700 font-medium break-all" dir="auto">{v}</dd>
              </div>
            ) : null;
          })}
        </dl>
      </button>
    );
  };

  const choices = q.trim() ? found : twins;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 flex items-center gap-2"><GitMerge className="w-5 h-5 text-[#f37121]" />{ar ? 'دمج مورّدَين' : 'Merge two suppliers'}</p>
            <p className="text-sm text-slate-500 mt-0.5">{ar ? 'نفس المورّد مسجَّل مرّتين؟ يصيران سجلًّا واحدًا ببيانات الاثنين.' : 'Same supplier recorded twice? They become one record with both sets of details.'}</p>
          </div>
          <button type="button" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!other && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">{ar ? `اختر المورّد المكرَّر لـ«${supplier.name}»` : `Pick the duplicate of “${supplier.name}”`}</p>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث باسم المورّد…' : 'Search a supplier…'}
                  className="w-full ps-9 pe-3 py-2.5 rounded-xl border border-slate-300 text-sm" />
              </div>
              {!q.trim() && twins.length > 0 && <p className="text-xs text-amber-700 font-semibold">{ar ? 'بنفس الاسم:' : 'Same name:'}</p>}
              <div className="space-y-1.5">
                {choices.map((s) => (
                  <button key={s._id} type="button" onClick={() => setOther(s)}
                    className="w-full text-start rounded-lg border border-slate-200 px-3 py-2 hover:border-[#f37121] hover:bg-orange-50/40">
                    <span className="font-semibold text-slate-900">{s.name}</span>
                    <span className="text-xs text-slate-500 ms-2">{ar ? `${s.vehicleCount || 0} شاحنة` : `${s.vehicleCount || 0} trucks`}{s.phone ? ` · ${s.phone}` : ''}</span>
                  </button>
                ))}
                {q.trim() && !found.length && <p className="text-sm text-slate-400">{ar ? 'لا نتائج' : 'No results'}</p>}
              </div>
            </div>
          )}
          {other && (
            <>
              <p className="text-sm text-slate-600">{ar ? 'اضغط على البطاقة التي تبقى — والأخرى تُدمَج فيها:' : 'Tap the card to keep — the other is merged into it:'}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Card s={supplier} />
                <Card s={other} />
              </div>
              <ul className="text-[12.5px] text-slate-600 list-disc ps-5 space-y-0.5">
                <li>{ar ? 'الخانات الفارغة في الباقي تُملأ من الآخر، والمختلفة تُحفَظ في الملاحظات.' : 'Empty fields are filled from the other; differing ones are kept in the notes.'}</li>
                <li>{ar ? 'الشاحنات والسائقون والشحنات وحسابات البوّابة تنتقل إلى الباقي.' : 'Trucks, drivers, shipments and portal accounts move to the kept one.'}</li>
                <li>{ar ? 'رقمه في منصّة التشغيل يُحفظ على الباقي، فلا يعود مكرَّرًا مع الاستيراد.' : 'Its operations-platform ID stays on the kept one, so an import will not split it again.'}</li>
              </ul>
              {twins.length !== 1 && <button type="button" onClick={() => setOther(null)} className="text-sm text-slate-500 underline">{ar ? 'اختيار مورّد آخر' : 'Pick another supplier'}</button>}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" onClick={run} disabled={!other || busy}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#f37121] text-white text-sm font-bold hover:bg-[#e06010] disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
            {ar ? 'دمج' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
