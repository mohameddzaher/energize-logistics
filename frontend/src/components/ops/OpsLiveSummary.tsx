'use client';
// Reusable LIVE operations summary — drop into any section dashboard to surface
// the external UPL field-ops data (counts + status breakdown)
// with a click-through to the full Operations Platform. Updates in real time via
// the `ops:stats` / `ops:shipments:changed` socket events and renders nothing if
// the current user has no ops read access (graceful degrade).
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Activity, Truck, Users, Car, ArrowRight } from 'lucide-react';
import { statusStyle, fmtNum, locName, opsText } from '@/lib/ops';

interface Dash {
  home?: { stats?: { status: string; count: string; label: string }[] } | null;
  stats?: { counts?: Record<string, string> } | null;
}

export default function OpsLiveSummary({ title }: { title?: string }) {
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const tx = opsText(lang);
  const [d, setD] = useState<Dash | null>(null);

  const load = useCallback(async () => {
    try { setD(await api.get<Dash>(`/api/ops/dashboard?lang=${lang}`)); }
    catch { /* keep last known data if the API hiccups */ }
  }, [lang]);

  useEffect(() => { load(); }, [load]);
  useSocket('ops:stats', useCallback((stats: any) => setD((p) => ({ ...(p || {}), stats })), []));
  useSocket('ops:shipments:changed', useCallback(() => load(), [load]));

  // Renders nothing until the first successful load (graceful for non-ops roles),
  // then keeps showing the last data even if a later refresh fails.
  if (!d) return null;
  const counts = d.stats?.counts || {};
  const statuses = (d.home?.stats || []).filter((s) => s.status !== 'all').slice(0, 6);
  const go = (path = '') => router.push(`/system/ops${path}`);

  const mini = [
    { k: 'shipments', label: lang === 'ar' ? 'الشحنات' : 'Shipments', icon: Truck, accent: 'text-[#f37121]', path: '/shipments' },
    { k: 'drivers', label: lang === 'ar' ? 'السائقون' : 'Drivers', icon: Users, accent: 'text-blue-600', path: '/drivers' },
    { k: 'cars', label: lang === 'ar' ? 'المركبات' : 'Cars', icon: Car, accent: 'text-emerald-600', path: '/cars' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><Activity className="w-4 h-4" /></span>
          {title || tx.section}
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {tx.live}</span>
        </h2>
        <button type="button" onClick={() => go()} className={`text-xs text-[#f37121] hover:underline flex items-center gap-1`}>{tx.viewAll} <ArrowRight className={`w-3.5 h-3.5 ${isRTL ? 'rotate-180' : ''}`} /></button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {mini.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.k} type="button" onClick={() => go(m.path)} className="text-start rounded-lg border border-slate-200 p-3 hover:border-[#f37121]/40 hover:shadow-sm transition-all">
              <Icon className={`w-4 h-4 ${m.accent}`} />
              <p className={`text-xl font-bold mt-1 ${m.accent}`}>{fmtNum(counts[m.k])}</p>
              <p className="text-slate-500 text-[11px]">{m.label}</p>
            </button>
          );
        })}
      </div>

      {statuses.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {statuses.map((s) => {
            const st = statusStyle(s.status);
            return (
              <button key={s.status} type="button" onClick={() => go(`/shipments?status=${s.status}`)} className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-600'} hover:opacity-80`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st?.dot || 'bg-slate-400'}`} />{lang === 'ar' ? (st?.ar || s.label) : (st?.en || s.label)}: {fmtNum(s.count)}
              </button>
            );
          })}
        </div>
      )}

      {/* ── ولا تُعرَض آخرُ أربع حمولات ────────────────────────────────────
          كانت أربعةَ صفوفٍ بأرقامها ومساراتها تحت البطاقة في سبع صفحات —
          عيّنةٌ من عشرات الآلاف لا يُقرأ منها شيء: لا هي أهمُّ ما يجري ولا
          هي كلُّه، ومَن أراد الحمولات فتح صفحتَها. فبقيت العدّاداتُ وحالاتُ
          الشحنات، وهي ما يُقرأ فعلًا. */}
    </div>
  );
}
