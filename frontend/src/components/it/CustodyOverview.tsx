'use client';
// كروت العهد وأزرار الحالة الثلاثة والفلاتر — قطعة واحدة تستعملها صفحة العهد
// ولوحة القسم معاً.
//
// السبب في استخراجها: اللوحة وصفحة العهد تعرضان نفس الإجماليات، ونسختان من
// نفس العدّ تفترقان عند أول تعديل — فيقرأ المستخدم رقمين لشيء واحد ولا يعود
// يثق في أيّهما. الحساب في الخادم، والعرض هنا، والشاشتان تقرآن من الاثنين.
import { CUSTODY_BUCKETS, CUSTODY_STATUSES, CUSTODY_STATE_KEYS, custodyStatusLabel, Lang } from '@/lib/it';
import { Laptop, Keyboard, Smartphone, Monitor, Package, UserCheck, Boxes, AlertOctagon } from 'lucide-react';

export interface BucketCount { key: string; count: number }

const BUCKET_ICON: Record<string, React.ElementType> = {
  laptops: Laptop,
  peripherals: Keyboard,
  phones: Smartphone,
  monitors: Monitor,
  other: Package,
};

const STATE_ICON: Record<string, React.ElementType> = {
  assigned: UserCheck,
  in_stock: Boxes,
  returned: AlertOctagon,
};

// لون لكل زر حالة. الحالة المختارة تُملأ، وغير المختارة تبقى هادئة — الفرق
// البصري هو ما يقول للمستخدم إن الجدول تحته مفلتر أصلاً.
const STATE_TONE: Record<string, { on: string; dot: string }> = {
  assigned: { on: 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-300', dot: 'text-amber-600' },
  in_stock: { on: 'border-blue-400 bg-blue-50 text-blue-800 ring-1 ring-blue-300', dot: 'text-blue-600' },
  returned: { on: 'border-red-400 bg-red-50 text-red-800 ring-1 ring-red-300', dot: 'text-red-600' },
};

export function CustodyCards({
  buckets, active, onPick, lang,
}: {
  buckets: BucketCount[];
  active: string;
  onPick: (key: string) => void;
  lang: Lang;
}) {
  const ar = lang === 'ar';
  const countOf = (k: string) => buckets.find((b) => b.key === k)?.count ?? 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CUSTODY_BUCKETS.map((b) => {
        const Icon = BUCKET_ICON[b.key] || Package;
        const on = active === b.key;
        return (
          <button
            key={b.key}
            type="button"
            // الضغط على كارت مُفعَّل يلغيه: بلا ذلك يعلق المستخدم في فلتر لا
            // يجد له زر إغلاق.
            onClick={() => onPick(on ? '' : b.key)}
            className={`group text-start rounded-xl border p-4 transition-all ${
              on
                ? 'border-[#f37121] bg-[#f37121]/[0.07] ring-1 ring-[#f37121]/40 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className={`text-xs font-medium truncate ${on ? 'text-[#f37121]' : 'text-slate-500'}`}>
                {ar ? b.ar : b.en}
              </span>
              <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-[#f37121]' : 'text-slate-300 group-hover:text-slate-400'}`} />
            </div>
            <div className={`text-2xl font-bold tabular-nums ${on ? 'text-[#f37121]' : 'text-slate-900'}`}>
              {countOf(b.key)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function CustodyStateButtons({
  byStatus, active, onPick, lang,
}: {
  byStatus: { assigned: number; in_stock: number; returned: number };
  active: string;
  onPick: (key: string) => void;
  lang: Lang;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CUSTODY_STATE_KEYS.map((k) => {
        const Icon = STATE_ICON[k];
        const on = active === k;
        const tone = STATE_TONE[k];
        return (
          <button
            key={k}
            type="button"
            onClick={() => onPick(on ? '' : k)}
            className={`flex items-center justify-between gap-3 rounded-xl border px-5 py-4 transition-all ${
              on ? tone.on : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Icon className={`w-5 h-5 shrink-0 ${on ? '' : tone.dot}`} />
              <span className="text-sm font-semibold truncate">{custodyStatusLabel(k, lang)}</span>
            </span>
            <span className="text-xl font-bold tabular-nums shrink-0">
              {byStatus?.[k] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { CUSTODY_STATUSES };
