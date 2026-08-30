'use client';
/**
 * المسارُ القديم يبقى حيًّا ويحوّل.
 *
 * «تحليل الحمولات» و«لوحة التحليلات» كانتا بابين لبيتٍ واحد — يقف المستخدمُ
 * أمام اسمين متشابهين لا يدري أيَّهما يفتح، ويقفز بينهما ليقارن رقمًا برقم.
 * صارتا تبويبَين في صفحةٍ واحدة، وهذا المسارُ يحوّل إليها كي لا تنكسر روابطُ
 * محفوظةٌ أو مُرسَلة.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/hr/HRKit';

export default function FleetLoadsAnalysisPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/system/fleet/dashboard?tab=loads'); }, [router]);
  return <Spinner />;
}
