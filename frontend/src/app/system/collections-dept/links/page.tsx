'use client';
/**
 * ربطُ الحسابات — قرارٌ بشريٌّ لا تخمينُ آلة.
 *
 * ── لماذا شاشة ─────────────────────────────────────────────────────────────
 * أسماءُ العملاء عندنا جاءت من كشوف التشغيل، وأسماءُ الدفتر من المحاسبة. من
 * ٢٥٣ حسابًا طابق الاسمُ ٣٧. وما تجاوز تشابهُه حدًّا عاليًا رُبط تلقائيًّا، وما
 * دونه هنا.
 *
 * ولا يُدمَج ما تشابه: الدمجُ ينقل مديونيّةً من حسابٍ إلى حساب، والتشابهُ
 * يُخطئ — «شركة فكر للاتصالات» و«شركة الفترة المتقدمة للاتصالات» تتشابهان
 * ولا تجمعهما جهة. وخطأٌ هنا لا يُكتشف إلّا حين يُطالَب عميلٌ بمالِ غيرِه.
 */
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { canEditCollections } from '@/lib/collections';
import { Loader2, Link2, Split, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Suggestion {
  _id: string; code: string; accountName: string; kind: string;
  candidateName?: string; score: number; decision: string; decidedHow?: string;
}

export default function PartyLinksPage() {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const canEdit = canEditCollections(user);

  const [rows, setRows] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'pending' | 'linked' | 'separate'>('pending');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>(`/api/collections-dept/ledger/link-suggestions?decision=${tab}`);
      setRows(d.rows || []); setCounts(d.counts || {});
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: 'linked' | 'separate') => {
    setWorking(id); setErr('');
    try { await api.post(`/api/collections-dept/ledger/link-suggestions/${id}`, { decision }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setWorking(null); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>;

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{ar ? 'ربط الحسابات' : 'Account linking'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {ar ? 'حسابٌ في دفتر المحاسبة قد يكون عميلًا مسجَّلًا عندنا باسمٍ آخر. القرارُ لك: يُربطان أم يبقى كلٌّ مستقلًّا.'
              : 'An account in the ledger may be a customer we already have under another name. You decide: link them, or keep them separate.'}
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 text-[13px] text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          {ar ? 'الربط ينقل تاريخ العميل القديم إلى الحساب ويُعطّل السجل القديم. لا يُحذف شيء — لكن لا تربط إلا حين تتأكد أنهما جهة واحدة.'
              : 'Linking moves the old record’s history onto the account and deactivates it. Nothing is deleted — but only link when you are sure they are the same company.'}
        </p>
      </div>

      <div className="flex gap-2">
        {([['pending', ar ? 'تنتظر القرار' : 'Pending'], ['linked', ar ? 'مربوطة' : 'Linked'], ['separate', ar ? 'مستقلة' : 'Separate']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setLoading(true); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${tab === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]/40'}`}>
            {label}{counts[k] != null ? ` (${counts[k]})` : ''}
          </button>
        ))}
      </div>

      {err && <p className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-slate-500 text-sm">{ar ? 'لا شيء هنا' : 'Nothing here'}</p>
        ) : rows.map((r) => (
          <div key={r._id} className="px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[260px]">
              <p className="text-sm text-slate-900 font-medium">
                <span className="font-mono text-[11px] text-slate-400 me-1.5">{r.code}</span>{r.accountName}
              </p>
              {r.candidateName && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {ar ? 'المرشَّح عندنا: ' : 'Our record: '}<span className="text-slate-700">{r.candidateName}</span>
                </p>
              )}
            </div>
            {/* درجةُ التشابه تُعرَض كما هي: القارئُ يقرّر بها، فإخفاؤها يخفي أساسَ القرار. */}
            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
              r.score >= 0.7 ? 'bg-emerald-50 text-emerald-700' : r.score >= 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}
              title={ar ? 'درجة تشابه الأسماء' : 'name similarity'}>
              {Math.round(r.score * 100)}%
            </span>
            {r.decision === 'pending' && canEdit ? (
              <div className="flex gap-1.5">
                <button type="button" onClick={() => decide(r._id, 'linked')} disabled={working === r._id}
                  className="px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-xs font-medium flex items-center gap-1 disabled:opacity-60">
                  {working === r._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}{ar ? 'نفس العميل' : 'Same customer'}
                </button>
                <button type="button" onClick={() => decide(r._id, 'separate')} disabled={working === r._id}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium flex items-center gap-1 hover:border-slate-400 disabled:opacity-60">
                  <Split className="w-3.5 h-3.5" />{ar ? 'حسابان مختلفان' : 'Different'}
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                {r.decision === 'linked' ? (ar ? 'مربوط' : 'linked') : (ar ? 'مستقل' : 'separate')}
                {r.decidedHow === 'auto' && <span className="text-slate-400">· {ar ? 'تلقائيًّا' : 'auto'}</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
