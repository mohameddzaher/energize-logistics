// رقمُ النسخة المنشورة الآن — يقرؤه المتصفّحُ ليعرف أنّ صفحته قديمة. راجع lib/appVersion.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export function GET() {
  let id = '';
  try { id = readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim(); } catch { /* dev */ }
  return Response.json({ id }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
