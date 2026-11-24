'use client';
/**
 * «تعديل بيانات» for a selection, as on the operations workflow: change only what you fill, blanks stay as they are.
 * The server runs the page's own single edit on each row (backend utils/bulkViaSingle), so every rule of a manual edit still applies; refused rows come back with the reason.
 */
import { useState } from 'react';
import { CheckSquare, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import ManagedSelect from '@/components/system/ManagedSelect';

export type BulkField =
  | { key: string; ar: string; en: string; type: 'text' | 'number' | 'date' | 'datetime' | 'textarea'; group?: string }
  | { key: string; ar: string; en: string; type: 'select'; options: { value: string; ar: string; en: string }[]; group?: string }
  | { key: string; ar: string; en: string; type: 'lookup'; lookup: string; group?: string };

export default function BulkEditPanel({ ids, endpoint, fields, ar, onDone }: {
  ids: string[]; endpoint: string; fields: BulkField[]; ar: boolean; onDone: () => void;
}) {
  const { notify, confirm } = useDialog();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ label: string; message: string }[]>([]);
  const t = (a: string, e: string) => (ar ? a : e);
  const filled = Object.entries(vals).filter(([, v]) => String(v ?? '').trim());

  const save = async () => {
    if (!filled.length) return;
    const names = filled.map(([k]) => { const f = fields.find((x) => x.key === k); return f ? (ar ? f.ar : f.en) : k; }).join('، ');
    if (!(await confirm({ title: t('تعديل جماعي', 'Bulk edit'), message: t(`تعديل ${names} على ${ids.length} صفًّا؟`, `Change ${names} on ${ids.length} rows?`) }))) return;
    setBusy(true); setFailed([]);
    try {
      const body = Object.fromEntries(filled.map(([k, v]) => {
        const f = fields.find((x) => x.key === k);
        return [k, f && f.type === 'number' ? Number(v) : v];
      }));
      const r = await api.post<{ message: string; failed: { label: string; message: string }[]; failedCount: number }>(endpoint, { ids, fields: body });
      notify(r.message, r.failedCount ? 'error' : 'success');
      setFailed(r.failed || []);
      if (!r.failedCount) { setOpen(false); setVals({}); }
      onDone();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy(false);
  };

  const input = (f: BulkField) => {
    const v = vals[f.key] ?? '';
    const set = (x: string) => setVals((p) => ({ ...p, [f.key]: x }));
    const cls = 'w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';
    if (f.type === 'select') {
      return (
        <select value={v} onChange={(e) => set(e.target.value)} className={cls} title={ar ? f.ar : f.en}>
          <option value="">{t('— لا يُغيَّر —', '— leave unchanged —')}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{ar ? o.ar : o.en}</option>)}
        </select>
      );
    }
    if (f.type === 'lookup') return <ManagedSelect type={f.lookup} storeLabel noAdd value={v} onChange={set} placeholder={t('— لا يُغيَّر —', '— leave unchanged —')} />;
    if (f.type === 'textarea') return <textarea value={v} onChange={(e) => set(e.target.value)} rows={2} className={cls} />;
    return (
      <input value={v} onChange={(e) => set(e.target.value)} className={cls} dir={f.type === 'number' ? 'ltr' : undefined}
        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'} />
    );
  };

  const groups = [...new Set(fields.map((f) => f.group || ''))];
  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen((o) => !o); setFailed([]); }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold">
        <CheckSquare className="w-4 h-4" />{t('تعديل بيانات', 'Edit data')} ({ids.length.toLocaleString('en-US')})
      </button>
      {open && (
        <div className="absolute top-full mt-2 end-0 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900">{t(`يُطبَّق على المحدَّد (${ids.length})`, `Applies to the selection (${ids.length})`)}</p>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" title={t('إغلاق', 'Close')}><X className="h-4 w-4" /></button>
          </div>
          <p className="mb-3 text-[11px] text-slate-500">{t('غيِّر ما تريد فقط — ما تتركه فارغًا لا يُغيَّر.', 'Change only what you need — blank fields are left unchanged.')}</p>
          <div className="max-h-[58vh] space-y-2.5 overflow-y-auto pe-1">
            {groups.map((g) => (
              <div key={g || 'main'} className="space-y-2.5">
                {g && <p className="pt-1 text-[12px] font-bold text-slate-800">{g}</p>}
                {fields.filter((f) => (f.group || '') === g).map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">{ar ? f.ar : f.en}</label>
                    {input(f)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {failed.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-[12px] text-red-700">
              <p className="mb-1 font-bold">{t('لم يُحفظ:', 'Not saved:')}</p>
              {failed.map((x, i) => <p key={i}><b className="tabular-nums">{x.label}</b> — {x.message}</p>)}
            </div>
          )}
          <button type="button" onClick={save} disabled={busy || !filled.length}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t(`حفظ على ${ids.length}`, `Save on ${ids.length}`)}
          </button>
        </div>
      )}
    </div>
  );
}
