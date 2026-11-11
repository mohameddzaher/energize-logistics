'use client';
/**
 * Department email template (collections statements, customs follow-up), edited at will.
 * Bracketed fields are filled at send time from the record itself. The server reads the template from the database for every draft, so a save reaches the very next message.
 * Left: the form; right: a live preview of the email as the customer receives it, company signature included (when `previewEndpoint` is given).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Loader2, Save, RotateCcw, Mail, Plus, ChevronDown, Eye, ImagePlus, Trash2 } from 'lucide-react';
import { EmailList } from '@/components/collections/SendStatementModal';

interface Tpl { subject: string; body: string; cc?: string[]; signature?: string; signatureImage?: string; signatureImageName?: string; updatedAt?: string; updatedByName?: string; placeholders: [string, string][]; mailbox: string; defaults: { subject: string; body: string } }

/** Shared by collections (default) and customs: each department passes its own template endpoint, title and live event. */
export default function EmailTemplateEditor({ ar, canEdit, endpoint = '/api/collections-dept/email-template', title, liveEvent = 'collections:changed', signatureHint, previewEndpoint }: {
  ar: boolean; canEdit: boolean; endpoint?: string; title?: string; liveEvent?: string; signatureHint?: string;
  /** POST { signature, signatureImage } → { html }: the closing block exactly as sent (logo, animated truck). */
  previewEndpoint?: string;
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
  const [menu, setMenu] = useState(false);
  const [sigHtml, setSigHtml] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Where an inserted field goes: the field the user was last in.
  const target = useRef<'subject' | 'body'>('body');

  const load = useCallback(() => {
    api.get<Tpl>(endpoint).then((x) => { setTpl(x); setSubject(x.subject); setBody(x.body); setCc(x.cc || []); setSig(x.signature || ''); setSigImg(x.signatureImage || ''); setSigImgName(x.signatureImageName || ''); }).catch(() => {});
  }, [endpoint]);
  useEffect(() => { load(); }, [load]);
  // A colleague saved the template from another screen; the new one is read unless there is an unsaved local edit.
  useSocket(liveEvent, useCallback((d: any) => {
    if (d?.source === 'email-template' && tpl && subject === tpl.subject && body === tpl.body && sig === (tpl.signature || '') && sigImg === (tpl.signatureImage || '')) load();
  }, [load, tpl, subject, body, sig, sigImg]));

  // The signature preview follows the text and image as they are typed.
  useEffect(() => {
    if (!previewEndpoint) return;
    const id = setTimeout(() => {
      api.post<{ html: string }>(previewEndpoint, { signature: sig, signatureImage: sigImg }).then((r) => setSigHtml(r.html || '')).catch(() => {});
    }, 350);
    return () => clearTimeout(id);
  }, [previewEndpoint, sig, sigImg]);

  const dirty = !!tpl && (subject !== tpl.subject || body !== tpl.body || cc.join() !== (tpl.cc || []).join() || sig !== (tpl.signature || '') || sigImg !== (tpl.signatureImage || ''));
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<Tpl>(endpoint, { subject, body, cc, signature: sig, signatureImage: sigImg, signatureImageName: sigImgName });
      setTpl((p) => (p ? { ...p, ...r } : p));
      notify(t('حُفظ القالب — يُستخدم في أوّل رسالةٍ تُرسَل من الآن', 'Template saved — used by the next email'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error'); }
    setSaving(false);
  };
  const insert = (token: string) => {
    setMenu(false);
    if (target.current === 'subject') {
      const el = subjectRef.current; const a = el?.selectionStart ?? subject.length; const b = el?.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, a) + token + subject.slice(b));
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + token.length, a + token.length); });
      return;
    }
    const el = bodyRef.current; const a = el?.selectionStart ?? body.length; const b = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + token.length, a + token.length); });
  };

  // Preview: each field shows as a highlighted label, so it reads as "filled automatically" rather than as code.
  const labelOf = useMemo(() => new Map((tpl?.placeholders || []).map(([k, d]) => [k, d])), [tpl]);
  const render = (text: string) => {
    const keys = [...labelOf.keys()];
    if (!keys.length) return text;
    const rx = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return text.split(rx).map((part, i) => (labelOf.has(part)
      ? <span key={i} className="mx-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[12px] font-bold text-[#b4471a]">{labelOf.get(part)}</span>
      : <span key={i}>{part}</span>));
  };

  if (!tpl) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  const lbl = 'mb-1.5 block text-[12.5px] font-bold text-slate-700';
  const inp = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 focus:border-[#f37121] disabled:bg-slate-50';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 bg-slate-900 px-5 py-3.5 text-white">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f37121]"><Mail className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold">{title || t('قالب بريد كشف الحساب', 'Statement email template')}</h2>
          <p className="text-[12px] text-slate-300">{t('يُرسَل من', 'Sent from')} <b dir="ltr">{tpl.mailbox}</b></p>
        </div>
        {tpl.updatedByName && <span className="ms-auto text-[12px] text-slate-300">{t('آخر تعديل', 'Last edited')}: {tpl.updatedByName}{tpl.updatedAt ? ` · ${new Date(tpl.updatedAt).toLocaleString('en-GB')}` : ''}</span>}
      </header>

      <div className="grid gap-0 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-5 p-5 lg:border-e border-slate-100">
          <div className={canEdit ? '' : 'pointer-events-none opacity-70'}>
            <EmailList label={t('نسخة (CC) دائمة — تُضاف إلى كلّ رسالة', 'Standing CC — added to every message')} value={cc} onChange={setCc} ar={ar} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] text-slate-600">{t('ضع المؤشّر حيث تريد، ثمّ أدرج معلومةً من المعاملة — تُملأ وحدها عند الإرسال.', 'Place the cursor, then insert a field — it fills itself when sending.')}</p>
            {canEdit && (
              <div className="relative shrink-0">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#f37121] bg-orange-50 px-3 py-1.5 text-[12.5px] font-bold text-[#b4471a] hover:bg-orange-100">
                  <Plus className="h-4 w-4" />{t('إدراج معلومة', 'Insert field')}<ChevronDown className="h-3.5 w-3.5" />
                </button>
                {menu && (
                  <div className="absolute end-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white py-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                    {tpl.placeholders.map(([k, d]) => (
                      <button key={k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)}
                        className="block w-full px-3 py-2 text-start text-[13px] font-semibold text-slate-700 hover:bg-orange-50 hover:text-[#b4471a]">{d}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className={lbl}>{t('الموضوع', 'Subject')}</span>
            <input ref={subjectRef} value={subject} onFocus={() => { target.current = 'subject'; }} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} dir="auto" className={inp} />
          </label>
          <label className="block">
            <span className={lbl}>{t('نصّ الرسالة', 'Message')}</span>
            <textarea ref={bodyRef} rows={12} value={body} onFocus={() => { target.current = 'body'; }} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} dir="auto" className={`${inp} leading-7`} />
          </label>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <p className="text-[12.5px] font-bold text-slate-700">{t('سطرٌ فوق توقيع الشركة (اختياري)', 'A line above the company signature (optional)')}</p>
            <textarea rows={3} value={sig} onChange={(e) => setSig(e.target.value)} disabled={!canEdit} dir="auto"
              placeholder={signatureHint || t('مثال: للاستفسار تواصلوا معنا على 920031911', 'e.g. For any question call 920031911')} className={`${inp} leading-7`} />
            <div className="flex flex-wrap items-center gap-3">
              {sigImg
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={sigImg} alt="" className="max-h-16 max-w-[200px] rounded border border-slate-200 bg-white p-1" />
                : <span className="text-[12px] text-slate-500">{t('لا صورة إضافية', 'No extra image')}</span>}
              {canEdit && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#b4471a]">
                  <ImagePlus className="h-4 w-4" />{sigImg ? t('تغيير الصورة', 'Change image') : t('إضافة صورة توقيع', 'Add a signature image')}
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => {
                    const f = e.target.files?.[0]; e.target.value = '';
                    if (!f) return;
                    if (f.size > 300 * 1024) { notify(t('الصورة أكبر من 300 ك.ب — صغّرها', 'Image over 300 KB'), 'error'); return; }
                    const r = new FileReader(); r.onload = () => { setSigImg(String(r.result)); setSigImgName(f.name); }; r.readAsDataURL(f);
                  }} />
                </label>
              )}
              {canEdit && sigImg && <button type="button" onClick={() => { setSigImg(''); setSigImgName(''); }} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" />{t('إزالة', 'Remove')}</button>}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="bg-slate-50 p-5">
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-600"><Eye className="h-4 w-4" />{t('معاينة — هكذا تصل الرسالة إلى العميل', 'Preview — as the customer receives it')}</p>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-1 border-b border-slate-100 px-4 py-3 text-[12.5px]">
              <p><span className="text-slate-500">{t('من:', 'From:')}</span> <b dir="ltr">{tpl.mailbox}</b></p>
              {!!cc.length && <p><span className="text-slate-500">CC:</span> <span dir="ltr">{cc.join(', ')}</span></p>}
              <p className="text-[14px] font-bold text-slate-900" dir="auto">{render(subject)}</p>
            </div>
            <div className="px-4 py-4 text-[13.5px] leading-7 text-slate-800 whitespace-pre-wrap" dir="auto">{render(body)}</div>
            {previewEndpoint && sigHtml && (
              // Rendered from the server's own signature builder, so what shows here is what is sent.
              <div className="border-t border-dashed border-slate-200 px-4 pb-4" dangerouslySetInnerHTML={{ __html: sigHtml }} />
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-slate-500">{t('الخانات المظلّلة تُستبدَل بقيم المعاملة عند الإرسال.', 'Highlighted fields are replaced by the transaction values when sending.')}</p>
        </div>
      </div>

      {canEdit && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button type="button" onClick={() => { setSubject(tpl.defaults.subject); setBody(tpl.defaults.body); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            <RotateCcw className="h-4 w-4" />{t('استرجاع النصّ الافتراضي', 'Restore default text')}
          </button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-[12px] font-semibold text-amber-700">{t('تعديلات غير محفوظة', 'Unsaved changes')}</span>}
            <button type="button" onClick={save} disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#e06010] disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('حفظ القالب', 'Save template')}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
