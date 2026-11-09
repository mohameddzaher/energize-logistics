'use client';
// The dashboard was merged into the analytics page; old links land there with their query.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ShipmentDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/system/shipment-orders/analytics${window.location.search}`);
  }, [router]);
  return null;
}
