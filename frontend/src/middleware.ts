import { NextResponse } from 'next/server';

// Auth is handled client-side by AuthContext.
// The middleware just passes through — the system layout
// shows a spinner while checking auth and redirects to login if needed.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
