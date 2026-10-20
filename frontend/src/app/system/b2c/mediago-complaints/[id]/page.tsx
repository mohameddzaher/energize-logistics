'use client';
/**
 * بلاغُ Media Go صفحةً كاملة — /system/b2c/mediago-complaints/[id].
 *
 * هي ما يفتحه حسابُ Media Go حين يضغط بلاغًا (لا نافذة): معرضٌ كبير، وكتلُ
 * المعلومات، والحالةُ والمحادثةُ والمسار بجانبها، وتنزل تحت بعضها على الهاتف.
 * ويصلها موظّفونا أيضًا من «فتح كصفحة». نقاطُها نقاطُ القائمة نفسُها — والصفحةُ
 * فرعٌ منها في خريطة الصفحات (genPageApis)، وفي سياج الحساب المحصور.
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
