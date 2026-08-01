'use client';
// مثل ManagedSelect لكن بقائمة منسدلة فيها بحث — لأي قائمة مرجعية قابلة للتعديل.
// يجلب خياراته من /api/lookups?type=…، يبحث فيها، ويسمح بإضافة عنصر جديد ثم
// يختاره فورًا. يخزّن مفتاح العنصر (key) مثل ManagedSelect تمامًا.
import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Check, ChevronDown, Search, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import type { LookupItem } from '@/components/system/ManagedSelect';

const foldAr = (s: string) => s.toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

let typesCache: Promise<Record<string, boolean>> | null = null;
const loadCanManage = (): Promise<Record<string, boolean>> => {
  if (!typesCache) {
    typesCache = api.get<{ types: { type: string; canManage: boolean }[] }>('/api/lookups/types')
      .then((d) => Object.fromEntries((d.types || []).map((t) => [t.type, t.canManage])))
      .catch(() => ({} as Record<string, boolean>));
  }
  return typesCache;
};

export default function SearchableManagedSelect({
  type, value, onChange, placeholder, disabled,
}: {
  type: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [items, setItems] = useState<LookupItem[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const d = await api.get<{ items: LookupItem[] }>(`/api/lookups?type=${encodeURIComponent(type)}&active=true`); setItems(d.items || []); }
    catch { setItems([]); }
  }, [type]);

  useEffect(() => { load(); loadCanManage().then((m) => setCanManage(!!m[type])); }, [load, type]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selected = items.find((i) => i.key === value);
  const label = selected ? (ar ? selected.nameAr : selected.nameEn) : (value || '');
  const fq = foldAr(q.trim());
  const filtered = items.filter((i) => !fq || foldAr(`${i.nameAr} ${i.nameEn} ${i.key}`).includes(fq));
  const exactExists = items.some((i) => foldAr(i.nameAr) === fq || foldAr(i.nameEn) === fq);

  const addNew = async () => {
    const name = q.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { item } = await api.post<{ item: LookupItem }>('/api/lookups', { type, nameEn: name, nameAr: name });
      await load();
      onChange(item.key);
      setQ(''); setOpen(false);
    } catch { /* keep */ }
    setSaving(false);
  };

  const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm text-start flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

  return (
    <div className="relative" ref={box}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={inputCls + (disabled ? ' opacity-60' : '')}>
        <span className={label ? 'text-slate-900' : 'text-slate-400'}>{label || placeholder || (ar ? 'اختر…' : 'Select…')}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث أو اكتب للإضافة…' : 'Search or type to add…'}
                className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="w-full text-start px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">{ar ? '— بدون —' : '— none —'}</button>
            )}
            {filtered.map((i) => (
              <button key={i._id} type="button" onClick={() => { onChange(i.key); setOpen(false); setQ(''); }}
                className={`w-full text-start px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${i.key === value ? 'bg-[#f37121]/5 text-[#f37121] font-semibold' : 'text-slate-700'}`}>
                {ar ? i.nameAr : i.nameEn}
                {i.key === value && <Check className="w-4 h-4" />}
              </button>
            ))}
            {filtered.length === 0 && !canManage && <p className="px-3 py-3 text-sm text-slate-400 text-center">{ar ? 'لا نتائج' : 'No matches'}</p>}
            {canManage && q.trim() && !exactExists && (
              <button type="button" onClick={addNew} disabled={saving} className="w-full text-start px-3 py-2 text-sm text-[#f37121] hover:bg-[#f37121]/5 flex items-center gap-1.5 border-t border-slate-100">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {ar ? `إضافة «${q.trim()}»` : `Add “${q.trim()}”`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
