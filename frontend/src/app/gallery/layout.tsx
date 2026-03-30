import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Event Gallery',
  description:
    'Browse the Energize Logistics event gallery. View photos from our 2nd Anniversary Celebration, Grand Opening, and other milestones in our logistics journey.',
  openGraph: {
    title: 'Event Gallery | Energize Logistics',
    description:
      'Explore memorable moments from Energize Logistics events and milestones.',
    images: [{ url: '/images/annual event/WhatsApp Image 2025-09-16 at 09.14.55_1ca17e0c.jpg', width: 1200, height: 630, alt: 'Energize Logistics Events' }],
  },
  alternates: {
    canonical: '/gallery',
  },
}

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return children
}
