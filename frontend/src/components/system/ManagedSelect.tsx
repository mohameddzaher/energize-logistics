'use client';
// A drop-in <select> for any editable reference list (lookup type). It fetches its
// own options from /api/lookups?type=... and renders an inline "+ Add" affordance
// underneath so users can create a new option without leaving the form — the new
// item is saved to its lookup collection and selected immediately.
//
// Usage:
//   <ManagedSelect type="procurement_category" value={form.category}
//     onChange={(v) => set('category', v)} placeholder={ar ? 'الفئة' : 'Category'} />
import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, X, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';

export interface LookupItem {
  _id: string;
  type: string;
  key: string;
  nameEn: string;
  nameAr: string;
  color?: string;
  isActive: boolean;
}

// Cache the per-role type metadata (which types the user may manage) once.
let typesCache: Promise<Record<string, boolean>> | null = null;
const loadCanManage = (): Promise<Record<string, boolean>> => {
  if (!typesCache) {
    typesCache = api
      .get<{ types: { type: string; canManage: boolean }[] }>('/api/lookups/types')
      .then((d) => Object.fromEntries((d.types || []).map((t) => [t.type, t.canManage])))
      .catch(() => ({} as Record<string, boolean>));
  }
  return typesCache;
};

const inputCls =
  'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

export default function ManagedSelect({
  type,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const [items, setItems] = useState<LookupItem[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ items: LookupItem[] }>(`/api/lookups?type=${encodeURIComponent(type)}&active=true`);
      setItems(d.items || []);
    } catch {
      setItems([]);
    }
  }, [type]);

  useEffect(() => {
    load();
    loadCanManage().then((m) => setCanManage(!!m[type]));
  }, [load, type]);

  const save = async () => {
    if (!nameEn.trim() && !nameAr.trim()) return;
    setSaving(true);
    setError('');
    try {
      const en = nameEn.trim() || nameAr.trim();
      const { item } = await api.post<{ item: LookupItem }>('/api/lookups', { type, nameEn: en, nameAr: nameAr.trim() || en });
      await load();
      onChange(item.key); // select the freshly created option
      setAdding(false);
      setNameEn('');
      setNameAr('');
    } catch (e: any) {
      setError(e.message || (ar ? 'فشل الحفظ' : 'Failed to save'));
    }
    setSaving(false);
  };

  // If the saved value is inactive/missing, still show it so the field isn't blank.
  const hasValue = value && items.some((i) => i.key === value);

  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        className={inputCls}
      >
        <option value="">{placeholder || (ar ? 'اختر…' : 'Select…')}</option>
        {value && !hasValue && <option value={value}>{value}</option>}
        {items.map((i) => (
          <option key={i._id} value={i.key}>
            {ar ? i.nameAr : i.nameEn}
          </option>
        ))}
      </select>

      {canManage && !disabled && (
        <div className="mt-1.5">
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-xs text-[#f37121] hover:text-[#e06010]"
            >
              <Plus className="w-3.5 h-3.5" /> {ar ? 'إضافة عنصر جديد' : 'Add new'}
            </button>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  autoFocus
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder={ar ? 'الاسم بالعربي' : 'Name (Arabic)'}
                  className={inputCls}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
                <input
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  placeholder={ar ? 'الاسم بالإنجليزي' : 'Name (English)'}
                  className={inputCls}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
              </div>
              {error && <p className="text-red-600 text-xs">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || (!nameEn.trim() && !nameAr.trim())}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-medium hover:bg-[#e06010] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {ar ? 'حفظ' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setError('');
                    setNameEn('');
                    setNameAr('');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 text-xs"
                >
                  <X className="w-3.5 h-3.5" /> {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
