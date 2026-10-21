'use client';
/**
 * عملاءُ يُقاسون على المدّة الافتراضيّة — ومن هنا تُكتب مُددُهم.
 *
 * خطورةُ الفاتورة تُقاس على مدّة سداد عميلها؛ ومن لم تُكتب مدّتُه يُقاس على
 * ثلاثين يومًا (قرارُ صاحب الشركة). وذلك تقديرٌ لا اتّفاق، فالقائمةُ تُعرَض
 * ليُسَدّ نقصُها: لكلّ عميلٍ خانةُ «المدّة» تُحفَظ في ملفّه (`PUT /parties/:id`)،
 * فيخرج من القائمة وتُعاد خطورةُ فواتيره في الحال.
 *
 * والصفوفُ من جواب اللوحة نفسِه (`defaultTerm.parties`) — تحت فلاترها.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Search, ExternalLink, Loader2, Check } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import ScrollX from '@/components/system/ScrollX';

export interface DefaultTermParty {
  key: string; party: string | null; name: string; code: string;
  officer: string; officerIsDefault?: boolean;
  count: number; value: number; tax: number; cash: number;
}

const money = (n?: number) => Math.round(n || 0).toLocaleString('en-US');
const fold = (s: string) => String(s || '').toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

export default function DefaultTermList({
  open, onClose, parties, days, ar, canEdit, onSaved, onOpenInvoices,
}: {
  open: boolean; onClose: () => void; parties: DefaultTermParty[]; days: number; ar: boolean; canEdit: boolean;
  onSaved?: () => void;
  /** يفتح فواتيرَ عميلٍ واحدٍ على المدّة الافتراضيّة. */
  onOpenInvoices?: (p: DefaultTermParty) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const s = fold(q);
    return s ? parties.filter((p) => fold(p.name).includes(s) || fold(p.code).includes(s) || fold(p.officer).includes(s)) : parties;
  }, [parties, q]);

  const save = async (p: DefaultTermParty) => {
    const n = Number(draft[p.key]);
    if (!p.party || !Number.isFinite(n) || n <= 0) { notify(t('اكتب عددَ أيّامٍ أكبر من صفر', 'Enter a number of days above zero'), 'error'); return; }
    setBusy(p.key);
    try {
      await api.put(`/api/collections-dept/parties/${p.party}`, { creditDays: Math.round(n) });
      setDone((prev) => new Set(prev).add(p.key));
      notify(t(`حُفظت مدّةُ «${p.name}»: ${Math.round(n)} يومًا`, `Saved ${p.name}: ${Math.round(n)} days`), 'success');
      onSaved?.();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-4xl max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 truncate">{t(`عملاء بمدّة افتراضية ${days} يومًا`, `Customers on the default ${days}-day term`)}</h3>
            <p className="text-[12px] text-slate-500">
              {t('اكتب مدّة سداد كلّ عميل كما اتُّفق معه — تُحفظ في ملفّه وتُعاد خطورةُ فواتيره فورًا',
                'Enter each customer’s agreed term — saved to their file, risk recomputed at once')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ms-auto text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-4 py-2.5 border-b border-slate-100">
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو الكود أو المسؤول…', 'Search name, code, officer…')}
              className="w-full ps-9 pe-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {!shown.length ? (
            <div className="p-10 text-center text-sm text-slate-500">{t('لا عملاء', 'No customers')}</div>
          ) : (
            <ScrollX>
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-3 py-2.5">{t('العميل', 'Customer')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('مسؤول التحصيل', 'Officer')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('المديونية', 'Outstanding')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('فواتير / كشوف', 'Invoices / reports')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('مدّة السداد (يوم)', 'Term (days)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.key} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 max-w-[260px]">
                        <span className="truncate block font-medium text-slate-800" title={p.name}>{p.name}</span>
                        {p.code ? <span className="text-[10px] text-slate-400">{p.code}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                        {p.officer || t('مدير القسم', 'Dept. manager')}
                        {p.officerIsDefault ? <span className="text-[10px] text-slate-400 block">{t('مدير القسم', 'manager')}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums font-semibold">{money(p.value)}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-slate-600">
                        <button type="button" onClick={() => onOpenInvoices?.(p)} className="hover:text-[#f37121] hover:underline">
                          {p.tax ? `${p.tax} ${t('فاتورة', 'inv')}` : ''}{p.tax && p.cash ? ' · ' : ''}{p.cash ? `${p.cash} ${t('كشف', 'rep')}` : ''}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {done.has(p.key) ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 text-[12px]"><Check className="w-3.5 h-3.5" />{t('حُفظت', 'Saved')}</span>
                        ) : canEdit && p.party ? (
                          <span className="inline-flex items-center gap-1.5">
                            <input type="number" min={1} inputMode="numeric" value={draft[p.key] ?? ''} placeholder={String(days)}
                              onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') save(p); }}
                              className="w-20 px-2 py-1 rounded-md border border-slate-300 text-sm tabular-nums" />
                            <button type="button" disabled={busy === p.key || !draft[p.key]} onClick={() => save(p)}
                              className="px-2 py-1 rounded-md bg-[#f37121] text-white text-[12px] font-semibold disabled:opacity-40">
                              {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('حفظ', 'Save')}
                            </button>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">{p.party ? '—' : t('بلا حسابٍ مربوط', 'no linked account')}</span>
                        )}
                        {p.party && (
                          <button type="button" title={t('ملفُّ العميل', 'Customer file')}
                            onClick={() => router.push(`/system/collections-dept/parties/${p.party}`)}
                            className="px-1.5 py-1 ms-1.5 rounded-md border border-slate-200 text-slate-500 hover:border-[#f37121] hover:text-[#f37121] align-middle"><ExternalLink className="w-3.5 h-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
        </div>
      </div>
    </div>
  );
}
