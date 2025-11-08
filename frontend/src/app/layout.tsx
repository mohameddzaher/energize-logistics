import '../styles/globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FloatingButtons from '../components/FloatingButtons'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Energize Logistics',
  description: 'Energize Logistics — Complete logistics, shipping & supply chain solutions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning style={{ height: '100%' }}>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0"
        />
      </head>

      <body className={`${inter.variable} antialiased bg-gray-800 text-gray-900 h-full overflow-x-hidden`}>
        <div className="flex flex-col min-h-screen w-full">
          <Header />
          <main className="flex-1 w-full overflow-hidden"> {/* غيرت من overflow-visible إلى hidden */}
            {children}
          </main>
          <Footer />
          <FloatingButtons />
        </div>
      </body>
    </html>
  )
}