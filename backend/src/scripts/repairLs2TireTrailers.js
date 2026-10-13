/**
 * repairLs2TireTrailers — يصحّح رقمَ التيدر المسجَّل على كلّ فردة من موضعها.
 *
 *   node src/scripts/repairLs2TireTrailers.js            ← تجربة، بلا كتابة
 *   node src/scripts/repairLs2TireTrailers.js --apply
 *
 * `trailerNumber` كان يُكتب مرّةً ولا يتبع الفردةَ إن نُقلت، فتراكم: فِرَدٌ على
 * عربيّةٍ وهي «على تيدرٍ» واقفٍ أو على عربيّةٍ أخرى. القاعدةُ والشرحُ في
 * services/ls2TireTrailers. لا يمسّ موضعَ فردةٍ ولا تيدر — رقمُ التيدر وحدَه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { resyncTireTrailers } = require('../services/ls2TireTrailers');
  const changes = await resyncTireTrailers({ dryRun: !APPLY });
  const kind = (c) => (c.to == null ? (c.from ? 'يُرفَع رقمٌ لا يخصّها' : '') : c.from ? 'يُصحَّح' : 'يُكتب');
  const tally = {};
  for (const c of changes) tally[kind(c)] = (tally[kind(c)] || 0) + 1;
  console.log(`\n  فِرَدٌ رقمُ تيدرها يخالف موضعَها: ${changes.length} — ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ') || 'لا شيء'}`);
  for (const c of changes.slice(0, 40)) {
    console.log(`   ${c.serial} · ${c.plate || 'بلا عربيّة'} · ${c.section || '—'} ${c.positionNumber ?? ''} · تيدر ${c.from || '—'} → ${c.to || '—'}`);
  }
  if (changes.length > 40) console.log(`   … و${changes.length - 40} أخرى`);
  console.log(APPLY ? '  كُتب.\n' : '  — تجربة، بلا كتابة. أضف --apply للتنفيذ.\n');
  if (APPLY) { try { require('../utils/ls2Touch').clearLs2Derived(); } catch (_) { /* */ } }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
