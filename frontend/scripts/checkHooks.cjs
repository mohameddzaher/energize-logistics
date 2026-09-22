/**
 * حارسُ ترتيب الخطّافات — يُشغَّل قبل كلّ بناء (`prebuild`).
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * React يعدّ الخطّافات في كلّ رسمة، فإن اختلف العددُ بين رسمتين أسقط المكوّنَ
 * كلَّه بخطأ #310 — شاشةٌ بيضاءُ برقمٍ لا يقول لمن أمامه شيئًا.
 *
 * ووقع ذلك في شاشتين معًا (٢٢ سبتمبر ٢٠٢٦): ملفُّ العميل في التحصيل ومعاملةُ
 * التخليص. في كلتيهما خطّافٌ كُتب **بعد** عودةٍ مبكّرة («يحمّل…» أو «لا يوجد»)،
 * فيُنادى في رسمةٍ ولا يُنادى في أخرى. خمسٌ وثلاثون مرّةً في سجلّ الأخطاء، وكلُّ
 * عميلٍ رابطٌ مختلف — فبدا أنّ «صفحاتٍ كثيرةً جدًّا» تسقط.
 *
 * والخطأُ لا يظهر في البناء ولا في فحص الأنواع ولا في الشاشة الفارغة: يظهر
 * حين تصل البيانات. فيُفحَص هنا بمحلّل TypeScript نفسِه، مكوّنًا مكوّنًا، وتُرفَض
 * البنيةُ قبل أن تصل أحدًا:
 *   ١. خطّافٌ بعد عودةٍ مبكّرة في جسم المكوّن.
 *   ٢. خطّافٌ داخل شرطٍ أو حلقة.
 *   ٣. خطّافٌ داخل دالّةٍ مُمرَّرة (map/filter/forEach…) — عددُه عددُ الصفوف.
 *
 *   node scripts/checkHooks.cjs
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

  // ١ و٢ — داخل جسم كلّ دالّة
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

    // ٣ — خطّافٌ داخل دالّةٍ مُمرَّرةٍ وسيطًا لنداءٍ ليس خطّافًا
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
