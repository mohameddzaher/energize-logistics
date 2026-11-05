'use client';
/**
 * Store issue requests (طلب صرف): the list, the create form and the printable PDF.
 * In a store that issues only through requests, saving a request is the stock-out; the server writes the movements and refuses any line that would take a balance below zero.
 * Posted requests are not edited. Cancelling returns every line to stock with opposite movements under the canceller's name.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, SearchableSelect } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import PeriodFilter from '@/components/system/PeriodFilter';
import { issueReasonLabel } from '@/lib/storeIssueReasons';
import { formatPlate } from '@/lib/flexMatch';
import { ClipboardList, Plus, X, Trash2, FileDown, Search, Ban, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { PlatePicker, IssueReasonPicker, plateKeyOf, type PlateRow, type StoreScope } from './StoreScreen';

type StoreItem = { _id: string; name: string; code?: string; supplierItemName?: string; unit: string; quantity: number };
type Line = { item: string; itemName: string; itemCode: string; unit: string; quantity: number; balanceAfter: number };
type IssueRequest = {
  _id: string; number: string; date: string; vehiclePlate: string; project?: string; rider?: string;
  issueReason: string; note?: string; lines: Line[]; status: 'posted' | 'cancelled';
  createdByName?: string; createdAt: string; cancelledByName?: string; cancelReason?: string; cancelledAt?: string;
  lineCount?: number; totalQty?: number;
};

export type IssueRequestsScope = {
  /** Requests endpoint, written in full by the page so the page-to-endpoint map sees it. */
  base: string;
  /** Store items endpoint: the lines are picked from it and balances read from it. */
  itemsBase: string;
  plateSource: StoreScope['plateSource'];
  canSee: (user: any) => boolean;
  canEdit: (user: any) => boolean;
};

const qtyText = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const dmy = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function downloadPdf(base: string, r: { _id: string; number: string }) {
  const blob = await api.getBlob(`${base}/${r._id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${r.number}.pdf`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function IssueRequests({ scope }: { scope: IssueRequestsScope }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const canEdit = scope.canEdit(user);

  const [rows, setRows] = useState<IssueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<IssueRequest | null>(null);
  const [busyPdf, setBusyPdf] = useState<string | null>(null);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [plates, setPlates] = useState<PlateRow[]>([]);
  const listReq = useLatestRequest();

  const load = useCallback(async () => {
    const token = listReq.begin();
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (status) qs.set('status', status);
    if (period.from) qs.set('from', period.from);
    if (period.to) qs.set('to', period.to);
    try {
      const d = await api.get<{ requests: IssueRequest[] }>(`${scope.base}${qs.toString() ? `?${qs}` : ''}`);
      if (listReq.isCurrent(token)) setRows(d.requests || []);
    } catch (e: any) { if (listReq.isCurrent(token)) notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, period.from, period.to, scope.base, notify]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);

  const loadItems = useCallback(() => {
    api.get<{ items: StoreItem[] }>(scope.itemsBase).then((d) => setItems(d.items || [])).catch(() => {});
  }, [scope.itemsBase]);
  useEffect(() => { loadItems(); }, [loadItems]);
  const loadPlates = useCallback(() => {
    api.get<any>(scope.plateSource.url).then((d) => setPlates(scope.plateSource.rows(d) || [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.plateSource.url]);
  useEffect(() => { loadPlates(); }, [loadPlates]);

  // Same event as the store: a request, a receipt or a cancellation changes balances and the list together.
  useSocket('ls2:store', useCallback(() => { load(); loadItems(); }, [load, loadItems]));
  useSocket('vreg:updated', loadPlates);

  const pdf = async (r: IssueRequest) => {
    setBusyPdf(r._id);
    try { await downloadPdf(scope.base, r); } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setBusyPdf(null);
  };

  const plateInfo = useMemo(() => new Map(plates.map((p) => [plateKeyOf(p.plate), p])), [plates]);

  if (!scope.canSee(user)) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading && !rows.length) return <Spinner />;

  const posted = rows.filter((r) => r.status === 'posted');
  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-5 h-5" />} title={t('طلبات الصرف', 'Issue requests')}
        subtitle={t('كلّ صرفٍ من المخزن يتمّ بطلب صرف: يُخصم الرصيد عند الحفظ ويُطبع الطلب للتوقيع', 'Every issue is a request: stock is deducted on save and the request is printed for signature')}>
        {canEdit && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" /> {t('طلب صرف', 'Issue request')}
          </button>
        )}
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('رقم الطلب / اللوحة / الصنف / الكود…', 'Number / plate / item / code…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-64 max-w-full" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          <option value="posted">{t('مصروف', 'Posted')}</option>
          <option value="cancelled">{t('ملغى', 'Cancelled')}</option>
        </select>
        <PeriodFilter ar={ar} from={period.from} to={period.to} onChange={(a, b) => setPeriod({ from: a, to: b })} />
        <span className="text-xs text-slate-400 ms-auto">
          {rows.length} {t('طلب', 'requests')} · {posted.reduce((a, r) => a + (r.lineCount || r.lines.length), 0)} {t('سطر مصروف', 'posted lines')}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>
                {[t('رقم الطلب', 'No.'), t('تاريخ الصرف', 'Issue date'), t('المركبة', 'Vehicle'), t('سبب الصرف', 'Reason'), t('الأصناف', 'Items'), t('بواسطة', 'By'), t('الحالة', 'Status'), ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const info = plateInfo.get(plateKeyOf(r.vehiclePlate));
                const isOpen = open === r._id;
                return [
                  <tr key={r._id} className={`hover:bg-slate-50 ${r.status === 'cancelled' ? 'text-slate-400' : ''}`}>
                    <td className="px-3 py-2 font-bold whitespace-nowrap" dir="ltr">{r.number}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {dmy(r.date)}
                      {r.createdAt && <span className="block text-[11px] text-slate-400" dir="ltr">{t('سُجّل', 'Recorded')} {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh' })}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-slate-800 whitespace-nowrap">{formatPlate(r.vehiclePlate) || r.vehiclePlate}</p>
                      <p className="text-[11px] text-slate-500">{[r.project || info?.project, r.rider || info?.rider].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{issueReasonLabel(r.issueReason, ar) || '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpen(isOpen ? null : r._id)} className="inline-flex items-center gap-1 text-start text-slate-700 hover:text-slate-900">
                        <span>{(r.lineCount ?? r.lines.length)} {t('سطر', 'lines')} · {qtyText(r.totalQty)}</span>
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <p className="text-[11px] text-slate-400 truncate max-w-[260px]">{r.lines.map((l) => l.itemName).join('، ')}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{r.createdByName || '—'}</td>
                    <td className="px-3 py-2">
                      {r.status === 'cancelled'
                        ? <span title={r.cancelReason || ''} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{t('ملغى', 'Cancelled')}</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{t('مصروف', 'Posted')}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => pdf(r)} disabled={busyPdf === r._id} title="PDF"
                          className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                          <FileDown className="w-3.5 h-3.5" />{busyPdf === r._id ? '…' : 'PDF'}
                        </button>
                        {canEdit && r.status === 'posted' && (
                          <button type="button" onClick={() => setCancelling(r)} title={t('إلغاء الطلب', 'Cancel request')}
                            className="px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold inline-flex items-center gap-1">
                            <Ban className="w-3.5 h-3.5" />{t('إلغاء', 'Cancel')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${r._id}-lines`} className="bg-slate-50/70">
                      <td colSpan={8} className="px-4 py-3">
                        <table className="w-full text-[13px]">
                          <thead><tr className="text-slate-500 text-xs">
                            {['#', t('الصنف', 'Item'), t('الكود', 'Code'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('الرصيد بعد الصرف', 'Balance after')].map((h) => <th key={h} className="px-2 py-1 text-start font-semibold">{h}</th>)}
                          </tr></thead>
                          <tbody className="divide-y divide-slate-200">
                            {r.lines.map((l, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                                <td className="px-2 py-1 font-medium text-slate-800">{l.itemName}</td>
                                <td className="px-2 py-1 text-slate-500" dir="ltr">{l.itemCode || '—'}</td>
                                <td className="px-2 py-1 text-slate-500">{l.unit}</td>
                                <td className="px-2 py-1 font-bold">{qtyText(l.quantity)}</td>
                                <td className="px-2 py-1 text-slate-600">{qtyText(l.balanceAfter)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.note ? <p className="mt-2 text-xs text-slate-600">{t('ملاحظة', 'Note')}: {r.note}</p> : null}
                        {r.status === 'cancelled' ? (
                          <p className="mt-2 text-xs text-red-600">
                            {t('أُلغي', 'Cancelled')}{r.cancelledByName ? ` · ${r.cancelledByName}` : ''}{r.cancelledAt ? ` · ${new Date(r.cancelledAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : ''}{r.cancelReason ? ` · ${r.cancelReason}` : ''}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">{t('لا طلبات صرف في هذا العرض', 'No issue requests in this view')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {creating && (
        <CreateModal base={scope.base} items={items} plates={plates} ar={ar}
          onClose={() => setCreating(false)}
          onSaved={async (r) => {
            setCreating(false); load(); loadItems();
            if (await confirm(t(`حُفظ طلب الصرف ${r.number} وخُصم من الرصيد. تنزيل ملف PDF للتوقيع؟`, `Request ${r.number} saved and stock deducted. Download the PDF for signature?`))) pdf(r);
          }} />
      )}
      {cancelling && (
        <CancelModal r={cancelling} base={scope.base} ar={ar} onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); load(); loadItems(); }} />
      )}
    </div>
  );
}

type DraftLine = { id: number; item: string; quantity: string };
let lineSeq = 1;
const blankLine = (): DraftLine => ({ id: lineSeq++, item: '', quantity: '' });

/**
 * Create form. The balance after each line is computed as it is typed: the item's stock minus this line and every earlier line of the same item, which is also what the server checks and prints.
 */
function CreateModal({ base, items, plates, ar, onClose, onSaved }: {
  base: string; items: StoreItem[]; plates: PlateRow[]; ar: boolean;
  onClose: () => void; onSaved: (r: IssueRequest) => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [plate, setPlate] = useState('');
  const [issueReason, setIssueReason] = useState('');
  // The actual issue day, chosen (the entry can follow the paper); the server keeps when it was recorded.
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [serverErr, setServerErr] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  const options = useMemo(() => items.map((i) => ({
    value: i._id,
    label: i.name,
    search: [i.code, i.supplierItemName].filter(Boolean).join(' '),
    hint: [i.code && `${t('كود', 'code')}: ${i.code}`, `${t('الرصيد', 'stock')}: ${qtyText(i.quantity)} ${i.unit || ''}`].filter(Boolean).join(' · '),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [items, ar]);

  const setLine = (id: number, k: 'item' | 'quantity', v: string) => {
    setLines((p) => p.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
    setServerErr({});
  };

  // Balance after each line, in order, reflecting earlier lines of the same item.
  const computed = useMemo(() => {
    const used = new Map<string, number>();
    return lines.map((l) => {
      const it = byId.get(l.item);
      const q = Number(l.quantity);
      if (!it) return { it: null, after: null as number | null, err: '' };
      const take = q > 0 ? q : 0;
      const sum = r3((used.get(it._id) || 0) + take);
      used.set(it._id, sum);
      const after = r3((Number(it.quantity) || 0) - sum);
      let err = '';
      if (l.quantity !== '' && !(q > 0)) err = t('الكمية يجب أن تكون أكبر من صفر', 'Quantity must be above zero');
      else if (after < 0) err = t(`الرصيد لا يكفي: المتاح ${qtyText(it.quantity)} ${it.unit}`, `Not enough stock: ${qtyText(it.quantity)} ${it.unit}`);
      return { it, after, err };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, byId, ar]);

  const filled = lines.filter((l) => l.item || l.quantity);
  const incomplete = filled.some((l) => !l.item || !(Number(l.quantity) > 0));
  const anyErr = computed.some((c) => c.err);
  const canSave = !!date && date <= todayYmd() && !!plate.trim() && !!issueReason && filled.length > 0 && !incomplete && !anyErr && !busy;

  const save = async () => {
    setBusy(true); setServerErr({});
    try {
      const d = await api.post<{ request: IssueRequest }>(base, {
        date, vehiclePlate: plate.trim(), issueReason, note: note.trim(),
        lines: filled.map((l) => ({ item: l.item, quantity: Number(l.quantity) })),
      });
      notify(t(`حُفظ طلب الصرف ${d.request.number}`, `Saved ${d.request.number}`), 'success');
      onSaved(d.request);
    } catch (e: any) {
      const errs: { line: number; message: string }[] = e?.data?.errors || e?.errors || [];
      if (errs.length) setServerErr(Object.fromEntries(errs.map((x) => [filled[x.line - 1]?.id, x.message])));
      notify(e?.message || 'Failed', 'error');
    } finally { setBusy(false); }
  };

  const cell = 'w-full px-2 py-1.5 rounded-md border border-slate-200 text-[13px]';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-[#f37121]">{t('طلب صرف', 'Issue request')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="mb-4 text-[12.5px] text-slate-500">{t('يُخصم الرصيد عند الحفظ. لا يُعدَّل الطلب بعد حفظه؛ يُلغى ويُعاد إن لزم.', 'Stock is deducted on save. A saved request is not edited; cancel it and raise a new one.')}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">{t('تاريخ الصرف *', 'Issue date *')}</label>
            <input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
          </div>
          <div>
            <PlatePicker plates={plates} value={plate} onChange={setPlate} ar={ar} label={t('المركبة / اللوحة *', 'Vehicle / plate *')} />
          </div>
        </div>
        <div className="mt-3"><IssueReasonPicker value={issueReason} onChange={setIssueReason} ar={ar} /></div>

        <p className="mt-4 mb-1.5 text-sm font-bold text-slate-800">{t('قطع الغيار المطلوبة', 'Requested parts')}</p>
        <ScrollX>
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-slate-900 text-slate-300 text-xs">
              {['#', t('الصنف (بحث بالاسم أو الكود) *', 'Item (name or code) *'), t('الوحدة', 'Unit'), t('الكمية *', 'Qty *'), t('الرصيد بعد الصرف', 'Balance after'), ''].map((h) => <th key={h} className="px-2 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const c = computed[i];
                const err = serverErr[l.id] || c.err;
                return (
                  <tr key={l.id} className={err ? 'bg-red-50' : ''}>
                    <td className="px-2 py-1.5 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1.5 min-w-[18rem]">
                      <SearchableSelect value={l.item} onChange={(v) => setLine(l.id, 'item', v)} options={options} searchAfter={0}
                        placeholder={t('اختر الصنف…', 'Pick the item…')} searchPlaceholder={t('اسم الصنف أو الكود…', 'Name or code…')}
                        emptyLabel={t('لا صنف مطابق', 'No match')} />
                      {err && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{err}</p>}
                    </td>
                    <td className="px-2 py-1.5 w-24 text-slate-600">{c.it?.unit || '—'}</td>
                    <td className="px-2 py-1.5 w-28">
                      <input type="number" min={0} step="any" inputMode="decimal" className={cell} value={l.quantity}
                        onChange={(e) => setLine(l.id, 'quantity', e.target.value)} />
                    </td>
                    <td className={`px-2 py-1.5 w-32 font-bold tabular-nums ${c.after !== null && c.after < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                      {c.it ? `${qtyText(c.after)} ${c.it.unit || ''}` : '—'}
                      {c.it ? <span className="block text-[10.5px] font-normal text-slate-400">{t('المتاح', 'in stock')}: {qtyText(c.it.quantity)}</span> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))} className="p-1 text-slate-300 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
        <button type="button" onClick={() => setLines((p) => [...p, blankLine()])} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          <Plus className="w-4 h-4" />{t('سطر آخر', 'Another line')}
        </button>

        <div className="mt-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">{t('ملاحظة (اختياري)', 'Note (optional)')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{t('إلغاء', 'Cancel')}</button>
          <button onClick={save} disabled={!canSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-40">
            <Save className="w-4 h-4" />{busy ? t('جارٍ الحفظ…', 'Saving…') : t(`حفظ وصرف (${filled.length} سطر)`, `Save & issue (${filled.length} lines)`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelModal({ r, base, ar, onClose, onDone }: { r: IssueRequest; base: string; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`${base}/${r._id}/cancel`, { reason: reason.trim() });
      notify(t(`أُلغي ${r.number} وعادت الكميات إلى المخزن`, `${r.number} cancelled; stock returned`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-red-600">{t('إلغاء طلب الصرف', 'Cancel issue request')} <span dir="ltr">{r.number}</span></h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-3">{formatPlate(r.vehiclePlate) || r.vehiclePlate} · {r.lines.length} {t('سطر', 'lines')}</p>
        <label className="block text-xs font-semibold text-slate-600 mb-1">{t('سبب الإلغاء', 'Reason')} *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        <p className="mt-3 text-[11px] leading-relaxed rounded-lg px-3 py-2 bg-slate-50 text-slate-500">
          {t('تعود كلُّ الكميات إلى المخزن بحركات وارد معاكسة تُسجَّل باسمك وبسببك، وتبقى حركات الصرف الأصلية في السجل مشطوبة، ويبقى الطلب ظاهرًا بحالة «ملغى».',
             'Every line returns to stock as an opposite movement under your name and reason; the original movements stay in the log struck through and the request stays listed as cancelled.')}
        </p>
        <button onClick={submit} disabled={busy || reason.trim().length < 3}
          className="w-full mt-3 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? t('جارٍ الإلغاء…', 'Cancelling…') : t('تأكيد الإلغاء', 'Confirm cancellation')}
        </button>
      </div>
    </div>
  );
}
