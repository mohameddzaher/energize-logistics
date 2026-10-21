'use client';
/**
 * هويّةُ الشاحنة من سجلّ المركبات — وما يقوله جهازُ لوكيشن بجانبها.
 *
 * الشاحنةُ سجلٌّ واحدٌ في النظام كلِّه (VehicleMaster)، ومرآةُ Wialon مرجعٌ إليه
 * لا نسخةٌ منه. فاللوحةُ والماركةُ والطرازُ والسنةُ والشاسيه والقطاعُ والمستنداتُ
 * تُقرأ من السجلّ، وسنةُ الجهاز وشاسيهه تُعرضان «حسب الجهاز» — وحيث يختلفان
 * يُرفع العلَم، والتصحيحُ في السجلّ. راجع backend/src/services/ls2VehicleLink.js.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp, Database } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { stateMeta, docLabel, fmtDate } from '@/lib/vehicleRegistry';
import type { Lang, Vehicle } from '@/lib/ls2';

const DOCS = ['vehicleLicense', 'inspection', 'insurance', 'operatingCard', 'authorization'] as const;

/** علَمٌ صغير: الجهازُ يخالف السجلّ — أو الوحدةُ غير مربوطة به. */
export function ConflictFlag({ v, lang }: { v: Pick<Vehicle, 'registry' | 'conflicts'>; lang: Lang }) {
  const ar = lang === 'ar';
  if (!v.registry) {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]" title={ar ? 'لا مركبةَ لها في سجلّ المركبات' : 'Not linked to the vehicle registry'}><Database className="w-3 h-3" />{ar ? 'غير مربوطة' : 'Unlinked'}</span>;
  }
  const n = (v.conflicts?.year ? 1 : 0) + (v.conflicts?.vin ? 1 : 0);
  if (!n) return null;
  const what = [v.conflicts?.year ? (ar ? 'سنة الصنع' : 'year') : '', v.conflicts?.vin ? (ar ? 'رقم الشاسيه' : 'VIN') : ''].filter(Boolean).join(ar ? ' و' : ' & ');
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]" title={ar ? `الجهاز يخالف السجلّ في ${what}` : `Device disagrees with the registry on ${what}`}><AlertTriangle className="w-3 h-3" />{ar ? 'تعارض' : 'Mismatch'}</span>;
}

function Field({ label, value, mono, warn, sub }: { label: string; value?: string | number | null; mono?: boolean; warn?: boolean; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`truncate ${mono ? 'font-mono text-[11px]' : 'font-medium'} ${warn ? 'text-amber-700' : 'text-slate-800'}`} title={value != null ? String(value) : ''}>{value != null && value !== '' ? value : '—'}</p>
      {sub ? <p className={`text-[10px] truncate ${warn ? 'text-amber-700' : 'text-slate-400'}`} title={sub}>{sub}</p> : null}
    </div>
  );
}

/** بطاقةُ الهويّة: السجلُّ أوّلًا، والجهازُ تحته حيث يُقارَن. */
export function RegistryIdentityCard({ v, lang }: { v: Pick<Vehicle, 'registry' | 'conflicts' | 'profile'>; lang: Lang }) {
  const ar = lang === 'ar';
  const r = v.registry;
  const dev = ar ? 'حسب الجهاز' : 'per device';
  if (!r) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
        {ar ? 'هذه الوحدة غير مربوطة بمركبةٍ في سجلّ المركبات — لوحتُها لا تطابق أيّ لوحةٍ هناك.' : 'This unit is not linked to a vehicle in the registry — its plate matches none there.'}
        {(v.profile?.vin || v.profile?.modelYear) ? <span className="block mt-1 text-slate-500">{dev}: {[v.profile?.brand, v.profile?.modelYear, v.profile?.vin].filter(Boolean).join(' · ')}</span> : null}
      </div>
    );
  }
  const yc = v.conflicts?.year; const vc = v.conflicts?.vin;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <Database className="w-3.5 h-3.5" />
        <span>{ar ? 'من سجلّ المركبات' : 'From the vehicle registry'}</span>
        <Link href={`/system/vehicles/registry/${r._id}`} className="text-[#f37121] hover:underline" onClick={(e) => e.stopPropagation()}>{ar ? 'فتح في السجلّ' : 'Open in registry'}</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
        <Field label={ar ? 'اللوحة' : 'Plate'} value={r.plateNumber} />
        <Field label={ar ? 'الماركة والطراز' : 'Brand & model'} value={[r.brand, r.model].filter(Boolean).join(' · ')} sub={v.profile?.brand ? `${dev}: ${v.profile.brand}` : undefined} />
        <Field label={ar ? 'سنة الصنع' : 'Model year'} value={r.modelYear} warn={!!yc} sub={v.profile?.modelYear ? `${dev}: ${v.profile.modelYear}${yc ? (ar ? ' — يخالف السجلّ' : ' — differs') : ''}` : undefined} />
        <Field label={ar ? 'رقم الشاسيه' : 'Chassis no.'} value={r.chassisNumber} mono warn={!!vc && !vc.partial} sub={v.profile?.vin ? `${dev}: ${v.profile.vin}${vc ? (vc.partial ? (ar ? ' — جزئيّ' : ' — partial') : (ar ? ' — يخالف السجلّ' : ' — differs')) : ''}` : undefined} />
        <Field label={ar ? 'القطاع' : 'Sector'} value={r.sector} />
        <Field label={ar ? 'حالة الخدمة' : 'Service status'} value={r.serviceStatus} />
        <Field label={ar ? 'المفوَّض' : 'Authorised person'} value={r.authorizedPerson} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DOCS.map((k) => {
          const d = r.docs?.[k];
          if (!d) return null;
          const m = stateMeta(d.state);
          return (
            <span key={k} className={`px-2 py-0.5 rounded-full text-[11px] ${m.bg}`} title={ar ? m.ar : m.en}>
              {docLabel(k, ar)}: {d.expiryDate ? fmtDate(d.expiryDate) : (ar ? m.ar : m.en)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface ConflictRow { unitId: number; plate: string; registryPlate: string; vehicleMaster: string | null; field: 'year' | 'vin'; registry: string; device: string; partial?: boolean }
interface ConflictsRes { items: ConflictRow[]; unlinked: { unitId: number; plate: string }[]; counts: { year: number; vin: number; vinPartial: number; unlinked: number; units: number } }

/**
 * «تعارضات البيانات» — كلُّ شاحنةٍ يخالف جهازُها السجلَّ في سنة الصنع أو رقم
 * الشاسيه. السجلُّ هو المرجع: من يفتح السطرَ يصحّح السجلَّ إن كان هو المخطئ،
 * فيختفي السطرُ في اللحظة نفسها (`vreg:updated`).
 */
export function RegistryConflictsPanel({ lang }: { lang: Lang }) {
  const ar = lang === 'ar';
  const [data, setData] = useState<ConflictsRes | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.get<ConflictsRes>('/api/ls2/registry-conflicts')); } catch { /* keep */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', load);
  useSocket('ls2:updated', load);
  if (!data) return null;
  const total = data.counts.year + data.counts.vin + data.counts.unlinked;
  if (!total) return null;
  return (
    <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-amber-50 text-amber-900 text-sm">
        <span className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" />{ar ? 'تعارضات البيانات' : 'Data conflicts'}</span>
        <span className="flex items-center gap-3 text-xs">
          <span>{ar ? 'سنة الصنع' : 'Year'}: {data.counts.year}</span>
          <span>{ar ? 'رقم الشاسيه' : 'VIN'}: {data.counts.vin}{data.counts.vinPartial ? ` (${ar ? 'جزئيّ' : 'partial'} ${data.counts.vinPartial})` : ''}</span>
          {data.counts.unlinked ? <span>{ar ? 'غير مربوطة' : 'Unlinked'}: {data.counts.unlinked}</span> : null}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="p-3 space-y-2">
          <p className="text-xs text-slate-500">{ar ? 'سجلُّ المركبات هو المرجع، والجهازُ شاهدٌ عليه. افتح المركبة في السجلّ وصحّح ما كان خطأً هناك؛ وإن كان الخطأ في الجهاز فيُصحَّح في لوكيشن سوليوشن.' : 'The vehicle registry is the reference; the device is a witness. Open the vehicle in the registry and correct it there, or correct the device in Location Solutions.'}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-start font-medium px-2 py-1.5">{ar ? 'اللوحة' : 'Plate'}</th>
                  <th className="text-start font-medium px-2 py-1.5">{ar ? 'الحقل' : 'Field'}</th>
                  <th className="text-start font-medium px-2 py-1.5">{ar ? 'في السجلّ' : 'Registry'}</th>
                  <th className="text-start font-medium px-2 py-1.5">{ar ? 'حسب الجهاز' : 'Per device'}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={`${c.unitId}-${c.field}`} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 whitespace-nowrap"><Link href={`/system/ls2/${c.unitId}`} className="text-slate-800 hover:underline">{c.registryPlate || c.plate}</Link><span className="block text-[10px] text-slate-400">{c.plate}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{c.field === 'year' ? (ar ? 'سنة الصنع' : 'Model year') : (ar ? 'رقم الشاسيه' : 'Chassis no.')}{c.partial ? <span className="ms-1 text-[10px] text-slate-500">({ar ? 'جزئيّ' : 'partial'})</span> : null}</td>
                    <td className="px-2 py-1.5 font-mono">{c.registry}</td>
                    <td className="px-2 py-1.5 font-mono text-amber-700">{c.device}</td>
                    <td className="px-2 py-1.5 text-end">{c.vehicleMaster ? <Link href={`/system/vehicles/registry/${c.vehicleMaster}`} className="text-[#f37121] hover:underline whitespace-nowrap">{ar ? 'فتح في السجلّ' : 'Open in registry'}</Link> : null}</td>
                  </tr>
                ))}
                {data.unlinked.map((u) => (
                  <tr key={`u-${u.unitId}`} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 whitespace-nowrap"><Link href={`/system/ls2/${u.unitId}`} className="text-slate-800 hover:underline">{u.plate}</Link></td>
                    <td className="px-2 py-1.5" colSpan={4}>{ar ? 'لا مركبةَ بهذه اللوحة في سجلّ المركبات' : 'No vehicle with this plate in the registry'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
