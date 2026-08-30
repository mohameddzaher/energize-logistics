import '../styles/globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FloatingButtons from '../components/FloatingButtons'
import { AuthProvider } from '@/context/AuthContext'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://energize-global.com'),
  title: {
    default: 'Energize Logistics | Complete Logistics & Supply Chain Solutions in Saudi Arabia',
    template: '%s | Energize Logistics',
  },
  description:
    'Energize Logistics provides reliable heavy truck transportation, customs clearance, 3PL last-mile logistics, and B2B tech solutions across Saudi Arabia and the Middle East. Founded in 2021 with 360+ employees and 7 branches.',
  keywords: [
    'logistics Saudi Arabia',
    'heavy truck transportation',
    'customs clearance KSA',
    'supply chain solutions',
    'freight forwarding',
    '3PL logistics',
    'last mile delivery Saudi',
    'Energize Logistics',
    'Jeddah logistics',
    'Riyadh logistics',
    'Dammam logistics',
    'fleet management',
    'B2B logistics solutions',
    'tire management system',
    'vehicle transportation KSA',
  ],
  authors: [{ name: 'Energize Logistics', url: 'https://energize-global.com' }],
  creator: 'Energize Logistics',
  publisher: 'Energize Logistics',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    // الجمهورُ الأوّل سعوديّ: تُعلَن العربيّةُ لغةً بديلةً كي تظهر البطاقةُ
    // بالعربيّة حين يُشارَك الرابطُ في واتساب أو لينكدإن بحسابٍ عربيّ.
    alternateLocale: ['ar_SA'],
    url: 'https://energize-global.com',
    siteName: 'Energize Logistics',
    title: 'Energize Logistics | Complete Logistics & Supply Chain Solutions',
    description:
      'Reliable logistics, international shipping, customs clearance, and smart supply chain solutions across Saudi Arabia and the Middle East.',
    images: [
      {
        url: '/images/energize-hero.jpg',
        width: 1920,
        height: 1080,
        alt: 'Energize Logistics - Complete Logistics Solutions',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Energize Logistics | Complete Logistics & Supply Chain Solutions',
    description:
      'Reliable logistics, international shipping, customs clearance, and smart supply chain solutions across Saudi Arabia.',
    images: ['/images/energize-hero.jpg'],
    creator: '@energizelco',
  },
  alternates: {
    canonical: 'https://energize-global.com',
    // الموقعُ عربيٌّ وإنجليزيّ: بغير هذا يفهرس جوجل نسخةً واحدة ويعدّ الأخرى
    // تكرارًا، فتضيع نصفُ الكلمات المفتاحيّة — ومعظمُ من يبحث عن نقلٍ ثقيلٍ
    // في السعوديّة يبحث بالعربيّة.
    languages: {
      'ar-SA': 'https://energize-global.com',
      'en-US': 'https://energize-global.com/en',
      'x-default': 'https://energize-global.com',
    },
  },
  // ── الأيقونة ──────────────────────────────────────────────────────────────
  // كان شريطُ التبويب يعرض ورقةً فارغة. والعلامةُ في ستّةَ عشرَ بكسلًا لا
  // تحتمل كلمة «energize» كاملةً — تصير خطًّا رماديًّا — فحرفُ الـ«z» وحدَه،
  // وهو العلامةُ التي تُعرَف بها الشركة، برتقاليًّا على داكنِ الشريط الجانبيّ.
  // وأرضيّتُه مصمتةٌ لا شفّافة، وإلّا اختفى الحرفُ في الوضع الداكن.
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/icon.png',
  },
  category: 'Logistics',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // ── ما تقرؤه محرّكاتُ البحث ────────────────────────────────────────────
  // البياناتُ المنظَّمة ليست زينةً: منها تبني جوجل «بطاقةَ المعرفة» — الاسمُ
  // والشعارُ والفروعُ والخدماتُ وأرقامُ التواصل تظهر بجانب النتيجة. وكانت
  // `Organization` عامّةً: شركةٌ ما، لا يُعرف ما تفعل. صارت `MovingCompany`
  // ومعها فهرسُ خدماتٍ صريح.
  //
  // وكلُّ رقمٍ هنا حقيقيّ: ثمانيةُ فروعٍ من سجلّ الفروع، والتأسيسُ ٢٠٢١،
  // والعددُ من سجلّ الموارد البشريّة. الرقمُ المخترَع في بياناتٍ منظَّمةٍ
  // يُكتشَف ويُعاقَب عليه، وأسوأُ من ذلك أنّه يُقرأ ويُصدَّق.
  const BRANCH_CITIES = [
    ['Jeddah', 'جدة'], ['Riyadh', 'الرياض'], ['Al Dammam', 'الدمام'],
    ['Makkah', 'مكة المكرمة'], ['Yanbu', 'ينبع'], ['Rabigh', 'رابغ'],
    ['Jazan', 'جازان'], ['Sudair', 'سدير'],
  ];

  const SERVICES = [
    ['Heavy Truck Transportation', 'النقل بالشاحنات الثقيلة'],
    ['Customs Clearance', 'التخليص الجمركي'],
    ['3PL & Last-Mile Delivery', 'الخدمات اللوجستية والتوصيل للميل الأخير'],
    ['Fleet Management', 'إدارة الأساطيل'],
    ['Freight Forwarding', 'الشحن والتوكيلات الملاحية'],
    ['Warehousing & Storage', 'التخزين والمستودعات'],
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'MovingCompany'],
    '@id': 'https://energize-global.com/#organization',
    name: 'Energize Logistics',
    alternateName: 'تنشيط الخدمات اللوجستية',
    url: 'https://energize-global.com',
    logo: {
      '@type': 'ImageObject',
      url: 'https://energize-global.com/images/energize-mark.png',
      width: 512,
      height: 512,
    },
    image: 'https://energize-global.com/images/energize-hero.jpg',
    description:
      'Leading logistics and transportation company in Saudi Arabia providing heavy truck transportation, customs clearance, 3PL last-mile logistics, fleet management and B2B tech solutions.',
    foundingDate: '2021',
    numberOfEmployees: { '@type': 'QuantitativeValue', value: 340, unitText: 'employees' },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Jeddah',
      addressRegion: 'Makkah Province',
      addressCountry: 'SA',
    },
    // المناطقُ التي تُخدَم فعلًا — فروعٌ قائمةٌ لا نيّاتٌ للتوسّع.
    areaServed: [
      { '@type': 'Country', name: 'Saudi Arabia' },
      ...BRANCH_CITIES.map(([en]) => ({ '@type': 'City', name: en })),
    ],
    location: BRANCH_CITIES.map(([en, ar]) => ({
      '@type': 'Place',
      name: `Energize Logistics — ${en}`,
      alternateName: `تنشيط الخدمات اللوجستية — ${ar}`,
      address: { '@type': 'PostalAddress', addressLocality: en, addressCountry: 'SA' },
    })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Logistics Services',
      itemListElement: SERVICES.map(([en, ar]) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: en, alternateName: ar, areaServed: { '@type': 'Country', name: 'Saudi Arabia' } },
      })),
    },
    knowsLanguage: ['ar', 'en'],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: '+966-54-095-8433',
        contactType: 'customer service',
        areaServed: 'SA',
        availableLanguage: ['English', 'Arabic'],
      },
      {
        '@type': 'ContactPoint',
        telephone: '+966-54-095-8433',
        contactType: 'sales',
        areaServed: 'SA',
        availableLanguage: ['English', 'Arabic'],
      },
    ],
    sameAs: [
      'https://www.linkedin.com/company/energizelco',
      'https://x.com/energizelco',
      'https://www.instagram.com/energizelco/',
      'https://www.youtube.com/@energizelco',
      'https://www.facebook.com/energizelco',
    ],
  };

  // موقعٌ يُبحَث فيه: يجعل جوجل يعرض خانةَ بحثٍ تحت النتيجة الأولى.
  const siteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': 'https://energize-global.com/#website',
    url: 'https://energize-global.com',
    name: 'Energize Logistics',
    inLanguage: ['ar-SA', 'en-US'],
    publisher: { '@id': 'https://energize-global.com/#organization' },
  };


  return (
    <html lang="en" suppressHydrationWarning style={{ height: '100%' }}>
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteLd) }}
        />
      </head>

      <body className={`${inter.variable} antialiased bg-gray-800 text-gray-900 h-full overflow-x-hidden`}>
        <AuthProvider>
          <div className="flex flex-col min-h-screen w-full">
            <Header />
            <main className="flex-1 w-full overflow-hidden">
              {children}
            </main>
            <Footer />
            <FloatingButtons />
          </div>
        </AuthProvider>
      </body>
    </html>
  )
}
