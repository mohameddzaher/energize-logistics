/* eslint-disable no-console */
/**
 * auditRoleNames — أيُّ اسمِ دورٍ في الشيفرة لا وجود له في سجلّ الأدوار؟
 *
 *   node src/scripts/auditRoleNames.js
 *
 * ── العطب الذي يكشفه ────────────────────────────────────────────────────────
 * الأدوار تُعاد تسميتها مع الوقت — `b2c_head` صار `b2c_manager` — والاسم القديم
 * يبقى في موضعٍ أو موضعين لم يُبحث فيهما. والشيفرة لا تشتكي: السلسلة صحيحةٌ
 * نحوًا، والاستعلام يعمل، ويعود فارغًا. فتفتح الشاشة فتقول «لا يوجد» وأنت
 * تنظر إلى الشخص في قائمة المستخدمين.
 *
 * ولا يمسكه المترجم ولا `tsc`: هي سلسلةٌ نصّية تُقارَن بسلسلة. فالوحيد الذي
 * يمسكه فحصٌ يقارن كلَّ اسمٍ يُكتب في الشيفرة بالسجلّ الواحد للأدوار.
 *
 * ويستثني ما ليس دورًا: قيمٌ لحقولٍ أخرى تشبه الأدوار في الشكل (حالات، أنواع).
 * فالمرشَّح هو ما يُشبه اسم دورٍ **ولا يوجد** في السجلّ ولا في قائمة الاستثناء.
 */
const fs = require('fs');
const path = require('path');
const { ALL_ROLES } = require('../config/roles');

const ROOTS = [
  path.join(__dirname, '..'),                                   // backend/src
  path.join(__dirname, '../../../frontend/src'),                // frontend/src
  path.join(__dirname, '../../../mobile/lib'),                   // mobile/lib
];
const SKIP_DIR = /node_modules|\.next|build|dist|\.git/;

/**
 * ── لا يُفتَّش عن شكلٍ، بل عن موضع ────────────────────────────────────────────
 * البحث عمّا «يُشبه اسم دور» يلتقط كلَّ سلسلةٍ فيها شرطةٌ سفليّة — حالاتِ
 * الكاوتش وأسماءَ الحقول — فيصير التقريرُ ضجيجًا يُهمَل، وفحصٌ يُهمَل أسوأ من
 * لا فحص.
 *
 * فالمقروء هو **مواضع استعمال الأدوار** وحدها: ما يُمرَّر إلى `authorize(`،
 * وما يُقارَن بـ`role ===`، وما يُرسَل في `role=` أو `role:`، وما يُدرج في
 * قوائم `roles: [...]`. وما خرج عن هذه المواضع ليس دورًا مهما أشبهه.
 */
const CONTEXTS = [
  // authorize('a', 'b', …)   ·   roles: ['a', 'b']   ·   ROLES = ['a']
  { rx: /authorize\s*\(([^)]*)\)/g, group: 1 },
  { rx: /\broles\s*:\s*\[([^\]]*)\]/g, group: 1 },
  { rx: /\b(?:ROLES|_ROLES)\s*=\s*\[([^\]]*)\]/g, group: 1 },
  // role === 'x'   ·   role !== 'x'   ·   role: 'x'   ·   ?role=x
  { rx: /\brole\s*(?:===|!==|==)\s*'([a-z0-9_]+)'/g, group: 1, single: true },
  { rx: /\brole\s*:\s*'([a-z0-9_]+)'/g, group: 1, single: true },
  { rx: /[?&]role=([a-z0-9_]+)/g, group: 1, single: true },
  // ['a','b'].includes(role)   ·   includes(user.role)
  { rx: /\[([^\]]*)\]\s*\.includes\s*\(\s*[\w.?]*role\s*\)/g, group: 1 },
];

const STRINGS = /'([a-z][a-z0-9_]*)'/g;

/** كلماتٌ تقع في مواضع الأدوار وليست أدوارًا: أنواعُ حسابٍ خارجيّ وقيمٌ عامّة. */
const NOT_ROLES = new Set([
  'client', 'customer', 'vendor', 'partner', 'all', 'any', 'none', 'system',
  // أدوارُ رسائل المحادثة في شاشة المساعد — تُكتب `role: 'user'` وليست أدوارَ دخول.
  'user', 'assistant',
]);

const known = new Set(ALL_ROLES);
const hits = new Map();   // name → [{file, line}]

const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(full); continue; }
    if (!/\.(js|ts|tsx|dart)$/.test(e.name)) continue;
    // ملفُّ الأدوار نفسُه هو المرجع، وسكربتات الفحص تذكر الأسماء لتفحصها.
    if (/config\/roles\.js$|auditRoleNames\.js$/.test(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const rel = path.relative(path.join(__dirname, '../../..'), full);
    lines.forEach((ln, i) => {
      if (/^\s*(\/\/|\*|#)/.test(ln)) return;               // تعليقٌ لا شيفرة
      for (const ctx of CONTEXTS) {
        ctx.rx.lastIndex = 0;
        let m;
        while ((m = ctx.rx.exec(ln))) {
          const names = ctx.single ? [m[ctx.group]] : [];
          if (!ctx.single) {
            let sm; STRINGS.lastIndex = 0;
            while ((sm = STRINGS.exec(m[ctx.group]))) names.push(sm[1]);
          }
          for (const name of names) {
            if (!name || known.has(name) || NOT_ROLES.has(name)) continue;
            if (!hits.has(name)) hits.set(name, []);
            const at = `${rel}:${i + 1}`;
            if (hits.get(name).length < 6 && !hits.get(name).includes(at)) hits.get(name).push(at);
          }
        }
      }
    });
  }
};
ROOTS.forEach(walk);

/** أقربُ دورٍ حقيقيّ بالاسم — يُقترح كي يُعرف البديل بلا بحث. */
const closest = (name) => {
  const parts = name.split('_');
  return ALL_ROLES
    .map((r) => ({ r, score: r.split('_').filter((p) => parts.includes(p)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2).map((x) => x.r);
};

console.log(`\n  سجلّ الأدوار: ${ALL_ROLES.length} دورًا\n`);
if (!hits.size) {
  console.log('  ✓ لا اسمَ دورٍ في الشيفرة خارج السجلّ.\n');
  process.exit(0);
}
console.log('  ⚠ أسماءٌ تُشبه الأدوار ولا وجود لها في السجلّ:\n');
for (const [name, places] of [...hits.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const alt = closest(name);
  console.log(`  «${name}»${alt.length ? `   ← لعلّه: ${alt.join(' أو ')}` : ''}`);
  places.forEach((p) => console.log(`      ${p}`));
  console.log('');
}
console.log(`  ${hits.size} اسمًا · راجعْ كلًّا: إمّا أن يُصحَّح إلى دورٍ قائم، أو يُضاف إلى config/roles.js، أو يُدرَج في NOT_ROLES إن لم يكن دورًا.\n`);
process.exit(1);
