'use client';
// Link from a section's customer page to the complete customer file; shown only to the roles allowed to open it (backend services/customerFile).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

let cached: Promise<boolean> | null = null;
const allowed = () => (cached ||= api.get<{ allowed: boolean }>('/api/customer-hub/file-access').then((d) => !!d.allowed).catch(() => false));

export default function FullFileLink({ id, reg }: { id: string; reg: 'crm' | 'shipment' | 'fleet' | 'customs' | 'collections' | 'contracts' }) {
  const { lang } = useLanguage();
  const [ok, setOk] = useState(false);
  useEffect(() => { allowed().then(setOk); }, []);
  if (!ok || !id) return null;
  return (
    <Link href={`/system/customers/${id}${reg === 'crm' ? '' : `?reg=${reg}`}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-bold text-white hover:bg-slate-800">
      <FolderOpen className="h-4 w-4" />{lang === 'ar' ? 'الملف الشامل' : 'Complete file'}
    </Link>
  );
}
