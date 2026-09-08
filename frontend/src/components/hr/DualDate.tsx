'use client';
/**
 * تاريخٌ بوجهين — ميلاديٌّ وهجريّ، يُحرَّر أيُّهما فيتبعه الآخر.
 *
 * ── ولماذا حقلٌ واحدٌ بوجهين لا حقلان ────────────────────────────────────
 * التاريخُ في القاعدة لحظةٌ واحدة، والتقويمُ طريقةُ كتابتها. فلو خُزِّن
 * الوجهان لأمكن أن يفترقا — ولا يُعرف حينئذٍ أيُّهما الصحيح. وقد رأينا ثمنَ
 * ذلك: واحدٌ وثلاثون تاريخًا هجريًّا كُتب في خانةٍ ميلاديّة فقُرئ سنةَ ١٤٤٩
 * ميلاديّة، فقالت الشاشةُ «متأخّر ٢١٠٩٨٧ يومًا» عن شهادةٍ سارية.
 *
 * فالمحفوظُ ميلاديٌّ دائمًا، والهجريُّ عرضٌ يُحسَب — ويُكتَب فيه فيُترجَم في
 * الحال. راجع lib/hijri.
 */
import { useEffect, useState } from 'react';
import { gregorianToHijri, hijriToGregorian } from '@/lib/hijri';

export default function DualDate({ value, onChange, ar, disabled, className }: {
  /** الميلاديّ «yyyy-mm-dd» — وهو وحدَه ما يُحفَظ. */
  value: string;
  onChange: (gregorian: string) => void;
  ar: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [hijri, setHijri] = useState('');

  // الهجريُّ يتبع الميلاديَّ إلّا وقتَ الكتابة فيه — وإلّا أُعيدت صياغةُ ما
  // يكتبه المستخدمُ تحت أصابعه.
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setHijri(gregorianToHijri(value)); }, [value, typing]);

  const box = 'px-2 py-1.5 rounded-lg border border-slate-300 text-sm w-full disabled:opacity-60';

  return (
    <div className={`grid grid-cols-2 gap-1.5 ${className || ''}`}>
      <label className="block">
        <span className="block text-[10px] text-slate-400 mb-0.5">{ar ? 'ميلادي' : 'Gregorian'}</span>
        <input type="date" value={value || ''} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} className={box} />
      </label>
      <label className="block">
        <span className="block text-[10px] text-slate-400 mb-0.5">{ar ? 'هجري' : 'Hijri'}</span>
        <input
          value={hijri}
          disabled={disabled}
          placeholder="1449-01-09"
          onFocus={() => setTyping(true)}
          onBlur={() => { setTyping(false); setHijri(gregorianToHijri(value)); }}
          onChange={(e) => {
            const v = e.target.value;
            setHijri(v);
            // لا يُترجَم إلّا تاريخٌ تامّ — وإلّا قفز الميلاديُّ مع كلّ حرف.
            const g = hijriToGregorian(v);
            if (g) onChange(g);
          }}
          className={`${box} tabular-nums`} />
      </label>
    </div>
  );
}
