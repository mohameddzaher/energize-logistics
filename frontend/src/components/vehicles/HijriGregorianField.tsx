'use client';
import { useState, useEffect } from 'react';
import { toHijriPlain, fromHijri } from '@/lib/vehicleRegistry';

/**
 * HijriGregorianField — خانتان لتاريخٍ واحد: هجريّةٌ وميلاديّة، كلٌّ تُسمِع الأخرى.
 *
 * ── لماذا اثنتان ───────────────────────────────────────────────────────────
 * أوراقُ المرور والفحص تُصدَر بالهجريّ، والموظّفُ يقرأ الورقةَ التي في يده.
 * وكانت الخانةُ ميلاديّةً وحدَها، فيحوّل بيده أو بهاتفه ثمّ يكتب — وكلُّ تحويلٍ
 * بيدٍ خطأٌ ينتظر. والعرضُ في الجداول كان بالتقويمين معًا أصلًا، فليكن الإدخالُ
 * كذلك.
 *
 * والمحفوظُ واحدٌ لا اثنان: الميلاديُّ هو ما يُخزَّن ويُحسَب به العمر، والهجريُّ
 * مشتقٌّ منه — راجع toHijri/fromHijri في lib/vehicleRegistry. فلا يفترقان أبدًا
 * كما يفترق عمودان يُملآن باليد.
 *
 * ويُكتب في أيِّهما شاء: ما يُكتب هجريًّا يصير ميلاديًّا في اللحظة، والعكس.
 * وما دام الهجريُّ ناقصًا (يكتب أوّلَ رقمين) لا يُمحى الميلاديُّ من تحته —
 * تُترَك الخانةُ كما هي حتى يكتمل ما يُقرأ.
 */
export default function HijriGregorianField({
  value, onChange, ar, inp, min, max, autoFocus,
}: {
  value: string; onChange: (v: string) => void; ar: boolean; inp: string;
  /** حدودُ التاريخ الميلاديّ (`YYYY-MM-DD`) — تُطبَّق على الخانتين معًا. */
  min?: string; max?: string; autoFocus?: boolean;
}) {
  const [hijri, setHijri] = useState(() => toHijriPlain(value));
  // ── والحدُّ يُطبَّق على الهجريّ كما يُطبَّق على الميلاديّ ─────────────────
  // خانةُ التاريخ الميلاديّة تمنع ما دون `min` بنفسها، والهجريّةُ نصٌّ لا يعرف
  // حدًّا. فلولا هذا الفحصُ لكُتب تاريخُ نهايةٍ قبل البداية بالهجريّ ومرّ.
  const [outOfRange, setOutOfRange] = useState(false);
  // التاريخُ قد يتغيّر من خارج الخانة (فتحُ صفٍّ آخر، أو زرُّ تجديد) — فالهجريُّ
  // يتبعه ما دام المستخدمُ لا يكتب فيه الآن.
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setHijri(toHijriPlain(value)); }, [value, typing]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <input type="date" value={value || ''} onChange={(e) => { setOutOfRange(false); onChange(e.target.value); }}
          className={inp} min={min} max={max} autoFocus={autoFocus} />
        <p className="text-[10px] text-slate-400 mt-0.5">{ar ? 'ميلادي' : 'Gregorian'}</p>
      </div>
      <div>
        <input
          type="text" dir="ltr" inputMode="numeric" placeholder="1448/04/04"
          value={hijri}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(e) => {
            setHijri(e.target.value);
            const g = fromHijri(e.target.value);
            if (!g) return;
            if ((min && g < min) || (max && g > max)) { setOutOfRange(true); return; }
            setOutOfRange(false);
            onChange(g);
          }}
          className={`${inp} font-mono`} />
        <p className={`text-[10px] mt-0.5 ${outOfRange ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
          {outOfRange
            ? (ar ? 'التاريخ خارج المسموح' : 'Date out of range')
            : (ar ? 'هجري — يُسمِع الميلاديّ' : 'Hijri — fills the Gregorian')}
        </p>
      </div>
    </div>
  );
}

