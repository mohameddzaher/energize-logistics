'use client';
/**
 * «العميل» in the operations workflow: picked from the approved customer names only,
 * never typed (the server refuses anything else — CUSTOMER_NOT_APPROVED).
 */
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { SearchableSelect, type SearchOption } from '@/components/hr/HRKit';

let cached: Promise<SearchOption[]> | null = null;
const loadNames = () => {
  if (!cached) {
    cached = api.get<{ names: string[] }>('/api/workflows/customer-names')
      .then((d) => (d.names || []).map((n) => ({ value: n, label: n })))
      .catch(() => { cached = null; return []; });
  }
  return cached;
};

export default function CustomerNamePicker({ value, onChange, ar, disabled }: {
  value: string; onChange: (v: string) => void; ar: boolean; disabled?: boolean;
}) {
  const [options, setOptions] = useState<SearchOption[]>([]);
  useEffect(() => { let alive = true; loadNames().then((o) => { if (alive) setOptions(o); }); return () => { alive = false; }; }, []);
  return (
    <SearchableSelect value={value || ''} onChange={onChange} options={options} searchAfter={0} disabled={disabled}
      placeholder={ar ? 'اختر العميل' : 'Pick the customer'}
      searchPlaceholder={ar ? 'ابحث باسم العميل…' : 'Search customer…'}
      emptyLabel={ar ? 'لا يوجد عميل بهذا الاسم' : 'No customer by that name'} />
  );
}
