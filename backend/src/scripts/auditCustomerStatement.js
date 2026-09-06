require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { getSubject } = require('../services/reportSources');
  const subj = getSubject('customer');

  for (const name of ['شركة ابازا', 'Branch of Arctech Investment HK Ltd', 'موسسة روابي اروي']) {
    const doc = await subj.build(name, { from: '2026-01-01', to: '2026-12-31' }, 'ar');
    if (!doc) { console.log(`\n«${name}» → لا تقرير`); continue; }
    const blocks = doc.blocks || [];
    const secs = blocks.filter((b) => b.kind === 'section').map((b) => b.text);
    console.log(`\n«${name}» → ${blocks.length} كتلة`);
    console.log('  الأقسام:', secs.join(' | '));
    const i = blocks.findIndex((b) => b.kind === 'section' && /كشف حساب التحصيل/.test(b.text || ''));
    if (i >= 0 && blocks[i + 1]?.kind === 'stats') {
      blocks[i + 1].items.forEach((x) => console.log(`    ${x.label}: ${x.value}`));
    }
    const tbl = blocks.find((b) => b.kind === 'table' && b.head?.some((h) => /رقم الفاتورة/.test(h)));
    if (tbl) console.log(`    صفوفُ جدول الفواتير: ${tbl.rows.length}`);
    const fu = blocks.findIndex((b) => b.kind === 'section' && /المتابعات/.test(b.text || ''));
    if (fu >= 0) console.log(`    متابعات: ${blocks[fu + 1]?.rows?.length || 0}`);
  }
  await mongoose.disconnect();
})();
