/**
 * Adds a B2C project in both places a project lives: the `lt_project` list (rep/HR project choice)
 * and B2CProject (order entry, targets). Idempotent; dry run unless --apply.
 * Usage: node src/scripts/addB2CProject.js "Media Go" [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Lookup = require('../models/Lookup');
const B2CProject = require('../models/B2CProject');

const APPLY = process.argv.includes('--apply');
const NAME = String(process.argv.slice(2).find((a) => !a.startsWith('--')) || '').trim();

(async () => {
  if (!NAME) { console.error('name required'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const esc = NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*${esc}\\s*$`, 'i');

  const lk = await Lookup.findOne({ type: 'lt_project', $or: [{ nameAr: re }, { nameEn: re }] });
  if (lk && !lk.deleted && lk.isActive !== false) console.log(`= lt_project «${lk.nameAr}» exists`);
  else if (lk) { console.log(`~ lt_project «${lk.nameAr}» restored`); if (APPLY) await Lookup.updateOne({ _id: lk._id }, { $set: { deleted: false, isActive: true } }); }
  else {
    const last = await Lookup.findOne({ type: 'lt_project' }).sort({ order: -1 }).lean();
    // Reuse the seed key when the name is a default, so boot seeding does not add a second row.
    const seeded = (require('../config/lookupTypes').REGISTRY || []).find((e) => e.type === 'lt_project')?.seed?.find((r) => re.test(r.nameAr));
    const key = seeded?.key || `lt_project_${NAME.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    console.log(`+ lt_project «${NAME}» (${key})`);
    if (APPLY) await Lookup.create({ type: 'lt_project', key, nameAr: NAME, nameEn: NAME, order: (last?.order || 0) + 1, isActive: true, isSystem: false });
  }

  const p = await B2CProject.findOne({ $or: [{ name: re }, { nameAr: re }] });
  if (p) {
    console.log(`= B2CProject «${p.name}» exists (active=${p.isActive})`);
    // nameAr is the join to the rep's project; only filled when missing, never re-cased.
    if (APPLY && (!p.isActive || !p.nameAr)) await B2CProject.updateOne({ _id: p._id }, { $set: { isActive: true, nameAr: p.nameAr || NAME } });
  } else {
    console.log(`+ B2CProject «${NAME}»`);
    if (APPLY) await B2CProject.create({ name: NAME, nameAr: NAME, isActive: true });
  }

  if (!APPLY) console.log('(dry run — add --apply)');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
