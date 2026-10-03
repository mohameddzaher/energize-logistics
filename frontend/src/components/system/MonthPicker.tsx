'use client';
/**
 * منتقي الشهر — سنةٌ وشهرٌ، لا `input type="month"`.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * `input type="month"` لا يدعمه سفاري على الحاسوب ولا فايرفوكس: يرسمه كلٌّ منهما
 * **خانةَ نصٍّ عاديّة** بلا منتقٍ ولا تحقّق. فمن يفتح الشاشةَ بأحدهما يرى مربّعًا
 * فارغًا لا يفتح شيئًا — «مش عارف أختار شهر» — بينما يعمل عند من يفتحها بكروم.
 * والعطبُ صامتٌ تمامًا: لا خطأ في السجلّ، ولا شيءَ في الشاشة إلّا خانةٌ لا
 * تستجيب. وهو منتشرٌ في اثنتي عشرةَ شاشةً: سير العمل والمحفظة والتقارير
 * والمبيعات ولوحةُ العهدة وسجلّات المركبات وتفقّد الدوام.
 *
 * ── والحلُّ قائمتان لا تقويم ───────────────────────────────────────────────
 * الشهرُ ليس تاريخًا يُنتقى من تقويم: هو اثنا عشرَ خيارًا وسنةٌ. وقائمتان
 * تعملان في كلّ متصفّحٍ بلا استثناء، وتُقرآن بالعربيّة كما تُنطَق («سبتمبر
 * ٢٠٢٦») بدل «2026-09» التي يكتبها الحقلُ الأصليّ بالإنجليزيّة مهما كانت لغةُ
 * الشاشة.
 *
 * والقيمةُ تبقى «YYYY-MM» كما كانت، فلا يتغيّر شيءٌ عند من يستعملها ولا في
 * الخادم.
 */
import { useMemo } from 'react';

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthPicker({
  value, onChange, ar, className, fromYear, toYear, allowEmpty = true, label,
}: {
  /** «YYYY-MM» أو فارغ. */
  value: string;
  onChange: (v: string) => void;
  ar: boolean;
  className?: string;
  /** حدودُ السنوات — الافتراضيُّ من ٢٠٢٣ إلى العام القادم. */
  fromYear?: number;
  toYear?: number;
  /** أيُقبل «بلا شهر»؟ شاشاتُ الفلترة تقبله، وشاشاتُ الإدخال لا. */
  allowEmpty?: boolean;
  label?: string;
}) {
  const now = new Date();
  const y0 = fromYear ?? 2023;
  const y1 = toYear ?? now.getFullYear() + 1;
  const years = useMemo(
    () => Array.from({ length: Math.max(1, y1 - y0 + 1) }, (_, i) => y1 - i),
    [y0, y1],
  );

  const [curY, curM] = (value || '').split('-');
  const months = ar ? MONTHS_AR : MONTHS_EN;
  const box = 'px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40';

  /** تغييرُ أحد الطرفين يكمّل الآخرَ بالحاليّ — فلا تبقى قيمةٌ نصفَ مكتوبة. */
  const emit = (y: string, m: string) => {
    if (!y && !m) { onChange(''); return; }
    const yy = y || String(now.getFullYear());
    const mm = m || String(now.getMonth() + 1).padStart(2, '0');
    onChange(`${yy}-${mm}`);
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className || ''}`} role="group" aria-label={label || (ar ? 'اختر الشهر' : 'Pick month')}>
      <select
        value={curM || ''}
        onChange={(e) => emit(curY || '', e.target.value)}
        aria-label={ar ? 'الشهر' : 'Month'}
        className={box}
      >
        {allowEmpty && <option value="">{ar ? 'الشهر' : 'Month'}</option>}
        {months.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>
        ))}
      </select>
      <select
        value={curY || ''}
        onChange={(e) => emit(e.target.value, curM || '')}
        aria-label={ar ? 'السنة' : 'Year'}
        className={box}
      >
        {allowEmpty && <option value="">{ar ? 'السنة' : 'Year'}</option>}
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
    </span>
  );
}
