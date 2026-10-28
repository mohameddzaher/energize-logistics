'use client';
/**
 * Operations — «التواصل مع العملاء»: requests sent from the customer portal.
 * Reply inside the system (the customer sees it in the portal) or by email from
 * a company mailbox (To/CC to several people, any subject, Arabic or English).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagesSquare, Mail, Send, Loader2, X, Lock, Unlock, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';

const fmt = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const REF_AR: Record<string, string> = { invoice: 'فاتورة', shipment: 'شحنة', date: 'تاريخ', other: 'مرجع' };

export default function CustomerRequestsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);
  const { notify } = useDialog();

  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: any[]; counts: Record<string, number> }>('/api/customer-requests');
      setItems(r.items || []); setCounts(r.counts || {});
    } catch (e: any) { notify(e?.message, 'error'); }
  }, [notify]);
  const loadOne = useCallback(async (id: string) => {
    try { const r = await api.get<{ request: any }>(`/api/customer-requests/${id}`); setSel(r.request); } catch (e: any) { notify(e?.message, 'error'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('customer-requests:changed', useCallback(() => { load(); if (sel?._id) loadOne(sel._id); }, [load, loadOne, sel?._id]));

  const shown = useMemo(() => items.filter((r) => (!status || r.status === status)
    && (!q.trim() || `${r.number} ${r.subject} ${r.customerName} ${r.accountName} ${r.accountEmail}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, status, q]);

  const STATUS: Record<string, [string, string]> = {
    open: [tx('New / awaiting reply', 'جديد / بانتظار الرد'), 'bg-amber-50 text-amber-700'],
    answered: [tx('Replied', 'تم الرد'), 'bg-emerald-50 text-emerald-700'],
    closed: [tx('Closed', 'مغلق'), 'bg-slate-100 text-slate-600'],
  };

  const sendReply = async () => {
    if (!reply.trim() || !sel) return;
    setBusy(true);
    try { const r = await api.post<{ request: any }>(`/api/customer-requests/${sel._id}/reply`, { text: reply }); setSel(r.request); setReply(''); load(); notify(tx('Reply sent to the portal', 'أُرسل الرد في البوابة'), 'success'); }
    catch (e: any) { notify(e?.message, 'error'); }
    setBusy(false);
  };
  const setSt = async (st: string) => {
    if (!sel) return;
    try { const r = await api.patch<{ request: any }>(`/api/customer-requests/${sel._id}/status`, { status: st }); setSel(r.request); load(); }
    catch (e: any) { notify(e?.message, 'error'); }
  };

  return (
    <div className="space-y-5" dir={ar ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><MessagesSquare className="h-6 w-6 text-[#f37121]" />{tx('Customer communication', 'التواصل مع العملاء')}</h1>
        <p className="mt-1 text-sm text-slate-500">{tx('Requests sent by customers from their portal', 'الطلبات التي يرسلها العملاء من بوابتهم')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[['', tx('All', 'الكل'), items.length], ['open', STATUS.open[0], counts.open || 0], ['answered', STATUS.answered[0], counts.answered || 0], ['closed', STATUS.closed[0], counts.closed || 0]].map(([k, l, n]) => (
          <button key={String(k)} type="button" onClick={() => setStatus(String(k))}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${status === k ? 'bg-[#12325c] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{l} ({n})</button>
        ))}
        <div className="relative ms-auto min-w-[220px]">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search…', 'ابحث بالعميل أو الموضوع أو الرقم…')}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pe-3 ps-9 text-sm focus:border-[#f37121] focus:outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!shown.length && <li className="p-8 text-center text-slate-400">{tx('No requests', 'لا توجد طلبات')}</li>}
          {shown.map((r) => (
            <li key={r._id}>
              <button type="button" onClick={() => loadOne(r._id)} className={`w-full px-4 py-3 text-start hover:bg-slate-50 ${sel?._id === r._id ? 'bg-orange-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#12325c]">#{r.number}{r.unreadStaff && <span className="ms-2 inline-block h-2 w-2 rounded-full bg-[#f37121]" />}</span>
                  <span className="text-[11px] text-slate-400">{fmt(r.lastActivityAt)}</span>
                </div>
                <p className="truncate font-semibold text-slate-900">{r.subject}</p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] text-slate-500">{r.customerName || r.accountName}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0]}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-h-[300px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {!sel ? <p className="py-20 text-center text-slate-400">{tx('Pick a request', 'اختر طلبًا')}</p> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] text-slate-500">#{sel.number} · {fmt(sel.createdAt)}</p>
                  <h2 className="text-lg font-bold text-slate-900">{sel.subject}</h2>
                  <p className="text-sm text-slate-600">{sel.customerName} · {sel.accountName} · <span dir="ltr">{sel.accountEmail}</span></p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEmailOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#12325c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b1f3a]">
                    <Mail className="h-4 w-4" />{tx('Reply by email', 'الرد بالإيميل')}
                  </button>
                  {sel.status !== 'closed'
                    ? <button type="button" onClick={() => setSt('closed')} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"><Lock className="h-4 w-4" />{tx('Close', 'إغلاق')}</button>
                    : <button type="button" onClick={() => setSt('open')} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"><Unlock className="h-4 w-4" />{tx('Reopen', 'إعادة فتح')}</button>}
                </div>
              </div>
              {!!sel.items?.length && (
                <ol className="space-y-2">
                  {sel.items.map((it: any, i: number) => (
                    <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
                      <span className="font-bold text-slate-500">{i + 1}.</span> <span dir="auto">{it.text}</span>
                      {it.ref && <span className="ms-2 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[#12325c] ring-1 ring-slate-200">{ar ? REF_AR[it.refType] || 'مرجع' : it.refType}: {it.ref}</span>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="space-y-3">
                {(sel.messages || []).map((m: any) => (
                  <div key={m._id} className={`flex ${m.side === 'staff' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.side === 'staff' ? 'bg-[#12325c] text-white' : 'bg-slate-50 ring-1 ring-slate-200'}`}>
                      <p className={`mb-1 text-[11.5px] font-semibold ${m.side === 'staff' ? 'text-white/70' : 'text-slate-500'}`}>
                        {m.byName} · {fmt(m.at)}{m.via === 'email' ? ` · ${tx('by email', 'بالإيميل')}` : ''}
                      </p>
                      {m.via === 'email' && (
                        <p className="mb-1 text-[11px] text-white/60" dir="ltr">{m.email?.from} → {(m.email?.to || []).join(', ')}{m.email?.cc?.length ? ` · cc ${m.email.cc.join(', ')}` : ''} · {m.email?.subject}</p>
                      )}
                      <p className="whitespace-pre-wrap" dir="auto">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 border-t border-slate-100 pt-4">
                <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tx('Reply inside the portal…', 'رد داخل البوابة…')} dir="auto"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-[#f37121] focus:outline-none" />
                <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} className="shrink-0 rounded-lg bg-[#f37121] px-4 text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {emailOpen && sel && <EmailModal req={sel} ar={ar} onClose={() => setEmailOpen(false)} onSent={(r) => { setSel(r); setEmailOpen(false); load(); }} />}
    </div>
  );
}

function EmailModal({ req, ar, onClose, onSent }: { req: any; ar: boolean; onClose: () => void; onSent: (r: any) => void }) {
  const tx = (en: string, a: string) => (ar ? a : en);
  const { notify } = useDialog();
  const [boxes, setBoxes] = useState<{ email: string; name: string }[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(req.accountEmail || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(`Re: ${req.subject} (#${req.number})`);
  const [mailLang, setMailLang] = useState<'en' | 'ar'>('en');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ mailboxes: { email: string; name: string }[]; preferred: string }>('/api/customer-requests/mailboxes')
      .then((r) => { setBoxes(r.mailboxes || []); setFrom(r.preferred && r.mailboxes.some((m) => m.email === r.preferred) ? r.preferred : (r.mailboxes[0]?.email || '')); })
      .catch(() => {});
  }, []);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ request: any; savedToSent: boolean }>(`/api/customer-requests/${req._id}/email`, { from, to, cc, subject, text, lang: mailLang });
      notify(tx('Email sent', 'أُرسل الإيميل') + (r.savedToSent ? '' : tx(' (not copied to Sent)', ' (لم يُنسخ في المرسل)')), 'success');
      onSent(r.request);
    } catch (e: any) { notify(e?.message || tx('Could not send', 'تعذّر الإرسال'), 'error'); }
    setBusy(false);
  };
  const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#f37121] focus:outline-none';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Mail className="h-5 w-5 text-[#f37121]" />{tx('Reply by email', 'الرد بالإيميل')} · #{req.number}</h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('From', 'من صندوق')}</label>
            {boxes.length ? (
              <select className={input} value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr">
                {boxes.map((b) => <option key={b.email} value={b.email}>{b.email}{b.name ? ` — ${b.name}` : ''}</option>)}
              </select>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{tx('No company mailbox has a stored password. Add one in IT → Company emails.', 'لا يوجد صندوق بريد محفوظةٌ كلمةُ مروره. أضفها من «تقنية المعلومات ← إيميلات الشركة».')}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('To (separate with commas)', 'إلى (افصل بفاصلة)')}</label>
            <input className={input} dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('CC (optional, separate with commas)', 'نسخة CC (اختياري، افصل بفاصلة)')}</label>
            <input className={input} dir="ltr" value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('Subject', 'الموضوع')}</label>
            <input className={input} dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold text-slate-600">{tx('Email language', 'لغة الرسالة')}</span>
            {(['en', 'ar'] as const).map((l) => (
              <button key={l} type="button" onClick={() => setMailLang(l)} className={`rounded-full px-3 py-1 text-xs font-semibold ${mailLang === l ? 'bg-[#12325c] text-white' : 'bg-slate-100 text-slate-600'}`}>{l === 'en' ? 'English' : 'العربية'}</button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{tx('Message', 'الرسالة')}</label>
            <textarea rows={8} className={input} dir={mailLang === 'ar' ? 'rtl' : 'ltr'} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="mt-1 text-[11.5px] text-slate-400">{tx('The customer’s request is quoted under your reply automatically.', 'طلبُ العميل يُضاف تحت ردّك تلقائيًّا.')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">{tx('Cancel', 'إلغاء')}</button>
            <button type="button" onClick={send} disabled={busy || !from || !to.trim() || !subject.trim() || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}{tx('Send', 'إرسال')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
