'use client';
// Live company activity for top management: the latest actions across every section, as readable lines from the audit log. Refreshes on activity events and every 20 seconds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Search, X } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader, Spinner } from '@/components/hr/HRKit';

type Log = { _id: string; createdAt: string; userName: string; sectionLabel?: string; actionLabel?: string; entityLabel?: string; subject?: string; summary?: string; kind?: string };

const ago = (iso: string, ar: boolean) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return ar ? 'الآن' : 'now';
  const m = Math.round(s / 60);
  if (m < 60) return ar ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return ar ? `منذ ${h} س` : `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-GB');
};

export default function TopManagementActivityPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ logs: Log[] }>(`/api/top-management/activity?limit=150&lang=${ar ? 'ar' : 'en'}`);
      setLogs(d.logs || []);
    } catch { /* keep the last list */ }
    setLoading(false);
  }, [ar]);
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [load]);
  const reloadSoon = useCallback(() => {
    if (soon.current) clearTimeout(soon.current);
    soon.current = setTimeout(load, 1500);
  }, [load]);
  useEffect(() => () => { if (soon.current) clearTimeout(soon.current); }, []);
  useSocket('notification:activity', reloadSoon);
  useSocket('notification:new', reloadSoon);

  const sections = [...new Set(logs.map((l) => l.sectionLabel).filter(Boolean))] as string[];
  const needle = q.trim();
  const shown = logs.filter((l) => (!section || l.sectionLabel === section)
    && (!needle || [l.userName, l.summary, l.subject, l.actionLabel, l.entityLabel].some((x) => String(x || '').includes(needle))));

  return (
    <div className="space-y-4">
      <PageHeader icon={<Activity className="w-6 h-6" />} title={t('نشاط الشركة المباشر', 'Live Company Activity')}
        subtitle={t('آخر ما يحدث في كل الأقسام لحظةً بلحظة: من فعل ماذا ومتى.', 'What is happening across every section, as it happens: who did what and when.')} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث باسم الشخص أو الإجراء…', 'Search by person or action…')}
            className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2 text-slate-400"><X className="w-4 h-4" /></button>}
        </div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
          <option value="">{t('كل الأقسام', 'All sections')}</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{t('مباشر', 'Live')}
        </span>
      </div>
      {loading ? <Spinner /> : shown.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">{t('لا يوجد نشاط مطابق', 'No matching activity')}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {shown.map((l) => (
            <div key={l._id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-[#f37121] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">
                  <span className="font-semibold">{l.userName}</span>{' '}
                  <span className="text-slate-600">{l.summary || [l.actionLabel, l.entityLabel, l.subject].filter(Boolean).join(' — ')}</span>
                </p>
                <p className="text-[11px] text-slate-400">{[l.sectionLabel, ago(l.createdAt, ar)].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
