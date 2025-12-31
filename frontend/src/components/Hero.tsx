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
          src="/images/energize 1.png"
          alt="logistics"
          width={1920}
          height={1080}
          className="w-full h-full object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/60 md:bg-gradient-to-r md:from-black/60 md:via-black/60 md:to-transparent"></div>
      </div>

      {/* المحتوى */}
      <div className="relative z-10 flex flex-col justify-start pt-32 items-left h-full px-6 md:px-24 text-white">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-2xl md:text-3xl font-extrabold md:text-left text-center"
        >
          Energi<span className="text-[#f37121]">Z</span>e Logistics
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9 }}
          className="text-sm md:text-sm font-bold mb-8 mt-8 md:text-left text-center max-w-xl mx-auto md:mx-0"
        >
          Reliable logistics, smarter supply chains and <br />seamless international
          shipping solutions. <br /> <span className="text-[#f37121]">We help you move goods faster and safer.</span>
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="flex flex-col sm:flex-row gap-4 items-center justify-center md:justify-start"
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
          className="text-xs text-gray-300 mt-6 md:text-left text-center max-w-md mx-auto md:mx-0"
        >
          Need to schedule a meeting? Book our conference room instantly with our online booking system
        </motion.p>

        {/* Stats Card - Mobile only - تم إخفاؤه */}
        {/* <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-8 mx-auto md:hidden"
        >
          <div className="text-center inline-block bg-black/30 backdrop-blur-sm px-5 py-3 rounded-lg border border-white/10">
            <p className="text-sm text-gray-300 font-bold">1M+</p>
            <p className="text-xs text-white pt-1">Successful Shipments</p>
          </div>
        </motion.div> */}
      </div>

      {/* Stats Card - Desktop only */}
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, delay: 0.6 }}
        className="hidden md:block absolute right-12 md:right-24 md:bottom-80"
      >
        <div className="text-right">
          <div className="text-center inline-block bg-black/30 backdrop-blur-sm px-5 py-3 rounded-lg border border-white/10">
            <p className="text-sm text-[#f37121] font-bold">+1M</p>
            <p className="text-xs text-white pt-1">Successful Trips</p>
          </div>
        </div>
      </motion.div>

      {/* تأثير إضافي */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="absolute bottom-24 left-1/2 transform -translate-x-1/2"
      >
        <div className="flex flex-col items-center">
          <span className="text-sm text-gray-400 mb-2">Scroll to explore</span>
          <div className="w-5 h-8 border-2 border-gray-500 rounded-full flex justify-center">
            <motion.div
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1 h-2 bg-gray-400 rounded-full mt-1"
            />
          </div>
        </div>
      </motion.div>
    </section>
  );
}