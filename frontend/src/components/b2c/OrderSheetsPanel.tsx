'use client';
/**
 * شيتاتُ جوجل — ربطُ ملفّ جوجل شيت لكلّ مشروع (backend: b2cOrderSheetController).
 *
 * يُفتح من «مدخلات الأوردرات» لمسؤولي القسم وحدَهم (الخادمُ يرفض غيرَهم).
 * والخادمُ يقرأ كلَّ ملفٍّ كلَّ دقيقة؛ وما يتغيّر يصل الجدولَ عبر `b2c:order:upserted`.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Modal } from '@/components/hr/HRKit';
import { ExternalLink, Loader2, RefreshCw, Trash2, Link2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

type Sheet = {
  _id: string; projectAr: string; sheetId: string; url: string; enabled: boolean;
  lastSyncAt: string | null; lastOkAt: string | null; lastError: string; lastChanges: number; unknownIds: string[];
};
type Data = { sheets: Sheet[]; projects: string[] };

const fmtTime = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

export default function OrderSheetsPanel({ open, onClose, ar }: { open: boolean; onClose: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [project, setProject] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.get<Data>('/api/b2c/order-sheets');
      setD(res); setErr('');
    } catch (e: any) { setErr(e?.message || 'Failed'); }
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  // القراءةُ الدوريّة على الخادم تُغيّر «آخر قراءة» وعددَ التغييرات.
  useSocket('b2c:order:upserted', () => { if (open) load(); });

  const add = async () => {
    if (!project) { notify(t('اختر المشروع', 'Pick a project'), 'error'); return; }
    if (!url.trim()) { notify(t('الصق رابط الملف', 'Paste the sheet link'), 'error'); return; }
    setAdding(true);
    try {
      const res = await api.post<{ sheet: Sheet }>('/api/b2c/order-sheets', { projectAr: project, url: url.trim() });
      if (res.sheet?.lastError) notify(t(`رُبط الملفّ لكن تعذّرت قراءته: ${res.sheet.lastError}`, `Linked, but could not read it: ${res.sheet.lastError}`), 'error');
      else notify(t('رُبط الملفّ وقُرئ بنجاح', 'Sheet linked and read'), 'success');
      setUrl(''); setProject('');
      await load();
    } catch (e: any) { notify(e?.message || t('تعذّر الربط', 'Link failed'), 'error'); }
    setAdding(false);
  };

  const syncNow = async (s: Sheet) => {
    setBusy((b) => ({ ...b, [s._id]: true }));
    try {
      const res = await api.post<{ changed: number }>(`/api/b2c/order-sheets/${s._id}/sync`, {});
      notify(t(`قُرئ الملفّ — ${res.changed || 0} تغييرًا`, `Read — ${res.changed || 0} changes`), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّرت القراءة', 'Read failed'), 'error'); }
    setBusy((b) => ({ ...b, [s._id]: false }));
    load();
  };

  const unlink = async (s: Sheet) => {
    const ok = await confirm({
      title: t('إلغاء الربط', 'Unlink'), tone: 'danger', confirmLabel: t('إلغاء الربط', 'Unlink'), cancelLabel: t('تراجع', 'Cancel'),
      message: t(`سيتوقّف النظام عن قراءة ملفّ مشروع «${s.projectAr}». الأوردراتُ التي قُرئت منه تبقى كما هي.`, `Stop reading the sheet of “${s.projectAr}”? Orders already read stay.`),
    });
    if (!ok) return;
    try { await api.delete(`/api/b2c/order-sheets/${s._id}`); await load(); }
    catch (e: any) { notify(e?.message || t('تعذّر إلغاء الربط', 'Unlink failed'), 'error'); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={t('شيتات جوجل — ملفّ لكلّ مشروع', 'Google Sheets — one per project')}>
      <div className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] leading-6 text-blue-900">
          {t('اجعل مشاركة الملف: أيّ شخصٍ لديه الرابط يستطيع العرض. يُقرأ الملف كلَّ دقيقة، وآخرُ تعديلٍ هو المعتمد.',
            'Share the file as “Anyone with the link can view”. It is read every minute; the latest edit wins.')}
        </p>

        {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</p>}
        {!d && !err && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}

        {d && (
          <div className="space-y-2.5">
            {!d.sheets.length && <p className="py-4 text-center text-[13px] text-slate-500">{t('لم يُربط ملفٌّ بعد', 'No sheet linked yet')}</p>}
            {d.sheets.map((s) => (
              <div key={s._id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold text-slate-900">{s.projectAr}</span>
                  {s.lastError
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11.5px] font-semibold text-red-700"><XCircle className="h-3.5 w-3.5" />{t('متوقّف', 'Failing')}</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{t('يعمل', 'Working')}</span>}
                  <a href={s.url || `https://docs.google.com/spreadsheets/d/${s.sheetId}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-700 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />{t('فتح الملف', 'Open sheet')}
                  </a>
                  <span className="ms-auto flex items-center gap-1.5">
                    <button type="button" onClick={() => syncNow(s)} disabled={!!busy[s._id]}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {busy[s._id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t('اقرأ الآن', 'Read now')}
                    </button>
                    <button type="button" onClick={() => unlink(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" />{t('إلغاء الربط', 'Unlink')}
                    </button>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-600">
                  <span>{t('آخر قراءة', 'Last read')}: <b className="tabular-nums text-slate-800">{fmtTime(s.lastSyncAt)}</b></span>
                  <span>{t('آخر قراءة ناجحة', 'Last success')}: <b className="tabular-nums text-slate-800">{fmtTime(s.lastOkAt)}</b></span>
                  <span>{t('التغييرات في آخر قراءة', 'Changes in last read')}: <b className="tabular-nums text-slate-800">{s.lastChanges || 0}</b></span>
                </div>
                {s.lastError && <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700">{s.lastError}</p>}
                {s.unknownIds?.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t('أرقام إقامة في الشيت غير موجودة في النظام: ', 'ID numbers in the sheet not found in the system: ')}<span className="tabular-nums">{s.unknownIds.join('، ')}</span></span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {d && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[13px] font-bold text-slate-800">{t('ربط ملفٍّ جديد', 'Link a new sheet')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
                <option value="">{t('اختر المشروع', 'Project')}</option>
                {d.projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/…"
                className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm" />
              <button type="button" onClick={add} disabled={adding}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e06010] disabled:opacity-50">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{t('ربط', 'Link')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
