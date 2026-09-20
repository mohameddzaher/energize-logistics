'use client';
/**
 * عقودُ التخليص — عقودُنا مع العملاء ووكلاءِ الشحن والناقلين في مكانٍ واحد.
 * والعقدُ نفسُه يظهر في ملفّ صاحبه (راجع صفحة الطرف) — مصدرٌ واحدٌ لا نسختان.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { PageHeader } from '@/components/hr/HRKit';
import { FileSignature } from 'lucide-react';
import CustomsContracts from '@/components/customs/CustomsContracts';

export default function Page() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer']
    .includes((user as any)?.role || '') || canEditSection((user as any)?.permissions, 'Customs');

  // أطرافُ القسم كلُّها في قائمةٍ واحدةٍ لاختيار صاحب العقد.
  const [parties, setParties] = useState<{ _id: string; name: string; kind: string }[]>([]);
  useEffect(() => {
    Promise.all(['customer', 'agent', 'carrier'].map((k) =>
      api.get<{ parties: any[] }>(`/api/customs-clearance/parties?kind=${k}`).then((d) => d.parties || []).catch(() => [])))
      .then((lists) => setParties(lists.flat().map((p: any) => ({ _id: p._id, name: p.name, kind: p.kind }))));
  }, []);

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileSignature className="w-6 h-6 text-[#f37121]" />}
        title={t('عقود التخليص', 'Customs contracts')}
        subtitle={t('عقودُنا مع العملاء والوكلاء والناقلين — ويظهر كلُّ عقدٍ في ملفّ صاحبه',
          'Our contracts with customers, agents and carriers — each also shows on its party profile')} />
      <CustomsContracts ar={ar} canEdit={canEdit} parties={parties} notify={notify} />
    </div>
  );
}
