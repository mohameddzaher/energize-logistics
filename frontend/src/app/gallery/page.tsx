"use client";

import { ArrowLeft, Calendar, MapPin, ImageIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function GalleryPage() {
  const events = [
    {
      id: "annual-event",
      title: "2nd Anniversary Celebration",
      description: "Celebrating two years of excellence in logistics and transportation across the region. A memorable event with our team, partners, and clients.",
      date: "September 2024",
      location: "Jeddah, Saudi Arabia",
      coverImage: "/images/annual event/WhatsApp Image 2025-09-16 at 09.14.55_1ca17e0c.jpg",
      imageCount: 31,
      folder: "annual event",
    },
    {
      id: "grand-opening",
      title: "Grand Opening - New Branch",
      description: "Opening our largest and most advanced logistics facility to serve you better. A milestone in our journey of growth and expansion.",
      date: "October 2024",
      location: "Riyadh, Saudi Arabia",
      coverImage: "/images/openinng/367A3280.jpg",
      imageCount: 34,
      folder: "openinng",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <section className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-12 px-6">
        <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto relative z-10">
          {/* Back Button */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </Link>

          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Event <span className="text-[#f37121]">Gallery</span>
          </h1>
          <p className="text-gray-400 text-sm md:text-base max-w-xl">
            Explore our journey through memorable moments and milestones
          </p>
        </div>
      </section>

      {/* Events Grid */}
      <section className="py-10 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/gallery/${event.id}`}
                className="group relative bg-gradient-to-b from-gray-800 to-[#1a1a1a] rounded-xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 border border-gray-700/50 hover:border-[#f37121]/50"
              >
                {/* Cover Image */}
                <div className="relative h-56 overflow-hidden">
                  <Image
                    src={event.coverImage}
                    alt={event.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />

                  {/* Image Count Badge */}
                  <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="font-medium text-xs">{event.imageCount} Photos</span>
                  </div>

                  {/* Event Info Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h2 className="text-lg font-bold text-white mb-2 group-hover:text-[#f37121] transition-colors">
                      {event.title}
                    </h2>

                    <div className="flex flex-col gap-1.5 text-xs text-gray-300 mb-2">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{event.date}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{event.location}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <p className="text-gray-400 text-xs leading-relaxed">
                    {event.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
