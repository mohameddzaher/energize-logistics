'use client';
/**
 * Per-user exception for one section on top of the role (User.accessSections / accessPages):
 * whether this person works on the section at all, and if so which of its pages open. Silence follows the role.
 * Used on the users page for operations staff and the vendors section.
 */
import { useEffect, useState } from 'react';
import api from '@/lib/api';

type Page = { key: string; section: string; ar?: string; en?: string };
let catalogCache: Promise<Page[]> | null = null;
const loadCatalog = () => {
  if (!catalogCache) catalogCache = api.get<{ catalog: Page[] }>('/api/admin/permissions').then((d) => d.catalog || []).catch(() => []);
  return catalogCache;
};

export default function UserSectionAccess({ ar, section, title, hint, sections, pages, onChange }: {
  ar: boolean; section: string; title: string; hint?: string;
  sections: Record<string, string>; pages: Record<string, boolean>;
  onChange: (next: { sections: Record<string, string>; pages: Record<string, boolean> }) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [catalog, setCatalog] = useState<Page[]>([]);
  useEffect(() => { loadCatalog().then((c) => setCatalog(c.filter((p) => p.section === section))); }, [section]);
  const on = sections[section] !== 'none';
  const setOn = (v: boolean) => {
    const s = { ...sections };
    if (v) delete s[section]; else s[section] = 'none';
    const p = { ...pages };
    // Closing the section clears its page choices; reopening starts from all its pages.
    for (const c of catalog) delete p[c.key];
    onChange({ sections: s, pages: p });
  };
  const setPage = (key: string, v: boolean) => {
    const p = { ...pages };
    if (v) delete p[key]; else p[key] = false;
    onChange({ sections, pages: p });
  };
  const labelOf = (p: Page) => (ar ? p.ar : p.en) || p.key;
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {hint && <p className="text-[12px] text-slate-500">{hint}</p>}
        </div>
        <button type="button" role="switch" aria-checked={on} onClick={() => setOn(!on)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-[#f37121]' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'start-[1.375rem]' : 'start-0.5'}`} />
        </button>
      </div>
      {on && catalog.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2">
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">{t('الصفحات التي تظهر له', 'Pages shown to this user')}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {catalog.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <input type="checkbox" checked={pages[p.key] !== false} onChange={(e) => setPage(p.key, e.target.checked)}
                  className="rounded border-slate-300 text-[#f37121] focus:ring-[#f37121]/50" />
                <span className="text-[13px] text-slate-700">{labelOf(p)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
