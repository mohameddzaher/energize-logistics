'use client';
// VehicleAssets — the workshop-registry section of a vehicle profile: which
// physical tires (by serial) and which trailer are on THIS truck right now,
// plus its asset movement history ("what was on it, what is on it now").
// Read-only here — moves are made on /system/ls2/fleet-assets — and it renders
// nothing at all if the plate has no registry data yet (fleet not imported).
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CircleDot, Container, History, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import { fmtDateTime, plateDigitsKey, type Lang } from '@/lib/ls2';

interface TireAsset { _id: string; tireNumber: string; serial: string; type: string; sensor: 'yes' | 'no' | 'unknown'; positionNumber: number | null; positionLabel: string; section: string; isSpare?: boolean }
interface AssetEvent { _id: string; entityType: string; label: string; action: string; fromPlate: string | null; fromPosition: string; toPlate: string | null; toPosition: string; date: string; reason: string; notes: string; performedByName: string }
interface Payload { flatbed: { numbering: number | null; batch: string; brand: string; currentTrailerNumber: string | null } | null; trailer: { trailerNumber: string } | null; tires: TireAsset[]; events: AssetEvent[] }

const ACTION_AR: Record<string, string> = { registered: 'تسجيل', mounted: 'تركيب', removed: 'إنزال', transferred: 'نقل', retired: 'إعدام', updated: 'تعديل' };
const ACTION_EN: Record<string, string> = { registered: 'Registered', mounted: 'Mounted', removed: 'Removed', transferred: 'Transferred', retired: 'Retired', updated: 'Edited' };
const ENTITY_AR: Record<string, string> = { tire: 'فردة', trailer: 'تيدر', flatbed: 'سطحة' };

export default function VehicleAssets({ plate, lang }: { plate?: string | null; lang: Lang }) {
  const ar = lang === 'ar';
  const [data, setData] = useState<Payload | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    if (!plate) return;
    try { setData(await api.get<Payload>(`/api/ls2/assets/vehicle/${encodeURIComponent(plate)}`)); } catch { /* section stays hidden */ }
  }, [plate]);
  useEffect(() => { load(); }, [load]);

  if (!data || (!data.flatbed && !data.trailer && !data.tires.length && !data.events.length)) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-[#f37121]" />
          {ar ? 'الكاوتشات والتيدر (سجل الورشة)' : 'Tires & Trailer (workshop registry)'}
        </h3>
        {/* The registry stores bare plate digits — searching the raw Wialon
            string ("ق ن ر 2708") there finds nothing. Link by the shared key. */}
        <Link
          href={`/system/ls2/fleet-assets?tab=tires&q=${encodeURIComponent(plateDigitsKey(plate))}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-xs font-medium"
        >
          <ExternalLink className="w-3.5 h-3.5" /> {ar ? 'استبدال / نقل كاوتش أو تيدر' : 'Replace / move tire or trailer'}
        </Link>
      </div>

      {/* Identity chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {data.flatbed?.numbering != null && (
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">{ar ? `ترقيم السطحة: ${data.flatbed.numbering}` : `Flatbed no. ${data.flatbed.numbering}`}</span>
        )}
        {data.flatbed?.batch && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{ar ? `الدفعة: ${data.flatbed.batch}` : `Batch ${data.flatbed.batch}`}</span>}
        {data.flatbed?.brand && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{data.flatbed.brand}</span>}
        {data.trailer
          ? <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium inline-flex items-center gap-1"><Container className="w-3.5 h-3.5" /> {ar ? `تيدر ${data.trailer.trailerNumber}` : `Trailer ${data.trailer.trailerNumber}`}</span>
          : <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-600">{ar ? 'بدون تيدر مسجّل' : 'No trailer registered'}</span>}
      </div>

      {/* Mounted tires */}
      {data.tires.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-start font-medium px-2 py-2">{ar ? 'الموقع' : 'Position'}</th>
                <th className="text-start font-medium px-2 py-2">{ar ? 'القسم' : 'Section'}</th>
                <th className="text-start font-medium px-2 py-2">{ar ? 'السيريال' : 'Serial'}</th>
                <th className="text-start font-medium px-2 py-2">{ar ? 'النوع' : 'Type'}</th>
                <th className="text-center font-medium px-2 py-2">{ar ? 'رقم الفردة' : 'Tire no.'}</th>
                <th className="text-center font-medium px-2 py-2">{ar ? 'سينسور' : 'Sensor'}</th>
              </tr>
            </thead>
            <tbody>
              {data.tires.map((t) => (
                <tr key={t._id} className="border-b border-slate-50">
                  <td className="px-2 py-1.5 text-slate-700">{t.positionLabel || (t.positionNumber != null ? `اطار ${t.positionNumber}` : '—')}</td>
                  <td className="px-2 py-1.5 text-slate-500">{t.section || '—'}</td>
                  <td className="px-2 py-1.5 font-mono font-medium text-slate-800">{t.serial}{t.isSpare && <span className="ms-1.5 inline-block px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-bold">{ar ? 'استبن' : 'spare'}</span>}</td>
                  <td className="px-2 py-1.5 text-slate-600">{t.type || '—'}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{t.tireNumber || '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {t.sensor === 'yes'
                      ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">{ar ? 'يوجد' : 'Yes'}</span>
                      : t.sensor === 'no'
                        ? <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{ar ? 'لا يوجد' : 'No'}</span>
                        : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Movement history (collapsed by default) */}
      {data.events.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
            <History className="w-3.5 h-3.5" /> {ar ? `سجل الحركات (${data.events.length})` : `Movement history (${data.events.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5">
              {data.events.map((e) => (
                <li key={e._id} className="text-xs text-slate-600 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(e.date, lang)}</span>
                  <span className="font-medium">{(ar ? ENTITY_AR[e.entityType] : e.entityType) || e.entityType} <span className="font-mono">{e.label}</span></span>
                  <span>{ar ? ACTION_AR[e.action] || e.action : ACTION_EN[e.action] || e.action}</span>
                  {(e.fromPlate || e.toPlate) && (
                    <span className="text-slate-500">
                      {[e.fromPlate, e.fromPosition].filter(Boolean).join(' · ') || '—'} ← {[e.toPlate, e.toPosition].filter(Boolean).join(' · ') || '—'}
                    </span>
                  )}
                  {e.reason && <span className="text-slate-400">({e.reason})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
