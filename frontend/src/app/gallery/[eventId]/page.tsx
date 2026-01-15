import EventAlbumClient from './EventAlbumClient';
import Link from "next/link";

const eventsData: Record<string, {
  title: string;
  description: string;
  date: string;
  location: string;
  images: string[];
}> = {
  "annual-event": {
    title: "2nd Anniversary Celebration",
    description: "Celebrating two years of excellence in logistics and transportation across the region. A memorable event with our team, partners, and clients.",
    date: "September 2024",
    location: "Jeddah, Saudi Arabia",
    images: [
      "WhatsApp Image 2025-09-16 at 09.14.55_1ca17e0c.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.55_f1e864f8.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_31f73201.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_35087111.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_561a7032.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_9b4779ab.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_a50ffe8b.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.56_c193eef3.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.57_5a98c729.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.57_ab880581.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.57_db4df30b.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.57_e274846f.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.57_f1445b0e.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_2bf24a2a.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_7a400d95.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_8975beb1.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_90a93f4d.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_b3062cf0.jpg",
      "WhatsApp Image 2025-09-16 at 09.14.58_f51027d8.jpg",
      "WhatsApp Image 2025-09-16 at 12.49.28_39726307.jpg",
      "WhatsApp Image 2025-09-16 at 12.49.29_6b23fc28.jpg",
      "energize family.jpg",
    ].map(img => `/images/annual event/${img}`),
  },
  "grand-opening": {
    title: "Grand Opening - New Branch",
    description: "Opening our largest and most advanced logistics facility to serve you better. A milestone in our journey of growth and expansion.",
    date: "October 2024",
    location: "Riyadh, Saudi Arabia",
    images: [
      "367A3280.jpg",
      "367A3282.jpg",
      "367A3286.jpg",
      "367A3290.jpg",
      "367A3304.jpg",
      "367A3305.jpg",
      "367A3308.jpg",
      "367A3312.jpg",
      "367A3314.jpg",
      "367A3316.jpg",
      "367A3317.jpg",
      "367A3320.jpg",
      "367A3325.jpg",
      "367A3331.jpg",
      "367A3365.jpg",
      "367A3371.jpg",
      "367A3373.jpg",
      "367A3376.jpg",
      "367A3381.jpg",
      "367A3391.jpg",
      "367A3393.jpg",
      "367A3401.jpg",
      "367A3406.jpg",
      "367A3410.jpg",
      "367A3411.jpg",
      "367A3412.jpg",
      "367A3413.jpg",
      "367A3416.jpg",
      "367A3418.jpg",
      "367A3421.jpg",
      "367A3423.jpg",
      "367A3452.jpg",
      "367A3460.jpg",
      "367A3463.jpg",
    ].map(img => `/images/openinng/${img}`),
  },
};

export function generateStaticParams() {
  return [
    { eventId: 'annual-event' },
    { eventId: 'grand-opening' },
  ];
}

export default async function EventAlbumPage({ params }: { params: Promise<{ eventId: string }> }) {
  const resolvedParams = await params;
  const event = eventsData[resolvedParams.eventId];

  if (!event) {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Event Not Found</h1>
          <Link href="/gallery" className="text-[#f37121] hover:underline">
            Back to Gallery
          </Link>
        </div>
      </main>
    );
  }

  return <EventAlbumClient event={event} />;
}
