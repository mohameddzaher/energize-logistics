/**
 * «الأرضيات» و«تصريح الخروج» بندٌ واحدٌ في الواقع — قالها القسم. فيُجمَع ما في
 * الأوّل إلى الثاني ويُصفَّر، قبل أن تُرفع خانتُه من الشاشة؛ وإلّا بقي مالٌ
 * مسجَّلٌ لا خانةَ له تُقرأ أو تُصحَّح.
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { CustomsClearance, recomputeTotals } = (() => {
    const M = require('../models/CustomsClearance');
    return { CustomsClearance: M, recomputeTotals: M.recomputeTotals };
  })();
  const apply = process.argv.includes('--apply');
  const rows = await CustomsClearance.find({ 'costs.demurrage': { $gt: 0 } });
  let n = 0; let sum = 0;
  for (const c of rows) {
    const d = Number(c.costs.demurrage) || 0;
    const before = Number(c.costs.exitPermit) || 0;
    console.log(`${c.refNumber}: تصريح الخروج ${before} + أرضيات ${d} = ${before + d}`);
    sum += d; n += 1;
    if (apply) {
      c.costs.exitPermit = before + d;
      c.costs.demurrage = 0;
      recomputeTotals(c);          // الإجماليّ والربح يُعاد حسابُهما
      await c.save();
    }
  }
  console.log({ clearances: n, moved: sum, applied: apply });
  process.exit(0);
})();
