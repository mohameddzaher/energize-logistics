const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

let io;

// Scoped partner accounts do not receive section broadcasts.
// The global broadcast (`emitToAll`) carries section rows such as statements, entries and employees. A scoped partner account (config/scopedRoles) sees only its own screen, so its sockets join a room that excludes every global broadcast and receive only events sent to its role (`emitToRole`) or to the user (`emitToUser`).
const SCOPED_ROOM = 'scoped-external';
const broadcast = () => io.except(SCOPED_ROOM);

const { isAllowedOrigin } = require('../config/cors');

/**
 * Events cross between workers.
 * Production runs two PM2 cluster workers and socket.io broadcasts only inside its own process, so a change on one worker never reaches clients on the other (half the users see a live system, half a stale one), on every live screen.
 * The official Mongo adapter is used instead of Redis: a capped collection plus a change stream, which the cluster supports and ttlCache already relies on.
 * If mounting fails, broadcasting stays within the worker.
 */
const ADAPTER_COLL = 'socketevents';
async function attachClusterAdapter(server) {
  try {
    const mongoose = require('mongoose');
    // Wait for the Mongo connection instead of giving up: the server opens the socket before Mongo connects, so bailing out on the first check meant the adapter was never mounted.
    if (mongoose.connection?.readyState !== 1) {
      await new Promise((resolve) => {
        const done = () => resolve();
        mongoose.connection.once('connected', done);
        mongoose.connection.once('open', done);
        setTimeout(done, 30000);                     // Do not wait forever.
      });
    }
    if (mongoose.connection?.readyState !== 1) return false;
    const db = mongoose.connection.db;

    // Capped collection: events are written and read but not kept. Created once; already existing is not an error.
    try {
      await db.createCollection(ADAPTER_COLL, { capped: true, size: 1e6 });
    } catch (e) {
      if (e && e.codeName !== 'NamespaceExists') throw e;
    }

    const { createAdapter } = require('@socket.io/mongo-adapter');
    server.adapter(createAdapter(db.collection(ADAPTER_COLL), {
      addCreatedAtField: true,
    }));
    return true;
  } catch (e) {
    console.error('socket cluster adapter unavailable — events stay per-worker:', e.message);
    return false;
  }
}

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  // Mounted after creation without awaiting: the server starts immediately and the adapter attaches once Mongo is connected.
  attachClusterAdapter(io).then((ok) => {
    if (ok) console.log('socket.io: cluster adapter attached (mongo)');
  });

  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      // Browsers hand the cookie; the mobile app passes the same access token
      // via the socket.io handshake auth payload instead.
      const token = cookies.accessToken || socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);

    socket.join(`user:${socket.userId}`);
    if (socket.userRole) socket.join(`role:${socket.userRole}`);
    if (require('../config/scopedRoles').isScopedRole(socket.userRole)) {
      socket.join(SCOPED_ROOM);
      // Does not join the dashboard, customer and operations rooms; what is broadcast there is not for this account.
      return;
    }

    socket.on('join:dashboard', (role) => {
      socket.join(`dashboard:${role}`);
    });

    socket.on('join:customer', (customerId) => {
      socket.join(`customer:${customerId}`);
    });

    socket.on('join:workflows', () => {
      socket.join('workflows');
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
      // Auto-unlock any workflows locked by this user
      try {
        const OperationsWorkflow = require('../models/OperationsWorkflow');
        OperationsWorkflow.updateMany(
          { lockedBy: socket.userId },
          { $set: { lockedBy: null, lockedByName: '', lockedAt: null } }
        ).then((result) => {
          if (result.modifiedCount > 0) {
            broadcast().emit('workflow:unlockAll', { userId: socket.userId });
          }
        }).catch(() => {});
      } catch (e) {}
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

// Finance listens to all money movement.
// Its pages combine money from every section, so any financial broadcast in any section clears its cache and tells it to refetch. Clearing and notifying are coalesced in a short window because saving one statement emits three events.
// Each event names the departments that read what changed (see each department's sources in financeController); an unnamed event clears all, so the error is an extra read, never a stale number.
// This is needed because the operations platform sync broadcasts `workflow:*` every few seconds, which kept reloading unrelated finance pages.
const FINANCE_DEPTS = [
  [/^(wallet:|workflow:|shipmentOrders:)/, ['operations', 'collections', 'fleet']],
  [/^fleet:/, ['fleet']],
  [/^customs:/, ['customs']],
  [/^(b2c:wallet|lt:custody)/, ['light']],
  [/^(marketing:|bd:)/, ['marketing']],
  [/^hr:(contract|employee|asset|master)/, ['hr', 'it']],
  [/^it:/, ['it', 'hr']],
  [/^collections:/, ['collections']],
  [/^(vreg:|vehicle:)/, ['vehicles', 'light']],
  [/^(ls2:(store|repair)|ht:custody)/, ['fleet']],
];
const FINANCE_EVENTS = /^(wallet:|workflow:|collections:|fleet:|shipmentOrders:|customs:|b2c:wallet|lt:custody|marketing:|bd:|hr:(contract|employee|asset|master)|it:|vreg:|vehicle:|ls2:(store|repair)|ht:custody|procurement:|performance:|accounting:)/;
let financeTimer = null;
let financePending = new Set();
const financeTouch = (event) => {
  const ev = String(event || '');
  if (!FINANCE_EVENTS.test(ev)) return;
  const hit = FINANCE_DEPTS.find(([re]) => re.test(ev));
  for (const d of (hit ? hit[1] : ['*'])) financePending.add(d);
  if (financeTimer) return;
  financeTimer = setTimeout(() => {
    financeTimer = null;
    const depts = financePending.has('*') ? null : [...financePending];
    financePending = new Set();
    try {
      const cache = require('../utils/ttlCache');
      if (!depts) cache.clear('finance:');
      else for (const d of depts) cache.clear(`finance:${d}:`);
    } catch (e) { /* The timeout is enough. */ }
    // Missing `depts` means all departments; a page that does not know the field refetches as before.
    if (io) broadcast().emit('finance:changed', { at: Date.now(), event: ev, ...(depts ? { depts } : {}) });
    // The window is ten seconds, not one and a half.
    // The operations sync broadcasts every five or six seconds in working hours, and each broadcast woke every open finance page. The payload is cached for a minute on the server, so faster wake-ups bring no new numbers, only extra calls and data on phones.
  }, 10000);
};

// The executive overview listens to every section.
// It covers the whole company, so any event in any section matters, except notifications, chats and typing events, which carry no figures. Events are coalesced for five seconds because the platform sync alone emits dozens per minute.
const EXEC_IGNORE = /^(notification|chat|remote:chat|typing|presence|user:|executive:|finance:changed|permissions:)/;
let execTimer = null;
const executiveTouch = (event) => {
  if (EXEC_IGNORE.test(String(event || '')) || execTimer) return;
  execTimer = setTimeout(() => {
    execTimer = null;
    try { require('../utils/ttlCache').clear('exec:'); } catch (e) { /* The timeout is enough. */ }
    if (io) broadcast().emit('executive:changed', { at: Date.now(), event });
    // The executive overview is a company-wide snapshot with a one-minute cache, so half a minute is enough; the old five seconds caused twelve refetches per minute on phones with no new figures.
  }, 30000);
};

/**
 * The payload is sent as it would be read.
 * The two server instances are linked by the Mongo adapter, which encodes a Mongoose document as raw BSON, not through `toJSON`. Clients on the other instance would then miss derived fields (such as the customs `pipeline` stages) and receive what `toJSON` deliberately drops (transaction profit), while same-instance clients get it right. The payload is converted to explicit JSON once here so output is identical from either instance.
 */
const plain = (data) => {
  if (data === undefined || data === null || typeof data !== 'object') return data;
  try { return JSON.parse(JSON.stringify(data)); } catch (_) { return data; }
};

const emitToAll = (event, data) => {
  if (io) broadcast().emit(event, plain(data));
  financeTouch(event);
  executiveTouch(event);
};

/**
 * Broadcast that respects what each role may see.
 * Financial columns are hidden from non-owners on every server path (list, detail, export, value lists, search), but a broadcast of the full document would leak invoice number, net and tax to every connected client, defeating all the other paths. One open path cancels all the closed ones.
 * The payload is built once per role and each client gets its role's version; connected clients number in the dozens, so the cost is negligible.
 */
const emitPerRole = (event, buildPayload) => {
  financeTouch(event);
  executiveTouch(event);
  if (!io) return;
  const cache = new Map();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.rooms && socket.rooms.has(SCOPED_ROOM)) continue;
    const role = socket.userRole || '';
    if (!cache.has(role)) cache.set(role, buildPayload(role));
    socket.emit(event, cache.get(role));
  }
};

const emitToUser = (userId, event, data) => {
  if (io) io.to(`user:${userId}`).emit(event, data);
  financeTouch(event);
  executiveTouch(event);
};

/** To every client with this role; it is the only route by which a scoped account receives live events. */
const emitToRole = (role, event, data) => {
  if (io) io.to(`role:${role}`).emit(event, plain(data));
};

const emitToDashboard = (role, event, data) => {
  if (io) io.to(`dashboard:${role}`).emit(event, data);
};

const emitToCustomer = (customerId, event, data) => {
  if (io) io.to(`customer:${customerId}`).emit(event, data);
};

module.exports = {
  initializeSocket,
  getIO,
  emitToAll,
  emitPerRole,
  emitToUser,
  emitToRole,
  emitToDashboard,
  emitToCustomer,
};
