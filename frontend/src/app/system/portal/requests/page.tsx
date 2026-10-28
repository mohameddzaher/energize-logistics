'use client';
/**
 * Portal — the customer's requests to us: a subject, one or more points (each can
 * refer to an invoice, a shipment or a date), and the conversation with our team.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Plus, Trash2, Send, Loader2, ArrowLeft, MessagesSquare } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';

type Item = { text: string; refType: '' | 'invoice' | 'shipment' | 'date' | 'other'; ref: string };
type Opt = { value: string; label: string };
interface Req {
  _id: string; number: number; subject: string; status: 'open' | 'answered' | 'closed';
  lastActivityAt: string; createdAt: string; unread?: boolean; items: any; messages: any;
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const blank = (): Item => ({ text: '', refType: '', ref: '' });

export default function PortalRequestsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);
  const { notify } = useDialog();

  const [list, setList] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'new' | 'view'>('list');
  const [open, setOpen] = useState<any>(null);
  const [opts, setOpts] = useState<{ invoices: Opt[]; shipments: Opt[] }>({ invoices: [], shipments: [] });
  const [subject, setSubject] = useState('');
  const [items, setItems] = useState<Item[]>([blank()]);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get<{ items: Req[] }>('/api/portal/requests'); setList(r.items || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  const loadOne = useCallback(async (id: string) => {
    try { const r = await api.get<{ request: any }>(`/api/portal/requests/${id}`); setOpen(r.request); } catch (e: any) { notify(e?.message, 'error'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('customer-requests:mine', useCallback(() => { load(); if (open?._id) loadOne(open._id); }, [load, loadOne, open?._id]));
  useEffect(() => {
    if (mode !== 'new' || opts.invoices.length || opts.shipments.length) return;
    api.get<{ invoices: Opt[]; shipments: Opt[] }>('/api/portal/requests/options').then(setOpts).catch(() => {});
  }, [mode, opts.invoices.length, opts.shipments.length]);

  const STATUS: Record<string, [string, string, string]> = {
    open: [tx('Sent', 'مُرسل'), 'bg-blue-50 text-blue-700', ''],
    answered: [tx('Replied', 'تم الرد'), 'bg-emerald-50 text-emerald-700', ''],
    closed: [tx('Closed', 'مغلق'), 'bg-slate-100 text-slate-600', ''],
  };
  const REF: Record<string, string> = { invoice: tx('Invoice', 'فاتورة'), shipment: tx('Shipment', 'شحنة'), date: tx('Date', 'تاريخ'), other: tx('Reference', 'مرجع') };

  const setItem = (i: number, patch: Partial<Item>) => setItems((p) => p.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const submit = async () => {
    if (!subject.trim()) { notify(tx('Write a subject', 'اكتب الموضوع'), 'error'); return; }
    const pts = items.filter((x) => x.text.trim() || x.ref.trim());
    if (!pts.length && !note.trim()) { notify(tx('Write at least one point', 'اكتب نقطة واحدة على الأقل'), 'error'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ request: any }>('/api/portal/requests', { subject, items: pts, message: note });
      notify(tx('Your request was sent', 'أُرسل طلبك'), 'success');
      setSubject(''); setItems([blank()]); setNote('');
      await load();
      setOpen(r.request); setMode('view');
    } catch (e: any) { notify(e?.message || tx('Could not send', 'تعذّر الإرسال'), 'error'); }
    setBusy(false);
  };
  const sendReply = async () => {
    if (!reply.trim() || !open) return;
    setBusy(true);
    try { await api.post(`/api/portal/requests/${open._id}/reply`, { text: reply }); setReply(''); await loadOne(open._id); load(); }
    catch (e: any) { notify(e?.message, 'error'); }
    setBusy(false);
  };

  const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#f37121] focus:outline-none';
  const refOptions = (t: string) => (t === 'invoice' ? opts.invoices : t === 'shipment' ? opts.shipments : []);
  const unread = useMemo(() => list.filter((x) => x.unread).length, [list]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><MessagesSquare className="h-6 w-6 text-[#f37121]" />{tx('My requests', 'طلباتي')}</h1>
          <p className="mt-1 text-sm text-slate-500">{tx('Ask us anything about your shipments and invoices — we reply here and by email.', 'اطلب منّا أيّ شيء بخصوص شحناتك وفواتيرك — نردّ هنا وبالبريد.')}</p>
        </div>
        {mode === 'list' ? (
          <button type="button" onClick={() => setMode('new')} className="inline-flex items-center gap-2 rounded-lg bg-[#f37121] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e06010]">
            <MessageSquarePlus className="h-4 w-4" />{tx('New request', 'طلب جديد')}
          </button>
        ) : (
          <button type="button" onClick={() => { setMode('list'); setOpen(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{tx('All requests', 'كل الطلبات')}
          </button>
        )}
      </div>

      {mode === 'list' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? <p className="p-8 text-center text-slate-400">{tx('Loading…', 'جارٍ التحميل…')}</p>
            : !list.length ? (
              <div className="p-10 text-center">
                <MessagesSquare className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-2 font-semibold text-slate-700">{tx('No requests yet', 'لا توجد طلبات بعد')}</p>
                <button type="button" onClick={() => setMode('new')} className="mt-3 text-sm font-semibold text-[#f37121] hover:underline">{tx('Send your first request', 'أرسل أول طلب')}</button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {unread > 0 && <li className="bg-orange-50 px-5 py-2 text-[12.5px] font-semibold text-[#c2410c]">{tx(`${unread} new replies`, `${unread} ردود جديدة`)}</li>}
                {list.map((r) => (
                  <li key={r._id}>
                    <button type="button" onClick={() => { setMode('view'); loadOne(r._id); }} className="flex w-full items-center gap-4 px-5 py-4 text-start hover:bg-slate-50">
                      <span className="w-16 shrink-0 font-bold text-[#12325c]">#{r.number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{r.subject}{r.unread && <span className="ms-2 inline-block h-2 w-2 rounded-full bg-[#f37121]" />}</span>
                        <span className="block text-[12px] text-slate-500">{fmt(r.lastActivityAt)} · {r.items} {tx('points', 'نقاط')}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {mode === 'new' && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('Subject', 'الموضوع')} *</label>
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={tx('e.g. Delivery documents for last week', 'مثال: مستندات تسليم الأسبوع الماضي')} />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-600">{tx('Points', 'النقاط')}</p>
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-500">{tx('Point', 'نقطة')} {i + 1}</span>
                  {items.length > 1 && <button type="button" onClick={() => setItems((p) => p.filter((_, k) => k !== i))} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </div>
                <textarea rows={2} className={input} value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} placeholder={tx('What do you need?', 'ماذا تحتاج؟')} />
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
                  <select className={input} value={it.refType} onChange={(e) => setItem(i, { refType: e.target.value as Item['refType'], ref: '' })}>
                    <option value="">{tx('No reference', 'بدون مرجع')}</option>
                    <option value="invoice">{tx('An invoice', 'فاتورة')}</option>
                    <option value="shipment">{tx('A shipment', 'شحنة')}</option>
                    <option value="date">{tx('A date', 'تاريخ')}</option>
                    <option value="other">{tx('Other reference', 'مرجع آخر')}</option>
                  </select>
                  {it.refType === 'date' ? <input type="date" className={`${input} [color-scheme:light]`} value={it.ref} onChange={(e) => setItem(i, { ref: e.target.value })} />
                    : it.refType === 'invoice' || it.refType === 'shipment' ? (
                      <>
                        <input className={input} list={`ref-${i}`} value={it.ref} onChange={(e) => setItem(i, { ref: e.target.value })}
                          placeholder={it.refType === 'invoice' ? tx('Invoice number', 'رقم الفاتورة') : tx('Shipment number', 'رقم الشحنة')} />
                        <datalist id={`ref-${i}`}>{refOptions(it.refType).slice(0, 400).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
                      </>
                    ) : it.refType === 'other' ? <input className={input} value={it.ref} onChange={(e) => setItem(i, { ref: e.target.value })} placeholder={tx('Reference', 'المرجع')} /> : <div />}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setItems((p) => [...p, blank()])} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
              <Plus className="h-4 w-4" />{tx('Add a point', 'أضف نقطة')}
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('Message (optional)', 'رسالة (اختياري)')}</label>
            <textarea rows={3} className={input} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#f37121] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#e06010] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}{tx('Send request', 'إرسال الطلب')}
          </button>
        </div>
      )}

      {mode === 'view' && open && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[12px] text-slate-500">#{open.number} · {fmt(open.createdAt)}</p>
                <h2 className="text-lg font-bold text-slate-900">{open.subject}</h2>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${STATUS[open.status]?.[1]}`}>{STATUS[open.status]?.[0]}</span>
            </div>
            {!!open.items?.length && (
              <ol className="mt-3 space-y-2">
                {open.items.map((it: any, i: number) => (
                  <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    <span className="font-bold text-slate-500">{i + 1}.</span> {it.text}
                    {it.ref && <span className="ms-2 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[#12325c] ring-1 ring-slate-200">{REF[it.refType] || ''}: {it.ref}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="space-y-3">
            {(open.messages || []).map((m: any) => (
              <div key={m._id} className={`flex ${m.side === 'customer' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${m.side === 'customer' ? 'bg-white ring-1 ring-slate-200' : 'bg-[#12325c] text-white'}`}>
                  <p className={`mb-1 text-[11.5px] font-semibold ${m.side === 'customer' ? 'text-slate-500' : 'text-white/70'}`}>{m.byName} · {fmt(m.at)}</p>
                  <p className="whitespace-pre-wrap" dir="auto">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
          {open.status !== 'closed' && (
            <div className="flex gap-2">
              <textarea rows={2} className={input} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tx('Write a message…', 'اكتب رسالة…')} />
              <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} className="shrink-0 rounded-lg bg-[#f37121] px-4 text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
