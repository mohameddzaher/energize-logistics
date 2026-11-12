'use client';
/**
 * Vehicle lifecycle actions shared by every screen that offers them: cancel authorization, end service (archive), restore.
 * One server path each (backend services/vehicleLifecycle); the B2C screen passes its own revoke endpoint, which runs the same service.
 */
import { useState, useCallback } from 'react';
import { UserMinus, Archive, ArchiveRestore, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';

export interface LifecycleVehicle {
  _id: string;
  plateNumber: string;
  authorizedPerson?: { name?: string; iqamaNumber?: string } | null;
}

type Done = () => void;

const today = () => new Date().toISOString().slice(0, 10);

/** End-of-service dialog. Module-level so its inputs keep focus across parent renders. */
function EndServiceModal({ v, ar, onClose, onDone, revoke }: {
  v: LifecycleVehicle; ar: boolean; onClose: () => void; onDone: (msg: string) => void;
  revoke: (v: LifecycleVehicle) => Promise<boolean>;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Set when the server refuses because the vehicle is still authorized.
  const [blocked, setBlocked] = useState(
    v.authorizedPerson?.name || v.authorizedPerson?.iqamaNumber
      ? t(`المركبة ما زالت مفوَّضة لـ ${v.authorizedPerson?.name || v.authorizedPerson?.iqamaNumber} — ألغِ التفويض أولًا`,
        `The vehicle is still authorised to ${v.authorizedPerson?.name || v.authorizedPerson?.iqamaNumber} — cancel the authorisation first`)
      : '');

  const save = async () => {
    if (!reason.trim()) { setErr(t('اكتب سبب إنهاء الخدمة', 'Enter the reason')); return; }
    if (!date) { setErr(t('حدِّد تاريخ إنهاء الخدمة', 'Pick the end date')); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/end-service`, { reason: reason.trim(), date });
      onDone(r?.message || t('أُنهيت خدمة المركبة', 'Service ended'));
    } catch (e: any) {
      if (e?.code === 'VEHICLE_AUTHORIZED') setBlocked(e.message);
      else setErr(e?.message || t('تعذّر إنهاء الخدمة', 'Could not end service'));
    }
    setSaving(false);
  };

  const cancelFirst = async () => {
    if (await revoke(v)) setBlocked('');
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2"><Archive className="w-5 h-5 text-slate-500" />{t('إنهاء خدمة المركبة', 'End vehicle service')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4"><bdi>{v.plateNumber}</bdi></p>

        {blocked ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 space-y-3">
            <p className="text-[13.5px] font-semibold text-red-800">{blocked}</p>
            <button onClick={cancelFirst}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">
              <UserMinus className="w-4 h-4" />{t('إلغاء التفويض', 'Cancel authorisation')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
              {t('تنتقل المركبة إلى «الأرشيف» بكلّ بياناتها وسجلّها (التفاويض والمستندات والحوادث والتجديدات)، وتخرج من سجلّ المركبات والتحليلات والتنبيهات وقوائم النقل الخفيف. ويمكن إعادتها لاحقًا.',
                'The vehicle moves to the Archive with all its data and history, and leaves the registry, analytics, alerts and light-transport lists. It can be restored later.')}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('سبب إنهاء الخدمة *', 'Reason *')}</label>
              <textarea className={`${inp} min-h-[80px]`} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={t('مثال: انتهاء عقد الإيجار وإعادة المركبة للمؤجِّر', 'e.g. lease ended, vehicle returned to the lessor')} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('تاريخ إنهاء الخدمة *', 'End date *')}</label>
              <input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {err && <p className="text-[12.5px] text-red-600">{err}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{t('إغلاق', 'Close')}</button>
          {!blocked && (
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />} {t('إنهاء الخدمة', 'End service')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Lifecycle actions for a screen. Render `element` once; call `revoke`, `endService`, `restore` from rows or headers.
 * `revokeEndpoint` lets a section call its own route to the same service (B2C: /api/light-transport/vehicles/:id/revoke-authorization).
 */
export function useVehicleLifecycle({ ar, onChanged, revokeEndpoint, source }: {
  ar: boolean; onChanged?: Done; revokeEndpoint?: (id: string) => string; source?: string;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { confirm, notify } = useDialog();
  const [ending, setEnding] = useState<LifecycleVehicle | null>(null);

  const revoke = useCallback(async (v: LifecycleVehicle): Promise<boolean> => {
    const who = v.authorizedPerson?.name || '';
    if (!(await confirm({
      title: t('إلغاء التفويض', 'Cancel authorisation'),
      tone: 'danger',
      confirmLabel: t('إلغاء التفويض', 'Cancel authorisation'),
      message: t(
        `سيُلغى تفويضُ ${who ? `«${who}»` : 'المفوَّض'} على المركبة ${v.plateNumber}: يزول اسمُ المفوَّض ورقمُ التفويض وتاريخُه من سجلّ المركبات ومن ملفّ الموظّف ومن النقل الخفيف. المركبة تبقى في السجلّ.`,
        `The authorisation of ${who ? `"${who}"` : 'the holder'} on ${v.plateNumber} will be cancelled: the holder, number and dates go from the registry, the employee file and light transport. The vehicle stays.`),
    }))) return false;
    try {
      const url = revokeEndpoint ? revokeEndpoint(v._id) : `/api/vehicle-registry/${v._id}/authorization`;
      const body = revokeEndpoint ? {} : { action: 'revoke', source: source || 'registry' };
      const r = await api.post<{ message: string }>(url, body);
      notify(r?.message || t('أُلغي التفويض', 'Authorisation cancelled'), 'success');
      onChanged?.();
      return true;
    } catch (e: any) {
      notify(e?.message || t('تعذّر إلغاء التفويض', 'Could not cancel'), 'error');
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar, confirm, notify, onChanged, revokeEndpoint, source]);

  const restore = useCallback(async (v: LifecycleVehicle): Promise<boolean> => {
    if (!(await confirm({
      title: t('إعادة المركبة', 'Restore vehicle'),
      confirmLabel: t('إعادة إلى السجلّ', 'Restore'),
      message: t(`ستعود المركبة ${v.plateNumber} إلى سجلّ المركبات وتُحسب في التحليلات والقوائم من جديد.`,
        `${v.plateNumber} will return to the registry and count in analytics and lists again.`),
    }))) return false;
    try {
      const r = await api.post<{ message: string }>(`/api/vehicle-registry/${v._id}/restore`, {});
      notify(r?.message || t('أُعيدت المركبة', 'Restored'), 'success');
      onChanged?.();
      return true;
    } catch (e: any) {
      notify(e?.message || t('تعذّرت الإعادة', 'Could not restore'), 'error');
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar, confirm, notify, onChanged]);

  const element = ending ? (
    <EndServiceModal v={ending} ar={ar} revoke={revoke}
      onClose={() => setEnding(null)}
      onDone={(msg) => { notify(msg, 'success'); setEnding(null); onChanged?.(); }} />
  ) : null;

  return { revoke, endService: setEnding as (v: LifecycleVehicle) => void, restore, element };
}

/** Small row buttons, same look on every table. */
export function RevokeButton({ ar, onClick }: { ar: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      title={ar ? 'إلغاء التفويض — المركبة تبقى' : 'Cancel authorisation — the vehicle stays'}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11.5px] font-semibold hover:bg-red-100 whitespace-nowrap">
      <UserMinus className="w-3.5 h-3.5" />{ar ? 'إلغاء التفويض' : 'Cancel auth.'}
    </button>
  );
}

export function EndServiceButton({ ar, onClick, onDark }: { ar: boolean; onClick: () => void; onDark?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      title={ar ? 'إنهاء خدمة المركبة ونقلها إلى الأرشيف' : 'End service and move to the archive'}
      className={onDark
        ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium'
        : 'inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 text-[11.5px] font-semibold hover:bg-slate-100 whitespace-nowrap'}>
      <Archive className={onDark ? 'w-4 h-4' : 'w-3.5 h-3.5'} />{ar ? 'إنهاء الخدمة' : 'End service'}
    </button>
  );
}

export function RestoreButton({ ar, onClick, onDark }: { ar: boolean; onClick: () => void; onDark?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={onDark
        ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold'
        : 'inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11.5px] font-semibold hover:bg-emerald-100 whitespace-nowrap'}>
      <ArchiveRestore className={onDark ? 'w-4 h-4' : 'w-3.5 h-3.5'} />{ar ? 'إعادة إلى السجلّ' : 'Restore'}
    </button>
  );
}
