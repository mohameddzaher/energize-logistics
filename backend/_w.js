require('dotenv').config();
const m = require('mongoose');
(async () => {
  await m.connect(process.env.MONGODB_URI);
  const V = require('./src/models/Ls2Vehicle');
  for (let i = 0; i < 12; i++) {
    const v = await V.findOne({ plate: '8201 ZXA' }).select('tireCount tiresCarriedOver').lean();
    if ((v?.tireCount || 0) > 1) { console.log('✓ ' + v.tireCount + ' إطار' + (v.tiresCarriedOver ? ' (من السجلّ)' : '')); process.exit(0); }
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log('لم تتغيّر بعد ٣ دقائق');
  process.exit(1);
})();
