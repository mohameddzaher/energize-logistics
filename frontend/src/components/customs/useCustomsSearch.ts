'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';

/**
 * ── البحثُ بكلّ ما في المعاملة، في كلّ شاشات التخليص ────────────────────────
 * الشاشاتُ تصفّي في المتصفّح ما عندها، وما عندها صفوفٌ مقلَّمة: لا بيانُ كلّ
 * حاوية، ولا إيصالُ إرجاعها، ولا طلباتُ الصرف، ولا الملاحظاتُ كلُّها. فكان
 * البحثُ برقمٍ من هذه يقول «لا نتائج» والمعاملةُ موجودة.
 *
 * فيُسأل الخادمُ عن المعرّفات المطابقة (`?ids=1&search=`) — من فهرسٍ واحدٍ
 * لكلّ نصٍّ في المعاملة (راجع SEARCH_INDEX_FIELDS في الخادم) — وتبقى الصفوفُ
 * وفلاترُها وعدّاداتُها في الشاشة كما هي. وإلى أن يصل الردّ يعمل البحثُ
 * المحلّيُّ على ما في الصفّ، فلا ينتظر الموظّفُ شيئًا ليرى أوّلَ النتائج.
 */

/** الطيُّ نفسُه في الخادم (utils/arabicSearch · searchKey). */
export const searchKey = (v: unknown): string => String(v ?? '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .toLowerCase()
  .replace(/[ً-ْٰـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/[ىئ]/g, 'ي')
  .replace(/ؤ/g, 'و')
  .replace(/[\s\-_./\\,:;#|'"()[\]{}–—]+/g, '');

/** هل يطابق النصُّ إحدى القيم — كاملًا مطويًّا، أو كلُّ كلمةٍ فيه في قيمةٍ ما. */
export function matchesSearch(text: string, values: unknown[]): boolean {
  const whole = searchKey(text);
  if (!whole) return true;
  const keys = values.filter((v) => v != null && v !== '').map(searchKey);
  if (keys.some((k) => k.includes(whole))) return true;
  const words = text.trim().split(/\s+/).map(searchKey).filter(Boolean);
  return words.length > 1 && words.every((w) => keys.some((k) => k.includes(w)));
}

export type CustomsHits = { ids: Set<string>; parties: Set<string> };

/**
 * المعاملاتُ (وأطرافُها) المطابقةُ لنصّ البحث من الخادم. `null` ما دام النصُّ
 * فارغًا أو الردُّ لم يصل — والشاشةُ حينها تكتفي بالبحث المحلّيّ.
 * `refreshKey`: ما يتغيّر حين تُعاد قراءةُ الصفوف، فيُعاد السؤالُ معها.
 */
export function useCustomsSearch(text: string, refreshKey?: unknown): CustomsHits | null {
  const [hits, setHits] = useState<(CustomsHits & { q: string }) | null>(null);
  const { begin, isCurrent } = useLatestRequest();
  const q = text.trim();
  useEffect(() => {
    if (!searchKey(q)) { begin(); setHits(null); return; }
    const timer = setTimeout(async () => {
      const token = begin();
      try {
        const r = await api.get<{ ids?: string[]; parties?: string[] }>(`/api/customs-clearance?ids=1&search=${encodeURIComponent(q)}`);
        if (isCurrent(token)) setHits({ q, ids: new Set(r.ids || []), parties: new Set(r.parties || []) });
      } catch { /* البحثُ المحلّيُّ يبقى */ }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, refreshKey, begin, isCurrent]);
  // ردٌّ لنصٍّ سابقٍ لا يُطبَّق على ما كُتب بعده.
  return hits && hits.q === q ? hits : null;
}
