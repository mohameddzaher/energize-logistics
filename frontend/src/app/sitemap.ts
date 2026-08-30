import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';

/**
 * خريطةُ الموقع — تُولَّد من الصفحات الموجودة فعلًا.
 *
 * ── لماذا لا تُكتب باليد ────────────────────────────────────────────────────
 * كانت `public/sitemap.xml` ملفًّا يُحرَّر يدويًّا. وملفٌّ كهذا يشيخ في اتّجاهين:
 * صفحةٌ تُضاف ولا تُدرَج فلا تُفهرَس، وصفحةٌ تُحذف ويبقى رابطُها فيُبلَّغ عنه
 * ٤٠٤ — وكلاهما يخصم من ثقة المفهرِس.
 *
 * فتُقرأ شجرةُ `app` عند البناء: كلُّ `page.tsx` صفحةٌ حقيقيّة. ويُستثنى ما لا
 * يُفهرَس — لوحةُ النظام وتسجيلُ الدخول ومساراتُ الـAPI والصفحاتُ ذاتُ
 * المعامل (`[id]`) لأنّها لا تُعرَف إلّا بمحتواها.
 */
const BASE = 'https://energize-global.com';

const EXCLUDED = new Set(['system', 'login', 'api']);

function collectRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }

  if (entries.some((e) => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))) {
    out.push(prefix || '/');
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // مجموعاتُ المسارات `(group)` لا تظهر في الرابط، والمعامل `[id]` لا يُفهرَس.
    if (e.name.startsWith('[') || e.name.startsWith('@') || e.name.startsWith('_')) continue;
    if (EXCLUDED.has(e.name)) continue;
    const seg = e.name.startsWith('(') ? '' : `/${e.name}`;
    out.push(...collectRoutes(path.join(dir, e.name), `${prefix}${seg}`));
  }
  return out;
}

/** الصفحةُ الأهمُّ أعلى أولويّة، وما تحتها يتدرّج بعمقه. */
const priorityOf = (route: string) => {
  if (route === '/') return 1;
  const depth = route.split('/').filter(Boolean).length;
  return depth === 1 ? 0.8 : 0.6;
};
const freqOf = (route: string): 'weekly' | 'monthly' =>
  (route === '/' || route === '/career' ? 'weekly' : 'monthly');

/**
 * الصفحاتُ ذاتُ المعامل التي تُولَّد مسبقًا.
 *
 * `[eventId]` مجلّدٌ واحد لكنّه صفحتان حقيقيّتان: كلُّ ألبومٍ صفحةٌ لها عنوانٌ
 * وصورٌ ونصّ. ومسحُ الشجرة لا يراهما — فتُقرأ من `generateStaticParams` نفسِها،
 * وهي المصدرُ الذي يبني منه Next تلك الصفحات، فلا تفترق الخريطةُ عمّا بُني.
 */
function staticParamRoutes(appDir: string): string[] {
  const out: string[] = [];
  const galleryPage = path.join(appDir, 'gallery', '[eventId]', 'page.tsx');
  try {
    const src = fs.readFileSync(galleryPage, 'utf8');
    const block = src.slice(src.indexOf('generateStaticParams'));
    for (const m of block.matchAll(/eventId:\s*'([^']+)'/g)) out.push(`/gallery/${m[1]}`);
  } catch { /* لا معرض */ }
  return out;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const appDir = path.join(process.cwd(), 'src', 'app');
  const routes = [...new Set([...collectRoutes(appDir), ...staticParamRoutes(appDir)])].sort();
  const lastModified = new Date();
  return routes.map((route) => ({
    url: `${BASE}${route === '/' ? '' : route}`,
    lastModified,
    changeFrequency: freqOf(route),
    priority: priorityOf(route),
  }));
}
