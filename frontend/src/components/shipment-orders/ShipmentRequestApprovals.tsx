'use client';
/**
 * «الاعتمادات»: the sales manager (and the members he delegated) decides sales reps' requests before they reach the
 * vendors, operations and fleet board — approve, return for edits, or reject, each with its reason in the history.
 * The manager also picks the delegates here (stored on the server, editable by him only).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, Modal, SearchInput } from '@/components/hr/HRKit';
import { LOG_LABEL, type ShipmentRequest, type ApprovalStatus } from '@/lib/shipmentRequests';
import { PAYMENT_SUBTYPES } from '@/lib/paymentKind';
import { CheckCircle2, Undo2, XCircle, Loader2, Users, History } from 'lucide-react';

const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
type Opt = { value: string; label: string; roleAr?: string };

export default function ShipmentRequestApprovals({ canManage }: { canManage: boolean }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const guard = useLatestRequest();
  const [tab, setTab] = useState<ApprovalStatus>('pending');
  const [rows, setRows] = useState<ShipmentRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [deciding, setDeciding] = useState<{ r: ShipmentRequest; kind: 'return' | 'decline' } | null>(null);
  const [history, setHistory] = useState<ShipmentRequest | null>(null);
  const [busy, setBusy] = useState('');
  const [delegatesOpen, setDelegatesOpen] = useState(false);

  const load = useCallback(async () => {
    const my = guard.begin();
    const p = new URLSearchParams({ approval: tab, approvalCounts: '1', limit: '500' });
    if (q.trim()) p.set('q', q.trim());
    try {
      const d = await api.get<{ requests: ShipmentRequest[]; approvalCounts: Record<string, number> }>(`/api/shipment-requests?${p}`);
      if (!guard.isCurrent(my)) return;
      setRows(d.requests || []); setCounts(d.approvalCounts || {});
    } catch (e: any) { if (guard.isCurrent(my)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    if (guard.isCurrent(my)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, guard]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  useSocket('shipmentRequests:changed', useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }, [load]));

  const approve = async (r: ShipmentRequest) => {
    setBusy(r._id);
    try { await api.post(`/api/shipment-requests/${r._id}/approve`, {}); notify(t(`اعتُمد الطلب رقم ${r.number} وأُرسل إلى فريق الموردين`, `Request ${r.number} approved`), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الاعتماد', 'Failed'), 'error'); }
    setBusy('');
  };

  const TABS: [ApprovalStatus, string, string][] = [['pending', 'بانتظار الاعتماد', 'Pending'], ['approved', 'المعتمدة', 'Approved'], ['returned', 'المعادة للتعديل', 'Returned'], ['rejected', 'المرفوضة', 'Rejected']];
  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {TABS.map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setLoading(true); }}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {t(a, e)}<span className="ms-1.5 tabular-nums opacity-70">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]"><SearchInput value={q} onChange={setQ} placeholder={t('رقم الطلب، العميل، المندوب…', 'Request no., customer, rep…')} /></div>
        {canManage && (
          <button type="button" onClick={() => setDelegatesOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">
            <Users className="h-4 w-4" />{t('المفوَّضون بالاعتماد', 'Delegated approvers')}
          </button>
        )}
      </div>

      {loading ? <Spinner /> : !rows.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-500">{t('لا طلبات هنا', 'No requests here')}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-auto max-h-[75vh]">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-slate-900 text-slate-200">
              <tr>
                {[t('رقم الطلب', 'Request'), t('المندوب', 'Rep'), t('العميل', 'Customer'), t('المسار', 'Route'), t('الشاحنات', 'Trucks'), t('نوع الشاحنة', 'Truck type'), t('سعر البيع', 'Selling'), t('الدفع', 'Payment'), t('الفرع', 'Branch'), t('التاريخ', 'Date'), tab === 'pending' ? t('إجراءات', 'Actions') : t('القرار', 'Decision')].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-start font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-bold tabular-nums">{r.number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.createdByName}{r.salesRepName && r.salesRepName !== r.createdByName ? ` · ${r.salesRepName}` : ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.customerName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.fromCity} ← {r.toCity}</td>
                  <td className="px-3 py-2 tabular-nums text-end">{r.trucks}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.truckType || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-end font-bold text-[#f37121]">{money(r.sellPrice)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.paymentSubtype ? ((PAYMENT_SUBTYPES as any)[r.paymentSubtype]?.[ar ? 'ar' : 'en'] || r.paymentSubtype) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.branch || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{when(r.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {tab === 'pending' ? (
                        <>
                          <button type="button" disabled={busy === r._id} onClick={() => approve(r)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
                            {busy === r._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{t('اعتماد', 'Approve')}
                          </button>
                          <button type="button" onClick={() => setDeciding({ r, kind: 'return' })} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2.5 py-1.5 text-[12px] font-semibold text-orange-700 hover:bg-orange-50"><Undo2 className="h-3.5 w-3.5" />{t('إعادة للتعديل', 'Return')}</button>
                          <button type="button" onClick={() => setDeciding({ r, kind: 'decline' })} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50"><XCircle className="h-3.5 w-3.5" />{t('رفض', 'Reject')}</button>
                        </>
                      ) : (
                        <span className="text-slate-600">{r.approvalByName || '—'}{r.approvalReason ? ` — ${r.approvalReason}` : ''}</span>
                      )}
                      <button type="button" onClick={() => setHistory(r)} className="ms-1 text-slate-400 hover:text-slate-800" title={t('السجلّ', 'History')}><History className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deciding && <DecideModal r={deciding.r} kind={deciding.kind} ar={ar} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); load(); }} />}
      {delegatesOpen && <DelegatesModal ar={ar} onClose={() => setDelegatesOpen(false)} />}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t(`سجلّ الطلب رقم ${history.number}`, `Request ${history.number} history`)}>
          <ol className="space-y-2">
            {[...history.log].reverse().map((l) => (
              <li key={l._id} className="text-[13px]">
                <span className="font-semibold">{(LOG_LABEL[l.action] || { ar: l.action, en: l.action })[ar ? 'ar' : 'en']}</span>{l.reason ? ` — ${l.reason}` : ''}
                {l.note && <span className="text-slate-600"> · {l.note}</span>}
                <span className="block text-[11px] text-slate-400">{l.byName} · {when(l.at)}</span>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </div>
  );
}

function DecideModal({ r, kind, ar, onClose, onDone }: { r: ShipmentRequest; kind: 'return' | 'decline'; ar: boolean; onClose: () => void; onDone: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { notify(kind === 'return' ? t('اكتب ما يجب تعديله', 'Write what to change') : t('اكتب سبب الرفض', 'Write the reason'), 'error'); return; }
    setSaving(true);
    try { await api.post(`/api/shipment-requests/${r._id}/${kind}`, { reason: reason.trim() }); notify(kind === 'return' ? t('أُعيد الطلب إلى المندوب', 'Returned to the rep') : t('رُفض الطلب', 'Rejected'), 'success'); onDone(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setSaving(false);
  };
  return (
    <Modal open onClose={onClose} title={kind === 'return' ? t(`إعادة الطلب رقم ${r.number} للتعديل`, `Return request ${r.number}`) : t(`رفض الطلب رقم ${r.number}`, `Reject request ${r.number}`)}
      footer={<button type="button" onClick={submit} disabled={saving} className={`ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 ${kind === 'return' ? 'bg-orange-600' : 'bg-red-600'}`}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}{kind === 'return' ? t('إعادة للتعديل', 'Return') : t('رفض الطلب', 'Reject')}</button>}>
      <label className="block text-sm font-semibold text-slate-800 mb-1.5">{kind === 'return' ? t('ما المطلوب تعديله؟', 'What should change?') : t('سبب الرفض', 'Reason')} *</label>
      <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
        placeholder={kind === 'return' ? t('مثلًا: سعر البيع أقلّ من سعر السوق', 'e.g. selling price below market') : ''} />
    </Modal>
  );
}

function DelegatesModal({ ar, onClose }: { ar: boolean; onClose: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [opts, setOpts] = useState<Opt[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.get<{ approvers: string[]; options: Opt[] }>('/api/shipment-requests/approvers')
      .then((d) => { setOpts(d.options || []); setPicked(new Set(d.approvers || [])); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const save = async () => {
    setSaving(true);
    try { await api.put('/api/shipment-requests/approvers', { approvers: [...picked] }); notify(t('حُفظ المفوَّضون', 'Saved'), 'success'); onClose(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setSaving(false);
  };
  const shown = opts.filter((o) => !q.trim() || o.label.includes(q.trim()));
  return (
    <Modal open onClose={onClose} title={t('المفوَّضون باعتماد طلبات الشحن', 'Delegated approvers')}
      footer={<button type="button" onClick={save} disabled={saving} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('حفظ', 'Save')}</button>}>
      <p className="mb-2 text-[12.5px] text-slate-500">{t('مَن تختاره من فريق المبيعات يعتمد الطلبات معك. لا يعتمد العضوُ طلبَه بنفسه.', 'Members picked here approve with you; no one approves his own request.')}</p>
      <SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالاسم…', 'Search by name…')} />
      {loading ? <Spinner /> : (
        <ul className="mt-2 max-h-[50vh] overflow-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
          {shown.map((o) => (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" className="accent-[#f37121]" checked={picked.has(o.value)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(o.value); else n.delete(o.value); return n; })} />
                <span className="font-semibold">{o.label}</span><span className="text-[11.5px] text-slate-500">{o.roleAr}</span>
              </label>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-4 text-center text-sm text-slate-500">{t('لا أعضاء', 'No members')}</li>}
        </ul>
      )}
    </Modal>
  );
}
