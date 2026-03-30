import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Learn about Energize Logistics — founded in 2021, a leading logistics and transportation company in Saudi Arabia with 360+ employees, 7 branches, and 1M+ successful shipments across the Middle East and Africa.',
  openGraph: {
    title: 'About Energize Logistics',
    description:
      'Founded in 2021, Energize Logistics is a leading logistics company in Saudi Arabia with 360+ employees and 7 operational branches.',
    images: [{ url: '/images/Asset 3.png', width: 160, height: 160, alt: 'Energize Logistics Logo' }],
  },
  alternates: {
    canonical: '/about',
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children
}
