'use client';
/**
 * ScrollX — حاويةُ جدولٍ عريض، بشريطِ تمريرٍ أفقيٍّ **فوقه** أيضًا.
 *
 * ── لماذا ──────────────────────────────────────────────────────────────────
 * شريطُ التمرير الأفقيّ في المتصفّح يقع أسفلَ الجدول. وجداولُ التحصيل طويلة:
 * مَن أراد عمودًا خارج الشاشة في الصفوف الأولى نزل إلى آخر الجدول ليسحب، ثمّ صعد
 * يبحث عن صفّه. فهنا شريطٌ ثانٍ أعلى الجدول مربوطٌ به — يتحرّكان معًا —
 * ويلتصق بأعلى الشاشة وأنت تنزل، ومعه سهمان يقفزان صفحةً من الأعمدة.
 *
 * ولا يظهر إلّا إن كان الجدولُ أعرضَ من مكانه؛ فالجدولُ الذي يتّسع لا يُثقَل بشيء.
 *
 * ── ولماذا «يطفو» ولا يلتصق ────────────────────────────────────────────────
 * `position: sticky` لا يعمل هنا: بطاقاتُ الجداول `overflow-hidden` و<main>
 * `overflow-x-auto`، وكلاهما يصير حاويةَ تمريرٍ لا تتحرّك فيلتصق الشريطُ بها لا
 * بالشاشة. فحين يتجاوز رأسُ الجدول أعلى الشاشة يُثبَّت الشريطُ `fixed` تحت
 * ترويسة النظام بعرض الجدول نفسِه، ويعود مكانَه حين يرجع الجدولُ إلى الأعلى.
 *
 * ── الاتّجاه ────────────────────────────────────────────────────────────────
 * في العربيّة يبدأ الجدولُ من اليمين و`scrollLeft` سالبٌ (كروم/سفاري/فايرفوكس
 * الحديثة). والشريطان في الاتّجاه نفسِه فتُنسَخ القيمةُ بينهما كما هي؛ أمّا
 * السهمان فيُحسبان بالقيمة المطلقة ليصحّا في الاتّجاهين.
 *
 * ── والشريطُ مرسومٌ لا شريطَ المتصفّح ──────────────────────────────────────
 * شريطُ النظام على الماك (ولوحةُ اللمس) يختفي حتى تتحرّك، فيبدو المكانُ فارغًا
 * ولا يُعرف أنّ هنا ما يُسحب. فالمسارُ والمقبضُ هنا مرسومان دائمًا: المقبضُ
 * يُسحب، والضغطُ على المسار يقفز إليه، وعجلةُ الفأرة فوقه تحرّك الجدول أفقيًّا.
 *
 * الاستعمال: ضعه مكان `<div className="overflow-x-auto">`، وتمرَّر إليه بقيّةُ
 * الخصائص (className، aria-busy…) كما هي.
 */
import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ScrollX({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const wrap = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const [float, setFloat] = useState<{ top: number; left: number; width: number } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ size: 100, pos: 0 });   // بالنسبة المئويّة من المسار
  const [over, setOver] = useState(false);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = main.current;
    if (!el) return;
    setOver(el.scrollWidth > el.clientWidth + 1);
    const max = el.scrollWidth - el.clientWidth;
    // حجمُ المقبض = الظاهرُ من الجدول؛ وموضعُه = ما مضى منه (من بدايته).
    const size = el.scrollWidth ? Math.max(8, (el.clientWidth / el.scrollWidth) * 100) : 100;
    const progress = max > 0 ? Math.min(1, Math.abs(el.scrollLeft) / max) : 0;
    setThumb({ size, pos: progress * (100 - size) });
    const rtl = getComputedStyle(el).direction === 'rtl';
    const pos = Math.abs(el.scrollLeft);                 // المسافةُ من بداية الجدول
    const atStart = pos <= 1;
    const atEnd = pos >= max - 1;
    // البداية يمينٌ في العربيّة ويسارٌ في الإنجليزيّة.
    setEdge(rtl ? { right: !atStart, left: !atEnd } : { left: !atStart, right: !atEnd });
  }, []);

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  // الطفو: رأسُ الجدول فوق حافّة الشاشة وجسمُه ما زال ظاهرًا.
  useEffect(() => {
    const place = () => {
      const w = wrap.current;
      if (!w) return;
      const header = document.querySelector('header');
      const hb = header ? header.getBoundingClientRect().bottom : 0;
      const offset = Math.max(0, hb);
      const r = w.getBoundingClientRect();
      const next = r.top < offset && r.bottom > offset + 80 ? { top: offset, left: r.left, width: r.width } : null;
      setFloat((p) => (p?.top === next?.top && p?.left === next?.left && p?.width === next?.width ? p : next));
    };
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true } as any);
      window.removeEventListener('resize', place);
    };
  }, []);
  // الشريطُ يتغيّر عرضُه حين يطفو ويعود — فيُعاد القياسُ ويُعاد الموضع.
  useEffect(() => {
    measure();
  }, [float, measure]);
  const sync = () => measure();

  // التقدّمُ ٠..١ من بداية الجدول ← scrollLeft بحسب الاتّجاه.
  const setProgress = (p: number) => {
    const el = main.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const v = Math.max(0, Math.min(1, p)) * max;
    el.scrollLeft = rtl ? -v : v;
  };
  const progressAt = (clientX: number) => {
    const tr = top.current;
    const el = main.current;
    if (!tr || !el) return 0;
    const r = tr.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const size = (thumb.size / 100) * r.width;
    const x = rtl ? r.right - clientX : clientX - r.left;   // المسافةُ من بداية المسار
    return (x - size / 2) / Math.max(1, r.width - size);
  };
  const drag = useRef<{ startX: number; startScroll: number } | null>(null);
  const onThumbDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = main.current;
    if (!el) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startScroll: el.scrollLeft };
  };
  const onThumbMove = (e: React.PointerEvent) => {
    const d = drag.current; const el = main.current; const tr = top.current;
    if (!d || !el || !tr) return;
    // بكسلُ المسار = (عرضُ الجدول ÷ عرضِ المسار) بكسلٍ من الجدول.
    const ratio = el.scrollWidth / Math.max(1, tr.clientWidth);
    el.scrollLeft = d.startScroll + (e.clientX - d.startX) * ratio;
  };
  const onThumbUp = () => { drag.current = null; };
  // العجلةُ فوق الشريط تحرّك الجدول أفقيًّا لا الصفحةَ عموديًّا — مستمعٌ أصليّ
  // غيرُ سلبيّ، لأنّ مستمعَ React سلبيٌّ ولا يمنع تمريرَ الصفحة.
  useEffect(() => {
    const tr = top.current;
    if (!tr) return;
    const onWheel = (e: WheelEvent) => {
      const el = main.current;
      if (!el) return;
      e.preventDefault();
      const rtl = getComputedStyle(el).direction === 'rtl';
      const dy = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      el.scrollLeft += rtl ? -dy : dy;
    };
    tr.addEventListener('wheel', onWheel, { passive: false });
    return () => tr.removeEventListener('wheel', onWheel);
  }, [over]);

  const jump = (dir: 1 | -1) => {
    const el = main.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const btn = 'shrink-0 p-1 rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:text-[#f37121] hover:border-[#f37121]/40 disabled:opacity-30 disabled:hover:text-slate-600 disabled:hover:border-slate-200';

  return (
    <div ref={wrap} className="relative">
      {over && float && <div className="h-[33px]" aria-hidden="true" />}
      {over && (
        <div style={float ? { position: 'fixed', top: float.top, left: float.left, width: float.width } : undefined}
          className={`z-40 flex items-center gap-1.5 px-2 py-1 bg-slate-50/95 backdrop-blur border-b border-slate-200 ${float ? 'shadow-md rounded-b-lg' : ''}`}>
          <button type="button" className={btn} disabled={!edge.right} onClick={() => jump(1)} aria-label="Scroll right">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div ref={top}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setProgress(progressAt(e.clientX)); }}
            className="group/track relative flex-1 h-3 rounded-full bg-slate-200/80 cursor-pointer" role="scrollbar"
            aria-orientation="horizontal" aria-valuenow={Math.round(thumb.pos)}>
            <div onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
              className="absolute top-0 bottom-0 rounded-full bg-slate-400 hover:bg-[#f37121] active:bg-[#f37121] cursor-grab active:cursor-grabbing transition-colors touch-none"
              style={{ width: `${thumb.size}%`, insetInlineStart: `${thumb.pos}%` }} />
          </div>
          <button type="button" className={btn} disabled={!edge.left} onClick={() => jump(-1)} aria-label="Scroll left">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
      <div ref={main} onScroll={sync} className={`overflow-x-auto ${className}`} {...rest}>
        {children}
      </div>
    </div>
  );
}
