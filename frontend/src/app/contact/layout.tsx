import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Get in touch with Energize Logistics. Contact us via email at info@energize-logistics.com or call +966 54 095 8433. Offices in Jeddah, Riyadh, Dammam, and Abha, Saudi Arabia.',
  openGraph: {
    title: 'Contact Us | Energize Logistics',
    description:
      'Reach out to Energize Logistics — email info@energize-logistics.com or call +966 54 095 8433. Offices across Saudi Arabia.',
  },
  alternates: {
    canonical: '/contact',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
