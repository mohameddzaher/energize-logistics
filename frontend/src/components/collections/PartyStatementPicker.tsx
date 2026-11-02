'use client';
/** Send account statement from the customer profile: filter to certain invoices or a period, then send. Step one picks type (cash/tax), period, state and specific invoices by tick. Step two is the same preview and send dialog (SendStatementModal) with the same selection, so the attached statement is exactly what was chosen here. */
import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Modal } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import SendStatementModal from '@/components/collections/SendStatementModal';
import { Loader2, ArrowLeft, ArrowRight } from 'lucide-react';

type Kind = 'cash' | 'tax';
interface Inv {
  _id?: string; reportNumber?: string; invoiceNumber?: string; customer?: string;
  paymentDate?: string; invoiceDate?: string; value?: number; remaining?: number; collectionState?: string; ageDays?: number | null;
}
const STATES: [string, string, string][] = [['', 'الكل', 'All'], ['no', 'غير مسدّدة', 'Unpaid'], ['partial', 'جزئية', 'Partial'], ['yes', 'مسدّدة', 'Paid']];
const norm = (s?: string) => String(s || '').replace(/[\s ​-‏]+/g, ' ').trim();
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function PartyStatementPicker({ partyName, defaultKind, ar, onClose }: {
  partyName: string; defaultKind: Kind; ar: boolean; onClose: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState('no');
  const [rows, setRows] = useState<Inv[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [next, setNext] = useState<URLSearchParams | null>(null);
  const guard = useLatestRequest();
  const keyOf = (r: Inv) => (kind === 'cash' ? String(r._id) : String(r.invoiceNumber));

  useEffect(() => {
    const mine = guard.begin();
    setRows(null); setPicked(new Set());
    const p = new URLSearchParams({ customer: partyName, limit: '500', page: '1' });
    if (from) p.set('from', from); if (to) p.set('to', to); if (state) p.set('collected', state);
    api.get<{ invoices: Inv[] }>(`/api/collections-dept/invoices/${kind}?${p.toString()}`)
      .then((d) => { if (guard.isCurrent(mine)) setRows((d.invoices || []).filter((r) => norm(r.customer) === norm(partyName) || !r.customer)); })
      .catch(() => { if (guard.isCurrent(mine)) setRows([]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, from, to, state, partyName]);

  const total = useMemo(() => (rows || []).reduce((s, r) => s + (Number(r.remaining) || 0), 0), [rows]);
  const go = () => {
    const p = new URLSearchParams({ customer: partyName, lang: ar ? 'ar' : 'en' });
    if (from) p.set('from', from); if (to) p.set('to', to); if (state) p.set('collected', state);
    // Only the selected rows if any; otherwise all this customer's rows (even if the name matches another, longer customer).
    const keys = picked.size ? [...picked] : (rows || []).map(keyOf);
    for (const k of keys) p.append('sel', k);
    setNext(p);
  };

  if (next) return <SendStatementModal kind={kind} params={next} ar={ar} onClose={onClose} />;
  const all = rows || [];
  const allOn = all.length > 0 && all.every((r) => picked.has(keyOf(r)));
  return (
    <Modal open onClose={onClose} wide title={t(`إرسال كشف حساب — ${partyName}`, `Email a statement — ${partyName}`)}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <button type="button" onClick={go} disabled={rows === null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {t('التالي: معاينة وإرسال', 'Next: preview & send')}{ar ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-sm font-semibold">
            {(['cash', 'tax'] as Kind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-3 py-1.5 ${kind === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>
                {k === 'cash' ? t('فواتير كاش', 'Cash') : t('فواتير ضريبية', 'Tax')}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[13px] font-semibold">
            {STATES.map(([k, a, e]) => (
              <button key={k || 'all'} type="button" onClick={() => setState(k)}
                className={`px-3 py-1.5 ${state === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600'}`}>{t(a, e)}</button>
            ))}
          </div>
          <PeriodFilter ar={ar} modes={['day', 'month', 'range']} from={from} to={to} onChange={(a, b) => { setFrom(a || ''); setTo(b || ''); }} />
        </div>
        <p className="text-[12.5px] text-slate-600">
          {picked.size
            ? t(`سيُرسَل ${picked.size} فاتورة مختارة`, `${picked.size} selected invoices will be sent`)
            : t(`لم تختر فواتير — سيُرسَل الكلّ (${all.length}) · المتبقّي ${money(total)} ريال`, `Nothing selected — all ${all.length} will be sent · due ${money(total)}`)}
        </p>
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
          {rows === null ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : !all.length ? (
            <p className="py-8 text-center text-sm text-slate-500">{t('لا فواتير بهذا الاختيار — يمكن الإرسال وسيقول أمر النقل ذلك.', 'No invoices for this choice.')}</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-[12px] text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start"><input type="checkbox" checked={allOn}
                    onChange={() => setPicked(allOn ? new Set() : new Set(all.map(keyOf)))} /></th>
                  <th className="px-3 py-2 text-start">{kind === 'cash' ? t('رقم أمر النقل', 'Report') : t('رقم الفاتورة', 'Invoice')}</th>
                  <th className="px-3 py-2 text-start">{t('التاريخ', 'Date')}</th>
                  <th className="px-3 py-2 text-end">{t('القيمة', 'Value')}</th>
                  <th className="px-3 py-2 text-end">{t('المتبقّي', 'Due')}</th>
                  <th className="px-3 py-2 text-end">{t('العمر', 'Age')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {all.map((r) => {
                  const k = keyOf(r); const on = picked.has(k);
                  return (
                    <tr key={k} className={on ? 'bg-orange-50/60' : ''} onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                      <td className="px-3 py-1.5"><input type="checkbox" checked={on} readOnly /></td>
                      <td className="px-3 py-1.5 font-semibold tabular-nums">{kind === 'cash' ? r.reportNumber : r.invoiceNumber}</td>
                      <td className="px-3 py-1.5 tabular-nums">{day(kind === 'cash' ? r.paymentDate : r.invoiceDate)}</td>
                      <td className="px-3 py-1.5 text-end tabular-nums">{money(r.value)}</td>
                      <td className="px-3 py-1.5 text-end tabular-nums font-semibold">{money(r.remaining)}</td>
                      <td className="px-3 py-1.5 text-end tabular-nums">{r.ageDays != null ? `${r.ageDays} ${t('يوم', 'd')}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
