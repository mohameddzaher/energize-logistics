'use client';
// الإشعارُ يحمل «مهمّة» ولا يعرف قسمَ صاحبها — فيفتح هذه، وهي تسأل الخادمَ عن
// خطّة هذا المستخدم وتذهب إليها.
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
