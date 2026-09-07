const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

let io;

const { isAllowedOrigin } = require('../config/cors');

/**
 * ── والحدثُ يعبر بين العمّال ──────────────────────────────────────────────
 *
 * الإنتاجُ يعمل بعاملَين في وضع العنقود (pm2 cluster). و socket.io يبثّ داخل
 * العملية التي يعيش فيها وحدَها: يُعدَّل سائقٌ على العامل الأوّل فيصل الحدثُ
 * إلى المتّصلين به، ولا يصل إلى من اتّصل بالثاني أبدًا. فيبدو النظامُ حيًّا
 * لنصف المستخدمين وميّتًا للنصف الآخر — وهو تفسيرُ «ليه لازم أعمل ريفريش؟».
 * والأمرُ يشمل كلَّ شاشةٍ حيّة في النظام لا شاشةَ السائقين وحدَها.
 *
 * ولا يُضاف Redis لهذا: العنقودُ عندنا يدعم `watch`، وهو ما تعتمد عليه
 * `ttlCache` أصلًا في إبطال المخزن بين العمّال. فالمحوّلُ الرسميُّ لمونجو يفعل
 * الشيءَ نفسَه — مجموعةٌ محدودةُ الحجم وتيّارُ تغييرٍ عليها — بلا بنيةٍ جديدة.
 *
 * وإن تعذّر التركيبُ لأيّ سبب، يبقى البثُّ داخل العامل كما كان: نصفُ حيٍّ خيرٌ
 * من خادمٍ لا يقوم.
 */
const ADAPTER_COLL = 'socketevents';
async function attachClusterAdapter(server) {
  try {
    const mongoose = require('mongoose');
    // ── ويُنتظَر اتّصالُ مونجو ولا يُستسلَم عنده ─────────────────────────
    // الخادمُ يفتح المقبسَ قبل أن يتّصل مونجو، فالانصرافُ عند أوّل نظرةٍ يعني
    // ألّا يُركَّب المحوّلُ أبدًا — وهو ما حدث: نُشر التغييرُ ولم تُنشأ
    // المجموعةُ أصلًا.
    if (mongoose.connection?.readyState !== 1) {
      await new Promise((resolve) => {
        const done = () => resolve();
        mongoose.connection.once('connected', done);
        mongoose.connection.once('open', done);
        setTimeout(done, 30000);                     // لا يُنتظَر إلى الأبد
      });
    }
    if (mongoose.connection?.readyState !== 1) return false;
    const db = mongoose.connection.db;

    // مجموعةٌ محدودةُ الحجم: الأحداثُ تُكتب وتُقرأ ثمّ لا تُحفَظ. تُنشأ مرّةً،
    // ووجودُها مسبقًا ليس خطأً.
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

  // يُركَّب بعد الإنشاء ولا يُنتظَر: الخادمُ يقوم فورًا، والمحوّلُ يلتحق بعد
  // أن يتّصل مونجو.
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
            io.emit('workflow:unlockAll', { userId: socket.userId });
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

const emitToAll = (event, data) => {
  if (io) io.emit(event, data);
};

/**
 * البثُّ الذي يحترم ما يراه كلُّ دور.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * الأعمدةُ الماليّة تُحجب عن غير أهلها في كلّ مسارٍ يمرّ بالخادم — القائمةُ
 * والتفصيلُ والتصديرُ وقوائمُ القيم والبحث. ثمّ يُعدَّل كشفٌ واحد، فيُبَثّ
 * المستندُ كاملًا إلى **كلّ** متّصل: رقمُ الفاتورة وصافيها وضريبتها تصل موظّفَ
 * العمليات في شاشته وقد مُنعت عنه في كلّ طلبٍ يطلبه.
 *
 * فالحجبُ لا يكون في مسارٍ ويُترك في آخر: بابٌ واحدٌ مفتوحٌ يُبطل الأبواب
 * المغلقةَ كلَّها.
 *
 * ── والحلُّ ────────────────────────────────────────────────────────────────
 * الحمولةُ تُبنى لكلّ دورٍ مرّةً واحدة، ثمّ تذهب لكلّ متّصلٍ حمولةُ دورِه —
 * وعددُ المتّصلين عشراتٌ لا آلاف، فالكلفةُ لا تُذكر.
 */
const emitPerRole = (event, buildPayload) => {
  if (!io) return;
  const cache = new Map();
  for (const socket of io.sockets.sockets.values()) {
    const role = socket.userRole || '';
    if (!cache.has(role)) cache.set(role, buildPayload(role));
    socket.emit(event, cache.get(role));
  }
};

const emitToUser = (userId, event, data) => {
  if (io) io.to(`user:${userId}`).emit(event, data);
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
  emitToDashboard,
  emitToCustomer,
};
