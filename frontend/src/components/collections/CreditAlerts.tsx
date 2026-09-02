'use client';
/**
 * تنبيهاتُ التحصيل — الحدُّ الائتمانيُّ وموعدُ الاستحقاق.
 *
 * ── لا تُخزَّن، تُحسب ────────────────────────────────────────────────────────
 * «قارب حدَّه» و«يستحقّ بعد يومين» جوابان عن الرصيد والتواريخ اليوم. والتنبيهُ
 * المخزَّن يصدق يومَ كُتب ويكذب في اليوم التالي — يبقى معلَّقًا بعد أن يسدّد
 * العميل، أو يغيب بعد أن ترتفع مديونيّتُه.
 *
 * والمخزَّنُ وحدَه هو الإسكات: قرارٌ بشريٌّ بأنّ فلانًا رآه. وهو مقيَّدٌ برصيده
 * لحظتَها — فمَن أسكته عند تسعين في المئة يعود إليه عند مئةٍ وعشرين.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { canEditCollections, money, dueWords } from '@/lib/collections';
import { AlertTriangle, Clock, BellOff, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export default function CreditAlerts({ compact = false }: { compact?: boolean }) {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const ar = lang === 'ar';
  const canEdit = canEditCollections(user);

  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openLimit, setOpenLimit] = useState(true);
  const [openDue, setOpenDue] = useState(!compact);

  const load = useCallback(async () => {
    try { setD(await api.get<any>('/api/collections-dept/ledger/alerts')); } catch { /* keep */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ack = async (a: any) => {
    setBusy(`${a.party}-${a.invoiceNumber || ''}`);
    try {
      await api.post('/api/collections-dept/ledger/alerts/ack', { party: a.party, kind: a.kind, invoiceNumber: a.invoiceNumber || '' });
      await load();
    } catch { /* ignore */ } finally { setBusy(null); }
  };

  if (!d) return null;
  const limit = d.limit || []; const due = d.due || [];
  if (!limit.length && !due.length) return null;
  const showLimit = compact ? limit.slice(0, 5) : limit;
  const showDue = compact ? due.slice(0, 5) : due;

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      {limit.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenLimit((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100 text-start">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900 flex-1">
              {ar ? 'الحد الائتماني' : 'Credit limit'}
              <span className="font-normal text-amber-700 ms-2">
                {ar ? `${d.counts.limitOver} تجاوزوا · ${d.counts.limitNear} اقتربوا` : `${d.counts.limitOver} over · ${d.counts.limitNear} near`}
              </span>
            </h3>
            {openLimit ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
          </button>
          {openLimit && (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {showLimit.map((a: any) => (
                <div key={a.party} className="px-4 py-2.5 flex flex-wrap items-center gap-3 hover:bg-slate-50">
                  <button type="button" onClick={() => router.push(`/system/collections-dept/parties/${a.party}`)}
                    className="text-sm text-slate-900 font-medium flex-1 min-w-[180px] text-start hover:text-[#f37121]">
                    <span className="font-mono text-[11px] text-slate-400 me-1">{a.code}</span>{a.name}
                  </button>
                  <span className="text-xs text-slate-500">{a.officer}</span>
                  <span className="text-xs tabular-nums text-slate-600">{money(a.outstanding)} / {money(a.creditLimit)}</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${a.over ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                    {Math.round(a.pct)}%
                  </span>
                  {canEdit && (
                    <button type="button" onClick={() => ack(a)} disabled={busy === `${a.party}-`}
                      title={ar ? 'رأيتُه — أخفِ التنبيه حتى ترتفع المديونية' : 'Seen — hide until the balance rises'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                      {busy === `${a.party}-` ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              ))}
              {compact && limit.length > 5 && (
                <button type="button" onClick={() => router.push('/system/collections-dept/aging')}
                  className="w-full px-4 py-2 text-xs text-[#f37121] hover:underline text-start">
                  {ar ? `و${limit.length - 5} غيرهم…` : `and ${limit.length - 5} more…`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {due.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenDue((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200 text-start">
            <Clock className="w-4 h-4 text-[#f37121]" />
            <h3 className="text-sm font-semibold text-slate-900 flex-1">
              {ar ? 'مواعيد الاستحقاق' : 'Due dates'}
              <span className="font-normal text-slate-600 ms-2">
                {ar ? `${d.counts.overdue} متأخّرة · ${d.counts.dueSoon} تستحقّ قريبًا` : `${d.counts.overdue} overdue · ${d.counts.dueSoon} due soon`}
              </span>
            </h3>
            {openDue ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {openDue && (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {showDue.map((a: any) => (
                <div key={`${a.party}-${a.invoiceNumber}`} className="px-4 py-2.5 flex flex-wrap items-center gap-3 hover:bg-slate-50">
                  <span className="font-mono text-xs text-slate-500 min-w-[70px]">{a.invoiceNumber}</span>
                  <button type="button" onClick={() => router.push(`/system/collections-dept/parties/${a.party}`)}
                    className="text-sm text-slate-900 flex-1 min-w-[160px] text-start hover:text-[#f37121]">{a.name}</button>
                  <span className="text-xs text-slate-500">{a.officer}</span>
                  <span className="text-xs tabular-nums text-slate-700">{money(a.total)}</span>
                  {/* المهلةُ تُعَدّ من التسليم، فيُعرَض التسليمُ لا الفوترة. */}
                  <span className="text-[11px] text-slate-400" title={ar ? 'تُحسب المهلة من تاريخ التسليم' : 'terms count from delivery'}>
                    {ar ? `سُلّمت ${new Date(a.deliveryDate).toLocaleDateString('en-GB')} · ${a.creditDays} يومًا` : `del. ${new Date(a.deliveryDate).toLocaleDateString('en-GB')} · ${a.creditDays}d`}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${a.daysToDue < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                    {dueWords(a.daysToDue, ar)}
                  </span>
                  {canEdit && (
                    <button type="button" onClick={() => ack(a)} disabled={busy === `${a.party}-${a.invoiceNumber}`}
                      title={ar ? 'رأيتُه' : 'Seen'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                      {busy === `${a.party}-${a.invoiceNumber}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              ))}
              {compact && due.length > 5 && (
                <button type="button" onClick={() => router.push('/system/collections-dept/ledger?open=true')}
                  className="w-full px-4 py-2 text-xs text-[#f37121] hover:underline text-start">
                  {ar ? `و${due.length - 5} غيرها…` : `and ${due.length - 5} more…`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
