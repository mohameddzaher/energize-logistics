import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Our Services',
  description:
    'Explore Energize Logistics services: heavy truck transportation, customs clearance & brokerage, 3PL last-mile logistics, tire management systems, vehicle transportation, and B2B logistics tech solutions across Saudi Arabia.',
  openGraph: {
    title: 'Services | Energize Logistics',
    description:
      'Heavy truck transportation, customs clearance, 3PL logistics, tire management, vehicle transport, and B2B tech solutions.',
  },
  alternates: {
    canonical: '/services',
  },
}

export default function ServicesLayout({ children }: { children: React.ReactNode }) {
  return children
}
