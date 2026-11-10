'use client';
/**
 * Follow-up email to the customer from inside a clearance transaction, sent from the customs mailbox.
 * The draft (addresses from the customer's customs file, subject and body from the section template, filled with the
 * transaction's stages) is built on the server (customsMailController); the employee edits and sends. Optionally about one container.
 */
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Modal } from '@/components/hr/HRKit';
import { EmailList } from '@/components/collections/SendStatementModal';
import { Loader2, Send, Mail, AlertTriangle } from 'lucide-react';

interface Sent { at: string; byName?: string; to: string[]; subject?: string; unit?: string }
interface Draft {
  mailbox: string; customerName: string; to: string[]; subject: string; body: string;
  signature?: string; signatureImage?: string; cc?: string[]; companySignature?: string; units: { index: number; number: string }[]; sent: Sent[];
}

export default function SendFollowUpEmail({ clearanceId, ar, onClose, onSent }: {
  clearanceId: string; ar: boolean; onClose: () => void; onSent?: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [unit, setUnit] = useState('');
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Picking a container rebuilds subject and body for it; addresses typed by hand are kept.
  useEffect(() => {
    let live = true;
    setErr('');
    api.get<Draft>(`/api/customs-clearance/${clearanceId}/email-draft${unit ? `?unit=${unit}` : ''}`)
      .then((x) => {
        if (!live) return;
        setD(x); setSubject(x.subject); setBody(x.body);
        setTo((prev) => (prev.length ? prev : x.to || []));
        setCc((prev) => (prev.length ? prev : x.cc || []));
      })
      .catch((e) => { if (live) setErr(e?.message || t('تعذّر إعداد الرسالة', 'Could not prepare the message')); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearanceId, unit]);

  const send = async () => {
    if (!to.length) { notify(t('أضف بريد العميل في «إلى»', 'Add the customer email in «To»'), 'error'); return; }
    setSending(true);
    try {
      const r = await api.post<{ to: string[]; savedToSent: boolean }>(`/api/customs-clearance/${clearanceId}/email`, { to, cc, subject, body, unit: unit === '' ? null : Number(unit) });
      notify(t(`أُرسلت الرسالة إلى ${r.to.join('، ')}${r.savedToSent ? ' — ونسختُها في «المرسل»' : ''}`, `Sent to ${r.to.join(', ')}`), 'success');
      onSent?.();
      onClose();
    } catch (e: any) { notify(e?.message || t('تعذّر الإرسال', 'Send failed'), 'error'); }
    setSending(false);
  };

  return (
    <Modal open onClose={onClose} wide title={t('إرسال بريد متابعة إلى العميل', 'Email a follow-up to the customer')}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <button type="button" onClick={send} disabled={!d || sending || !to.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white hover:bg-[#e06010] disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}{t('إرسال الآن', 'Send now')}
        </button>
      </>}>
      {err ? <p className="py-6 text-center text-sm text-red-600">{err}</p> : !d ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{t('جارٍ إعداد الرسالة…', 'Preparing…')}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <Mail className="h-4 w-4 text-[#f37121]" />
            <span>{t('من', 'From')}: <b dir="ltr">{d.mailbox}</b></span>
            <span>· {t('العميل', 'Customer')}: <b>{d.customerName || '—'}</b></span>
          </div>
          {d.units.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('موضوع المتابعة', 'Follow-up about')}</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">{t('المعاملة كاملة — كلّ الحاويات', 'Whole transaction — all containers')}</option>
                {d.units.map((u) => <option key={u.index} value={String(u.index)}>{t('حاوية', 'Container')} {u.number}</option>)}
              </select>
            </label>
          )}
          {!d.to.length && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <AlertTriangle className="h-4 w-4" />{t('لا بريد لهذا العميل في أيٍّ من سجلّات العملاء — أضفه هنا، ويُفضَّل في ملفّ العميل ليُستخدَم دائمًا.', 'No email for this customer in any register — add it here, and ideally on the customer file.')}
            </p>
          )}
          <EmailList label={t('إلى — يمكن أكثر من بريد', 'To — more than one allowed')} value={to} onChange={setTo} ar={ar} />
          <EmailList label={t('نسخة CC — اختياري', 'Cc — optional')} value={cc} onChange={setCc} ar={ar} />
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('الموضوع', 'Subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('نصّ الرسالة', 'Message')}</span>
            <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-7" />
          </label>
          {d.companySignature && (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2">
              <p className="mb-1 text-[11.5px] font-semibold text-slate-500">{t('توقيع الشركة — يُضاف في آخر الرسالة مع الشعار', 'Company signature — appended with the logo')}</p>
              <p className="whitespace-pre-wrap text-[12.5px] text-slate-600" dir="ltr">{d.companySignature}</p>
            </div>
          )}
          {(d.signature || d.signatureImage) && (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2">
              <p className="mb-1 text-[11.5px] font-semibold text-slate-500">{t('التوقيع (من إعدادات القسم) — يُضاف في آخر الرسالة', 'Signature (from settings) — appended')}</p>
              {d.signature && <p className="whitespace-pre-wrap text-[13px] text-slate-700" dir="auto">{d.signature}</p>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.signatureImage && <img src={d.signatureImage} alt="" className="mt-1 max-h-16 max-w-[220px]" />}
            </div>
          )}
          {d.sent.length > 0 && (
            <div className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="mb-1 text-[12px] font-semibold text-slate-600">{t('آخر ما أُرسل من هذه المعاملة', 'Recently sent from this transaction')}</p>
              {d.sent.map((s, i) => (
                <p key={i} className="text-[12px] text-slate-600">
                  {new Date(s.at).toLocaleString('en-GB')} · {s.byName || ''} → <span dir="ltr">{(s.to || []).join(', ')}</span>{s.unit ? ` · ${t('حاوية', 'container')} ${s.unit}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
