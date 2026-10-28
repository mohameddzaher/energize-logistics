// Version of the build THIS server is running. The browser compares it with its
// own build id (lib/appVersion) to know when a newer version is live.
//
// It must be the running build, not .next/BUILD_ID on disk: a deploy copies the
// new files before the server restarts, and reading the file then announced a
// version the server was not serving yet — every open page reloaded into the
// same old version, again and again.
export const dynamic = 'force-dynamic';

const RUNNING = process.env.NEXT_PUBLIC_BUILD_ID || '';

export function GET() {
  return Response.json({ id: RUNNING }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
