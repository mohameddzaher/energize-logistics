'use client';
// A <select> for picking a Vendor with an inline "+ Add" affordance underneath:
// type a name, it creates the vendor (POST /api/vendors) and selects it. Use this
// in procurement forms so users never get stuck with an empty vendor list.
import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, X, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';

interface VendorLite { _id: string; name: string }

const inputCls =
  'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

export default function VendorSelect({
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vendors: VendorLite[] }>('/api/vendors');
      setVendors(d.vendors || []);
    } catch {
      setVendors([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { vendor } = await api.post<{ vendor: VendorLite }>('/api/vendors', { name: name.trim() });
      await load();
      onChange(vendor._id);
      setAdding(false);
      setName('');
    } catch (e: any) {
      setError(e.message || (ar ? 'فشل الحفظ' : 'Failed to save'));
    }
    setSaving(false);
  };

  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} className={inputCls}>
        <option value="">{placeholder || (ar ? 'اختر المورّد…' : 'Select vendor…')}</option>
        {vendors.map((v) => (
          <option key={v._id} value={v._id}>{v.name}</option>
        ))}
      </select>

      {!disabled && (
        <div className="mt-1.5">
          {!adding ? (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs text-[#f37121] hover:text-[#e06010]">
              <Plus className="w-3.5 h-3.5" /> {ar ? 'إضافة مورّد جديد' : 'Add new vendor'}
            </button>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ar ? 'اسم المورّد' : 'Vendor name'}
                className={inputCls}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              {error && <p className="text-red-600 text-xs">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-medium hover:bg-[#e06010] disabled:opacity-50">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {ar ? 'حفظ' : 'Save'}
                </button>
                <button type="button" onClick={() => { setAdding(false); setError(''); setName(''); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 text-xs">
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
