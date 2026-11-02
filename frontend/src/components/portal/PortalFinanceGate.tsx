'use client';
// Customer portal gate for the invoices and payments pages.
// The portal shows no prices to the customer: the server exposes the `finance` service only to those entitled to it. Opening the invoices or payments link directly without it shows 'unavailable', and the page is not mounted at all, so no amount is requested.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { Lock } from 'lucide-react';

export default function PortalFinanceGate({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  // null = still asking; a failed answer counts as «not offered» — money is
  // never shown on a guess.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<{ services?: { key: string }[] }>('/api/portal/me')
      .then((m) => { if (alive) setAllowed((m.services || []).some((s) => s.key === 'finance' || s.key === 'invoices')); })
      .catch(() => { if (alive) setAllowed(false); });
    return () => { alive = false; };
  }, []);

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 shadow-sm text-center max-w-md mx-auto mt-10">
        <Lock className="w-8 h-8 text-slate-300 mx-auto" />
        <p className="text-slate-900 font-semibold mt-3">{ar ? 'غير متاح' : 'Not available'}</p>
        <p className="text-slate-500 text-sm mt-1">
          {ar ? 'هذه الصفحة غير متاحة لحسابك.' : 'This page is not available for your account.'}
        </p>
        <Link href="/system/portal" className="inline-block mt-4 text-[#f37121] text-sm hover:underline">
          {ar ? 'العودة للوحة' : 'Back to dashboard'}
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
