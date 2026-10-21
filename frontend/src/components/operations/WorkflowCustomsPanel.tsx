'use client';
/**
 * «التخليص الجمركي» في صفحة الكشف — المعاملةُ التي يخدمها، وربطُها يدويًّا.
 *
 * الربطُ الآليُّ يأتي من الخادم (خانةُ النقل في المعاملة، أو «رقم السند» =
 * البوليصة أو الحاوية — راجع backend/src/services/customsOpsLink). وما لا دليلَ
 * عليه يربطه موظّفُ التشغيل هنا بالبحث برقم المعاملة أو البوليصة أو الحاوية.
 * وما كتبه قسمُ التخليص في خانة النقل لا يُفكّ من هنا: يُصحَّح في المعاملة.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, Search, Ship, Unlink, X } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import CustomsLinkBadge, { type CustomsLinkView, customsIdOf, viaLabel } from '@/components/customs/CustomsLinkBadge';

type Hit = {
  _id: string; refNumber: string; blNumber: string; customerName: string;
  containerCount: number; containers: string[]; isCompleted: boolean; upcoming: boolean;
};

export default function WorkflowCustomsPanel({ workflowId, link, ar, canLink, onSaved }: {
  workflowId: string;
  link?: (CustomsLinkView & { at?: string; byName?: string }) | null;
  ar: boolean;
  canLink: boolean;
  onSaved: (wf: any) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const linked = !!customsIdOf(link);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const [units, setUnits] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const guard = useLatestRequest();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (text: string) => {
    const mine = guard.begin();
    if (text.trim().length < 2) { setHits([]); setBusy(false); return; }
    setBusy(true);
    try {
      const d = await api.get<{ clearances: Hit[] }>(`/api/workflows/customs-search?q=${encodeURIComponent(text.trim())}`);
      if (guard.isCurrent(mine)) setHits(d.clearances || []);
    } catch { if (guard.isCurrent(mine)) setHits([]); }
    finally { if (guard.isCurrent(mine)) setBusy(false); }
  }, [guard]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const close = () => { setPicking(false); setQ(''); setHits([]); setChosen(null); setUnits(new Set()); };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const wf = await api.put<any>(`/api/workflows/${workflowId}/customs-link`, { clearanceId: chosen._id, containers: [...units] });
      onSaved(wf);
      notify(t(`رُبط الكشف بالمعاملة ${chosen.refNumber}`, `Linked to ${chosen.refNumber}`), 'success');
      close();
    } catch (e: any) {
      notify(e?.message || t('تعذّر الربط', 'Could not link'), 'error');
    } finally { setSaving(false); }
  };

  const unlink = async () => {
    const ok = await confirm({
      title: t('فكّ الربط', 'Unlink'),
      message: t(`يُفكّ ربطُ الكشف بالمعاملة ${link?.refNumber || ''}، ولا يُعاد آليًّا من رقم السند.`, `Unlink from ${link?.refNumber || ''}. It will not be re-linked automatically from the document number.`),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const wf = await api.delete<any>(`/api/workflows/${workflowId}/customs-link`);
      onSaved(wf);
      notify(t('فُكّ الربط', 'Unlinked'), 'success');
    } catch (e: any) {
      notify(e?.message || t('تعذّر فكّ الربط', 'Could not unlink'), 'error');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="px-6 py-3 border-b border-slate-200 border-l-4 border-l-sky-500 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-sm text-sky-800 flex items-center gap-2">
          <Ship className="w-4 h-4" /> {t('التخليص الجمركي', 'Customs clearance')}
        </h2>
        {canLink && !picking && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicking(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
              <Link2 className="w-3.5 h-3.5" /> {linked ? t('تغيير المعاملة', 'Change clearance') : t('ربط بمعاملة تخليص', 'Link to a clearance')}
            </button>
            {linked && link?.via !== 'move' && (
              <button type="button" onClick={unlink}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:text-red-600 hover:border-red-200">
                <Unlink className="w-3.5 h-3.5" /> {t('فكّ الربط', 'Unlink')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-6 space-y-4">
        {linked ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-slate-500 text-xs mb-1.5">{t('المعاملة', 'Clearance')}</p>
              <CustomsLinkBadge link={link} ar={ar} compact />
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1.5">{t('رقم البوليصة', 'Bill of lading')}</p>
              <p className="text-slate-900" dir="ltr">{link?.blNumber || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1.5">{t('عميل التخليص', 'Clearance customer')}</p>
              <p className="text-slate-900">{link?.customerName || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1.5">{t('مصدر الربط', 'Linked by')}</p>
              <p className="text-slate-700">
                {viaLabel(link?.via, ar)}
                {link?.via === 'manual' && link?.byName ? <span className="text-slate-500"> — {link.byName}</span> : null}
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-slate-500 text-xs mb-1.5">{t('الحاويات في هذا الكشف', 'Containers on this report')}</p>
              {(link?.containers || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {(link?.containers || []).map((c) => (
                    <span key={c} dir="ltr" className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 font-mono">{c}</span>
                  ))}
                </div>
              ) : <p className="text-slate-500 text-xs">{t('لم تُحدَّد حاويةٌ بعينها', 'No specific container')}</p>}
            </div>
            {link?.via === 'move' && canLink && (
              <p className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">
                {t('رقمُ هذا الكشف مكتوبٌ في خانة النقل بالمعاملة، فيُصحَّح الربطُ من صفحة المعاملة في قسم التخليص.',
                  'This report number is written in the clearance transport entry; correct it from the clearance page.')}
              </p>
            )}
          </div>
        ) : !picking && (
          <p className="text-sm text-slate-500">{t('الكشفُ غيرُ مرتبطٍ بمعاملة تخليص.', 'This report is not linked to a customs clearance.')}</p>
        )}

        {picking && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input autoFocus value={q}
                  onChange={(e) => {
                    const v = e.target.value; setQ(v); setChosen(null); setUnits(new Set());
                    if (timer.current) clearTimeout(timer.current);
                    timer.current = setTimeout(() => search(v), 300);
                  }}
                  placeholder={t('رقم المعاملة أو البوليصة أو الحاوية أو اسم العميل', 'Clearance, B/L, container or customer')}
                  className="w-full ps-9 pe-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40" />
              </div>
              <button type="button" onClick={close} title={t('إلغاء', 'Cancel')} className="p-2 text-slate-500 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            {busy && <p className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {t('جارٍ البحث…', 'Searching…')}</p>}
            {!busy && q.trim().length >= 2 && !hits.length && <p className="text-xs text-slate-500">{t('لا معاملةَ تطابق البحث', 'No matching clearance')}</p>}
            {!!hits.length && (
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white max-h-72 overflow-auto">
                {hits.map((h) => (
                  <li key={h._id}>
                    <button type="button" onClick={() => { setChosen(h); setUnits(new Set()); }}
                      className={`w-full text-start px-3 py-2 text-sm hover:bg-slate-50 ${chosen?._id === h._id ? 'bg-sky-50' : ''}`}>
                      <span className="font-semibold text-slate-900">{h.refNumber}</span>
                      <span className="text-slate-500" dir="ltr"> · {h.blNumber || '-'}</span>
                      <span className="text-slate-600"> · {h.customerName || '-'}</span>
                      <span className="text-slate-400 text-xs"> · {h.containerCount} {t('وحدة', 'units')}{h.upcoming ? ` · ${t('قادمة', 'upcoming')}` : h.isCompleted ? ` · ${t('مغلقة', 'closed')}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {chosen && (
              <div className="space-y-2">
                {!!chosen.containers.length && (
                  <>
                    <p className="text-xs text-slate-500">{t('الحاوياتُ التي نقلها هذا الكشف (اختياريّ)', 'Containers carried by this report (optional)')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {chosen.containers.map((c) => {
                        const on = units.has(c);
                        return (
                          <button key={c} type="button" dir="ltr"
                            onClick={() => setUnits((prev) => { const n = new Set(prev); if (on) n.delete(c); else n.add(c); return n; })}
                            className={`rounded-md px-2 py-0.5 text-xs font-mono border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={save} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    {t(`ربط بالمعاملة ${chosen.refNumber}`, `Link to ${chosen.refNumber}`)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
