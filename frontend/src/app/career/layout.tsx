import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Join the Energize Logistics team. Explore open positions in logistics, operations, accounting, and more across Saudi Arabia. Submit your application today.',
  openGraph: {
    title: 'Careers | Energize Logistics',
    description:
      'Explore career opportunities at Energize Logistics. Open positions in logistics, operations, and more across Saudi Arabia.',
  },
  alternates: {
    canonical: '/career',
  },
}

export default function CareerLayout({ children }: { children: React.ReactNode }) {
  return children
}
