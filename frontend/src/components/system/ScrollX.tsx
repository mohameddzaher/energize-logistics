'use client';
/**
 * ScrollX — حاويةُ جدولٍ عريض، بشريطِ تمريرٍ أفقيٍّ **فوقه** أيضًا.
 *
 * ── لماذا ──────────────────────────────────────────────────────────────────
 * شريطُ التمرير الأفقيّ في المتصفّح يقع أسفلَ الجدول. وجداولُ التحصيل طويلة:
 * مَن أراد عمودًا خارج الشاشة في الصفوف الأولى نزل إلى آخر الجدول ليسحب، ثمّ صعد
 * يبحث عن صفّه. فهنا شريطٌ ثانٍ أعلى الجدول مربوطٌ بالأوّل — يتحرّكان معًا —
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
  const lock = useRef<'main' | 'top' | null>(null);
  const [width, setWidth] = useState(0);
  const [over, setOver] = useState(false);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = main.current;
    if (!el) return;
    // مدى الشريط العلويّ = مدى الجدول، وإن كان الشريطُ أضيقَ (بين السهمين).
    const track = top.current?.clientWidth || el.clientWidth;
    setWidth(el.scrollWidth - el.clientWidth + track);
    setOver(el.scrollWidth > el.clientWidth + 1);
    const max = el.scrollWidth - el.clientWidth;
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
    if (top.current && main.current) top.current.scrollLeft = main.current.scrollLeft;
  }, [float, measure]);
  // الشريطان يتبادلان الموضع؛ والقفلُ يمنع أن يردّ كلٌّ منهما على صدى الآخر.
  const sync = (from: 'main' | 'top') => {
    const a = from === 'main' ? main.current : top.current;
    const b = from === 'main' ? top.current : main.current;
    if (!a || !b) return;
    if (lock.current && lock.current !== from) { lock.current = null; return; }
    lock.current = from;
    b.scrollLeft = a.scrollLeft;
    requestAnimationFrame(() => { if (lock.current === from) lock.current = null; });
    measure();
  };

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
          <div ref={top} onScroll={() => sync('top')}
            className="flex-1 overflow-x-auto overflow-y-hidden h-3 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 hover:[&::-webkit-scrollbar-thumb]:bg-[#f37121] [&::-webkit-scrollbar-track]:bg-slate-200/70 [&::-webkit-scrollbar-track]:rounded-full">
            <div style={{ width, height: 1 }} />
          </div>
          <button type="button" className={btn} disabled={!edge.left} onClick={() => jump(-1)} aria-label="Scroll left">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
      <div ref={main} onScroll={() => sync('main')} className={`overflow-x-auto ${className}`} {...rest}>
        {children}
      </div>
    </div>
  );
}
