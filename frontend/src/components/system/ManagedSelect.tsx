'use client';
// A drop-in <select> for any editable reference list (lookup type). It fetches its own options from /api/lookups?type=... and renders an inline "+ Add" affordance underneath so users can create a new option without leaving the form; the new item is saved to its lookup collection and selected immediately.
// Usage:
// <ManagedSelect type="procurement_category" value={form.category}
// onChange={(v) => set('category', v)} placeholder={ar ? 'Category' : 'Category'} />
import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, X, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { SearchableSelect } from '@/components/hr/HRKit';

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

// One request per lookup type, not per input.
// An invoice table draws the input in every row, so 100 rows meant 100 identical requests that queued up and the last one arrived after 3.4 s. Inputs drawn together share one promise; the answer is kept only a few seconds so a settings-screen add is not delayed, and an add from here clears it.
const LOOKUP_TTL = 10000;
const lookupCache = new Map<string, { at: number; p: Promise<LookupItem[]> }>();
const loadItems = (type: string): Promise<LookupItem[]> => {
  const hit = lookupCache.get(type);
  if (hit && Date.now() - hit.at < LOOKUP_TTL) return hit.p;
  const p = api
    .get<{ items: LookupItem[] }>(`/api/lookups?type=${encodeURIComponent(type)}&active=true`)
    .then((d) => d.items || []);
  lookupCache.set(type, { at: Date.now(), p });
  // A failure is not cached, or every input drawn afterwards would inherit it.
  p.catch(() => { if (lookupCache.get(type)?.p === p) lookupCache.delete(type); });
  return p;
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
  storeLabel,
  strict,
  noAdd,
  className,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Hides "add new item" inside the input.
   * Closed lists (e.g. our branches) are managed from the settings page, not from a table row; a one-click add next to a quickly typed field turned a stray character into a new branch.
   */
  noAdd?: boolean;
  /**
   * Stores the Arabic name instead of the key.
   * Many fields (vehicle sector, color, insurance cover type) have held the Arabic text since the first import and filters, exports and reports read it directly, so converting to keys would break all of them. The goal is to restrict what can be written, not change what is stored: still Arabic text, but only from the list, so one make does not become three spellings.
   */
  storeLabel?: boolean;
  /** Disables free typing where logic is built on the value and cannot accept new text. */
  strict?: boolean;
  /**
   * Input size when it differs from the default.
   * The default is the form size and looks oversized inside a table row, making cell heights uneven; the table passes its own size instead of forking the component.
   */
  className?: string;
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

  const load = useCallback(async (fresh = false) => {
    try {
      if (fresh) lookupCache.delete(type);
      setItems(await loadItems(type));
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
      await load(true);
      onChange(storeLabel ? item.nameAr : item.key); // select the freshly created option
      setAdding(false);
      setNameEn('');
      setNameAr('');
    } catch (e: any) {
      setError(e.message || (ar ? 'فشل الحفظ' : 'Failed to save'));
    }
    setSaving(false);
  };

  const optionValue = (i: LookupItem) => (storeLabel ? i.nameAr : i.key);
  // A saved value no longer in the list (disabled or entered before unification) stays shown as an orphan option. Removing it makes the field look empty and the next edit of another field would save the blank over a valid value.
  const hasValue = value && items.some((i) => optionValue(i) === value);

  /**
   * The list is searchable.
   * Some lists are long (28 departments, projects grow) and a native <select> has no search. More than 8 options open with a search box; fewer stay a plain list since search there only slows things down.
   */
  return (
    <div>
      <SearchableSelect
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder || (ar ? 'اختر…' : 'Select…')}
        searchPlaceholder={ar ? 'ابحث…' : 'Search…'}
        options={[
          // A saved value that left the list stays as an orphan option; dropping it makes the field look empty when it is not.
          ...(value && !hasValue ? [{ value, label: value }] : []),
          // One option per value: two lookup rows with the same label must not show twice.
          ...items.filter((i, k) => items.findIndex((x) => optionValue(x) === optionValue(i)) === k)
            .map((i) => ({ value: optionValue(i), label: (ar ? i.nameAr : i.nameEn) || optionValue(i) })),
        ]}
        // "Other" can be typed rather than blocked.
        // The list restricts what is typed but must not stop data entry for a new department or status not yet registered; it is typed and shows up for the list manager to add. Disabled by `strict` where logic depends on the value.
        allowCustom={!strict}
        customHint={(typed) => (ar ? `استعمل «${typed}» (أخرى)` : `Use “${typed}” (other)`)}
      />

      {canManage && !disabled && !noAdd && (
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
