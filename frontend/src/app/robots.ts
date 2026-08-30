import type { MetadataRoute } from 'next';

/**
 * robots — يُولَّد ليبقى مع خريطةِ الموقع في ملفٍّ واحدٍ من الحقيقة.
 *
 * ولوحةُ النظام محجوبةٌ عن المفهرِسات: صفحاتُها خلف تسجيل دخولٍ فلن تُقرأ،
 * لكنّ زحفَها يستهلك حصّةَ الزحف التي كان يجب أن تُنفَق على صفحات الخدمات.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/system/', '/login/', '/api/', '/_next/'],
      },
    ],
    sitemap: 'https://energize-global.com/sitemap.xml',
    host: 'https://energize-global.com',
  };
}
