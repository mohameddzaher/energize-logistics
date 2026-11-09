'use client';
// A carrier seen only by name in shipments; registering it from the card moves to its id page.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/hr/HRKit';
import VendorCard from '@/components/vendors/VendorCard';

function Inner() {
  const sp = useSearchParams();
  return <VendorCard name={sp?.get('n') || ''} />;
}
export default function VendorByNamePage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
