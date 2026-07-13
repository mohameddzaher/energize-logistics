"use client";

import { useState } from 'react';

interface LocationMapProps {
  title?: string;
  subtitle?: string;
}

export default function LocationMap({
  title = "Our Headquarters",
  subtitle = "Visit our main office in Jeddah, Saudi Arabia"
}: LocationMapProps) {
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  const contactInfo = {
    address: "Al-Madinah Al-Munawarah Road, Jeddah, Saudi Arabia",
    coordinates: "21.576898, 39.16732",
    phone: "920031911",
    email: "info@energize-logistics.com",
    workingHours: "Sun - Thu: 8:00 AM - 6:00 PM"
  };

  return (
    <section className="py-12 px-4 sm:px-6 bg-gradient-to-b from-gray-950 to-black">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-px bg-gradient-to-r from-transparent via-orange-500/60 to-transparent"></div>
            <span className="text-orange-400 text-xs font-semibold uppercase tracking-wider">Visit Us</span>
            <div className="w-10 h-px bg-gradient-to-r from-transparent via-orange-500/60 to-transparent"></div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">
            {title}
          </h2>
          <p className="text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Google Maps Embed */}
          <div className="relative rounded-lg overflow-hidden border border-gray-800/50">
            <div className="aspect-[4/3] relative">
              {!isMapLoaded && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-3xl mb-2">🗺️</div>
                    <div className="text-gray-400 text-sm">Loading map...</div>
                  </div>
                </div>
              )}
              
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3710.23113884275!2d39.16732!3d21.576898999999994!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjHCsDM0JzM2LjgiTiAzOcKwMTAnMDIuNCJF!5e0!3m2!1sen!2ssa!4v1760014775791!5m2!1sen!2ssa"
                className="absolute top-0 start-0 w-full h-full border-0"
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={() => setIsMapLoaded(true)}
              />
            </div>
            
            {/* Map Controls */}
            <div className="absolute bottom-4 end-4 flex gap-2">
              <a
                href="https://maps.google.com/?q=21.576898,39.16732"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-gray-900/90 backdrop-blur-sm text-white text-xs rounded-md border border-gray-800 hover:bg-gray-800 transition-colors flex items-center gap-1"
              >
                <span>Open in Maps</span>
                <span>↗</span>
              </a>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <div className="p-5 bg-gradient-to-br from-gray-900/50 to-black/40 rounded-lg border border-gray-800/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-md bg-gradient-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20 flex items-center justify-center">
                  <span className="text-lg">📍</span>
                </div>
                <div>
                  <h3 className="text-white text-base font-bold">Headquarters</h3>
                  <p className="text-orange-400 text-xs">Main Office</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="text-gray-500 mt-0.5">🏢</div>
                  <div>
                    <div className="text-gray-500 text-xs mb-0.5">Address</div>
                    <div className="text-white text-sm">{contactInfo.address}</div>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="text-gray-500 mt-0.5">📞</div>
                  <div>
                    <div className="text-gray-500 text-xs mb-0.5">Phone</div>
                    <a href={`tel:${contactInfo.phone}`} className="text-white text-sm hover:text-orange-400 transition-colors">
                      {contactInfo.phone}
                    </a>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="text-gray-500 mt-0.5">✉️</div>
                  <div>
                    <div className="text-gray-500 text-xs mb-0.5">Email</div>
                    <a href={`mailto:${contactInfo.email}`} className="text-white text-sm hover:text-orange-400 transition-colors">
                      {contactInfo.email}
                    </a>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="text-gray-500 mt-0.5">🕐</div>
                  <div>
                    <div className="text-gray-500 text-xs mb-0.5">Working Hours</div>
                    <div className="text-white text-sm">{contactInfo.workingHours}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Get Directions */}
            <div className="p-4 bg-gradient-to-r from-orange-500/5 to-amber-500/5 rounded-lg border border-orange-500/20">
              <h4 className="text-white text-sm font-bold mb-2">Get Directions</h4>
              <p className="text-gray-400 text-xs mb-3">
                Use the following coordinates for navigation:
              </p>
              <div className="flex items-center justify-between p-2 bg-gray-900/30 rounded border border-gray-800/30">
                <div className="text-gray-300 text-xs font-mono">{contactInfo.coordinates}</div>
                <button
                  onClick={() => navigator.clipboard.writeText(contactInfo.coordinates)}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}