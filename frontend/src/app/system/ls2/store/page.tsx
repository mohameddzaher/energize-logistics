'use client';
/**
 * مخزن النقل الثقيل — قطعُ الغيار.
 *
 * الشاشةُ نفسُها يستعملها مخزنُ النقل الخفيف بنطاقٍ آخر: آليّةُ المخزن واحدةٌ
 * (وارد وصادر، رصيدٌ بعد كلّ حركة، تراجعٌ بحركةٍ معاكسةٍ لا بمسح) والأصنافُ
 * والأرصدةُ مختلفة — راجع `components/store/StoreScreen`.
 */
import { useAuth } from '@/context/AuthContext';
import StoreScreen from '@/components/store/StoreScreen';
import { isLs2Staff, isLs2Admin } from '@/lib/ls2';

export default function Ls2StorePage() {
  useAuth();
  return (
    <StoreScreen scope={{
      base: '/api/ls2/store',
      titleAr: 'مخزن النقل الثقيل', titleEn: 'Heavy Transport Store',
      subtitleAr: 'قطع الغيار — الرصيد والحركات', subtitleEn: 'Spare parts — stock & movements',
      plateSource: { url: '/api/ls2/vehicles', key: 'items', of: (v) => v.plate },
      canSee: isLs2Staff, canEdit: isLs2Admin,
      fileName: 'ls2-store',
    }} />
  );
}
