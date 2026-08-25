import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
