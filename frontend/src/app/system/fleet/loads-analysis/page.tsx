'use client';
/**
 * The old route stays alive and redirects.
 * Loads analysis and the analytics dashboard were two doors to one house, with similar names and jumping between them to compare. They are now two tabs in one page, and this route redirects to it so saved or sent links do not break.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/hr/HRKit';

export default function FleetLoadsAnalysisPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/system/fleet/dashboard?tab=loads'); }, [router]);
  return <Spinner />;
}
