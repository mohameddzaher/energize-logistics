'use client'

import { motion } from 'framer-motion'
import React from 'react'

const ContactCTA: React.FC = () => {
  return (
    <section className="relative bg-gradient-to-b from-gray-800 to-black text-white py-20 px-6 text-center overflow-hidden">
      {/* Blurred Background Effects */}
      <motion.div
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ repeat: Infinity, duration: 10, ease: 'easeInOut' }}
        className="absolute top-[-100px] left-[20%] w-[300px] h-[300px] bg-[#f37121]/30 rounded-full blur-[120px] opacity-60"
      />
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 12, ease: 'easeInOut', delay: 2 }}
        className="absolute bottom-[-120px] right-[10%] w-[250px] h-[250px] bg-gray-600/30 rounded-full blur-[100px] opacity-50"
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        viewport={{ once: true }}
        className="relative z-10 max-w-3xl mx-auto"
      >
        <h2 className="text-3xl font-bold mb-4">
          Ready to <span className="text-[#f37121]">Power Your Logistics</span>?
        </h2>
        <p className="text-gray-400 mb-8 text-sm md:text-base">
          Get in touch with our team today to explore how Energize can simplify
          your supply chain and accelerate your business.
        </p>

       <a
  href="/contact"
  className="inline-block px-6 py-2 border border-gray-500/40 text-gray-200 font-medium rounded-lg
             hover:border-[#f37121] hover:text-[#f37121] transition-all duration-300 text-sm"
>
  Contact Us Now
</a>
      </motion.div>
    </section>
  )
}

export default ContactCTA