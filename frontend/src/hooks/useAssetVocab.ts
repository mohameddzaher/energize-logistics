'use client';
// The custody / store vocabulary (item types and conditions) shared by the
// Software & IT and HR sections.
//
// It is editable from Settings → Reference Data, so it is fetched from the
// `asset_type` / `asset_condition` lookups rather than hardcoded. The maps in
// lib/it.ts and lib/hr.ts stay as the fallback: they render the correct labels
// on first paint and if the request fails, so no page ever shows a raw key.
import { useEffect, useState, useMemo } from 'react';
import api from '@/lib/api';
import { CUSTODY_TYPES, CONDITIONS, IT_CUSTODY_EXCLUDED_TYPE_KEYS, Lang } from '@/lib/it';

export interface VocabOption { key: string; en: string; ar: string }

interface LookupRow { key: string; nameEn: string; nameAr: string; isActive?: boolean }

// One in-flight request per type across all mounted pages — the two custody
// pages and the two store pages would otherwise each fetch the same two lists.
const cache = new Map<string, Promise<LookupRow[]>>();
const fetchType = (type: string) => {
  if (!cache.has(type)) {
    cache.set(
      type,
      api.get<{ items: LookupRow[] }>(`/api/lookups?type=${type}&active=true`)
        .then((d) => d.items || [])
        .catch(() => []),
    );
  }
  return cache.get(type)!;
};

const fromMap = (map: Record<string, { en: string; ar: string }>): VocabOption[] =>
  Object.entries(map).map(([key, v]) => ({ key, en: v.en, ar: v.ar }));

export function useAssetVocab() {
  const [types, setTypes] = useState<VocabOption[]>(() => fromMap(CUSTODY_TYPES));
  const [conditions, setConditions] = useState<VocabOption[]>(() => fromMap(CONDITIONS));

  useEffect(() => {
    let alive = true;
    fetchType('asset_type').then((rows) => {
      if (alive && rows.length) setTypes(rows.map((r) => ({ key: r.key, en: r.nameEn, ar: r.nameAr })));
    });
    fetchType('asset_condition').then((rows) => {
      if (alive && rows.length) setConditions(rows.map((r) => ({ key: r.key, en: r.nameEn, ar: r.nameAr })));
    });
    return () => { alive = false; };
  }, []);

  return useMemo(() => {
    const label = (list: VocabOption[], key: string, lang: Lang) => {
      const hit = list.find((o) => o.key === key);
      // An unknown key means the row predates a rename — show the key rather
      // than an empty cell so it is obvious something needs fixing.
      if (!hit) return key || '—';
      return lang === 'ar' ? hit.ar : hit.en;
    };
    return {
      types,
      conditions,
      // Vehicles and generic tools belong to other sections; IT never offers them.
      itTypes: types.filter((t) => !IT_CUSTODY_EXCLUDED_TYPE_KEYS.includes(t.key)),
      typeLabel: (key: string, lang: Lang) => label(types, key, lang),
      conditionLabel: (key: string, lang: Lang) => label(conditions, key, lang),
    };
  }, [types, conditions]);
}
