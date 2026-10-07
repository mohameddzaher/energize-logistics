'use client';
/**
 * صفوفُ عقدةٍ من شجرة المديونيّة — ومن هنا تُصنَّف مشكلةُ العميل.
 *
 * الصفوفُ تأتي من **نفس** الاشتقاق الذي حسب البطاقة (`/receivables/rows`
 * و`/receivables/overview` يقرآن `derive()` واحدة في الخادم)، فلا يُقرأ رقمٌ
 * ثمّ يُفتَح جدولٌ بغيره — وهو أوّلُ ما يُفقِد الثقةَ في لوحة.
 *
 * ولأنّ تصنيفَ الخلاف صفةُ **العميل** لا الفاتورة، فالزرُّ على الصفّ يصنّف
 * صاحبَه — وكلُّ فواتيره تتبعه في الحال.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Scale, Handshake, Ban, ExternalLink, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import ScrollX from '@/components/system/ScrollX';

export interface Row {
  _id: string; invoiceNumber: string; kind: string; total: number;
  partyName: string; partyCode: string; party: string | null;
  invoiceDate: string | null; deliveryDate: string | null; status: string;
  creditDays: number; officer: string; issueState: 'none' | 'negotiating' | 'legal';
  basis: 'delivery' | 'invoice'; dueDate: string | null; daysLate: number | null;
  dueState: string; lateBand: string;
}

const money = (n?: number) => Math.round(n || 0).toLocaleString('en-US');
const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : '—');

const ISSUE: Record<string, { ar: string; en: string; cls: string }> = {
  none: { ar: 'لا خلاف', en: 'No issue', cls: 'bg-slate-100 text-slate-600' },
  negotiating: { ar: 'يُتفاوض', en: 'Negotiating', cls: 'bg-sky-50 text-sky-700' },
  legal: { ar: 'قضايا', en: 'Legal', cls: 'bg-[#7c2d12]/10 text-[#7c2d12]' },
};

export default function ReceivablesRows({
  open, onClose, title, query, ar, canEdit, onChanged,
}: {
  open: boolean; onClose: () => void; title: string;
  query: Record<string, string>; ar: boolean; canEdit: boolean; onChanged?: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [value, setValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ ...query, limit: '300' });
      const d = await api.get<{ rows: Row[]; total: number; value: number }>(`/api/collections-dept/receivables/rows?${p}`);
      setRows(d.rows || []); setTotal(d.total || 0); setValue(d.value || 0);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(query)]);

  useEffect(() => { load(); }, [load]);

  const setIssue = async (r: Row, state: 'none' | 'negotiating' | 'legal') => {
    if (!r.party) { notify(t('هذه الفاتورة بلا حسابٍ مربوط', 'This invoice has no linked account'), 'error'); return; }
    let note = '';
    if (state !== 'none') {
      const ask = window.prompt(state === 'legal'
        ? t(`رقمُ القضيّة أو بيانُها — «${r.partyName}»:`, `Case number or details — “${r.partyName}”:`)
        : t(`ما المتَّفقُ عليه مع «${r.partyName}»؟`, `What was agreed with “${r.partyName}”?`));
      if (!ask || !ask.trim()) return;
      note = ask.trim();
    }
    setBusy(r._id);
    try {
      await api.put(`/api/collections-dept/parties/${r.party}/issue`, { state, note });
      notify(t('سُجِّلت الحالة — وكلُّ فواتير العميل تتبعها', 'Recorded — all the customer’s invoices follow it'), 'success');
      await load();
      onChanged?.();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-6xl max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 truncate">{title}</h3>
            <p className="text-[12px] text-slate-500 tabular-nums">
              {total.toLocaleString('en-US')} {t('فاتورة', 'invoices')} · {money(value)}
              {total > rows.length ? ` · ${t(`يُعرَض أوّلُ ${rows.length}`, `showing first ${rows.length}`)}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ms-auto text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          ) : !rows.length ? (
            <div className="p-10 text-center text-sm text-slate-500">{t('لا صفوف', 'No rows')}</div>
          ) : (
            <ScrollX>
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-3 py-2.5">{t('الفاتورة', 'Invoice')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('العميل', 'Customer')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('المبلغ', 'Amount')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('تاريخ الفاتورة', 'Invoice date')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('التسليم', 'Delivery')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('المدّة', 'Term')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('الاستحقاق', 'Due')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('التأخير', 'Late by')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('موظف التحصيل', 'Officer')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('الحالة', 'Issue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const iss = ISSUE[r.issueState] || ISSUE.none;
                    return (
                      <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                          {r.invoiceNumber}
                          <span className="text-[10px] text-slate-400 ms-1">{r.kind === 'tax' ? t('ضريبي', 'tax') : t('كاش', 'cash')}</span>
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <span className="truncate block" title={r.partyName}>{r.partyName || '—'}</span>
                          {r.partyCode ? <span className="text-[10px] text-slate-400">{r.partyCode}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums font-semibold">{money(r.total)}</td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">{d10(r.invoiceDate)}</td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">
                          {d10(r.deliveryDate)}
                          {/* ويُقال من أيِّ تاريخٍ عُدَّ: فاتورةٌ لم تُسلَّم تُعَدّ من إصدارها. */}
                          {r.basis === 'invoice' ? <span className="text-[10px] text-amber-600 block">{t('عُدَّ من الإصدار', 'counted from issue')}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-slate-600">{r.creditDays || '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">{d10(r.dueDate)}</td>
                        <td className="px-3 py-2 text-end tabular-nums font-semibold">
                          {r.daysLate == null ? <span className="text-slate-300">—</span>
                            : r.daysLate > 60 ? <span className="text-red-700">{r.daysLate}</span>
                              : r.daysLate > 0 ? <span className="text-amber-600">{r.daysLate}</span>
                                : <span className="text-emerald-600">{r.daysLate}</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.officer || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${iss.cls}`}>{ar ? iss.ar : iss.en}</span>
                          {canEdit && (
                            <span className="inline-flex items-center gap-1 ms-1.5">
                              <button type="button" disabled={busy === r._id} title={t('يُتفاوض', 'Negotiating')}
                                onClick={() => setIssue(r, 'negotiating')}
                                className="px-1.5 py-1 rounded-md border border-sky-200 text-sky-600 hover:bg-sky-50 disabled:opacity-40"><Handshake className="w-3.5 h-3.5" /></button>
                              <button type="button" disabled={busy === r._id} title={t('قضايا', 'Legal')}
                                onClick={() => setIssue(r, 'legal')}
                                className="px-1.5 py-1 rounded-md border border-[#7c2d12]/30 text-[#7c2d12] hover:bg-[#7c2d12]/5 disabled:opacity-40"><Scale className="w-3.5 h-3.5" /></button>
                              {r.issueState !== 'none' && (
                                <button type="button" disabled={busy === r._id} title={t('رفعُ الحالة', 'Clear')}
                                  onClick={() => setIssue(r, 'none')}
                                  className="px-1.5 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><Ban className="w-3.5 h-3.5" /></button>
                              )}
                            </span>
                          )}
                          {r.party && (
                            <button type="button" title={t('ملفُّ العميل', 'Customer file')}
                              onClick={() => router.push(`/system/collections-dept/parties/${r.party}`)}
                              className="px-1.5 py-1 ms-1 rounded-md border border-slate-200 text-slate-500 hover:border-[#f37121] hover:text-[#f37121]"><ExternalLink className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          )}
        </div>
      </div>
    </div>
  );
}
