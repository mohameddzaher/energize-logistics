"use client";

import { motion } from "framer-motion";
import React from "react";

const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: "easeOut" },
  },
};

const GoogleMapSection: React.FC = () => {
  return (
    <motion.section
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 flex justify-center items-center"
    >
      {/* اللمسة البرتقالية الناعمة */}
      <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
      <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

      <div className="relative z-10 w-[92%] sm:w-[85%] md:w-[70%] lg:w-[55%] rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.4)] border border-gray-700/50">
        {/* العنوان */}
        <div className="bg-gray-950/70 text-center py-3 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">
            Visit Our <span className="text-[#f37121]">Main Office</span>
          </h2>
          <p className="text-gray-400 mt-1 text-sm">Jeddah, Saudi Arabia</p>
        </div>

        {/* الخريطة */}
        <div className="relative w-full h-[350px]">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3710.23113884275!2d39.16732!3d21.576898999999994!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjHCsDM0JzM2LjgiTiAzOcKwMTAnMDIuNCJF!5e0!3m2!1sen!2ssa!4v1760014775791!5m2!1sen!2ssa"
            className="absolute top-0 left-0 w-full h-full border-0"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </motion.section>
  );
};

export default GoogleMapSection;