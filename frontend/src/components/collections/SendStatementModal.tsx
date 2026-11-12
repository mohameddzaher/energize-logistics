'use client';
/** Send to customer: the account statement by email from the collections mailbox. It takes the page filter as is (customer, invoice, state, period, columns, selection), the same one that prints the statement PDF, so the employee sees before sending the message filled from the department template, the customer's email from their profile and the attached PDF. They edit then send, and it leaves from collections@ immediately. All computation is on the server (collectionsMailController). */
import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import EmailAttachments from '@/components/system/EmailAttachments';
import type { UploadFile } from '@/lib/uploadFiles';
import { useDialog } from '@/components/system/DialogProvider';
import { Modal } from '@/components/hr/HRKit';
import { Loader2, Send, X, Plus, FileText, Mail, AlertTriangle } from 'lucide-react';

interface Draft {
  mailbox: string; partyName: string; partyId: string | null; partyCode: string;
  to: string[]; subject: string; body: string; signature?: string; signatureImage?: string; cc?: string[]; companySignature?: string; rows: number; openCount: number; openValue: number; multipleCustomers: boolean;
}
const RX = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

/** URLSearchParams from an object, keeping repeated keys as lists (cf_x=a&cf_x=b). */
function paramsToObject(p: URLSearchParams) {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(p.keys())) {
    const all = p.getAll(k);
    out[k] = all.length > 1 ? all : all[0];
  }
  return out;
}

export function EmailList({ label, value, onChange, ar }: { label: string; value: string[]; onChange: (v: string[]) => void; ar: boolean }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(/[\s,;،]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const okOnes = parts.filter((x) => RX.test(x) && !value.includes(x));
    if (okOnes.length) onChange([...value, ...okOnes]);
    setDraft(parts.filter((x) => !RX.test(x)).join(' '));
  };
  return (
    <div>
      <p className="mb-1 text-[12.5px] font-semibold text-slate-700">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
        {value.map((e) => (
          <span key={e} dir="ltr" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[12.5px] text-slate-800">
            {e}<button type="button" onClick={() => onChange(value.filter((x) => x !== e))} className="text-slate-400 hover:text-red-600"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} dir="ltr"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); add(); } }}
          onBlur={add} placeholder={ar ? 'أضف بريدًا…' : 'Add an email…'}
          className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-[13px] outline-none" />
        {draft.trim() && <button type="button" onClick={add} className="text-[#f37121]"><Plus className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

export default function SendStatementModal({ kind, params, ar, onClose }: {
  kind: 'cash' | 'tax'; params: URLSearchParams; ar: boolean; onClose: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const qs = useMemo(() => params.toString(), [params]);
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [excel, setExcel] = useState(true);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);

  useEffect(() => {
    let live = true;
    api.get<Draft>(`/api/collections-dept/invoices/${kind}/send-draft?${qs}`)
      .then((x) => { if (!live) return; setD(x); setTo(x.to || []); setCc(x.cc || []); setSubject(x.subject); setBody(x.body); })
      .catch((e) => { if (live) setErr(e?.message || t('تعذّر إعداد الرسالة', 'Could not prepare the message')); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, qs]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const preview = async () => {
    if (pdfUrl || pdfBusy) return;
    setPdfBusy(true);
    try { const b = await api.getBlob(`/api/collections-dept/invoices/${kind}/statement?${qs}`); setPdfUrl(URL.createObjectURL(b)); }
    catch (e: any) { notify(e?.message || t('تعذّر إعداد الكشف', 'Could not build the statement'), 'error'); }
    setPdfBusy(false);
  };

  const send = async () => {
    if (!to.length) { notify(t('أضف بريد العميل في «إلى»', 'Add the customer email in «To»'), 'error'); return; }
    setSending(true);
    try {
      const r = await api.post<{ to: string[]; savedToSent: boolean; partyLogged: boolean }>(`/api/collections-dept/invoices/${kind}/send`, {
        query: paramsToObject(params), to, cc, subject, body, attachExcel: excel, lang: ar ? 'ar' : 'en', attachments: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName })),
      });
      notify(t(`أُرسلت الرسالة إلى ${r.to.join('، ')}${r.savedToSent ? ' — ونسختُها في «المرسل»' : ''}`, `Sent to ${r.to.join(', ')}`), 'success');
      onClose();
    } catch (e: any) { notify(e?.message || t('تعذّر الإرسال', 'Send failed'), 'error'); }
    setSending(false);
  };

  return (
    <Modal open onClose={onClose} wide title={t('إرسال كشف الحساب إلى العميل', 'Email the statement to the customer')}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <button type="button" onClick={send} disabled={!d || sending || !to.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white hover:bg-[#e06010] disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}{t('إرسال الآن', 'Send now')}
        </button>
      </>}>
      {err ? <p className="py-6 text-center text-sm text-red-600">{err}</p> : !d ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{t('جارٍ إعداد الرسالة والكشف…', 'Preparing…')}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <Mail className="h-4 w-4 text-[#f37121]" />
            <span>{t('من', 'From')}: <b dir="ltr">{d.mailbox}</b></span>
            <span>· {t('العميل', 'Customer')}: <b>{d.partyName || t('عدّة عملاء', 'Several customers')}</b>{d.partyCode ? ` (${d.partyCode})` : ''}</span>
            <span>· {t(`${d.rows} فاتورة في الكشف، منها ${d.openCount} غير مسدّدة`, `${d.rows} invoices, ${d.openCount} unpaid`)}</span>
          </div>
          {d.multipleCustomers && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <AlertTriangle className="h-4 w-4" />{t('الفلتر يضمّ أكثر من عميل — فلتر على عميلٍ واحد ليصله كشفُه وحده.', 'The filter spans several customers — filter to one customer first.')}
            </p>
          )}
          {!d.to.length && d.partyName && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <AlertTriangle className="h-4 w-4" />{t('لا بريد لهذا العميل في ملفّه — أضفه هنا، ويُفضَّل في ملفّ العميل ليُستخدَم دائمًا.', 'No email on file — add it here, and ideally in the customer profile.')}
            </p>
          )}
          <EmailList label={t('إلى — يمكن أكثر من بريد', 'To — more than one allowed')} value={to} onChange={setTo} ar={ar} />
          <EmailList label={t('نسخة CC — يمكن أكثر من بريد (اختياري)', 'Cc — more than one allowed (optional)')} value={cc} onChange={setCc} ar={ar} />
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('الموضوع', 'Subject')}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('نصّ الرسالة', 'Message')}</span>
            <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-7" />
          </label>
          <EmailAttachments ar={ar} value={files} onChange={setFiles} />
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
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
            <span className="text-[12.5px] font-semibold text-slate-700">{t('المرفقات', 'Attachments')}:</span>
            <button type="button" onClick={preview} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-semibold text-slate-700 hover:text-[#f37121]">
              {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}{t('كشف الحساب PDF — معاينة', 'Statement PDF — preview')}
            </button>
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-700">
              <input type="checkbox" checked={excel} onChange={(e) => setExcel(e.target.checked)} />{t('وملف Excel بالفواتير', 'and an Excel file')}
            </label>
          </div>
          {pdfUrl && <iframe title="statement" src={pdfUrl} className="h-[60vh] w-full rounded-xl border border-slate-200" />}
        </div>
      )}
    </Modal>
  );
}
