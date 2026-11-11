'use client';
import { io, Socket } from 'socket.io-client';

// Connect DIRECTLY to the backend at api.<domain> (a same-SITE subdomain), so
// the SameSite=None;Secure cookie is still sent on the handshake — no Safari/iOS
// ITP problem (that only hits cross-SITE domains). Going direct (instead of the
// Netlify same-origin proxy) lets us actually use WebSockets — nginx upgrades
// them — instead of slow long-polling.
let socket: Socket | null = null;
// Set once the app asked to connect, so waking up never connects a logged-out page.
let started = false;

export const getSocket = (): Socket => {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL
      || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');
    socket = io(url, {
      withCredentials: true,
      autoConnect: false,
      // Never give up: a laptop asleep or a dropped network used to exhaust 10 attempts and leave the page without live updates until a refresh.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
    // Back online or back to the tab: reconnect at once instead of waiting for the next backoff step.
    if (typeof window !== 'undefined') {
      const wake = () => { if (socket && !socket.connected && started) socket.connect(); };
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    }
  }
  return socket;
};

export const connectSocket = () => {
  started = true;
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
};

export const disconnectSocket = () => {
  started = false;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
