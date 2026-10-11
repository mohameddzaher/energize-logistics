/**
 * revertCustomsToUpcoming — يردّ معاملةً حُوِّلت إلى جاريةٍ خطأً إلى القادمة.
 *
 *   node src/scripts/revertCustomsToUpcoming.js CC-00273           ← تجربة
 *   node src/scripts/revertCustomsToUpcoming.js CC-00273 --apply
 *
 * يكتب علَمَ «قادمة» ويمسح بصمةَ التحويل وحدَهما. والتاريخُ المرتقَبُ والأوراقُ
 * وكلُّ ما كُتب في المعاملة يبقى كما هو. ومع `--stage <مرحلة>` يردّ المرحلةَ
 * كذلك (لمن ضغط مراحلَ بعد التحويل وهو يجرّب). وما عُلِّم من المراحل لا يُمسّ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const ref = process.argv[2];
const APPLY = process.argv.includes('--apply');
const si = process.argv.indexOf('--stage');
const stage = si > -1 ? process.argv[si + 1] : null;

(async () => {
  if (!ref || ref.startsWith('--')) { console.error('اكتب رقمَ المعاملة: CC-00000'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CustomsClearance = require('../models/CustomsClearance');
  const c = await CustomsClearance.findOne({ refNumber: ref });
  if (!c) { console.error(`لا معاملةَ بالرقم ${ref}`); process.exit(1); }
  console.log(`\n  ${c.refNumber} · ${c.blNumber || '—'} · ${c.customerName || '—'}`);
  console.log(`  الآن: ${c.upcoming ? 'قادمة' : 'جارية'} · التاريخ المرتقَب ${c.expectedDate || '—'} · المرحلة ${c.stage} · المعلَّم من المراحل ${(c.stagesDone || []).join('، ') || '—'}`);
  if (c.upcoming && !stage) { console.log('  هي قادمةٌ أصلًا — لا شيءَ يُكتب.\n'); await mongoose.disconnect(); return; }
  if (!c.expectedDate) { console.error('  لا تاريخَ مرتقَبًا لها — لا تُرَدّ قادمةً بلا تاريخ.'); process.exit(1); }
  console.log(`  سيُكتب: قادمة = نعم${stage ? ` · المرحلة = ${stage}` : ''}`);
  if (!APPLY) { console.log('  — تجربة، بلا كتابة. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); return; }
  c.upcoming = true;
  c.activatedAt = undefined; c.activatedBy = undefined; c.activatedByName = undefined;
  if (stage) c.stage = stage;
  await c.save();
  try { require('../utils/ttlCache').clear('customs:'); } catch (_) { /* */ }
  console.log('  ✔ عادت إلى المعاملات القادمة.\n');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
