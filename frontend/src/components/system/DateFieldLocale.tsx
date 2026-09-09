'use client';
/**
 * خاناتُ التاريخ تُقرأ صحيحةً عند كلّ الناس.
 *
 * ── العطب ────────────────────────────────────────────────────────────────
 * `<input type="date">` وهي فارغةٌ تكتب صيغتَها من **إعداد المنطقة في جهاز
 * المستخدم** لا من صفحتنا. فمن كان جهازُه عربيًّا رأى «يوم/شهر/سنة» داخل خانةٍ
 * يفرضها كروم من اليسار إلى اليمين، فقرأها مقلوبةً «موي/رهش/ةنس». والشاشةُ
 * الواحدةُ تختلف بين اثنين يجلسان متجاورَين.
 *
 * ولا يُصلَح ذلك بـCSS ولا بـ`lang`: كروم يفرض `ltr` على الخانة فرضًا ويتجاهل
 * لغةَ العنصر — قِيسَ ذلك ولم يُخمَّن. راجع `styles/globals.css`.
 *
 * ── فما يفعله هذا الملفّ ─────────────────────────────────────────────────
 * يضع `data-empty="1"` على كلّ خانةٍ فارغة، فتُخفي CSS نصَّ المتصفّح وترسم
 * مكانَه `dd/mm/yyyy` — نصًّا نملكه، لاتينيًّا لا ينقلب، واحدًا عند الجميع.
 * ويُرفَع الوسمُ بمجرّد امتلائها فيعود نصُّها الأصليّ، وليس فيه حينئذٍ إلّا
 * الأرقام.
 *
 * ── ولماذا مراقبٌ للـDOM ─────────────────────────────────────────────────
 * الخاناتُ مئتان في سبعةٍ وثمانين ملفًّا، وأكثرُها داخل نوافذَ تُبنى عند فتحها
 * لا مع الصفحة. ولا يصحّ أن يُعتمَد على أن يتذكّر ذلك كاتبُ كلِّ شاشةٍ جديدة —
 * يُنسى مرّةً فيعود العطبُ في موضعٍ لا يُلحَظ.
 */
import { useEffect } from 'react';

// `time` مستثنًى: الساعةُ لا يختلف ترتيبُها بين اللغات كاختلاف التاريخ.
const TYPES = ['date', 'datetime-local', 'month', 'week'];
const SELECTOR = TYPES.map((t) => `input[type="${t}"]`).join(',');

function mark(el: Element) {
  const input = el as HTMLInputElement;
  if (input.value) input.removeAttribute('data-empty');
  else input.setAttribute('data-empty', '1');
}

function markAll(root: ParentNode) {
  root.querySelectorAll?.(SELECTOR).forEach(mark);
}

export default function DateFieldLocale() {
  useEffect(() => {
    markAll(document);

    // الخانةُ تمتلئ وتفرغ بعد رسمها، وقد تُملأ من الشيفرة لا من لوحة المفاتيح،
    // فيُلتقط الحدثان في مرحلة الالتقاط ليصل ما يقع داخل النوافذ أيضًا.
    const onChange = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.matches?.(SELECTOR)) mark(t);
    };
    document.addEventListener('input', onChange, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('blur', onChange, true);

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const el = n as Element;
          if (el.matches?.(SELECTOR)) mark(el);
          markAll(el);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('input', onChange, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('blur', onChange, true);
      mo.disconnect();
    };
  }, []);
  return null;
}
