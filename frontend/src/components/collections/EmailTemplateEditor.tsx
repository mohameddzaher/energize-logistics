'use client';
/**
 * قالبُ بريد كشف الحساب — يكتبه القسمُ ويعدّله متى شاء (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * الخاناتُ بين قوسين تُملأ عند الإرسال من الكشف نفسِه (اسمُ العميل، المستحقّ…).
 * والحفظُ يصل أوّلَ رسالةٍ بعده: الخادمُ يقرأ القالبَ من القاعدة في كلّ مسودّة.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Loader2, Save, RotateCcw, Mail } from 'lucide-react';

interface Tpl { subject: string; body: string; updatedAt?: string; updatedByName?: string; placeholders: [string, string][]; mailbox: string; defaults: { subject: string; body: string } }

export default function EmailTemplateEditor({ ar, canEdit }: { ar: boolean; canEdit: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(() => {
    api.get<Tpl>('/api/collections-dept/email-template').then((x) => { setTpl(x); setSubject(x.subject); setBody(x.body); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  // زميلٌ حفظ القالبَ من شاشةٍ أخرى — يُقرأ الجديد ما لم يكن هنا تعديلٌ لم يُحفظ.
  useSocket('collections:changed', useCallback((d: any) => {
    if (d?.source === 'email-template' && tpl && subject === tpl.subject && body === tpl.body) load();
  }, [load, tpl, subject, body]));

  const dirty = !!tpl && (subject !== tpl.subject || body !== tpl.body);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<Tpl>('/api/collections-dept/email-template', { subject, body });
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
        <h2 className="text-[15px] font-bold text-slate-900">{t('قالب بريد كشف الحساب', 'Statement email template')}</h2>
        <span className="text-[12.5px] text-slate-600">{t('يُرسَل من', 'Sent from')} <b dir="ltr">{tpl.mailbox}</b></span>
        {tpl.updatedByName && <span className="ms-auto text-[12px] text-slate-500">{t('آخر تعديل', 'Last edited')}: {tpl.updatedByName}{tpl.updatedAt ? ` · ${new Date(tpl.updatedAt).toLocaleString('en-GB')}` : ''}</span>}
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
