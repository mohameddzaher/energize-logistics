"use client";

import { ArrowRight, Calendar, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function GalleryPreview() {
  const events = [
    {
      id: "annual-event",
      title: "2nd Anniversary Celebration",
      description: "Celebrating two years of excellence in logistics and transportation across the region.",
      date: "September 2024",
      location: "Jeddah, Saudi Arabia",
      coverImage: "/images/annual event/WhatsApp Image 2025-09-16 at 09.14.55_1ca17e0c.jpg",
      imageCount: 31,
    },
    {
      id: "grand-opening",
      title: "Grand Opening - New Branch",
      description: "Opening our largest and most advanced logistics facility to serve you better.",
      date: "October 2024",
      location: "Riyadh, Saudi Arabia",
      coverImage: "/images/openinng/367A3280.jpg",
      imageCount: 34,
    },
  ];

  return (
    <section className="relative bg-gray-900 text-white py-20 px-6 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/5 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Our <span className="text-[#f37121]">Gallery</span>
          </h2>
          <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto">
            Explore memorable moments from our events and milestones as we grow together
          </p>
        </div>

        {/* Event Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/gallery/${event.id}`}
              className="group relative bg-gradient-to-b from-gray-800 to-[#1a1a1a] rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 border border-gray-700/50 hover:border-[#f37121]/50"
            >
              {/* Image */}
              <div className="relative h-64 overflow-hidden">
                <Image
                  src={event.coverImage}
                  alt={event.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                {/* Image Count Badge */}
                <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-medium">
                  {event.imageCount} Photos
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#f37121] transition-colors">
                  {event.title}
                </h3>
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                  {event.description}
                </p>

                {/* Meta Info */}
                <div className="flex flex-col gap-2 text-xs text-gray-500 mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>{event.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>{event.location}</span>
                  </div>
                </div>

                {/* View Album Link */}
                <div className="flex items-center gap-2 text-[#f37121] font-semibold text-sm group-hover:gap-3 transition-all">
                  <span>View Album</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* View All Button */}
        <div className="text-center">
          <Link
            href="/gallery"
            className="inline-flex items-center gap-3 px-8 py-3 rounded-lg border border-[#f37121]/50 hover:border-[#f37121] hover:bg-[#f37121]/10 text-white font-semibold transition-all duration-300"
          >
            <span>View All Events</span>
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
