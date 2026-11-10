'use client';
/** Statement email template, written and edited by the department at will. Bracketed fields are filled at send time from the statement itself (customer name, amount due...). A save reaches the next message because the server reads the template from the database for every draft. */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Loader2, Save, RotateCcw, Mail } from 'lucide-react';
import { EmailList } from '@/components/collections/SendStatementModal';

interface Tpl { subject: string; body: string; cc?: string[]; signature?: string; signatureImage?: string; signatureImageName?: string; updatedAt?: string; updatedByName?: string; placeholders: [string, string][]; mailbox: string; defaults: { subject: string; body: string } }

/** Shared by collections (default) and customs: each department passes its own template endpoint, title and live event. */
export default function EmailTemplateEditor({ ar, canEdit, endpoint = '/api/collections-dept/email-template', title, liveEvent = 'collections:changed', signatureHint }: {
  ar: boolean; canEdit: boolean; endpoint?: string; title?: string; liveEvent?: string; signatureHint?: string;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sig, setSig] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [sigImg, setSigImg] = useState('');
  const [sigImgName, setSigImgName] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(() => {
    api.get<Tpl>(endpoint).then((x) => { setTpl(x); setSubject(x.subject); setBody(x.body); setCc(x.cc || []); setSig(x.signature || ''); setSigImg(x.signatureImage || ''); setSigImgName(x.signatureImageName || ''); }).catch(() => {});
  }, [endpoint]);
  useEffect(() => { load(); }, [load]);
  // A colleague saved the template from another screen; the new one is read unless there is an unsaved local edit.
  useSocket(liveEvent, useCallback((d: any) => {
    if (d?.source === 'email-template' && tpl && subject === tpl.subject && body === tpl.body && sig === (tpl.signature || '') && sigImg === (tpl.signatureImage || '')) load();
  }, [load, tpl, subject, body, sig, sigImg]));

  const dirty = !!tpl && (subject !== tpl.subject || body !== tpl.body || cc.join() !== (tpl.cc || []).join() || sig !== (tpl.signature || '') || sigImg !== (tpl.signatureImage || ''));
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<Tpl>(endpoint, { subject, body, cc, signature: sig, signatureImage: sigImg, signatureImageName: sigImgName });
      setTpl((p) => (p ? { ...p, ...r } : p));
      notify(t('حُفظ القالب — يصل أوّلَ رسالةٍ تُرسَل الآن', 'Template saved — used by the next email'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error'); }
    setSaving(false);
  };
  const insert = (token: string) => {
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + token); return; }
    const a = el.selectionStart ?? body.length; const b = el.selectionEnd ?? body.length;
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };

  if (!tpl) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="h-5 w-5 text-[#f37121]" />
        <h2 className="text-[15px] font-bold text-slate-900">{title || t('قالب بريد كشف الحساب', 'Statement email template')}</h2>
        <span className="text-[12.5px] text-slate-600">{t('يُرسَل من', 'Sent from')} <b dir="ltr">{tpl.mailbox}</b></span>
        {tpl.updatedByName && <span className="ms-auto text-[12px] text-slate-500">{t('آخر تعديل', 'Last edited')}: {tpl.updatedByName}{tpl.updatedAt ? ` · ${new Date(tpl.updatedAt).toLocaleString('en-GB')}` : ''}</span>}
      </div>
      {/* Copied on every message: set once here instead of typing the same addresses each time. */}
      <div className={canEdit ? '' : 'pointer-events-none opacity-70'}>
        <EmailList label={t('نسخة CC دائمة — تُضاف إلى كلّ رسالة تلقائيًّا', 'Standing CC — added to every message')} value={cc} onChange={setCc} ar={ar} />
      </div>
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('الموضوع', 'Subject')}</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('نصّ الرسالة', 'Message')}</span>
        <textarea ref={bodyRef} rows={14} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} dir="auto" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-7" />
      </label>
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-slate-700">{t('خانات تُملأ تلقائيًّا عند الإرسال — اضغط لإدراجها في النصّ', 'Auto-filled fields — click to insert')}</p>
        <div className="flex flex-wrap gap-1.5">
          {tpl.placeholders.map(([k, d]) => (
            <button key={k} type="button" disabled={!canEdit} onClick={() => insert(k)} title={d}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]">
              {k} <span className="font-normal text-slate-500">— {d}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Signature: appended to the end of every message. */}
      <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <p className="text-[12.5px] font-semibold text-slate-700">{t('التوقيع — يُضاف في آخر كلّ رسالة', 'Signature — added to the end of every email')}</p>
        <textarea rows={4} value={sig} onChange={(e) => setSig(e.target.value)} disabled={!canEdit} dir="auto"
          placeholder={signatureHint || t('مثال: إدارة التحصيل — إنرجايز للخدمات اللوجستية\nهاتف: 920031911', 'e.g. Collections — Energize Logistics')}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-7" />
        <div className="flex flex-wrap items-center gap-3">
          {sigImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sigImg} alt="" className="max-h-20 max-w-[240px] rounded border border-slate-200 bg-white p-1" />
          ) : <span className="text-[12px] text-slate-500">{t('لا صورة توقيع', 'No signature image')}</span>}
          {canEdit && (
            <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:text-[#f37121]">
              {sigImg ? t('تغيير الصورة', 'Change image') : t('إضافة صورة (شعار/توقيع)', 'Add an image (logo/signature)')}
              <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                if (f.size > 300 * 1024) { notify(t('الصورة أكبر من 300 ك.ب — صغّرها', 'Image over 300 KB'), 'error'); return; }
                const r = new FileReader(); r.onload = () => { setSigImg(String(r.result)); setSigImgName(f.name); }; r.readAsDataURL(f);
              }} />
            </label>
          )}
          {canEdit && sigImg && <button type="button" onClick={() => { setSigImg(''); setSigImgName(''); }} className="text-[12.5px] text-red-600">{t('إزالة الصورة', 'Remove image')}</button>}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => { setSubject(tpl.defaults.subject); setBody(tpl.defaults.body); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
            <RotateCcw className="h-4 w-4" />{t('النصّ الافتراضي', 'Default text')}
          </button>
          <button type="button" onClick={save} disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('حفظ القالب', 'Save template')}
          </button>
        </div>
      )}
    </section>
  );
}
