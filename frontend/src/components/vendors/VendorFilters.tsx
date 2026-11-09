'use client';
/**
 * Filters shared by the vendors section's two analyses. Shipment dimensions (branch, customer, cities, truck, operations
 * rep, payment) narrow the trips counted; carrier dimensions (kind, follow-up owner, contract status) narrow the
 * carriers. Values carry counts from the server; every pick re-queries live.
 */
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import MultiSearchSelect from '@/components/system/MultiSearchSelect';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import { kindLabel } from '@/lib/vendors';
import { X, RotateCcw } from 'lucide-react';

export type VendorFilterState = Record<string, string[]>;

const DIMS: [string, string, string][] = [
  ['branch', 'الفرع', 'Branch'], ['customer', 'العميل', 'Customer'], ['fromCity', 'مدينة التحميل', 'Loading city'], ['toCity', 'مدينة الوصول', 'Destination'],
  ['truckType', 'نوع الشاحنة', 'Truck type'], ['agent', 'مندوب التشغيل', 'Operations rep'], ['payment', 'نوع الدفع', 'Payment type'],
  ['kind', 'نوع المورّد', 'Carrier kind'], ['owner', 'مسؤول المتابعة', 'Follow-up owner'], ['contract', 'حالة التعاقد', 'Contract status'],
];

/** The filters as query parameters (repeated `f_<dim>`). */
export const vendorFilterQuery = (f: VendorFilterState) => {
  const p = new URLSearchParams();
  for (const [k, vals] of Object.entries(f)) vals.forEach((v) => p.append(`f_${k}`, v));
  return p.toString();
};

export default function VendorFilters({ value, onChange, from, to, ar }: {
  value: VendorFilterState; onChange: (v: VendorFilterState) => void; from: string; to: string; ar: boolean;
}) {
  const [opts, setOpts] = useState<Record<string, { value: string; count: number }[]>>({});
  const [carrier, setCarrier] = useState<{ owners: { value: string; count: number }[]; contracts: { value: string; count: number }[] }>({ owners: [], contracts: [] });
  useEffect(() => {
    api.get<{ options: Record<string, { value: string; count: number }[]> }>(`/api/shipment-orders/insights/options?from=${from}&to=${to}`)
      .then((r) => setOpts(r.options || {})).catch(() => {});
  }, [from, to]);
  useEffect(() => { api.get<any>('/api/vendors-mgmt/filter-options').then(setCarrier).catch(() => {}); }, []);

  const none = ar ? '— غير محدّد —' : '— not set —';
  const label = (k: string, v: string) => {
    if (v === '__blank__' || v === '__none') return none;
    if (k === 'payment') return (PAYMENT_SUBTYPES as any)[v]?.[ar ? 'ar' : 'en'] || v;
    if (k === 'kind') return kindLabel(v, ar);
    return v;
  };
  const optionsOf = (k: string) => {
    if (k === 'kind') return ['master', 'outside', 'freelancer', 'fleet'].map((v) => ({ value: v, label: label(k, v) }));
    if (k === 'owner') return carrier.owners.map((o) => ({ value: o.value, label: label(k, o.value), count: o.count }));
    if (k === 'contract') return carrier.contracts.map((o) => ({ value: o.value, label: label(k, o.value), count: o.count }));
    return (opts[k] || []).map((o) => ({ value: String(o.value), label: label(k, String(o.value)), count: o.count }));
  };
  const set = (k: string, v: string[]) => { const n = { ...value }; if (v.length) n[k] = v; else delete n[k]; onChange(n); };
  const active = Object.values(value).reduce((s, v) => s + v.length, 0);

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {DIMS.map(([k, a, e]) => (
          <MultiSearchSelect key={k} label={ar ? a : e} ar={ar} value={value[k] || []} onChange={(v) => set(k, v)} options={optionsOf(k)} searchable={k !== 'kind'} />
        ))}
      </div>
      {active > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(value).flatMap(([k, vals]) => vals.map((v) => (
            <span key={`${k}:${v}`} className="inline-flex items-center gap-1 rounded-full bg-[#f37121]/10 text-[#b9541a] border border-[#f37121]/30 px-2.5 py-1 text-[12px] font-semibold">
              <span className="text-slate-500 font-normal">{(DIMS.find((d) => d[0] === k) || [])[ar ? 1 : 2]}:</span>{label(k, v)}
              <button type="button" onClick={() => set(k, vals.filter((x) => x !== v))} className="hover:text-red-600"><X className="w-3 h-3" /></button>
            </span>
          )))}
          <button type="button" onClick={() => onChange({})} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[12px] font-semibold hover:bg-slate-200">
            <RotateCcw className="w-3 h-3" />{ar ? 'مسح الفلاتر' : 'Clear filters'}
          </button>
        </div>
      )}
    </div>
  );
}
