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
      /**
       * ── المركباتُ ومشاريعُها ──────────────────────────────────────────────
       * المركباتُ التي يُصرَف عليها هي مركباتُ القسم (الدرّاجاتُ ومركباتُ
       * المناديب، لا شاحنات لوكيشن سوليوشن). وكان المصدرُ لوحاتِ الموظّفين
       * وحدَها: فمركبةٌ لا راكبَ لها لا تظهر أصلًا، ولا يُعرَف مشروعُ ما ظهر.
       *
       * فصار من `orders/options`: سجلُّ مركبات القسم كاملًا (بنوعها وماركتها)
       * موصولًا براكبها الحاليّ — ومنه المشروعُ والفرعُ. والوصلُ بمفتاح اللوحة
       * لأنّ السجلّين يكتبانها بصيغتين.
       */
      plateSource: {
        url: '/api/light-transport/orders/options',
        rows: (d: any) => {
          const key = (v: any) => String(v ?? '').replace(/[^0-9A-Za-z\u0621-\u064A]/g, '').toUpperCase();
          const riderOf = new Map<string, any>();
          for (const e of (d.employees || [])) {
            const k = key(e.vehiclePlate);
            if (k && !riderOf.has(k)) riderOf.set(k, e);
          }
          const rows = (d.vehicles || []).map((v: any) => {
            const r = riderOf.get(key(v.plateNumber));
            return {
              plate: v.plateNumber,
              project: r?.projectAr || '',
              rider: r?.name || v.authorizedName || '',
              city: r?.cityAr || '',
              detail: [v.typeAr, v.brand].filter(Boolean).join(' '),
            };
          });
          // ولوحةٌ على موظّفٍ وليست في سجلّ المركبات تُضاف: الصرفُ عليها واقعٌ.
          const have = new Set(rows.map((r: any) => key(r.plate)));
          for (const [k, e] of riderOf) {
            if (!have.has(k) && e.vehiclePlate) {
              rows.push({ plate: e.vehiclePlate, project: e.projectAr || '', rider: e.name || '', city: e.cityAr || '', detail: '' });
            }
          }
          return rows.sort((a: any, b: any) => String(a.plate).localeCompare(String(b.plate)));
        },
      },
      canSee: canSeeLT, canEdit: canEditLT,
      fileName: 'light-transport-store',
    }} />
  );
}
