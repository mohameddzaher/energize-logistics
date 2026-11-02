/* eslint-disable no-console */
/**
 * Finds role names in the code that are missing from the role registry.
 * Roles get renamed over time (b2c_head became b2c_manager) and the old name survives in a spot nobody searched. Nothing complains: the string is valid, the query runs and returns empty, so the screen says none exist while the person is in the user list.
 * Neither the compiler nor tsc catches it: it is a string compared with a string. Only a check comparing every name in the code with the single role registry does.
 * It excludes non-roles shaped like roles (statuses, types): a candidate is something that looks like a role name and is absent from both the registry and the exclusion list.
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
 * It does not search by shape but by position.
 * Searching for anything that looks like a role name catches every string with an underscore (tyre states, field names), so the report becomes ignored noise. Only role usage sites are read: arguments to authorize(, comparisons with role ===, values sent as role= or role:, and entries in roles: [...] lists. Anything outside these is not a role however similar.
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

/** Words in role positions that are not roles: external account types and generic values. */
const NOT_ROLES = new Set([
  'client', 'customer', 'vendor', 'partner', 'all', 'any', 'none', 'system',
  // Chat message roles in the assistant screen are written role: 'user'; they are not login roles.
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
    // The roles file itself is the reference, and audit scripts mention names in order to check them.
    if (/config\/roles\.js$|auditRoleNames\.js$/.test(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const rel = path.relative(path.join(__dirname, '../../..'), full);
    lines.forEach((ln, i) => {
      if (/^\s*(\/\/|\*|#)/.test(ln)) return;               // Comment, not code.
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

/** Closest real role by name, suggested so the replacement is known without searching. */
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
