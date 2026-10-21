/**
 * ربطُ كشوف التشغيل القائمة بمعاملات التخليص — مرّةً، بالأدلّة القويّة وحدها.
 *
 * الأدلّةُ هي نفسُها التي يستعملها النظامُ بعد اليوم (services/customsOpsLink):
 *   move       رقمُ الكشف مكتوبٌ في خانة نقلٍ أو إرجاعٍ بسيّارة الشركة في المعاملة؛
 *   bl         «رقم السند» في الكشف = بوليصةُ معاملةٍ واحدة (بالبادئة أو بدونها، ٨ خاناتٍ فأكثر)؛
 *   container  «رقم السند» = رقمُ حاويةٍ مسجّلةٍ في معاملةٍ واحدة.
 * ولا تخمين: بوليصةٌ تحملها معاملتان، أو كشفٌ تذكره معاملتان، لا يُربط.
 * وما ربطه أو فكّه موظّفٌ بيده لا يُمسّ.
 *
 * تجربةٌ افتراضًا (تقرأ ولا تكتب)؛ `--apply` للكتابة. `--list` يطبع كلَّ ربط.
 *   node src/scripts/backfillCustomsOpsLinks.js [--apply] [--list]
 *   ENV_FILE=/path/to/.env لقاعدةٍ غيرِ التي في backend/.env.
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  const list = process.argv.includes('--list');
  // التجربةُ لا تكتب شيئًا — ولا فهرسًا: النموذجُ يحمل فهرسًا جديدًا يُبنى عند الإقلاع.
  if (!apply) mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGODB_URI, apply ? {} : { autoIndex: false, autoCreate: false });
  const link = require('../services/customsOpsLink');
  const idx = await link.loadIndex();

  // المرشّحون: مَن ذكرته معاملةٌ برقمه، ومَن عليه «رقم سند»، ومَن هو مربوطٌ الآن.
  const filter = {
    $or: [
      { reportNumber: { $in: [...idx.byReport.keys()] } },
      { documentNumber: { $nin: ['', null] } },
      { customsLink: { $exists: true } },
    ],
  };
  const res = await link.resolveReports(filter, { dryRun: !apply, emit: false });

  const byVia = {}; const clearances = new Set(); let unlink = 0;
  for (const c of res.changes) {
    if (!c.to) { unlink += 1; continue; }
    byVia[c.to.via] = (byVia[c.to.via] || 0) + 1;
    clearances.add(String(c.to.clearance));
  }
  console.log(apply ? '── كُتب ──' : '── تجربة (لم يُكتب شيء) ──');
  console.log({ candidates: 'reports with a move ref, a documentNumber, or an existing link', changes: res.changed, byVia, unlink, clearances: clearances.size });
  if (list) {
    for (const c of res.changes) {
      console.log(c.reportNumber, '→', c.to ? `${c.to.refNumber} (${c.to.via}) BL ${c.to.blNumber} ${c.to.containers.join(',')}` : 'unlink');
    }
  }
  if (apply && res.changed) {
    // الشاشاتُ في العاملَين تقرأ من ذاكرتها — يُمسح ما يقرأ الربطَ قبل الإغلاق.
    const cache = require('../utils/ttlCache');
    for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'customslink:']) await cache.clearShared(p).catch(() => {});
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
