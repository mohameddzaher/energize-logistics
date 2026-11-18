'use client';
import { useParams, useSearchParams } from 'next/navigation';
import CustomerFullFile from '@/components/customers/CustomerFullFile';

export default function Page() {
  const p = useParams();
  const sp = useSearchParams();
  return <CustomerFullFile id={String((p as any)?.id || '')} reg={sp?.get('reg') || undefined} />;
}
