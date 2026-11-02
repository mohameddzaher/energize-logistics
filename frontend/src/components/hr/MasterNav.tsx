'use client';
// One navigation bar linking the employee-file pages, so the user can see where the work is instead of opening page after page.
// The number is expiries (expired, critical, near: `needsAttention`), not missing data. It matches the expiries page and dashboard cards. Groups without documents show no number. The counter reads from the same overview endpoint as the home page, so there is no second computation.
import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { getHrOverview } from '@/lib/hrMaster';
import { LayoutGrid, CalendarClock, Users } from 'lucide-react';

type Item = { href: string; ar: string; en: string; count?: number; icon?: React.ReactNode };

export default function MasterNav() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const pathname = usePathname() || '';
  const [groups, setGroups] = useState<{ key: string; ar: string; en: string; count?: number }[]>([]);
  const [expiring, setExpiring] = useState(0);
  // The link carries the condition the number was counted with: scope is everyone not archived (`expiryScope`) and the near threshold is `alert.warnDays`. Both come from the server so the opened page counts the same people and period.
  const [scope, setScope] = useState<Record<string, string>>({});
  const [warnDays, setWarnDays] = useState<number | null>(null);
  // Two quick edits fire two reads; the older may arrive last and revert the number. See hooks/useLatestRequest.
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const o = await getHrOverview({});
      if (!guard.isCurrent(mine)) return;
      setScope(o.expiryScope || {});
      setWarnDays(o.alert?.warnDays ?? null);
      setGroups((o.groups || []).map((g: any) => ({
        key: g.key, ar: g.ar, en: g.en,
        // Only documents have expiries; other groups have no number.
        count: g.needsAttention == null ? undefined : g.needsAttention,
      })));
      setExpiring(o.totals?.expiringSoon || 0);
    } catch { /* The bar must not stop the page. */ }
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:master', load);
  // A contract is created and terminated from the contracts page; both change the contract status and the number of employees whose documents are tracked.
  useSocket('hr:contract', load);

  const scopeQs = new URLSearchParams(scope).toString();

  const items: Item[] = [
    { href: '/system/hr/master', ar: 'النظرة الشاملة', en: 'Overview', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    // Number = expired + expiring within `warnDays`, so the page opens on the same period.
    { href: `/system/hr/master/expiring${warnDays != null ? `?withinDays=${warnDays}` : ''}`, ar: 'الانتهاءات', en: 'Expiries', count: expiring, icon: <CalendarClock className="w-3.5 h-3.5" /> },
    // The link carries the filter that produces the same number, so the opened table is not the whole table. See state=attention on the server.
    ...groups.map((g) => ({
      href: g.count ? `/system/hr/master/${g.key}?state=attention${scopeQs ? `&${scopeQs}` : ''}` : `/system/hr/master/${g.key}`,
      ar: g.ar, en: g.en, count: g.count,
    })),
    { href: '/system/hr/employees', ar: 'كل الموظفين', en: 'All employees', icon: <Users className="w-3.5 h-3.5" /> },
  ];

  return (
    <nav className="-mx-1 overflow-x-auto pb-1">
      <div className="flex items-center gap-1.5 px-1 min-w-max">
        {items.map((it) => {
          const active = pathname === it.href.split('?')[0];
          const work = (it.count || 0) > 0;
          return (
            <button key={it.href} onClick={() => router.push(it.href)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border whitespace-nowrap transition
                ${active ? 'bg-[#12325c] text-white border-[#12325c]'
                         : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:text-slate-900'}`}>
              {it.icon}
              {ar ? it.ar : it.en}
              {it.count != null && (
                <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums
                  ${active ? 'bg-white/20 text-white'
                           : work ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                  {it.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="px-1 pt-1.5 text-[11px] text-slate-500">
        {t('الرقم بجانب كل صفحة = مستندات منتهية أو تقترب من الانتهاء، لمن لم تنتهِ خدمته. و«الانتهاءات» مجموعها: يُعَدّ كل مستند مرة، فالموظف الواحد قد يُعَدّ بأكثر من مستند.',
           'The number next to each page = documents expired or nearing expiry, for staff whose service has not ended. “Expiries” is their sum: each document counts once, so one employee may count more than once.')}
      </p>
    </nav>
  );
}
