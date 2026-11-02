import type { MetadataRoute } from 'next';

/**
 * robots: generated so it stays in sync with the sitemap as one source of truth.
 * The system area is blocked from crawlers: its pages are behind login and unreadable anyway, but crawling them would use crawl budget meant for the service pages.
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
