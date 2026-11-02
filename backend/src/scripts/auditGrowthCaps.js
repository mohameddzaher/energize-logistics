/* eslint-disable no-console */
/**
 * Finds code limits that are now close to today's data.
 * Every limit becomes tight eventually as the company grows. Silent truncation announces nothing: a screen shows a thousand rows and looks complete, so a decision is built on partial data. Daily individual orders once reached 43,000 under a 5,000 cap.
 * The audit itself had three bugs: it counted slice(0, 10) as a row cap though it trims a date to YYYY-MM-DD; it attributed a limit to a neighbouring model inside Promise.all; and it compared a filtered query's limit to the whole collection.
 * A false alarm gets ignored, so it now separates certain truncation from what needs a look.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// A list of ten or a hundred is a deliberate display choice (latest ten), not a growth cap.
const MIN_MEANINGFUL_CAP = 100;

const RX_MODEL_FIND = /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*find\s*\(/;
const RX_LIMIT = /\.limit\(\s*(\d+)\s*\)/;
const RX_HAS_LIMIT = /\.limit\(/;

/** Empty filter: find() or find({}), meaning the full list. */
function looksUnfiltered(afterFind) {
  const head = afterFind.replace(/\s+/g, '');
  return head.startsWith(')') || head.startsWith('{})');
}

/** Collects { model, cap, file, line, filtered } for each meaningful limit. */
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

        // The model is taken from the same line first; looking at earlier lines stops at the previous .limit(, which belongs to another model.
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

  // All models are loaded first: mongoose.model(name) does not know a model whose file has not been required, so nothing would be measured and the audit would pass without checking.
  const modelsDir = path.join(base, 'models');
  for (const f of fs.readdirSync(modelsDir)) {
    if (f.endsWith('.js')) { try { require(path.join(modelsDir, f)); } catch (e) { /* A broken model must not stop the audit. */ } }
  }

  const caps = collectCaps(base);

  // Only the highest unfiltered cap per model is measured: sidebar lists have deliberately smaller limits, and filtered ones are not comparable to the whole collection.
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
      // Filtered caps are shown for review, not alarm: the collection size is not the size of what the query returns, and judging needs the largest per-entity set, which code alone cannot tell.
      if (r.filtered) { state = '· مفلتَر — يُنظَر'; look++; } else { state = '⛔ يقصّ الآن'; crit++; }
    } else if (r.pct >= 60 && !r.filtered) { state = '⚠ اقترب'; warn++; }
    if (state === '✓') continue;   // Healthy items are not printed: the report is a work list, not an inventory.
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
