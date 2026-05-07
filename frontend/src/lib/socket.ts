'use client';
import { io, Socket } from 'socket.io-client';

// Connect to the same origin so the handshake's Cookie header is first-party.
// Mobile browsers block third-party cookies, which breaks socket auth when
// pointed cross-origin. The window.location.origin path is rewritten to the
// backend by Next.js (see next.config.ts /socket.io rewrite). Polling-only
// transport keeps things working through the Netlify proxy, which doesn't
// reliably upgrade WebSockets.
let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const url = typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001');
    socket = io(url, {
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['polling', 'websocket'],
    });
  }
  return socket;
};

export const connectSocket = () => {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
