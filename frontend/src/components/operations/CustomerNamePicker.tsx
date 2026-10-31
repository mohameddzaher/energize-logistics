'use client';
/**
 * «العميل» in the operations workflow: picked from the approved names and the customers page,
 * never typed (the server refuses anything else — CUSTOMER_NOT_APPROVED).
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { SearchableSelect, type SearchOption } from '@/components/hr/HRKit';

export default function CustomerNamePicker({ value, onChange, ar, disabled }: {
  value: string; onChange: (v: string) => void; ar: boolean; disabled?: boolean;
}) {
  const [options, setOptions] = useState<SearchOption[]>([]);
  // Read fresh, and again on any customer change, so a new customer shows at once.
  const load = useCallback(() => {
    api.get<{ names: string[] }>('/api/workflows/customer-names')
      .then((d) => setOptions((d.names || []).map((n) => ({ value: n, label: n })))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:customers', load);
  return (
    <SearchableSelect value={value || ''} onChange={onChange} options={options} searchAfter={0} disabled={disabled}
      placeholder={ar ? 'اختر العميل' : 'Pick the customer'}
      searchPlaceholder={ar ? 'ابحث باسم العميل…' : 'Search customer…'}
      emptyLabel={ar ? 'لا يوجد عميل بهذا الاسم' : 'No customer by that name'} />
  );
}
