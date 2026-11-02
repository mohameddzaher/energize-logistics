'use client';
/**
 * A Media Go complaint as a full page, /system/b2c/mediago-complaints/[id].
 * What a Media Go account opens when it clicks a complaint (no dialog): a large gallery, info blocks, with status, conversation and path beside them, stacked on phones. Our staff reach it through the open-as-page action. Its endpoints are the list's own; the page is a child of it in the page map (genPageApis) and in the restricted-account fence.
 */
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { ComplaintDetail, type Mode } from '@/components/b2c/MediaGoKit';
import { MEDIAGO_ROLE } from '@/lib/mediago';

export default function MediaGoComplaintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLanguage();
  const { user } = useAuth();
  const id = String(params?.id || '');
  const mode: Mode = String(user?.role || '') === MEDIAGO_ROLE ? 'partner' : (lang === 'ar' ? 'ar' : 'en');
  const back = useCallback(() => router.push('/system/b2c/mediago-complaints'), [router]);
  if (!/^[0-9a-f]{24}$/i.test(id)) return <div className="p-8 text-slate-500">—</div>;
  return <ComplaintDetail id={id} mode={mode} variant="page" onClose={back} />;
}
