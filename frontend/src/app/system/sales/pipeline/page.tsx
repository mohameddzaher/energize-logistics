'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { TrendingUp } from 'lucide-react';
import { isSalesStaff, money, userName } from '@/lib/finance';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { getSalesPipelineTranslations } from '@/lib/translations';

// Mirrors backend config/crmDefaults PIPELINE_STAGES.
const STAGES = [
  { key: 'new', en: 'New', ar: 'جديد', color: '#94a3b8' },
  { key: 'contacted', en: 'Contacted', ar: 'تم التواصل', color: '#3b82f6' },
  { key: 'qualified', en: 'Qualified', ar: 'مؤهّل', color: '#6366f1' },
  { key: 'proposal', en: 'Proposal', ar: 'عرض سعر', color: '#a855f7' },
  { key: 'negotiation', en: 'Negotiation', ar: 'تفاوض', color: '#f97316' },
  { key: 'won', en: 'Won', ar: 'تم الفوز', color: '#22c55e' },
  { key: 'lost', en: 'Lost', ar: 'خسارة', color: '#ef4444' },
];

export default function SalesPipelinePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getSalesPipelineTranslations(lang);
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api.get<{ deals: any[] }>('/api/sales/pipeline'); setDeals(d.deals || []); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));

  if (!isSalesStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  const companyName = (c: any) => (!c ? '—' : ar && c.arabicName ? c.arabicName : c.name || '—');

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<TrendingUp className="w-5 h-5" />} title={tx.pageTitle}
        subtitle={`${deals.length} · ${money(deals.filter((d) => d.status === 'open').reduce((s, d) => s + (d.value || 0), 0))}`} />

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((st) => {
          const col = deals.filter((d) => d.stage === st.key);
          const val = col.reduce((s, d) => s + (d.value || 0), 0);
          return (
            <div key={st.key} className="shrink-0 w-72 bg-slate-50 border border-slate-200 rounded-xl flex flex-col">
              <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color }} />
                  <span className="text-slate-900 text-sm font-semibold">{ar ? st.ar : st.en}</span>
                  <span className="text-slate-500 text-xs">{col.length}</span>
                </div>
                <span className="text-slate-500 text-xs">{money(val)}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[100px]">
                {col.map((d) => (
                  <div key={d._id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <p className="text-slate-900 text-sm font-medium">{d.title}</p>
                    <p className="text-slate-500 text-xs mt-1">{companyName(d.company)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-green-600 text-sm">{money(d.value, d.currency || 'SAR')}</span>
                      <span className="text-slate-500 text-xs">{userName(d.owner)}</span>
                    </div>
                  </div>
                ))}
                {col.length === 0 && <p className="text-slate-600 text-xs text-center py-3">—</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-slate-500 text-xs">{tx.manageDealsHint}</p>
    </div>
  );
}
