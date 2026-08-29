/* eslint-disable no-console */
/**
 * auditHookOrder — أيُّ شاشةٍ تنادي خطّافًا بعد خروجٍ مبكر؟
 *
 *   node src/scripts/auditHookOrder.js
 *
 * قاعدةُ React: عددُ الخطّافات ثابتٌ في كل رسمة. وشاشةٌ تكتب
 * `if (loading) return <Spinner/>` ثم تنادي `useMemo` بعدها تُرسَم أوّلًا
 * بخطّافاتٍ أقلّ ثم بأكثر، فيرمي React استثناءً يظهر للمستخدم شاشةً بيضاء:
 * «Application error: a client-side exception has occurred» — بلا أيّ دلالةٍ
 * على السبب، ولا يظهر إلّا بعد أن يعود النداء فيصير `loading` كاذبًا.
 *
 * وهو خطأٌ لا يمسكه المترجم ولا `tsc`: الشيفرة صحيحةٌ نحوًا، والخطأ في الترتيب.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../../frontend/src');
const HOOK = /\b(useState|useEffect|useCallback|useMemo|useRef|useReducer|useContext|useLayoutEffect|use[A-Z][A-Za-z0-9]*)\s*\(/;
// ── الدقّة تُشترى بالتضييق ───────────────────────────────────────────────────
// الخروج المبكر الحقيقيّ سطرٌ في جسم المكوّن مباشرةً — مسافتان بالضبط — يعيد
// JSX. و`return` بأربع مسافاتٍ أو أكثر يكون داخل `filter` أو `map` أو شرطٍ
// متشعّب، ولا علاقة له بترتيب الخطّافات. وإنذارٌ كاذب يُهمَل بعده الفحص كلُّه.
const EARLY_RETURN = /^ {2}(if\s*\(.+?\)\s*)?return\s*[<(]/;
// والخطّاف الحقيقيّ إسنادٌ في جسم المكوّن مباشرةً: `  const x = useMemo(`.
const TOP_HOOK = /^ {2}(const|let)\s+[[{\w].*?=\s*(use[A-Z][A-Za-z0-9]*)\s*\(|^ {2}(use[A-Z][A-Za-z0-9]*)\s*\(/;

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (/\.tsx$/.test(e.name)) files.push(full);
  }
};
walk(ROOT);

const hits = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let seenReturn = -1;
  let depth0 = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // بدايةُ مكوّنٍ جديد تُصفّر الحالة: ملفٌّ فيه مكوّنان لا يتداخلان.
    // كلُّ دالّةٍ في المستوى الأعلى تبدأ عدًّا جديدًا — مكوّنًا كانت أو خطّافًا
    // مخصَّصًا (`export function useDialog`). وإغفال الخطّافات المخصَّصة كان
    // يجعل الفحص يقرأ `return` المكوّن السابق كأنّه خروجٌ مبكر في هذه الدالّة.
    if (/^(export\s+)?(default\s+)?(async\s+)?function\s+\w/.test(ln)
        || /^(export\s+)?const\s+\w+\s*[:=].*=>\s*\{/.test(ln)) {
      seenReturn = -1; depth0 = true; continue;
    }
    if (!depth0) continue;
    if (EARLY_RETURN.test(ln) && seenReturn < 0) { seenReturn = i + 1; continue; }
    const m = ln.match(TOP_HOOK);
    if (seenReturn > 0 && m && !/^\s*(\/\/|\*)/.test(ln)) {
      const hook = m[2] || m[3];
      hits.push({ file: path.relative(ROOT, f), afterLine: seenReturn, hookLine: i + 1, hook });
      break;
    }
  }
}

console.log('\n  الشاشة                                                   الخطّاف        بعد سطر  في سطر');
console.log('  ' + '─'.repeat(94));
for (const h of hits) {
  console.log('  ' + h.file.padEnd(56) + h.hook.padEnd(15) + String(h.afterLine).padStart(6) + String(h.hookLine).padStart(8));
}
console.log(`\n  فُحص ${files.length} ملفًّا · ${hits.length} فيها خطّافٌ بعد خروجٍ مبكر.\n`);
process.exit(hits.length ? 1 : 0);
