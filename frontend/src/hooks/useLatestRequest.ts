'use client';
import { useRef, useCallback } from 'react';

/**
 * حارسُ الطلب الأحدث — لا يكتب ردٌّ قديمٌ فوق ردٍّ أحدث.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * أيُّ جدولٍ يُفلتَر على الخادم ويُحدَّث لحظيًّا يُطلق أكثرَ من طلبٍ في اللحظة
 * نفسِها: البحثُ يغيّر النصَّ ويعيد الصفحةَ إلى الأولى، فينطلق طلبٌ بالبحث
 * الجديد ورقمِ الصفحة القديم — ويعود فارغًا. ويسابقُهما تحديثٌ من السوكِت.
 *
 * والشبكةُ لا تحفظ الترتيب: مَن يصل أخيرًا هو الذي يُعرض. فيبحث المستخدم عن
 * صفٍّ فلا يجده، ثمّ يخرج من الصفحة ويعود فيجده — لأنّ الخروجَ يعيد كلَّ شيءٍ
 * إلى بدايته فينطلق طلبٌ واحدٌ لا يسابقه أحد.
 *
 * ── الاستعمال ──────────────────────────────────────────────────────────────
 *   const guard = useLatestRequest();
 *   const load = useCallback(async () => {
 *     const mine = guard.begin();
 *     const d = await api.get(...);
 *     if (!guard.isCurrent(mine)) return;   // سبقَه أحدثُ منه
 *     setRows(d.rows);
 *   }, [...]);
 */
export function useLatestRequest() {
  const seq = useRef(0);
  const begin = useCallback(() => ++seq.current, []);
  const isCurrent = useCallback((token: number) => token === seq.current, []);
  return { begin, isCurrent };
}

export default useLatestRequest;
