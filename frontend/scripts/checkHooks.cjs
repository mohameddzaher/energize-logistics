/**
 * Hook-order guard, run before every build (prebuild).
 * React counts hooks per render; a differing count crashes the component with error #310 (blank screen). It appears only when data arrives, not in build or type check, so it is checked with the TypeScript parser.
 * Rejects: 1) a hook after an early return in a component body; 2) a hook inside a condition or loop; 3) a hook inside a callback passed to a non-hook call (map/filter/forEach).
 * Usage: node scripts/checkHooks.cjs
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const HOOK = /^use[A-Z]/;
const ROOT = path.join(__dirname, '..', 'src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(tsx|ts)$/.test(e.name)) files.push(p);
  }
}(ROOT));

const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
const isHookCall = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK.test(n.expression.text);
const isCond = (st) => ts.isIfStatement(st) || ts.isForStatement(st) || ts.isForOfStatement(st)
  || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)
  || ts.isSwitchStatement(st) || ts.isTryStatement(st);
const returnsEarly = (st) => ts.isReturnStatement(st) || (ts.isIfStatement(st) && (
  ts.isReturnStatement(st.thenStatement)
  || (ts.isBlock(st.thenStatement) && st.thenStatement.statements.some((x) => ts.isReturnStatement(x)))));

const found = [];
for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const rel = path.relative(path.join(__dirname, '..'), file);

  // Cases 1 and 2: inside each function body.
  const hooksIn = (node, cb) => {
    const walk = (n) => { if (isFn(n)) return; if (isHookCall(n)) cb(n); ts.forEachChild(n, walk); };
    walk(node);
  };
  const checkBody = (body, name) => {
    if (!body || !ts.isBlock(body)) return;
    let early = null;
    for (const st of body.statements) {
      if (isCond(st)) hooksIn(st, (h) => found.push(`${rel}:${at(h)}  ${name}() — ${h.expression.text} داخل شرطٍ أو حلقة`));
      else if (early) hooksIn(st, (h) => found.push(`${rel}:${at(h)}  ${name}() — ${h.expression.text} بعد عودةٍ مبكّرة في السطر ${early}`));
      if (!early && returnsEarly(st)) early = at(st);
    }
  };

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) checkBody(node.body, node.name.text);
    else if (ts.isVariableDeclaration(node) && node.initializer && isFn(node.initializer)) checkBody(node.initializer.body, node.name.getText());

    // Case 3: a hook inside a function passed as an argument to a non-hook call.
    if (isHookCall(node)) {
      let n = node.parent;
      while (n && !ts.isFunctionDeclaration(n)) {
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isCallExpression(n.parent)
            && n.parent.arguments.includes(n)) {
          const callee = n.parent.expression.getText();
          if (!HOOK.test(callee.split('.').pop() || '')) {
            found.push(`${rel}:${at(node)}  ${node.expression.text} داخل ${callee}() — يُنادى بعدد العناصر`);
          }
          break;
        }
        n = n.parent;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

const unique = [...new Set(found)];
if (unique.length) {
  console.error('\n✗ ترتيبُ الخطّافات مكسور — React يُسقط هذه الشاشات بخطأ #310:\n');
  unique.forEach((f) => console.error('   ' + f));
  console.error('\n   الخطّافاتُ كلُّها في أعلى المكوّن، قبل أيّ return وخارج أيّ شرط.\n');
  process.exit(1);
}
console.log(`✓ ترتيبُ الخطّافات سليم (${files.length} ملفًّا)`);
