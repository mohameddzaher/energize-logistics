'use client'

import { motion } from 'framer-motion'
import React from 'react'

const NewsSection: React.FC = () => {
  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
  } as const

  const newsData = [
    {
      question: 'How is Saudi Arabia advancing its logistics sector under Vision 2030?',
      answer:
        'The Kingdom is investing heavily in smart infrastructure, digital transformation, and integrated transport networks. Vision 2030 aims to position Saudi Arabia as a global logistics hub connecting Asia, Africa, and Europe.',
    },
    {
      question: 'What are the key challenges logistics companies face in Saudi Arabia?',
      answer:
        'Challenges include optimizing last-mile delivery in expanding cities, maintaining temperature-sensitive shipments in extreme weather, and integrating digital tracking systems across large networks.',
    },
    {
      question: 'How is technology transforming logistics operations in Saudi Arabia?',
      answer:
        'AI, IoT, and real-time tracking are enabling smarter route planning, predictive maintenance, and improved fleet efficiency - leading to faster, more transparent deliveries and lower costs.',
    },
    {
      question: 'What role does sustainability play in logistics in Saudi Arabia?',
      answer:
        'Sustainability is a growing priority. Many logistics providers are introducing fuel-efficient vehicles, optimizing routes to reduce emissions, and investing in renewable energy for warehouses and transport hubs.',
    },
    {
      question: 'How do logistics solutions support Saudi e-commerce growth?',
      answer:
        'With booming online shopping demand, logistics companies are offering advanced fulfillment centers, same-day delivery in major cities, and integrated inventory systems to help e-commerce businesses scale efficiently.',
    },
    {
      question: 'Why should global businesses consider Saudi Arabia for regional distribution?',
      answer:
        'Strategically located and backed by massive infrastructure projects like NEOM and the Landbridge, Saudi Arabia offers unmatched access to global markets with efficient customs and world-class transport links.',
    },
  ]

  return (
    <section className="relative bg-gray-900 text-white py-24 px-6 overflow-hidden">
      {/* ✨ اللمسة البرتقالية الخلفية */}
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 10, ease: 'easeInOut' }}
        className="absolute top-[-100px] right-[-120px] w-[350px] h-[350px] bg-[#f37121]/20 blur-[120px] rounded-full"
      />
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 12, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-[-120px] left-[-120px] w-[300px] h-[300px] bg-[#f37121]/15 blur-[110px] rounded-full"
      />

      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        className="relative z-10 max-w-4xl mx-auto text-center"
      >
        <h2 className="text-3xl md:text-3xl font-bold text-[#f37121] mb-4">
          Logistics Insights in Saudi Arabia
        </h2>
        <p className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto">
          Explore how Saudi Arabia is redefining logistics through technology, innovation,
          and sustainability - driving growth under Vision 2030.
        </p>
      </motion.div>

      <div className="relative z-10 max-w-3xl mx-auto mt-12 space-y-8">
        {newsData.map((item, index) => (
          <motion.div
            key={index}
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="bg-gradient-to-b from-gray-800 to-gray-850 border border-gray-700/40 rounded-2xl p-5 shadow-md hover:shadow-lg hover:border-[#f37121]/40 transition-all duration-300"
          >
            <h3 className="text-base md:text-lg font-semibold text-[#f37121] mb-2">
              {item.question}
            </h3>
            <p className="text-gray-300 text-xs md:text-sm leading-relaxed">{item.answer}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

export default NewsSection