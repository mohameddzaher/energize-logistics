/* eslint-disable no-console */
/**
 * auditGrowthCaps — أيُّ سقفٍ في الشيفرة صار قريبًا من بيانات اليوم؟
 *
 *   node src/scripts/auditGrowthCaps.js
 *
 * ── لماذا يُشغَّل دوريًّا ─────────────────────────────────────────────────────
 * كلُّ سقفٍ يُكتب اليوم يصير ضيّقًا يومًا: تكبر الشركة، وتتراكم السنوات، فتبلغ
 * مجموعةٌ حدَّها. والقصُّ الصامت لا يُعلن عن نفسه — الشاشة تعرض ألفًا وتبدو
 * كأنّها عرضت الكلّ، فيُقرأ الناقصُ كاملًا ويُبنى عليه قرار.
 *
 * وقع ذلك هنا فعلًا: طلبات الأفراد اليوميّة بلغت ثلاثةً وأربعين ألفًا تحت سقفٍ
 * من خمسة آلاف، فكانت الشاشة تعرض ثُمنَ ما تظنّ أنها تعرضه.
 *
 * ── وثلاثة أخطاءٍ وقع فيها هذا الفحص نفسه قبل أن يصحّ ────────────────────────
 * ١) عدَّ `slice(0, 10)` سقفَ صفوفٍ وهو يقصّ **تاريخًا** إلى YYYY-MM-DD.
 * ٢) نسب الحدَّ إلى نموذجٍ مجاورٍ داخل `Promise.all` — فقاس حدَّ سجلّ الأحداث
 *    إلى عدد الإطارات.
 * ٣) قاس حدَّ استعلامٍ **مفلتَر** («سجلّ هذا الموظّف») إلى المجموعة كلّها،
 *    فأعلن قصًّا لا وجود له.
 *
 * وفحصٌ يُنذر كذبًا يُهمَل بعد إنذارين — فيصير أسوأ من لا فحص إطلاقًا. ولهذا
 * يفصل الآن بين ما يقصّ يقينًا وما يحتاج نظرًا.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// قائمةٌ من عشرةٍ أو مئةٍ قرارُ عرضٍ مقصود («أحدث عشرة»)، لا سقفُ نموّ.
const MIN_MEANINGFUL_CAP = 100;

const RX_MODEL_FIND = /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*find\s*\(/;
const RX_LIMIT = /\.limit\(\s*(\d+)\s*\)/;
const RX_HAS_LIMIT = /\.limit\(/;

/** فلترٌ فارغ: `find()` أو `find({})` — أي القائمة الكاملة. */
function looksUnfiltered(afterFind) {
  const head = afterFind.replace(/\s+/g, '');
  return head.startsWith(')') || head.startsWith('{})');
}

/** يجمع { model, cap, file, line, filtered } لكل حدٍّ ذي معنى. */
function collectCaps(base) {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|scripts|seeds/.test(e.name)) walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const cap = line.match(RX_LIMIT);
        if (!cap) return;
        const n = Number(cap[1]);
        if (n < MIN_MEANINGFUL_CAP) return;

        // النموذج من **نفس السطر** أوّلًا؛ والنظر إلى ما قبله يتوقّف عند أوّل
        // `.limit(` آخر، فذاك حدٌّ مستقلٌّ لنموذجٍ غيره.
        let chunk = line;
        let mdl = chunk.match(RX_MODEL_FIND);
        if (!mdl) {
          for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
            if (RX_HAS_LIMIT.test(lines[j])) break;
            const m = lines[j].match(RX_MODEL_FIND);
            if (m) { mdl = m; chunk = lines[j]; break; }
          }
        }
        if (!mdl) return;

        const at = chunk.indexOf('.find(');
        const filtered = at < 0 ? true : !looksUnfiltered(chunk.slice(at + 6));
        found.push({ model: mdl[1], cap: n, file: path.relative(base, full), line: i + 1, filtered });
      });
    }
  };
  walk(path.join(base, 'controllers'));
  walk(path.join(base, 'services'));
  return found;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const base = path.join(__dirname, '..');

  // تُحمَّل كلُّ النماذج أوّلًا: `mongoose.model(name)` لا يعرف نموذجًا لم
  // يُستدعَ ملفُّه بعد، فبدونه لا يُقاس شيء ويخرج الفحص «سليمًا» وهو لم يفحص.
  const modelsDir = path.join(base, 'models');
  for (const f of fs.readdirSync(modelsDir)) {
    if (f.endsWith('.js')) { try { require(path.join(modelsDir, f)); } catch (e) { /* نموذجٌ معطوب لا يوقف الفحص */ } }
  }

  const caps = collectCaps(base);

  // أعلى سقفٍ **غير مفلتَر** لكلّ نموذج هو الذي يُقاس: القوائم الجانبية حدودُها
  // أصغر عمدًا، والمفلترة لا تُقاس إلى المجموعة كلّها أصلًا.
  const byModel = new Map();
  for (const c of caps) {
    const cur = byModel.get(c.model);
    if (!cur) { byModel.set(c.model, c); continue; }
    if (cur.filtered && !c.filtered) { byModel.set(c.model, c); continue; }
    if (cur.filtered === c.filtered && c.cap > cur.cap) byModel.set(c.model, c);
  }

  const rows = [];
  for (const [model, info] of byModel) {
    let coll;
    try { coll = mongoose.model(model).collection.collectionName; } catch (e) { continue; }
    const n = await mongoose.connection.collection(coll).estimatedDocumentCount().catch(() => -1);
    if (n < 0) continue;
    rows.push({ model, n, cap: info.cap, at: `${info.file}:${info.line}`, pct: Math.round((n / info.cap) * 100), filtered: info.filtered });
  }
  rows.sort((a, b) => b.pct - a.pct);

  console.log('\n  النموذج                  الصفوف     السقف   النسبة   الحالة              الموضع');
  console.log('  ' + '─'.repeat(92));
  let warn = 0; let crit = 0; let look = 0;
  for (const r of rows) {
    let state = '✓';
    if (r.n >= r.cap) {
      // المفلتَر يُعرَض للنظر لا للإنذار: عددُ المجموعة كلِّها ليس عدد ما يعيده،
      // والحكم عليه يحتاج قياس أكبر مجموعةٍ لكيانٍ واحد — وهو ما لا يُعرَف من
      // الشيفرة وحدها.
      if (r.filtered) { state = '· مفلتَر — يُنظَر'; look++; } else { state = '⛔ يقصّ الآن'; crit++; }
    } else if (r.pct >= 60 && !r.filtered) { state = '⚠ اقترب'; warn++; }
    if (state === '✓') continue;   // السليم لا يُطبَع: التقرير قائمةُ عملٍ لا جرد
    console.log('  ' + r.model.padEnd(24) + String(r.n).padStart(8) + String(r.cap).padStart(10)
      + String(r.pct + '%').padStart(8) + '   ' + state.padEnd(19) + r.at);
  }
  console.log('');
  console.log(`  فُحص ${caps.length} حدًّا على ${rows.length} نموذجًا · ${rows.length - crit - warn - look} سليمًا.`);
  if (crit) console.log(`  ⛔ ${crit} نموذجًا تجاوز سقفه على قائمةٍ غير مفلترة — نتائجه مبتورة الآن.`);
  if (warn) console.log(`  ⚠ ${warn} نموذجًا تجاوز ٦٠٪ من سقفه — يُراجَع قبل أن يبلغه.`);
  if (look) console.log(`  · ${look} حدًّا على استعلامٍ مفلتَر — يُنظَر فيه يدويًّا (قد يكون سليمًا تمامًا).`);
  if (!crit && !warn && !look) console.log('  ✓ لا سقف قريبٌ من بياناته.');
  process.exit(crit ? 1 : 0);
})();
