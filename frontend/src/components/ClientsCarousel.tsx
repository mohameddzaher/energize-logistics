'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'

export default function ClientsCarousel() {
  // ✅ تأكد إن الأسماء دي بتطابق فعلاً الصور اللي عندك
  const logos = [
    '/images/clients/unnamed.jpg',
    '/images/clients/client2.jpg',
    '/images/clients/client3.webp',
    '/images/clients/client4.png',
    '/images/clients/client5.jpg',
    '/images/clients/client6.webp',
    '/images/clients/client7.png',
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="mt-24 text-center overflow-hidden"
    >
      <h3 className="text-3xl font-bold text-[#f37121] mb-10">
        Trusted by Our <span className="text-white">Clients</span>
      </h3>

      <div className="relative w-full overflow-hidden">
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ repeat: Infinity, duration: 25, ease: 'linear' }}
          className="flex gap-12"
        >
          {logos.flatMap((logo) => [logo, logo]).map((logo, index) => (
            <div
              key={index}
              className="flex items-center justify-center bg-gray-800 p-4 rounded-xl shadow-sm w-40 h-20"
            >
              <Image
                src={logo}
                alt={`Client ${index + 1}`}
                width={120}
                height={60}
                className="object-contain grayscale hover:grayscale-0 transition duration-300"
              />
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  )
}