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
import { ExternalLink, Loader2, RefreshCw, Trash2, Link2, AlertTriangle, CheckCircle2, XCircle, Download, Save } from 'lucide-react';

type Sheet = {
  _id: string; projectAr: string; sheetId: string; url: string; enabled: boolean;
  lastSyncAt: string | null; lastOkAt: string | null; lastError: string; lastChanges: number; unknownIds: string[];
};
type Data = { sheets: Sheet[]; projects: string[]; headEmails?: string[] };

/**
 * بريدُ جوجل لمسؤولي القسم — يُضافون محرّرين لحماية كلّ ورقة في الشيتات الثلاثة
 * (يكتبون في أيّ يومٍ من أيّ شهر).
 */
function HeadEmails({ initial, ar, onSaved }: { initial: string[]; ar: boolean; onSaved: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const joined = initial.join('\n');
  const [text, setText] = useState(joined);
  const [busy, setBusy] = useState(false);
  // المحفوظُ تغيّر (حفظٌ هنا أو من مسؤولٍ آخر) — لا كلُّ إعادة تحميلٍ للوحة.
  useEffect(() => { setText(joined); }, [joined]);
  const save = async () => {
    setBusy(true);
    try {
      const emails = text.split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean);
      await api.put('/api/b2c/order-sheets/heads', { emails });
      notify(t('حُفظ البريد — يُطبَّق في الشيتات خلال دقائق', 'Saved — applied to the sheets within minutes'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Save failed'), 'error'); }
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[13px] font-bold text-slate-800">{t('بريد جوجل لمسؤولي القسم', 'Section heads’ Google emails')}</p>
      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
        {t('بريدُ مدير القسم ونائبه والإدارة (حساب جوجل) — بريدٌ في كلّ سطر. يُشارَك معهم ملفُّ كلّ مشروع، ويكتبون في أيّ يومٍ من أيّ شهر (والشهورُ قبل أكتوبر 2026 لهم وحدَهم).',
          'Google accounts of the manager, deputy and admins — one per line. They can edit any day of any month.')}
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} dir="ltr" rows={3}
        placeholder="name@gmail.com"
        className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-[12.5px]" />
      <button type="button" onClick={save} disabled={busy}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[#12325c] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#0d2647] disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{t('حفظ البريد', 'Save emails')}
      </button>
    </div>
  );
}

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

  const downloadScript = async () => {
    try {
      const blob = await api.getBlob('/api/b2c/order-sheets/script');
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = 'energize-b2c-sheets.gs'; el.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Download failed'), 'error'); }
  };
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
        {/* ── الطريقةُ المعتمدة: سكربتُ جوجل يُنشئ الملفّات ويديرها ── */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] leading-6 text-emerald-900">
          <p className="font-bold">{t('سكربت جوجل — الملفّات يديرها النظام', 'Google script — the system manages the files')}</p>
          <ol className="list-decimal ps-5">
            <li>{t('حمِّل السكربت من الزرّ تحت (فيه مفتاحُ الربط).', 'Download the script below (it carries the link key).')}</li>
            <li>{t('افتح script.google.com بحساب جوجل صاحب الفولدر ← مشروع جديد ← امسح ما فيه والصق السكربت ← احفظ.', 'Open script.google.com with the folder owner account → New project → paste → save.')}</li>
            <li>{t('اختر الدالّة setup واضغط «تشغيل» ← وافق على الأذونات. (إن توقّف لطول الوقت شغّله ثانيةً فيكمل.)', 'Pick setup and press Run → allow permissions (re-run if it times out; it resumes).')}</li>
          </ol>
          <p>{t('يُنشئ ملفًّا لكلّ مشروع في الفولدر ويحدّثه كلَّ ٥ دقائق من النظام، ويرسل كلَّ رقمٍ يُكتب فيه إلى النظام فورًا، ويقفل كلَّ شيءٍ إلّا خانات الأيّام.',
            'It creates one file per project, refreshes it every 5 minutes, sends each typed number instantly, and locks everything but the day cells.')}</p>
          <p className="mt-1.5 font-bold">{t('ما يستطيعه كلٌّ في الشيت', 'Who can do what in the sheet')}</p>
          <ul className="list-disc ps-5">
            <li>{t('المشرفون: عددُ الأوردرات في خانات الأيّام من أكتوبر 2026 فقط.', 'Supervisors: order counts in day cells from October 2026 only.')}</li>
            <li>{t('مسؤولو القسم (بريدُهم تحت): أيُّ يومٍ مضى من أيِّ شهر — والشهورُ القديمة لهم وحدَهم — ويصل التعديلُ النظامَ فورًا.', 'Section heads (emails below): any past day of any month — old months are theirs only — reaching the system instantly.')}</li>
            <li>{t('المناديبُ مرتّبون بالمشرف ثمّ بالاسم في كلّ الشهور. والشهورُ قبل أكتوبر ٢٠٢٦ تُعرض كما كانت في الشيت القديم: صفٌّ لكلّ حساب باسمه هناك.', 'Reps are listed by supervisor then name. Months before Oct 2026 show exactly as in the old sheet: one row per account.')}</li>
            <li>{t('الأسماءُ وأرقامُ الإقامة والمشرفون والمشاريع من النظام وحدَه — ما يُكتب فوقها في الشيت يُعاد من النظام.', 'Names, IDs, supervisors and projects come from the system only — overwritten in the sheet.')}</li>
          </ul>
          <p className="mt-1.5 rounded-md bg-amber-100/70 px-2 py-1 text-amber-900">
            {t('إصدار ٢٠٢٦/١٠/٢١: من ثبّت السكربت قبل هذا التاريخ يحمّله من جديد، ويلصقه مكانَ القديم في مشروع script.google.com نفسِه، ويحفظ، ثمّ يشغّل setup مرّةً.',
              'Version 2026-10-21: if installed before, download again, replace the code in the same Apps Script project, save, and run setup once.')}
          </p>
          <button type="button" onClick={downloadScript}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-emerald-700">
            <Download className="h-3.5 w-3.5" />{t('تحميل سكربت جوجل', 'Download Google script')}
          </button>
        </div>

        {d && <HeadEmails initial={d.headEmails || []} ar={ar} onSaved={load} />}

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
