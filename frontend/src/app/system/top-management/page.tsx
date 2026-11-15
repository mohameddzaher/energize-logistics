'use client';
// Top management approves leaves from «موافقات الإجازات»; this address now opens its staff requests.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TopManagementIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/system/top-management/requests'); }, [router]);
  return null;
}
