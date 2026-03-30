import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Our Clients',
  description:
    'Energize Logistics is proud to serve 100+ trusted clients across industries in Saudi Arabia and the Middle East. Discover the companies that trust us with their logistics needs.',
  openGraph: {
    title: 'Our Clients | Energize Logistics',
    description:
      'We serve 100+ trusted clients across industries in Saudi Arabia and the Middle East.',
  },
  alternates: {
    canonical: '/clients',
  },
}

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return children
}
