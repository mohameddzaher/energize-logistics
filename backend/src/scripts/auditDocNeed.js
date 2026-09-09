/** لكلّ عائلةِ مستندات: كم مركبةً تُعَدّ «مطلوب — ناقص» اليوم، وكم «غير مطلوب». */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { VehicleMaster, VehicleRegistryConfig } = require('../models/VehicleMaster');
  const VDOC = require('../config/vehicleDocuments');
  const a = ((await VehicleRegistryConfig.findOne().lean()) || {}).alerts || {};
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const vs = await VehicleMaster.find({}).lean();
  console.log(`\n  ${vs.length} مركبة\n`);
  console.log('  العائلة'.padEnd(22) + 'مطلوب—ناقص'.padStart(12) + 'غير مطلوب'.padStart(12) + 'لها تاريخ'.padStart(12) + 'أخرى'.padStart(8));
  console.log('  ' + '─'.repeat(64));
  for (const d of VDOC.DOCUMENTS) {
    let need = 0, notReq = 0, have = 0, other = 0;
    for (const v of vs) {
      const date = get(v, d.path);
      const code = String(get(v, d.statusPath) || '');
      if (date) { have += 1; continue; }
      if (code === 'not_required' || code === 'not_in_use') { notReq += 1; continue; }
      if (code === 'required' || code === 'none' || code === '') { need += 1; continue; }
      other += 1;
    }
    console.log('  ' + d.ar.padEnd(20) + String(need).padStart(12) + String(notReq).padStart(12) + String(have).padStart(12) + String(other).padStart(8));
  }
  console.log('\n  «مطلوب—ناقص» هي ما تعرضه شريحةُ العمل في صفحة كلّ عائلة.');
  console.log('  وكلُّ صفٍّ فيها بلا وضعٍ مسجَّل — لا أحدَ قال إنّه غيرُ مطلوب، فعُدَّ نقصًا.');
  await mongoose.disconnect();
})();
