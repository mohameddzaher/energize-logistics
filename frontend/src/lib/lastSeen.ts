/**
 * آخرُ ما رآه هذا المتصفّح — يُعرض فورَ فتح الصفحة ثمّ يحلّ محلَّه الجديد.
 *
 * أرقامُ منصّة التشغيل تصل بعد ثوانٍ، وكانت البطاقاتُ تعرض «—» كلَّ فتحة. فيُحفَظ
 * آخرُ جوابٍ سليمٍ لكلّ مفتاح في المتصفّح ويُقرأ أوّلًا. للعرض الفوريّ وحده —
 * ليس مصدرَ حقيقة، والجديدُ يستبدله ما إن يصل. وكلُّ قراءةٍ وكتابةٍ محميّة:
 * التخزينُ قد يُمنع (نافذةٌ خاصّة) فتعمل الصفحةُ بدونه.
 */
const PREFIX = 'lastSeen:';

export function readLastSeen<T>(key: string): T | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(PREFIX + key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function writeLastSeen<T>(key: string, value: T) {
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* */ }
}
