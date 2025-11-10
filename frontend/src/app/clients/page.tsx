// 'use client'

// import { motion } from 'framer-motion'

// export default function ClientsPage() {
//   const logos = Array.from({ length: 200 }, (_, i) => `/images/clients/${i + 1}.jpeg`)

//   return (
//     <main className="min-h-screen bg-gray-900 text-white py-14 px-6 sm:px-10 relative overflow-hidden">
//       {/* 🟠 خلفيات زخرفية */}
//       <motion.div
//         animate={{ scale: [1, 1.1, 1] }}
//         transition={{ repeat: Infinity, duration: 9, ease: 'easeInOut' }}
//         className="absolute top-[-100px] right-[-100px] w-[400px] h-[400px] bg-[#f37121]/20 rounded-full blur-[100px] opacity-60 z-0"
//       />
//       <motion.div
//         animate={{ scale: [1, 1.15, 1] }}
//         transition={{ repeat: Infinity, duration: 11, ease: 'easeInOut', delay: 1 }}
//         className="absolute bottom-[-120px] left-[-120px] w-[400px] h-[400px] bg-gray-700/25 rounded-full blur-[100px] opacity-50 z-0"
//       />

//       <div className="relative z-10 max-w-7xl mx-auto text-center">
//         {/* العنوان */}
//         <h1 className="text-3xl font-bold mb-8">
//           Our <span className="text-[#f37121]">Valued Clients</span>
//         </h1>

//         <p className="max-w-3xl mx-auto text-gray-300 mb-16">
//           We’re proud to work with a wide range of trusted clients across industries.
//         </p>

//         {/* 🎞️ الكاروسيل المتحرك */}
//         <div className="relative w-full overflow-hidden mb-20">
//           <motion.div
//             animate={{ x: [0, -4000] }}
//             transition={{ repeat: Infinity, duration: 24, ease: 'linear' }}
//             className="flex gap-8"
//           >
//             {[...Array(2)].map((_, loopIndex) => (
//               <div key={loopIndex} className="flex gap-8">
//                 {logos.map((logo, index) => (
//                   <div
//                     key={`${loopIndex}-${index}`}
//                     className="flex items-center justify-center bg-white/5 backdrop-blur-sm 
//                                p-6 rounded-2xl shadow-md border border-gray-700/40 
//                                hover:border-[#f37121]/50 transition-all duration-300 
//                                min-w-[220px] h-[130px]"
//                   >
//                     <img
//                       src={logo}
//                       alt={`Client ${index + 1}`}
//                       loading="eager"
//                       className="max-w-full max-h-full object-contain drop-shadow-lg"
//                       onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
//                     />
//                   </div>
//                 ))}
//               </div>
//             ))}
//           </motion.div>
//         </div>

//         {/* 🖼️ شبكة الصور الثابتة */}
//         <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
//           {logos.map((logo, index) => (
//             <div
//               key={index}
//               className="flex items-center justify-center bg-white/5 backdrop-blur-sm 
//                          p-5 rounded-xl border border-gray-700/40 
//                          hover:border-[#f37121]/50 transition-all duration-300"
//             >
//               <img
//                 src={logo}
//                 alt={`Client ${index + 1}`}
//                 loading="eager"
//                 className="max-w-full max-h-[80px] object-contain drop-shadow-md"
//                 onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
//               />
//             </div>
//           ))}
//         </div>
//       </div>
//     </main>
//   )
// }

'use client'

export default function ClientsPage() {
  // قلل عدد الصور لتحسين الأداء
  const logos = Array.from({ length: 100 }, (_, i) => `/images/clients/${i + 1}.jpeg`)

  return (
    <main className="min-h-screen bg-gray-900 text-white py-14 px-4 sm:px-6 relative overflow-hidden">
      {/* 🟠 خلفيات زخرفية ثابتة */}
      <div className="absolute top-[-100px] right-[-100px] w-[300px] h-[300px] bg-[#f37121]/20 rounded-full blur-[80px] opacity-60 z-0" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[300px] h-[300px] bg-gray-700/25 rounded-full blur-[80px] opacity-50 z-0" />

      <div className="relative z-10 max-w-7xl mx-auto text-center">
        {/* العنوان */}
        <h1 className="text-3xl font-bold mb-6">
          Our <span className="text-[#f37121]">Valued Clients</span>
        </h1>

        <p className="max-w-3xl mx-auto text-gray-300 mb-12 text-sm sm:text-base">
          We are proud to work with a wide range of trusted clients across industries.
        </p>

        {/* 🎞️ الكاروسيل المتحرك (محسّن للأداء) */}
        <div className="relative w-full overflow-hidden mb-16">
          <div className="flex gap-6 clients-carousel">
            {/* 3 نسخ بدلاً من 2 لتقليل التكرار */}
            {[...Array(3)].map((_, loopIndex) => (
              <div key={loopIndex} className="flex gap-6">
                {logos.map((logo, index) => (
                  <div
                    key={`${loopIndex}-${index}`}
                    className="flex items-center justify-center bg-white/5 p-4 rounded-xl border border-gray-700/40 hover:border-[#f37121]/50 transition-all duration-300 min-w-[140px] sm:min-w-[160px] h-[80px] sm:h-[100px] flex-shrink-0"
                  >
                    <img
                      src={logo}
                      alt={`Client ${index + 1}`}
                      loading="lazy"
                      className="max-w-full max-h-[50px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 🖼️ شبكة الصور الثابتة */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {logos.map((logo, index) => (
            <div
              key={index}
              className="flex items-center justify-center bg-white/5 p-3 rounded-lg border border-gray-700/40 hover:border-[#f37121]/50 transition-all duration-300 h-[70px] sm:h-[90px]"
            >
              <img
                src={logo}
                alt={`Client ${index + 1}`}
                loading="lazy"
                className="max-w-full max-h-[40px] sm:max-h-[60px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(calc(-100% / 3));
          }
        }
        
        .clients-carousel {
          animation: scroll 40s linear infinite;
          width: max-content;
          will-change: transform;
        }
        
        /* تحسينات للأجهزة المحمولة */
        @media (max-width: 768px) {
          .clients-carousel {
            animation: scroll 60s linear infinite;
          }
        }
        
        /* إيقاف التحريك عند التمرير */
        .clients-carousel:hover {
          animation-play-state: paused;
        }
      `}</style>
    </main>
  )
}