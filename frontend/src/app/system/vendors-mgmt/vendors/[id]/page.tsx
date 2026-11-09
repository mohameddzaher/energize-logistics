'use client';
import { useParams } from 'next/navigation';
import VendorCard from '@/components/vendors/VendorCard';

export default function VendorCardPage() {
  const params = useParams();
  return <VendorCard id={String(params?.id || '')} />;
}
