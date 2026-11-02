/* eslint-disable no-console */
/**
 * Finds screens that call a hook after an early return.
 * React requires a constant hook count per render. A screen with if (loading) return <Spinner/> followed by useMemo renders first with fewer hooks, then more, so React throws and the user sees a white screen with no hint of the cause, only once loading turns false.
 * Neither the compiler nor tsc catches it: the code is syntactically valid and the fault is ordering.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../../frontend/src');
const HOOK = /\b(useState|useEffect|useCallback|useMemo|useRef|useReducer|useContext|useLayoutEffect|use[A-Z][A-Za-z0-9]*)\s*\(/;
// Precision comes from narrowing. A real early return is a line directly in the component body, exactly two spaces deep, returning JSX. A return indented four or more is inside a filter, map or nested condition and is unrelated to hook order. A false alarm would get the whole audit ignored.
const EARLY_RETURN = /^ {2}(if\s*\(.+?\)\s*)?return\s*[<(]/;
// A real hook is an assignment directly in the component body: `  const x = useMemo(`.
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
    // A new component resets the state: a file with two components does not overlap.
    // Every top-level function starts a new count, component or custom hook (export function useDialog). Ignoring custom hooks made the audit read the previous component's return as an early return in this function.
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
