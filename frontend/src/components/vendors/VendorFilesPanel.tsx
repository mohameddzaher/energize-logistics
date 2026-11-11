'use client';
/**
 * The carrier card's papers, official contract and approval. Every action writes through /api/vendors-mgmt and the
 * section's socket event refreshes the card and the dashboards, so the result shows in the analytics at once.
 */
import { useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Panel, fmtDay } from '@/components/analytics/AnalyticsKit';
import { Field, TextInput, TextArea, Modal } from '@/components/hr/HRKit';
import FilePicker, { type PickedFile, kb } from '@/components/system/FilePicker';
import { DOC_KINDS, APPROVAL, approvalLabel } from '@/lib/vendors';
import { FileText, Trash2, Loader2, Handshake, CheckCircle2, XCircle, Undo2, Send, AlertTriangle } from 'lucide-react';

type Row = Record<string, any>;
const toBody = (files: PickedFile[]) => files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title }));

function FileLine({ f, onRemove, ar }: { f: Row; onRemove?: () => void; ar: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px]">
      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <a href={f.fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:underline truncate">{f.title || f.fileName}</a>
      <span className="text-[11px] text-slate-400 shrink-0">{kb(f.size)} · {fmtDay(f.uploadedAt)}{f.uploadedByName ? ` · ${f.uploadedByName}` : ''}</span>
      {onRemove && <button type="button" onClick={onRemove} title={ar ? 'حذف' : 'Delete'} className="ms-auto p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
    </li>
  );
}

/** Approval state of the carrier with the approver's buttons, or the submitter's resubmit. */
export function ApprovalBlock({ d, editor, ar, onChanged }: { d: Row; editor: boolean; ar: boolean; onChanged: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const A = d.approval || {};
  const [ask, setAsk] = useState<'' | 'reject' | 'return' | 'resubmit'>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!A.status || (A.status === 'approved' && !A.log?.length)) return null;
  const id = d.vendor._id;
  const act = async (action: string, n = '') => {
    setBusy(true);
    try {
      if (action === 'resubmit') await api.post(`/api/vendors-mgmt/vendors/${id}/resubmit`, { note: n });
      else await api.post(`/api/vendors-mgmt/vendors/${id}/approval`, { action, note: n });
      notify(t('تمّ', 'Done'), 'success'); setAsk(''); setNote(''); onChanged();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy(false);
  };
  const cls = (APPROVAL[A.status] || APPROVAL.approved).cls;
  return (
    <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[12.5px] ${cls}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b>{approvalLabel(A.status, ar)}</b>
        {A.submittedByName && <span>{t('أضافه', 'Added by')} {A.submittedByName} · {fmtDay(A.submittedAt)}</span>}
        {A.status === 'approved' && A.approvedByName && <span>{t('اعتمده', 'Approved by')} {A.approvedByName} · {fmtDay(A.approvedAt)}</span>}
        {A.note && A.status !== 'approved' && <span className="font-semibold">— {A.note}</span>}
        <div className="ms-auto flex flex-wrap gap-1.5">
          {A.status === 'pending' && A.canApprove && <>
            <button type="button" disabled={busy} onClick={() => act('approve')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"><CheckCircle2 className="w-3.5 h-3.5" />{t('اعتماد', 'Approve')}</button>
            <button type="button" disabled={busy} onClick={() => setAsk('return')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 text-white font-semibold"><Undo2 className="w-3.5 h-3.5" />{t('إعادة للتعديل', 'Return')}</button>
            <button type="button" disabled={busy} onClick={() => setAsk('reject')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold"><XCircle className="w-3.5 h-3.5" />{t('رفض', 'Reject')}</button>
          </>}
          {['returned', 'rejected'].includes(A.status) && editor && <button type="button" disabled={busy} onClick={() => setAsk('resubmit')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold"><Send className="w-3.5 h-3.5" />{t('إعادة التقديم للاعتماد', 'Resubmit')}</button>}
        </div>
      </div>
      {!!A.log?.length && (
        <ol className="mt-1.5 space-y-0.5 text-[11.5px] opacity-90">
          {A.log.slice().reverse().map((l: Row, i: number) => (
            <li key={i}>{fmtDay(l.at)} · {l.byName} · {({ submit: t('قدّمه', 'submitted'), resubmit: t('أعاد تقديمه', 'resubmitted'), approve: t('اعتمده', 'approved'), reject: t('رفضه', 'rejected'), return: t('أعاده للتعديل', 'returned') } as Row)[l.action] || l.action}{l.note ? ` — ${l.note}` : ''}</li>
          ))}
        </ol>
      )}
      {ask && (
        <Modal open onClose={() => setAsk('')} title={ask === 'reject' ? t('رفض المورّد', 'Reject carrier') : ask === 'return' ? t('إعادة للتعديل', 'Return for edits') : t('إعادة التقديم', 'Resubmit')}
          footer={<button type="button" disabled={busy} onClick={() => act(ask, note)} className="ms-auto px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{t('تأكيد', 'Confirm')}</button>}>
          <Field label={ask === 'reject' ? t('سبب الرفض *', 'Reason *') : ask === 'return' ? t('المطلوب تعديله *', 'What to fix *') : t('ملاحظة (اختياري)', 'Note (optional)')}>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

export default function VendorFilesPanel({ d, editor, ar, onChanged }: { d: Row; editor: boolean; ar: boolean; onChanged: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const v = d.vendor;
  const C = d.contract || {};
  const docs: Row[] = v.documents || [];
  const [adding, setAdding] = useState<Record<string, PickedFile[]>>({});
  const [extraTitle, setExtraTitle] = useState('');
  const [busy, setBusy] = useState('');
  const [contract, setContract] = useState<{ contracted: boolean | null; end: string; files: PickedFile[] } | null>(null);

  const addDocs = async (kind: string) => {
    const files = adding[kind] || [];
    if (!files.length) return;
    if (kind === 'other' && !extraTitle.trim()) { notify(t('اكتب اسم المستند', 'Name the paper'), 'error'); return; }
    setBusy(kind);
    try {
      await api.post(`/api/vendors-mgmt/vendors/${v._id}/documents`, { documents: [{ kind, title: kind === 'other' ? extraTitle.trim() : undefined, files: toBody(files) }] });
      setAdding((a) => ({ ...a, [kind]: [] })); if (kind === 'other') setExtraTitle('');
      notify(t('رُفعت المستندات', 'Papers uploaded'), 'success'); onChanged();
    } catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy('');
  };
  const removeDoc = async (f: Row) => {
    if (!(await confirm({ title: t('حذف المستند', 'Delete paper'), message: f.title || f.fileName, tone: 'danger' }))) return;
    try { await api.delete(`/api/vendors-mgmt/vendors/${v._id}/documents/${f._id}`); onChanged(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };
  const removeContractFile = async (f: Row) => {
    if (!(await confirm({ title: t('حذف ملفّ العقد', 'Delete contract file'), message: f.title || f.fileName, tone: 'danger' }))) return;
    try { await api.delete(`/api/vendors-mgmt/vendors/${v._id}/contract-files/${f._id}`); onChanged(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };
  const saveContract = async () => {
    if (!contract) return;
    if (contract.contracted == null) { notify(t('حدِّد: تمّ التعاقد رسميًّا أم لا', 'Choose yes or no'), 'error'); return; }
    if (contract.files.some((f) => !f.title.trim())) { notify(t('اكتب اسمًا لكلّ ملفّ عقد', 'Name every contract file'), 'error'); return; }
    setBusy('contract');
    try {
      await api.put(`/api/vendors-mgmt/vendors/${v._id}/contract`, { contracted: contract.contracted, contractEndDate: contract.end || '', files: toBody(contract.files) });
      notify(t('حُفظ العقد', 'Contract saved'), 'success'); setContract(null); onChanged();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };
  const others = docs.filter((x) => x.kind === 'other');
  const stateCls = C.state === 'expired' ? 'text-red-600' : C.state === 'expiring' ? 'text-amber-700' : 'text-emerald-700';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Panel title={t('المستندات', 'Papers')} subtitle={d.missingDocs?.length ? <span className="text-amber-700 font-semibold">{t('ناقص: ', 'Missing: ')}{d.missingDocs.map((m: Row) => (ar ? m.label : m.labelEn)).join('، ')}</span> : t('المستندات المطلوبة مكتملة', 'Required papers complete')}>
        <div className="space-y-3">
          {[...DOC_KINDS.map((k) => ({ key: k.key, label: ar ? k.ar : k.en, list: docs.filter((x) => x.kind === k.key) })), { key: 'other', label: t('مستنداتٌ إضافية', 'Extra papers'), list: others }].map((g) => (
            <div key={g.key} className={`rounded-xl border p-3 ${g.key !== 'other' && !g.list.length && v.type !== 'freelancer' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
              <p className="text-[13px] font-bold text-slate-800 mb-1.5">{g.label} <span className="text-slate-400 font-normal">({g.list.length})</span></p>
              {!!g.list.length && <ul className="space-y-1 mb-2">{g.list.map((f: Row) => <FileLine key={f._id} f={f} ar={ar} onRemove={editor ? () => removeDoc(f) : undefined} />)}</ul>}
              {editor && (
                <div className="flex flex-wrap items-start gap-2">
                  {g.key === 'other' && <div className="w-full sm:w-60"><TextInput placeholder={t('اسم المستند', 'Paper name')} value={extraTitle} onChange={(e) => setExtraTitle(e.target.value)} /></div>}
                  <FilePicker files={adding[g.key] || []} onChange={(f) => setAdding((a) => ({ ...a, [g.key]: f }))} max={10} label={t('إضافة ملفّات', 'Add files')} />
                  {!!(adding[g.key] || []).length && <button type="button" disabled={busy === g.key} onClick={() => addDocs(g.key)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-bold">{busy === g.key && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t('رفع', 'Upload')}</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={t('التعاقد الرسميّ', 'Official contract')}
        actions={editor ? <button type="button" onClick={() => setContract({ contracted: C.marked ? !!C.contracted : null, end: C.endDate || '', files: [] })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[12.5px] font-semibold"><Handshake className="w-3.5 h-3.5" />{t('تحديث العقد', 'Update contract')}</button> : null}>
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-[11.5px] text-slate-500">{t('تمّ التعاقد معه رسميًّا', 'Officially contracted')}</dt><dd className={`font-bold ${C.contracted ? 'text-emerald-700' : 'text-slate-600'}`}>{C.contracted ? t('نعم', 'Yes') : t('لا', 'No')}{!C.marked && <span className="ms-1 text-[11px] font-normal text-slate-400">{t('(من حالة التعاقد المستوردة)', '(from imported status)')}</span>}</dd></div>
          <div><dt className="text-[11.5px] text-slate-500">{t('تاريخ نهاية العقد', 'Contract end')}</dt><dd className={`font-bold tabular-nums ${stateCls}`}>{C.endDate || '—'}{C.daysLeft != null && <span className="ms-1 text-[11.5px] font-semibold">{C.daysLeft < 0 ? t(`(انتهى منذ ${-C.daysLeft} يوم)`, `(ended ${-C.daysLeft}d ago)`) : t(`(باقي ${C.daysLeft} يوم)`, `(${C.daysLeft}d left)`)}</span>}</dd></div>
        </dl>
        {(C.state === 'expiring' || C.state === 'expired') && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-red-700"><AlertTriangle className="w-4 h-4" />{t(`يظهر في التنبيهات ويُشعَر به القسم (قبل النهاية بـ${C.alertDays} يومًا)`, `Flagged in alerts and notified (${C.alertDays} days ahead)`)}</p>}
        <p className="mt-3 text-[12px] font-semibold text-slate-600">{t('ملفّات العقد', 'Contract files')}</p>
        {(C.files || []).length ? <ul className="mt-1 space-y-1">{C.files.map((f: Row) => <FileLine key={f._id} f={f} ar={ar} onRemove={editor ? () => removeContractFile(f) : undefined} />)}</ul> : <p className="text-[12.5px] text-slate-400 mt-1">{t('لا ملفّات', 'No files')}</p>}
      </Panel>

      {contract && (
        <Modal open onClose={() => setContract(null)} title={t('العقد الرسميّ', 'Official contract')}
          footer={<button type="button" disabled={busy === 'contract'} onClick={saveContract} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{busy === 'contract' && <Loader2 className="w-4 h-4 animate-spin" />}{t('حفظ', 'Save')}</button>}>
          <Field label={t('تمّ التعاقد معه رسميًّا؟', 'Officially contracted?')}>
            <div className="flex gap-2">
              {([[true, 'نعم', 'Yes'], [false, 'لا', 'No']] as const).map(([val, a, e]) => (
                <button key={String(val)} type="button" onClick={() => setContract({ ...contract, contracted: val })} className={`px-4 py-2 rounded-lg border text-sm font-semibold ${contract.contracted === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'}`}>{ar ? a : e}</button>
              ))}
            </div>
          </Field>
          <Field label={t('تاريخ نهاية العقد (اختياري)', 'Contract end date (optional)')}><TextInput type="date" value={contract.end} onChange={(e) => setContract({ ...contract, end: e.target.value })} /></Field>
          <Field label={t('ملفّات العقد — اكتب اسم كلّ ملفّ', 'Contract files — name each one')}>
            <FilePicker files={contract.files} onChange={(f) => setContract({ ...contract, files: f })} max={10} />
          </Field>
          {contract.contracted && !(C.files || []).length && !contract.files.length && <p className="text-[12.5px] text-amber-700">{t('أرفِق ملفّ العقد الموقَّع.', 'Attach the signed contract file.')}</p>}
        </Modal>
      )}
    </div>
  );
}
