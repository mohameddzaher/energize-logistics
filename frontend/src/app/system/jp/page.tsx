'use client';
// The notification carries a task but not its owner's department, so this page asks the server for the user's plan and redirects to it.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Spinner } from '@/components/hr/HRKit';

export default function Page() {
  const router = useRouter();
  useEffect(() => {
    api.get<{ path: string | null }>('/api/jp/home')
      .then((r) => router.replace(r.path || '/system'))
      .catch(() => router.replace('/system'));
  }, [router]);
  return <Spinner />;
}
