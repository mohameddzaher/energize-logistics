import path from 'node:path';
import { execSync } from 'node:child_process';

// ── رقمُ النسخة: يعرفه المتصفّحُ عن نفسه، ويعرفه الخادمُ عن الحاليّة ─────────
// تبويبةٌ مفتوحةٌ قبل النشر تبقى على الشيفرة القديمة (ملفّاتُها تبقى على
// الخادم)، فإصلاحٌ نُشر لا يصل مَن لم يُحدِّث صفحته — «بيقولي لسه». فيُكتب
// الرقمُ في الحزمة نفسِها (NEXT_PUBLIC_BUILD_ID) وفي `.next/BUILD_ID`، ويقارن
// المتصفّحُ رقمَه بما يقوله `/app-version` — راجع lib/appVersion.
// ورقمٌ واحدٌ للبناء كلِّه: next.config يُقرأ في كلّ عاملٍ من عمّال البناء، فوقتٌ
// يُحسب في كلٍّ منها يعطي الحزمةَ رقمًا والملفَّ رقمًا آخر — فتظنّ كلُّ تبويبةٍ
// نفسَها قديمة. فالرقمُ هو الـcommit (النشرُ يرفض شجرةً غيرَ نظيفة)، ويُمرَّر
// للعمّال في البيئة.
function pickBuildId() {
  if (process.env.BUILD_ID_OVERRIDE) return process.env.BUILD_ID_OVERRIDE;
  let id = '';
  try { id = execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* لا git */ }
  id = id || `b${Date.now().toString(36)}`;
  process.env.BUILD_ID_OVERRIDE = id;
  return id;
}
const BUILD_ID = pickBuildId();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // QA builds into its own folder (NEXT_DIST_DIR=.next-qa) so a deploy and a
  // local test never overwrite each other's build — qa/README.md.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Pin the workspace root to THIS folder. A stray package-lock.json in the home
  // directory made Next infer the wrong root, which corrupts the dev webpack
  // chunk graph (stale chunks referencing modules that no longer exist).
  outputFileTracingRoot: path.resolve('.'),
  poweredByHeader: false,
  compress: true,
  // ── لماذا هذه الحزم بالذات ──────────────────────────────────────────────────
  // `lucide-react` و`recharts` تُستورَد بالاسم من حزمة واحدة ضخمة (recharts وحدها
  // ٧٫٤ ميغابايت مصدرًا)، فيدخل في حزمة الصفحة أكثر ممّا تستعمله بكثير — وهذا
  // أثقل ما في صفحات اللوحات. هذا الخيار يحوّل الاستيراد إلى ملفّ لكل رمز،
  // فلا يُحمَّل إلا المستعمَل فعلًا.
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion', 'date-fns'],
  },
  reactStrictMode: false,
  images: {
    unoptimized: true,
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${backend}/socket.io/:path*`,
      },
    ];
  },
}

export default nextConfig;
