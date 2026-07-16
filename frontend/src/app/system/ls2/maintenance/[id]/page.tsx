'use client';
// There is exactly ONE vehicle profile — /system/ls2/[id] — and it carries the
// whole record: telemetry, the service plan, every periodic service with its
// checklist, the deferred tasks and the exceptional repairs. This route used to be
// a second, thinner maintenance view; it now just forwards, so older links (and
// anything still pointing here) land on the full profile.
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Spinner } from '@/components/hr/HRKit';

export default function MaintenanceRedirect() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  useEffect(() => { if (id) router.replace(`/system/ls2/${id}`); }, [id, router]);
  return <Spinner />;
}
