'use client';
/**
 * /system — لا شاشةَ هنا، بل توجيهٌ إلى أوّل صفحةٍ لصاحب الحساب: صفحةُ الدخول
 * المضبوطةُ لدوره، وإلّا صفحةُ قسمه (راجع lib/roleRoutes). وكانت «لوحة التحكم»
 * هي هذا الاحتياط، فلمّا حُذفت صار لكلّ دورٍ مدخلُه.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { landingFor } from '@/lib/roleRoutes';
import { Spinner } from '@/components/hr/HRKit';

export default function SystemIndex() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && user) router.replace(landingFor(user));
  }, [loading, user, router]);
  return <Spinner />;
}
