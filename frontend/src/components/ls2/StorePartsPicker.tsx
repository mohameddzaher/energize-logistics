'use client';
// Spare parts taken from the heavy-transport store for a maintenance record.
// Only items that exist in the store with a balance can be picked, and a line cannot exceed the remaining
// quantity; the server re-checks both when it posts the issue request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, Package, Plus } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

export type PartLine = { item: string; quantity: string };
export type StoreItem = { _id: string; name: string; code?: string; quantity: number; unit?: string; unitPrice?: number; category?: string; categoryAr?: string };

const norm = (s: string) => (s || '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ْـ]/g, '').toLowerCase();
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Lines that are complete and within balance; used by the forms to block saving. */
export function partsProblem(lines: PartLine[], items: Map<string, StoreItem>, ar: boolean): string | null {
  for (const l of lines) {
    const it = items.get(l.item);
    const q = Number(l.quantity);
    if (!it) return ar ? 'صنف غير موجود في المخزن' : 'Item not in store';
    if (!(q > 0)) return ar ? `اكتب كمية «${it.name}»` : `Enter the quantity of ${it.name}`;
    if (q > it.quantity) return ar ? `«${it.name}»: المتبقّي ${it.quantity} فقط` : `${it.name}: only ${it.quantity} left`;
  }
  return null;
}

export default function StorePartsPicker({
  value, onChange, ar, onItems,
}: {
  value: PartLine[];
  onChange: (lines: PartLine[]) => void;
  ar: boolean;
  onItems?: (items: Map<string, StoreItem>) => void;
}) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: StoreItem[] }>('/api/ls2/store');
      setItems(r.items || []);
    } catch { /* keep */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Balances move while the form is open (another issue, a receipt); the remaining figure follows.
  useSocket('ls2:store', load);

  const byId = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  useEffect(() => { onItems?.(byId); }, [byId, onItems]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const chosen = new Set(value.map((l) => l.item));
  const results = useMemo(() => {
    const t = norm(q.trim());
    return items
      .filter((i) => !chosen.has(i._id))
      .filter((i) => !t || [i.name, i.code, i.categoryAr, i.category].some((x) => norm(x || '').includes(t)))
      .sort((a, b) => (b.quantity > 0 ? 1 : 0) - (a.quantity > 0 ? 1 : 0) || a.name.localeCompare(b.name, 'ar'))
      .slice(0, 40);
  }, [items, q, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (it: StoreItem) => {
    if (!(it.quantity > 0)) return;
    onChange([...value, { item: it._id, quantity: '1' }]);
    setQ(''); setOpen(false);
  };
  const setQty = (i: number, quantity: string) => onChange(value.map((l, k) => (k === i ? { ...l, quantity } : l)));
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));

  const total = value.reduce((a, l) => a + (Number(l.quantity) || 0) * (byId.get(l.item)?.unitPrice || 0), 0);

  return (
    <div className="space-y-2">
      <div ref={wrap} className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={ar ? 'ابحث عن صنف في مخزن النقل الثقيل…' : 'Search the heavy-transport store…'}
          className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#f37121]"
        />
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
            {results.length === 0 && <p className="text-xs text-slate-400 px-3 py-3">{ar ? 'لا يوجد صنف مطابق في المخزن' : 'No matching item in the store'}</p>}
            {results.map((it) => {
              const empty = !(it.quantity > 0);
              return (
                <button key={it._id} type="button" disabled={empty} onClick={() => add(it)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-start text-sm border-b border-slate-50 ${empty ? 'opacity-50 cursor-not-allowed' : 'hover:bg-orange-50'}`}>
                  <Package className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-slate-800">{it.name}</span>
                    <span className="block text-[11px] text-slate-400">{[it.code, it.categoryAr].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`text-[11px] font-semibold tabular-nums ${empty ? 'text-red-600' : 'text-emerald-700'}`}>
                    {empty ? (ar ? 'نفد' : 'Out') : `${it.quantity} ${it.unit || ''}`}
                  </span>
                  {!empty && <Plus className="w-3.5 h-3.5 text-[#f37121]" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {value.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 text-slate-500">
              <th className="text-start font-semibold px-2 py-1.5">{ar ? 'الصنف' : 'Item'}</th>
              <th className="text-center font-semibold px-2 py-1.5">{ar ? 'المتبقّي' : 'Left'}</th>
              <th className="text-center font-semibold px-2 py-1.5">{ar ? 'الكمية' : 'Qty'}</th>
              <th className="text-end font-semibold px-2 py-1.5">{ar ? 'القيمة' : 'Value'}</th>
              <th className="w-8" />
            </tr></thead>
            <tbody>
              {value.map((l, i) => {
                const it = byId.get(l.item);
                const qn = Number(l.quantity);
                const over = it ? qn > it.quantity : true;
                return (
                  <tr key={l.item} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 text-slate-800">{it?.name || (ar ? 'صنف غير موجود' : 'Missing item')}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{it ? `${it.quantity} ${it.unit || ''}` : '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="number" min={0} step="any" max={it?.quantity} value={l.quantity} onChange={(e) => setQty(i, e.target.value)}
                        className={`w-20 px-2 py-1 rounded border text-center tabular-nums ${over || !(qn > 0) ? 'border-red-400 bg-red-50' : 'border-slate-200'}`} />
                    </td>
                    <td className="px-2 py-1.5 text-end tabular-nums text-slate-700">{it ? money((qn || 0) * (it.unitPrice || 0)) : '—'}</td>
                    <td className="px-1"><button type="button" onClick={() => remove(i)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t border-slate-200 bg-slate-50">
              <td colSpan={3} className="px-2 py-1.5 font-semibold text-slate-700">{ar ? 'قيمة قطع الغيار' : 'Parts value'}</td>
              <td className="px-2 py-1.5 text-end font-bold tabular-nums text-slate-900">{money(total)}</td>
              <td />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
