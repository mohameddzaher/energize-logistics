'use client'

import { motion } from 'framer-motion'

export default function ClientsPage() {
  const logos = Array.from({ length: 200 }, (_, i) => `/images/clients/${i + 1}.jpeg`)

  return (
    <main className="min-h-screen bg-gray-900 text-white py-14 px-6 sm:px-10 relative overflow-hidden">
      {/* 🟠 خلفيات زخرفية */}
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 9, ease: 'easeInOut' }}
        className="absolute top-[-100px] right-[-100px] w-[400px] h-[400px] bg-[#f37121]/20 rounded-full blur-[100px] opacity-60 z-0"
      />
      <motion.div
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ repeat: Infinity, duration: 11, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-[-120px] left-[-120px] w-[400px] h-[400px] bg-gray-700/25 rounded-full blur-[100px] opacity-50 z-0"
      />

      <div className="relative z-10 max-w-7xl mx-auto text-center">
        {/* العنوان */}
        <h1 className="text-3xl font-bold mb-8">
          Our <span className="text-[#f37121]">Valued Clients</span>
        </h1>

        <p className="max-w-3xl mx-auto text-gray-300 mb-16">
          We’re proud to work with a wide range of trusted clients across industries.
        </p>

        {/* 🎞️ الكاروسيل المتحرك */}
        <div className="relative w-full overflow-hidden mb-20">
          <motion.div
            animate={{ x: [0, -4000] }}
            transition={{ repeat: Infinity, duration: 24, ease: 'linear' }}
            className="flex gap-8"
          >
            {[...Array(2)].map((_, loopIndex) => (
              <div key={loopIndex} className="flex gap-8">
                {logos.map((logo, index) => (
                  <div
                    key={`${loopIndex}-${index}`}
                    className="flex items-center justify-center bg-white/5 backdrop-blur-sm 
                               p-6 rounded-2xl shadow-md border border-gray-700/40 
                               hover:border-[#f37121]/50 transition-all duration-300 
                               min-w-[220px] h-[130px]"
                  >
                    <img
                      src={logo}
                      alt={`Client ${index + 1}`}
                      loading="eager"
                      className="max-w-full max-h-full object-contain drop-shadow-lg"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </div>

        {/* 🖼️ شبكة الصور الثابتة */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
          {logos.map((logo, index) => (
            <div
              key={index}
              className="flex items-center justify-center bg-white/5 backdrop-blur-sm 
                         p-5 rounded-xl border border-gray-700/40 
                         hover:border-[#f37121]/50 transition-all duration-300"
            >
              <img
                src={logo}
                alt={`Client ${index + 1}`}
                loading="eager"
                className="max-w-full max-h-[80px] object-contain drop-shadow-md"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}