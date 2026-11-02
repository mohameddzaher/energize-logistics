/**
 * Proves that an event emitted in one process reaches a client connected to another.
 * Two servers on different ports with a Mongo adapter between them, like the two production workers.
 * Needs socket.io-client, which is not a production dependency: npm install --no-save socket.io-client && node src/scripts/auditSocketCluster.js
 */
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const { createAdapter } = require('@socket.io/mongo-adapter');

const COLL = 'socketevents_test';
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  try { await db.createCollection(COLL, { capped: true, size: 1e6 }); } catch (e) { if (e.codeName !== 'NamespaceExists') throw e; }

  const make = async (port) => {
    const srv = http.createServer();
    const s = new Server(srv, { cors: { origin: true } });
    s.adapter(createAdapter(db.collection(COLL), { addCreatedAtField: true }));
    await new Promise((r) => srv.listen(port, r));
    return { srv, s };
  };
  const A = await make(5311);   // First worker
  const B = await make(5312);   // Second worker

  const client = Client('http://localhost:5312', { transports: ['websocket'] });
  await new Promise((r) => client.on('connect', r));
  console.log('اتّصل العميلُ بالعامل الثاني.');

  const got = new Promise((resolve) => {
    client.on('fleet:drivers', (d) => resolve(d));
    setTimeout(() => resolve(null), 6000);
  });

  // Emitted from the first worker; the client is not connected to it.
  setTimeout(() => A.s.emit('fleet:drivers', { from: 'worker-1' }), 400);
  const res = await got;
  console.log(res ? `✓ وصل الحدثُ عبر العمّال: ${JSON.stringify(res)}` : '✗ لم يصل — البثُّ ما زال داخل العامل');

  client.close(); A.srv.close(); B.srv.close();
  await db.collection(COLL).drop().catch(() => {});
  await mongoose.disconnect();
  process.exit(res ? 0 : 1);
})();
