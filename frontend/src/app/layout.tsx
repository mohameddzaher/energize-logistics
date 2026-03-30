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
  },
  category: 'Logistics',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Energize Logistics',
    url: 'https://energize-global.com',
    logo: 'https://energize-global.com/images/Asset 3.png',
    description:
      'Leading logistics and transportation company in Saudi Arabia providing heavy truck transportation, customs clearance, 3PL logistics, and B2B tech solutions.',
    foundingDate: '2021',
    numberOfEmployees: {
      '@type': 'QuantitativeValue',
      minValue: 360,
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Jeddah',
      addressCountry: 'SA',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: '+966-54-095-8433',
        contactType: 'customer service',
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
  }

  return (
    <html lang="en" suppressHydrationWarning style={{ height: '100%' }}>
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
