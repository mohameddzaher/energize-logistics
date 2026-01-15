"use client";

import { ArrowLeft, Calendar, MapPin, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type EventData = {
  title: string;
  description: string;
  date: string;
  location: string;
  images: string[];
};

export default function EventAlbumClient({ event }: { event: EventData }) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <section className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-10 px-6">
        <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          <Link
            href="/gallery"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Gallery</span>
          </Link>

          <h1 className="text-2xl md:text-3xl font-bold mb-2">{event.title}</h1>
          <p className="text-gray-400 text-sm mb-5 max-w-2xl">{event.description}</p>

          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-gray-300">
              <Calendar className="w-3.5 h-3.5 text-[#f37121]" />
              <span>{event.date}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-300">
              <MapPin className="w-3.5 h-3.5 text-[#f37121]" />
              <span>{event.location}</span>
            </div>
            <div className="text-gray-400">
              {event.images.length} Photos
            </div>
          </div>
        </div>
      </section>

      {/* Image Grid */}
      <section className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {event.images.map((image, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelectedImage(image)}
                className="relative aspect-square overflow-hidden rounded-lg group cursor-pointer bg-gray-800"
                aria-label={`View photo ${index + 1}`}
              >
                <Image
                  src={image}
                  alt={`${event.title} - Photo ${index + 1}`}
                  fill
                  className="object-cover group-hover:scale-110 transition-transform duration-300"
                  sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  loading={index < 8 ? "eager" : "lazy"}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors"
            aria-label="Close lightbox"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="relative max-w-7xl max-h-[90vh] w-full h-full">
            <Image
              src={selectedImage}
              alt="Selected photo"
              fill
              className="object-contain"
              sizes="100vw"
              quality={95}
            />
          </div>
        </div>
      )}
    </main>
  );
}
