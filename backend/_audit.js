require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const c = require('./src/services/ls2Client');
  const V = require('./src/models/Ls2Vehicle');
  const T = require('./src/models/Ls2TireAsset');
  const to = Math.floor(Date.now() / 1000), from = to - 3 * 86400;
  const units = await c.searchUnits();
  const rows = [];
  for (const u of units) {
    const r = await c.loadMessages(u.id, from, to, 20000).catch(() => ({ messages: [] }));
    const ms = r.messages || [];
    const ch = new Set();
    for (const m of ms) for (const k of Object.keys(m.p || {})) if (/^tire_temp_/.test(k)) ch.add(k.replace('tire_temp_', ''));
    const v = await V.findOne({ unitId: u.id }).select('plate plateKey tireCount').lean();
    const reg = v ? await T.countDocuments({ plateKey: v.plateKey, status: 'mounted', sensor: 'yes' }) : 0;
    rows.push({ plate: v?.plate || u.nm, unitId: u.id, arriving: ch.size, shown: v?.tireCount || 0, registered: reg, msgs: ms.length });
  }
  rows.sort((a, b) => a.arriving - b.arriving);
  console.log('\n  اللوحة        يصل  نعرض  مسجَّل  رسائل/٣ي   الحكم');
  console.log('  ' + '─'.repeat(70));
  let ours = 0, theirs = 0, ok = 0;
  for (const r of rows) {
    let verdict;
    if (r.arriving === 0 && r.msgs === 0) { verdict = '— الوحدة صامتة تمامًا'; }
    else if (r.arriving === 0) { verdict = '⛔ منهم — لا يبثّ حسّاسًا'; theirs++; }
    else if (r.shown < r.arriving) { verdict = '⚠ منّا — نعرض أقلّ ممّا يصل'; ours++; }
    else if (r.arriving < 12) { verdict = `⛔ منهم — ${12 - r.arriving} قناة ناقصة`; theirs++; }
    else { verdict = '✓'; ok++; }
    if (verdict === '✓') continue;
    console.log('  ' + String(r.plate).padEnd(14) + String(r.arriving).padStart(4) + String(r.shown).padStart(6)
      + String(r.registered).padStart(7) + String(r.msgs).padStart(10) + '   ' + verdict);
  }
  console.log(`\n  سليم: ${ok} · منّا: ${ours} · منهم: ${theirs} · من ${rows.length} مركبة`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
