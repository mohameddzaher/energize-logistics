/**
 * checkTeamLeaderParity: every role list that names a section manager also names its team leader.
 * The team leader holds its manager's rights (config/roles RIGHTS_OF). rbac and the shared helpers (roleIn / rightsRoleOf) honour that,
 * but an in-code list such as ['hr_manager', ...].includes(role) does not, so a list missing the team leader silently denies it.
 * Scans backend/src, frontend/src and mobile/lib. Exempt: performance review and business review (team leaders are staff there),
 * generated files and scripts. A deliberate exception carries `team-leader-exception: <reason>` on the line or the line above.
 * Usage: node src/scripts/checkTeamLeaderParity.js [--fix]   (exits 1 on a violation without --fix)
 */
const fs = require('fs');
const path = require('path');
const R = require('../config/roles');

const ROOT = path.join(__dirname, '..', '..', '..');
const FIX = process.argv.includes('--fix');
const PAIRS = Object.entries(R.RIGHTS_OF).map(([tl, mgr]) => ({ tl, mgr }));
const EXEMPT = [
  /backend\/src\/config\/roles\.js$/, /backend\/src\/config\/performanceDepartments\.js$/, /backend\/src\/controllers\/performanceController\.js$/,
  /backend\/src\/config\/businessReview\.js$/, /backend\/src\/scripts\//, /backend\/src\/seeds\//,
  /frontend\/src\/lib\/roles\.ts$/, /frontend\/src\/lib\/businessReview\.ts$/, /frontend\/src\/lib\/performance\.ts$/, /frontend\/src\/app\/system\/performance\//,
  /mobile\/lib\/screens\/performance_/, /mobile\/lib\/screens\/business_review/,
];

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(e.name)) walk(p); } else if (/\.(js|ts|tsx|dart|cjs)$/.test(e.name)) files.push(p);
  }
};
['backend/src', 'frontend/src', 'mobile/lib'].forEach((d) => walk(path.join(ROOT, d)));

// Index of a `//` comment start in a line, ignoring ones inside quotes; -1 if none.
const commentIdx = (line) => {
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) { if (c === '\\') { i += 1; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') return i;
  }
  return -1;
};
const skipBack = (s, a) => {
  for (;;) {
    while (a >= 0 && /\s/.test(s[a])) a -= 1;
    const ls = s.lastIndexOf('\n', a) + 1;
    const ci = commentIdx(s.slice(ls, a + 1));
    if (ci >= 0) { a = ls + ci - 1; continue; }
    if (s[a] === '/' && s[a - 1] === '*') { a = s.lastIndexOf('/*', a) - 1; continue; }
    return a;
  }
};
const skipFwd = (s, b) => {
  for (;;) {
    while (b < s.length && /\s/.test(s[b])) b += 1;
    if (s[b] === '/' && s[b + 1] === '/') { b = s.indexOf('\n', b); if (b < 0) return s.length; continue; }
    if (s[b] === '/' && s[b + 1] === '*') { b = s.indexOf('*/', b) + 2; continue; }
    return b;
  }
};
const enclosing = (s, i) => {
  let depth = 0;
  for (let k = i - 1; k >= 0; k -= 1) {
    const c = s[k];
    if (c === ']' || c === ')' || c === '}') depth += 1;
    else if (c === '[' || c === '(' || c === '{') { if (depth === 0) return k; depth -= 1; }
  }
  return -1;
};
const matchClose = (s, o) => {
  let d = 0;
  for (let k = o; k < s.length; k += 1) {
    const c = s[k];
    if (c === "'" || c === '"') { const e = s.indexOf(c, k + 1); if (e > 0 && !s.slice(k, e).includes('\n')) { k = e; continue; } }
    if (c === '[' || c === '(' || c === '{') d += 1;
    else if (c === ']' || c === ')' || c === '}') { d -= 1; if (d === 0) return k; }
  }
  return s.length;
};

const re = new RegExp(`(['"])(${PAIRS.map((p) => p.mgr).join('|')})\\1`, 'g');
const tlOf = Object.fromEntries(PAIRS.map((p) => [p.mgr, p.tl]));
const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (EXEMPT.some((r) => r.test(rel))) continue;
  let s = fs.readFileSync(f, 'utf8');
  const ins = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    const i = m.index; const j = i + m[0].length;
    const ls = s.lastIndexOf('\n', i) + 1;
    if (commentIdx(s.slice(ls, i)) >= 0) continue;
    if (s.lastIndexOf('/*', i) > s.lastIndexOf('*/', i)) continue;
    const prev = s[skipBack(s, i - 1)]; const next = s[skipFwd(s, j)];
    if (!('[,{'.includes(prev) && ',]}'.includes(next))) continue;
    const o = enclosing(s, i);
    const span = s.slice(o, (o >= 0 ? matchClose(s, o) : s.length) + 1);
    const tl = tlOf[m[2]];
    if (new RegExp(`['"]${tl}['"]`).test(span)) continue;
    // A list handed to roleIn() already honours the team leader.
    if (o >= 0 && /roleIn\([^()]*,\s*$/.test(s.slice(Math.max(0, o - 120), o))) continue;
    const prevLine = s.slice(s.lastIndexOf('\n', ls - 2) + 1, ls);
    const line = s.slice(ls, s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i));
    if (/team-leader-exception/.test(prevLine + line)) continue;
    const lineNo = s.slice(0, i).split('\n').length;
    bad.push(`${rel}:${lineNo}  ${m[2]} without ${tl}`);
    ins.push({ at: j, text: `, ${m[1]}${tl}${m[1]}` });
  }
  if (FIX && ins.length) {
    for (const x of ins.sort((a, b) => b.at - a.at)) s = s.slice(0, x.at) + x.text + s.slice(x.at);
    fs.writeFileSync(f, s);
  }
}

if (bad.length && !FIX) {
  console.error(`\n✗ ${bad.length} role list(s) name a section manager without its team leader:\n`);
  bad.forEach((b) => console.error(`  ${b}`));
  console.error('\n  Add the team leader, use roleIn()/rightsRoleOf(), or mark `// team-leader-exception: <reason>`. --fix adds them.\n');
  process.exit(1);
}
console.log(FIX ? `✓ added ${bad.length} team leader(s)` : `✓ every manager role list names its team leader (${files.length} files)`);
