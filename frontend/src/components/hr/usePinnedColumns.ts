'use client';
/**
 * أعمدةٌ ثابتة على يمين جداول الموارد البشريّة — الإجراءات، ثمّ الرقم الوظيفيّ
 * والاسم والهويّة — والباقي يتحرّك تحتها.
 *
 * جداولُ القسم أعرضُ من الشاشة (الماستر وحده عشراتُ الأعمدة)، ومن مرّر إلى
 * تاريخٍ في آخر الجدول لم يعد يعرف لمن هو، ولا يجد زرَّ التعديل إلّا بالعودة.
 * فتُثبَّت هويّةُ الصفّ وأفعالُه في الأوّل.
 *
 * ── العرضُ يُقاس ولا يُفترَض ────────────────────────────────────────────────
 * لتثبيت أعمدةٍ متجاورة لا بدّ لكلٍّ أن يعرف أين ينتهي ما قبله. والعرضُ يتغيّر
 * باللغة وطول الأسماء، فيُقاس من الترويسة بـ ResizeObserver ويُجمع. و`start`
 * لا `left`: يتبع اتّجاه الصفحة فيصحّ في العربيّة والإنجليزيّة.
 *
 * والخليّةُ الثابتة تحمل خلفيّةً صريحة — وإلّا رُئيت الأعمدةُ الجارية من تحتها.
 * والصفُّ يحمل `group` ليبقى تلوينُ المرور عليه في الجزء الثابت كذلك.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function usePinnedColumns(count: number) {
  const [widths, setWidths] = useState<number[]>(() => Array(count).fill(0));
  const observers = useRef<(ResizeObserver | null)[]>([]);

  useEffect(() => () => { observers.current.forEach((o) => o?.disconnect()); }, []);

  const refs = useMemo(() => Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
    observers.current[i]?.disconnect();
    observers.current[i] = null;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidths((prev) => (Math.abs((prev[i] || 0) - w) < 0.5 ? prev : prev.map((x, j) => (j === i ? w : x))));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const o = new ResizeObserver(measure);
      o.observe(el);
      observers.current[i] = o;
    }
  }), [count]);

  const offset = useCallback((i: number) => widths.slice(0, i).reduce((a, b) => a + b, 0), [widths]);

  /** خصائصُ ترويسةِ العمود الثابت رقم i. */
  const th = useCallback((i: number, extra = '') => ({
    ref: refs[i],
    className: `sticky z-30 bg-slate-900 ${i === count - 1 ? 'border-e border-slate-600' : ''} ${extra}`,
    style: { insetInlineStart: offset(i) },
  }), [refs, offset, count]);

  /** خصائصُ خليّةِ العمود الثابت رقم i في صفّ. */
  const td = useCallback((i: number, extra = '', bg = 'bg-white group-hover:bg-slate-50') => ({
    className: `sticky z-20 ${bg} ${i === count - 1 ? 'border-e border-slate-200' : ''} ${extra}`,
    style: { insetInlineStart: offset(i) },
  }), [offset, count]);

  return { th, td };
}
