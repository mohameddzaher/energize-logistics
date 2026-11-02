'use client';
/** /system: no screen here, only a redirect to the account's first page: the login page configured for its role, otherwise its section page (see lib/roleRoutes). The control dashboard used to be this fallback; once it was removed each role got its own entry. */
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
