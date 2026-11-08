'use client';
// The department board was merged into the meetings page; old links (with ?dept=) land there.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BoardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/system/business-review/daily${window.location.search}`);
  }, [router]);
  return null;
}
