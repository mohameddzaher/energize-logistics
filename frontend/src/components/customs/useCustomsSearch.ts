'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';

/**
 * Search by everything in a transaction, across all clearance screens.
 * Screens filter in the browser the rows they hold, and those rows are trimmed: no per-container statement, return receipt, payment requests or all notes. Searching by such a number used to report no results although the transaction existed. So the server is asked for matching ids (`?ids=1&search=`) from one index of all transaction text (see SEARCH_INDEX_FIELDS on the server), while rows, filters and counters stay on the screen. Until the reply arrives, local search runs on the row so the first results appear without waiting.
 */

/** Same fold as the server (utils/arabicSearch, searchKey). */
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

/** Whether the text matches one of the values: the whole folded text, or every word of it within some value. */
export function matchesSearch(text: string, values: unknown[]): boolean {
  const whole = searchKey(text);
  if (!whole) return true;
  const keys = values.filter((v) => v != null && v !== '').map(searchKey);
  if (keys.some((k) => k.includes(whole))) return true;
  const words = text.trim().split(/\s+/).map(searchKey).filter(Boolean);
  return words.length > 1 && words.every((w) => keys.some((k) => k.includes(w)));
}

export type CustomsHits = { ids: Set<string>; parties: Set<string> };

/** Transactions (and their parties) matching the search text, from the server. `null` while the text is empty or the reply has not arrived, in which case the screen uses local search only. `refreshKey` changes when rows are re-read, so the query repeats with them. */
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
      } catch { /* Local search stays. */ }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, refreshKey, begin, isCurrent]);
  // A reply for earlier text is not applied to later input.
  return hits && hits.q === q ? hits : null;
}
