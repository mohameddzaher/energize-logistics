'use client';
import { io, Socket } from 'socket.io-client';

// Connect DIRECTLY to the backend at api.<domain> (a same-SITE subdomain), so
// the SameSite=None;Secure cookie is still sent on the handshake — no Safari/iOS
// ITP problem (that only hits cross-SITE domains). Going direct (instead of the
// Netlify same-origin proxy) lets us actually use WebSockets — nginx upgrades
// them — instead of slow long-polling.
let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL
      || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');
    socket = io(url, {
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
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
