const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

let io;

const { isAllowedOrigin } = require('../config/cors');

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    },
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
  emitToUser,
  emitToDashboard,
  emitToCustomer,
};
