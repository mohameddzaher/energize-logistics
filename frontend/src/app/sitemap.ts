import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sitemap, generated from the pages that actually exist.
 * The old hand-edited public/sitemap.xml aged both ways: added pages were not indexed and deleted pages still got 404 reports, both hurting crawler trust.
 * The app tree is read at build time: every page.tsx is a real page. Excluded: the system area, login, API routes and parameterised pages (`[id]`), which are only known by content.
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
    // Route groups `(group)` do not appear in the URL, and the `[id]` parameter is not indexed.
    if (e.name.startsWith('[') || e.name.startsWith('@') || e.name.startsWith('_')) continue;
    if (EXCLUDED.has(e.name)) continue;
    const seg = e.name.startsWith('(') ? '' : `/${e.name}`;
    out.push(...collectRoutes(path.join(dir, e.name), `${prefix}${seg}`));
  }
  return out;
}

/** The main page gets the highest priority; deeper pages get progressively lower. */
const priorityOf = (route: string) => {
  if (route === '/') return 1;
  const depth = route.split('/').filter(Boolean).length;
  return depth === 1 ? 0.8 : 0.6;
};
const freqOf = (route: string): 'weekly' | 'monthly' =>
  (route === '/' || route === '/career' ? 'weekly' : 'monthly');

/**
 * Parameterised pages that are pre-generated.
 * `[eventId]` is one folder but several real pages (each album has a title, images and text), which a tree scan cannot see. They are read from `generateStaticParams` itself, the same source Next builds from, so the sitemap matches the build.
 */
function staticParamRoutes(appDir: string): string[] {
  const out: string[] = [];
  const galleryPage = path.join(appDir, 'gallery', '[eventId]', 'page.tsx');
  try {
    const src = fs.readFileSync(galleryPage, 'utf8');
    const block = src.slice(src.indexOf('generateStaticParams'));
    for (const m of block.matchAll(/eventId:\s*'([^']+)'/g)) out.push(`/gallery/${m[1]}`);
  } catch { /* No gallery */ }
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
