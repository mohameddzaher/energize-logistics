'use client';
/**
 * «متابعات الكشف» — سجلٌّ واحدٌ على كشف التشغيل يكتبه ثلاثة أقسام.
 *
 * التخليصُ يكتب «الحاويةُ ما زالت في الميناء»، والتشغيلُ «السائقُ وصل»، والتحصيلُ
 * «العميلُ استلم» — على الكشف نفسِه، ويقرؤها الثلاثة. ولكلّ قسمٍ بابُه إلى السجلّ
 * (`basePath`)، لأنّ كلًّا منهم يصل إلى الكشف بحارس قسمه:
 *   /api/workflows/:id/follow-ups
 *   /api/customs-clearance/:id/ops-reports/:reportId/follow-ups
 *   /api/collections-dept/reports/:reportId/follow-ups
 *
 * مَن يرى الكشفَ يكتب متابعة، ومرفقٌ واحدٌ اختياريّ معها. والحذفُ لكاتبها أو
 * للإدارة (`canDelete` يقوله الخادم). ويتحدّث وحدَه على `workflow:followUps`.
 * راجع backend/src/controllers/workflowFollowUpController.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquareText, Paperclip, Trash2, Loader2, Send, X } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { useDialog } from '@/components/system/DialogProvider';

export interface ReportFollowUp {
  _id: string; text: string; byName: string; byRole?: string;
  source?: 'operations' | 'customs' | 'collections'; at: string; canDelete: boolean;
  attachment?: { fileUrl: string; fileName?: string; mimeType?: string; size?: number } | null;
}

const MAX_FILE = 10 * 1024 * 1024;
const ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx';
const SOURCE: Record<string, [string, string]> = {
  operations: ['التشغيل', 'Operations'],
  customs: ['التخليص', 'Customs'],
  collections: ['التحصيل', 'Collections'],
};

const when = (d: string, ar: boolean) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export default function ReportFollowUps({ basePath, workflowId, ar, compact = false, onCount }: {
  basePath: string; workflowId: string; ar: boolean;
  /** داخل صفٍّ مفتوحٍ في جدول: بلا إطار البطاقة. */
  compact?: boolean;
  onCount?: (n: number) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { confirm, notify } = useDialog();
  const [rows, setRows] = useState<ReportFollowUp[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const guard = useLatestRequest();
  const countRef = useRef(onCount);
  countRef.current = onCount;

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ followUps: ReportFollowUp[] }>(basePath);
      if (!guard.isCurrent(mine)) return;
      setRows(d.followUps || []); setError('');
      countRef.current?.((d.followUps || []).length);
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || t('تعذّر تحميل المتابعات', 'Could not load follow-ups'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('workflow:followUps', useCallback((d: any) => {
    if (!d?.workflowId || String(d.workflowId) === String(workflowId)) load();
  }, [workflowId, load]));

  const pick = (f: File | null) => {
    setFormError('');
    if (f && f.size > MAX_FILE) { setFormError(t('الملفُّ أكبرُ من ١٠ ميغا', 'The file is larger than 10 MB')); return; }
    setFile(f);
  };

  const add = async () => {
    const body = text.trim();
    if (!body) { setFormError(t('اكتب نصَّ المتابعة', 'Write the follow-up')); return; }
    setSaving(true); setFormError('');
    try {
      let payload: Record<string, any> = { text: body };
      if (file) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
        });
        payload = { ...payload, file: { name: file.name, dataUrl } };
      }
      await api.post(basePath, payload);
      setText(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      setFormError(e?.message || t('تعذّر حفظ المتابعة', 'Could not save the follow-up'));
    } finally { setSaving(false); }
  };

  const remove = async (f: ReportFollowUp) => {
    if (!(await confirm({ title: t('حذف المتابعة', 'Delete follow-up'), message: f.text.slice(0, 160), tone: 'danger', confirmLabel: t('حذف', 'Delete') }))) return;
    try { await api.delete(`${basePath}/${f._id}`); await load(); } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const body = (
    <>
      <div className="flex flex-col gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000}
          placeholder={t('اكتب متابعةً على هذا الكشف…', 'Write a follow-up on this report…')}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} title={t('مرفق', 'Attachment')} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900">
            <Paperclip className="w-3.5 h-3.5" /> {file ? file.name : t('إرفاق ملف (اختياريّ)', 'Attach a file (optional)')}
          </button>
          {file && (
            <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
              title={t('إزالة المرفق', 'Remove attachment')} className="p-1 text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
          )}
          <button type="button" onClick={add} disabled={saving}
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#e06010] disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t('إضافة متابعة', 'Add follow-up')}
          </button>
        </div>
        {formError && <p className="text-xs text-red-600">{formError}</p>}
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {!error && rows === null && <p className="mt-3 text-xs text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {rows && rows.length === 0 && <p className="mt-3 text-xs text-slate-500">{t('لا متابعاتٍ على هذا الكشف بعد.', 'No follow-ups on this report yet.')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((f) => (
            <li key={f._id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-start gap-2">
                <p className="flex-1 whitespace-pre-wrap text-sm text-slate-900">{f.text}</p>
                {f.canDelete && (
                  <button type="button" onClick={() => remove(f)} title={t('حذف', 'Delete')} className="p-1 text-slate-400 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {f.attachment?.fileUrl && (
                <a href={f.attachment.fileUrl} target="_blank" rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-[#f37121] hover:underline">
                  <Paperclip className="w-3 h-3" /> {f.attachment.fileName || t('المرفق', 'Attachment')}
                </a>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                {f.byName || '—'}
                {f.source && SOURCE[f.source] && <span className="text-slate-400"> · {ar ? SOURCE[f.source][0] : SOURCE[f.source][1]}</span>}
                <span className="text-slate-400"> · {when(f.at, ar)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (compact) return <div>{body}</div>;
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <MessageSquareText className="w-4 h-4 text-slate-500" /> {t('متابعات الكشف', 'Report follow-ups')}
        {rows ? <span className="font-normal text-slate-400">({rows.length})</span> : null}
      </h2>
      {body}
    </section>
  );
}
