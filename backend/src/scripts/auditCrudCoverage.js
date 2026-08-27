/* eslint-disable no-console */
/**
 * auditCrudCoverage — أيُّ سجلٍّ في النظام لا يُنشأ أو لا يُعدَّل أو لا يُحذف؟
 *
 *   node src/scripts/auditCrudCoverage.js
 *   node src/scripts/auditCrudCoverage.js --section fleet
 *
 * المستخدم يفتح شاشةً فيجد بياناتٍ لا يستطيع تصحيحها، فيصحّحها في إكسل خارج
 * النظام — وعندها يصير النظام سجلًّا للماضي لا أداةَ عمل. هذا الفحص يقرأ
 * ملفّات المسارات ويقول أين الفجوة، بدل أن تُكتشف واحدةً واحدة بالشكوى.
 *
 * ولا يُقرأ الحرفُ وحده: مسارٌ اسمُه `/:id/restore` إنشاءٌ في الشكل وتعديلٌ في
 * المعنى، فتُصنَّف الأفعال بما تفعله لا بما تُسمّى.
 */
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '../routes');
const SKIP = /^(auth|index|health|publicFleetApi|portal|partners|uploads|reports|lookups|notifications|sectionWork|permissions)\.js$/;

/** المسارات التي هي إجراءُ عملٍ لا CRUD — لا تُحسب إنشاءً. */
const ACTIONY = /(login|logout|refresh|export|import|sync|seed|recalc|send|notify|resolve|assign|transfer|restore|reverse|toggle|mark|generate|preview|bulk|search|filters|options|dashboard|stats|analytics|profile|meta|summary)/i;

/**
 * موارد القراءة: شاشةُ تقريرٍ أو تنبيهٍ أو لوحة، لا سجلٌّ يُنشئه أحد.
 * عدُّها فجوةً يُغرق التقرير بضجيجٍ يُهمَل بعده كلُّه — وفحصٌ يُهمَل أسوأ من
 * لا فحص.
 */
const READ_ONLY = /^(overview|expiring|registers|alerts|risk-alerts|history|range|branch|daily|low-visit-customers|follow-ups|my-tasks|pending-by-customer|lookup-report|document-types|by-employee|employees|roles|suggest-manager|utilisation|permissions|users|store|me|leaves|leave|chat|reports|suggestions|shipments|config|settings|journal|bills|evaluations|announcements|daily-orders|master|requests|assets|vehicles|authorizations|accidents|insurance-policies|corporate-policies)$/;

const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js') && !SKIP.test(f));
const only = process.argv.includes('--section') ? process.argv[process.argv.indexOf('--section') + 1] : null;

const rows = [];
for (const f of files) {
  if (only && !f.includes(only)) continue;
  const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
  const routes = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ verb: m[1], p: m[2] }));
  if (!routes.length) continue;

  // تُجمَّع المسارات في «موارد»: الجذر الأوّل بعد الشرطة. و`/:id` جذرٌ أيضًا —
  // هو تعديلُ المورد الأصليّ وحذفُه، وإهمالُه كان يُظهر كلَّ ملفٍّ بلا تعديل.
  const byResource = new Map();
  for (const r of routes) {
    const first = r.p.split('/').filter(Boolean)[0] || '/';
    const seg = first.startsWith(':') ? '/' : first;
    const cur = byResource.get(seg) || { get: 0, post: 0, put: 0, patch: 0, delete: 0, actions: 0 };
    if (r.verb === 'post' && ACTIONY.test(r.p)) cur.actions++;
    else cur[r.verb]++;
    byResource.set(seg, cur);
  }

  for (const [res, v] of byResource) {
    // مواردُ القراءة فقط (لوحات، تحليلات، خيارات) ليست فجوةً بل تصميم.
    if (ACTIONY.test(res) || READ_ONLY.test(res)) continue;
    if (!v.get) continue;
    const missing = [];
    if (!v.post) missing.push('إنشاء');
    if (!v.put && !v.patch) missing.push('تعديل');
    if (!v.delete) missing.push('حذف');
    if (missing.length) rows.push({ file: f.replace('.js', ''), res, missing, has: v });
  }
}

rows.sort((a, b) => b.missing.length - a.missing.length || a.file.localeCompare(b.file));
console.log('\n  الملفّ                المورد                 الناقص');
console.log('  ' + '─'.repeat(74));
for (const r of rows) {
  console.log('  ' + r.file.padEnd(22) + r.res.padEnd(24) + r.missing.join(' · '));
}
console.log(`\n  ${rows.length} موردًا ناقص الأفعال · ${rows.filter((r) => r.missing.length === 3).length} منها بلا إنشاء ولا تعديل ولا حذف.\n`);
