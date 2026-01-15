"use client";

import { ArrowRight, Calendar, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function GalleryPreview() {
  const events = [
    {
      id: "annual-event",
      title: "5th Anniversary Celebration",
      description: "Celebrating 5 years of excellence in logistics and transportation across the region.",
      date: "September 2025",
      location: "Jeddah, Saudi Arabia",
      coverImage: "/images/annual event/energize family.jpg",
      imageCount: 31,
    },
    {
      id: "grand-opening",
      title: "Grand Opening - New Main Branch",
      description: "Opening our largest and most advanced logistics facility to serve you better.",
      date: "January 2026",
      location: "Jeddah, Saudi Arabia",
      coverImage: "/images/openinng/367A3410.jpg",
      imageCount: 34,
    },
  ];

  return (
    <section className="relative bg-gray-900 text-white py-12 px-6 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/5 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            Our <span className="text-[#f37121]">Gallery</span>
          </h2>
          <p className="text-gray-400 text-sm md:text-base max-w-xl mx-auto">
            Explore memorable moments from our events and milestones
          </p>
        </div>

        {/* Event Cards */}
        <div className="grid md:grid-cols-2 gap-5 mb-8">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/gallery/${event.id}`}
              className="group relative bg-gradient-to-b from-gray-800 to-[#1a1a1a] rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 border border-gray-700/50 hover:border-[#f37121]/50"
            >
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                <Image
                  src={event.coverImage}
                  alt={event.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                {/* Image Count Badge */}
                <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-medium">
                  {event.imageCount} Photos
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="text-base font-bold text-white mb-1.5 group-hover:text-[#f37121] transition-colors">
                  {event.title}
                </h3>
                <p className="text-gray-400 text-xs mb-3 line-clamp-2">
                  {event.description}
                </p>

                {/* Meta Info */}
                <div className="flex flex-col gap-1.5 text-xs text-gray-500 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{event.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{event.location}</span>
                  </div>
                </div>

                {/* View Album Link */}
                <div className="flex items-center gap-2 text-[#f37121] font-semibold text-xs group-hover:gap-3 transition-all">
                  <span>View Album</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* View All Button */}
        <div className="text-center">
          <Link
            href="/gallery"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg border border-[#f37121]/50 hover:border-[#f37121] hover:bg-[#f37121]/10 text-white font-semibold transition-all duration-300"
          >
            <span>View All Events</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
