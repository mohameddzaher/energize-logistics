"use client";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ArrowRight } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative w-full h-screen">
      <div className="absolute inset-0">
        <Image
          src="/images/tt.jpg"
          alt="logistics"
          width={1920}
          height={1080}
          className="w-full h-full object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/70"></div>
      </div>

      {/* المحتوى */}
      <div className="relative z-10 flex flex-col justify-center items-center h-full px-6 md:px-24 text-white">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-2xl md:text-3xl font-extrabold"
        >
          Energi<span className="text-[#f37121]">Z</span>e Logistics
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9 }}
          className="text-sm md:text-sm font-bold mb-8 mt-8 text-center max-w-xl"
        >
          Reliable logistics, smarter supply chains and seamless international
          shipping solutions. We help you move goods faster and safer.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="flex flex-col sm:flex-row gap-4 items-center"
        >
          {/* زر حجز الميتنج روم */}
          <Link 
            href="/display"
            className="group flex items-center gap-3 px-6 py-3 rounded-lg  hover:from-[#e5651a] hover:border-white hover:bg-white/10 text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform  border border-orange-400/50"
          >
            <CalendarDays className="w-5 h-5" />
            <span>Book Meeting Room</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>

          {/* زر Contact Us */}
          <a
            href="/contact"
            className="group flex items-center gap-3 px-6 py-3 rounded-lg border border-gray-400 hover:border-white hover:bg-white/10 text-white font-semibold transition-all duration-300"
          >
            <span>Contact Us</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
          </a>
        </motion.div>

        {/* رسالة تشجيعية صغيرة */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.5 }}
          className="text-xs text-gray-300 mt-6 text-center max-w-md"
        >
          Need to schedule a meeting? Book our conference room instantly with our online booking system
        </motion.p>
      </div>

      {/* تأثير إضافي */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2"
      >
        <div className="flex flex-col items-center">
          <span className="text-sm text-gray-400 mb-2">Scroll to explore</span>
          <div className="w-6 h-10 border-2 border-gray-400 rounded-full flex justify-center">
            <motion.div
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1 h-3 bg-gray-400 rounded-full mt-2"
            />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
// ---------------------------------------

// 'use client'
// import { motion } from 'framer-motion'

// export default function Hero() {
//   return (
//     <section className="relative w-full h-screen">
//       {/* الخلفية */}
//       <div className="absolute inset-0">
//         <img
//           src="/images/1 reduced.jpg"
//           alt="logistics"
//           className="w-full h-full object-cover"
//         />
//         {/* overlay لتغميق الصورة قليلًا */}
//         <div className="absolute inset-0 bg-black/40"></div>
//       </div>

//       {/* المحتوى */}
//       <div className="relative z-10 flex flex-col justify-center items-start h-full px-6 md:px-24 text-white">
//         <motion.h1
//           initial={{ opacity: 0, y: 20 }}
//           animate={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.7 }}
//           className="text-4xl md:text-6xl font-extrabold mb-4"
//         >
//           Energize Logistics
//         </motion.h1>

//         <motion.p
//           initial={{ opacity: 0, y: 20 }}
//           animate={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.9 }}
//           className="text-lg md:text-xl mb-6 max-w-xl"
//         >
//           Reliable logistics, smarter supply chains and seamless international shipping solutions. We help you move goods faster and safer.
//         </motion.p>

//         <motion.div
//           initial={{ opacity: 0, y: 20 }}
//           animate={{ opacity: 1, y: 0 }}
//           transition={{ duration: 1 }}
//           className="flex gap-4"
//         >
//           <a href="#services" className="px-6 py-3 rounded-md bg-accent text-white font-semibold">
//             Our Services
//           </a>
//           <a href="#contact" className="px-6 py-3 rounded-md border border-white">
//             Contact Us
//           </a>
//         </motion.div>
//       </div>
//     </section>
//   )
// }
