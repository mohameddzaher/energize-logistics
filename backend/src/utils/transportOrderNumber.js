/**
 * The one transport order series, shared by Shipment Orders and Fleet Management.
 * `$inc` is atomic in the database, so two people on either section never get the same
 * number. The counter never trails the platform's highest, and a number already on a
 * workflow row (older fleet loads carry 100001+) is stepped over.
 */
const mongoose = require('mongoose');

async function nextTransportNumber() {
  const { db } = mongoose.connection;
  const counters = db.collection('shipmentordercounters');
  const [top] = await db.collection('shipmentorders').find({ source: 'platform', graduationNumber: { $ne: null } })
    .sort({ graduationNumber: -1 }).limit(1).project({ graduationNumber: 1 }).toArray();
  if (top) await counters.updateOne({ _id: 'waybill' }, { $max: { seq: top.graduationNumber } }, { upsert: true });
  for (let i = 0; i < 1000; i += 1) {
    const c = await counters.findOneAndUpdate({ _id: 'waybill' }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
    const seq = c.value ? c.value.seq : c.seq;
    if (!(await db.collection('operationsworkflows').findOne({ reportNumber: String(seq) }, { projection: { _id: 1 } }))) return seq;
  }
  throw new Error('No free transport order number');
}

module.exports = { nextTransportNumber };
