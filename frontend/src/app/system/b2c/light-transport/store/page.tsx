'use client';
/**
 * مخزن النقل الخفيف — قطعُ غيار الدرّاجات ومستلزماتُ المناديب.
 *
 * ── ولماذا الشاشةُ نفسُها ───────────────────────────────────────────────────
 * سؤالُ المخزن واحدٌ في القسمين: ماذا عندنا، وكم بقي، ومن صرف ماذا على أيّ
 * مركبة، وما الذي قارب النفاد. فآليّتُه مكتوبةٌ مرّةً (`StoreScreen`) ويُمرَّر
 * لها نطاقُ القسم — وأصنافُ المخزنين وأرصدتُهما منفصلةٌ في القاعدة
 * (`warehouse`)، فلا يُقرأ رصيدُ أحدهما في الآخر ولا يُجمعان في رقم.
 */
import { useAuth } from '@/context/AuthContext';
import StoreScreen from '@/components/store/StoreScreen';
import { canSeeLT, canEditLT } from '@/lib/lightTransport';

export default function LightTransportStorePage() {
  useAuth();
  return (
    <StoreScreen scope={{
      base: '/api/light-transport/store',
      titleAr: 'مخزن النقل الخفيف', titleEn: 'Light Transport Store',
      subtitleAr: 'قطع الغيار والمستلزمات — الرصيد والحركات', subtitleEn: 'Parts & supplies — stock & movements',
      // المركباتُ التي يُصرَف عليها هي مركباتُ القسم: الدرّاجاتُ ومركباتُ
      // المناديب، لا شاحنات لوكيشن سوليوشن.
      plateSource: { url: '/api/light-transport/employees?limit=500', key: 'employees', of: (e) => e.vehiclePlate },
      canSee: canSeeLT, canEdit: canEditLT,
      fileName: 'light-transport-store',
    }} />
  );
}
