/**
 * repairLs2TireTrailers: correct the trailer number recorded on each tire from its position.
 * Usage: node src/scripts/repairLs2TireTrailers.js [--apply] (dry run by default).
 * `trailerNumber` was written once and did not follow a moved tire, so tires on a truck were recorded as on a trailer, standing, or on another truck. The rule is explained in services/ls2TireTrailers. Only the trailer number changes, never a tire or trailer position.
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
