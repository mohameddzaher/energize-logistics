require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { FleetShipment } = require('../models/FleetModels');
  const c = require('../controllers/fleetController');
  const rows = await FleetShipment.find({}).select('_id waybillNumber').limit(5).lean();
  if (!rows.length) { console.log('لا شحنات'); process.exit(0); }
  const ids = rows.map((r) => String(r._id));
  console.log(`يطلب ${ids.length} بوليصة: ${rows.map((r) => r.waybillNumber).join(', ')}`);

  const t = Date.now();
  const out = await new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(s) { this.statusCode = s; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      json(b) { resolve({ code: this.statusCode, json: b }); },
      send(buf) { resolve({ code: this.statusCode, buf, headers: this.headers }); },
    };
    c.getWaybillsPdf({ body: { ids }, query: {}, user: { role: 'super_admin' } }, res).catch((e) => resolve({ code: 500, json: { err: e.message } }));
  });
  if (out.code !== 200) { console.log('✗', out.json); process.exit(1); }
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(out.buf);
  console.log(`✓ ${out.buf.length.toLocaleString()} بايت · ${doc.getPageCount()} صفحة · ${((Date.now() - t) / 1000).toFixed(1)}ث`);
  console.log(`   المتوقَّع ${ids.length} صفحة — ${doc.getPageCount() === ids.length ? 'مطابق' : '✗ غير مطابق'}`);
  fs.writeFileSync('/tmp/waybills-test.pdf', out.buf);
  console.log('   حُفظ في /tmp/waybills-test.pdf');
  await mongoose.disconnect();
})();
