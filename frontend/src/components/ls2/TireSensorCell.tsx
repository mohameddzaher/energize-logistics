'use client';
// خلية «حساسات الكاوتش» — الرقم الواحد الذي يقول من برّه أين وصلت حملة تسليح
// الأسطول بالحسّاسات: «٧ / ٥ / ٢».
//
//   أخضر  = فردةٌ مركَّبةٌ على الأرض وحسّاسها **يبثّ الآن**
//   أحمر  = باقي مواضع الأرض، بلا تغطية
//   الاستبن = عدده؛ أخضر إن كان مسلَّحًا، ورماديٌّ صامتٌ إن لم يكن
//
// وتُوضع في مكوّنٍ واحد تستدعيه الشاشتان بدل نسخها في كلٍّ منهما: لو نُسخت
// لاختلف لونٌ أو حدٌّ في إحداهما بعد أوّل تعديل، فيظنّ القارئ أنهما رقمان.
//
// الأرقام كلها تأتي محسوبةً من الخادم (services/ls2TireSensors.js)؛ هنا عرضٌ
// فقط — ولا يُشتقّ هنا شيء.
import { useState } from 'react';
import Link from 'next/link';
import { X, TriangleAlert, CircleDot, ExternalLink } from 'lucide-react';
import { ls2Text, type Lang, type TireSensorCoverage } from '@/lib/ls2';

export default function TireSensorCell({ cov, plate, unitId, lang }: {
  cov?: TireSensorCoverage | null;
  plate: string;
  unitId: number;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const t = ls2Text(lang);
  if (!cov) return <span className="text-slate-300">—</span>;

  const spareOn = cov.spareWithSensor > 0;
  return (
    <>
      <button
        type="button"
        // الصفّ نفسه يفتح ملف المركبة؛ لولا الإيقاف هنا لَما ظهرت النافذة أصلًا.
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`${t.tireSensorsWorking}: ${cov.withSensor} · ${t.tireSensorsMissing}: ${cov.withoutSensor} · ${t.tireSensorsSpare}: ${cov.spare}`}
        className="inline-flex items-center gap-1 tabular-nums font-bold text-[13px] rounded-lg px-2 py-1 hover:bg-slate-100 transition-colors"
      >
        <span className="text-emerald-600">{cov.withSensor}</span>
        <span className="text-slate-300 font-normal">/</span>
        <span className={cov.withoutSensor > 0 ? 'text-red-600' : 'text-slate-300'}>{cov.withoutSensor}</span>
        <span className="text-slate-300 font-normal">/</span>
        <span className={spareOn ? 'text-emerald-600' : 'text-slate-400 font-medium'}>{cov.spare}</span>
        {/* الصامت لا يُدمَج في الأخضر ولا يُخفى: علامةٌ كهرمانية تقول إن جزءًا من
            الأحمر حسّاساتٌ مركَّبةٌ معطّلة — وعلاجها استبدالٌ لا تركيب. */}
        {cov.silent > 0 && (
          <span className="ms-0.5 inline-flex items-center gap-0.5 text-amber-600 text-[11px] font-bold">
            <TriangleAlert className="w-3 h-3" />{cov.silent}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">{t.tireSensorsTitle}</h3>
                <p className="text-xs text-slate-500">{plate}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <span className="text-2xl font-bold tabular-nums">
                <span className="text-emerald-600">{cov.withSensor}</span>
                <span className="text-slate-300"> / </span>
                <span className={cov.withoutSensor > 0 ? 'text-red-600' : 'text-slate-300'}>{cov.withoutSensor}</span>
                <span className="text-slate-300"> / </span>
                <span className={spareOn ? 'text-emerald-600' : 'text-slate-400'}>{cov.spare}</span>
              </span>
              <div className="text-[11px] text-slate-600 leading-tight">
                <p><b className="text-emerald-600">{cov.withSensor}</b> {t.tireSensorsWorking}</p>
                <p><b className={cov.withoutSensor > 0 ? 'text-red-600' : 'text-slate-500'}>{cov.withoutSensor}</b> {t.tireSensorsMissing}</p>
                <p><b className={spareOn ? 'text-emerald-600' : 'text-slate-500'}>{cov.spare}</b> {t.tireSensorsSpare}{spareOn ? ` — ${cov.spareWithSensor} ${t.tireSensorsSpareOn}` : ''}</p>
              </div>
            </div>

            {cov.silent > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><TriangleAlert className="w-3.5 h-3.5" />{cov.silent} {t.tireSensorsSilent}</p>
                <p className="text-[11px] opacity-90">{t.tireSensorsSilentNote}</p>
                {cov.faultyChannels.length > 0 && (
                  <p className="text-[11px]">
                    {t.tireSensorsChannels}:{' '}
                    <span className="font-mono">{cov.faultyChannels.map((c) => `${c.axle ?? '?'}–${c.position ?? '?'}`).join('، ')}</span>
                  </p>
                )}
              </div>
            )}

            {cov.positionsWithoutSensor.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-600">{t.tireSensorsNoSensorList} ({cov.positionsWithoutSensor.length})</p>
                <ul className="text-xs text-slate-700 space-y-1">
                  {cov.positionsWithoutSensor.map((p) => (
                    <li key={`${p.positionNumber}-${p.serial}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1">
                      <CircleDot className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="flex-1 truncate">{p.positionLabel || (p.positionNumber != null ? `${lang === 'ar' ? 'اطار' : 'Tire'} ${p.positionNumber}` : '—')}{p.section ? ` — ${p.section}` : ''}</span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">{p.serial}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : cov.unregistered === 0 && cov.withoutSensor === 0 ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{t.tireSensorsAllCovered}</p>
            ) : null}

            {/* المواضع التي لم تُجرَد بعد ليست «بلا حسّاس»: هي مجهولة، والفرق
                يمنع أن يُقرأ نقصُ الجرد على أنه نقصُ تسليح. */}
            {cov.unregistered > 0 && (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                {cov.unregistered} {t.tireSensorsNotStocktaken}
              </p>
            )}

            <Link href={`/system/ls2/${unitId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f37121] hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />{t.tireSensorsOpenVehicle}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
