'use client'

import { motion } from 'framer-motion'
import {
  FaTruck,
  FaTasks,
  FaHeadset,
  FaLaptopCode,
  FaCogs,
  FaLifeRing
} from 'react-icons/fa'

export default function Services() {
  const services = [
    {
      id: 1,
      icon: <FaTruck className="text-[#f37121] text-3xl" />,
      title: 'Heavy Truck Transportation',
      description:
        'Reliable and efficient heavy truck transportation services across Saudi Arabia and the region. Our modern fleet ensures safe, on-time, and cost-effective delivery for all cargo types.',
    },
    {
      id: 2,
      icon: <FaTasks className="text-[#f37121] text-3xl" />,
      title: 'Full Customs Clearance Procedures',
      description:
        'Comprehensive customs clearance services handled by experienced professionals, ensuring smooth and fast import and export operations with zero delays.',
    },
    {
      id: 3,
      icon: <FaHeadset className="text-[#f37121] text-3xl" />,
      title: '24/7 Customer Service and Support',
      description:
        'Dedicated support team available around the clock to assist our clients, providing real-time updates and solutions to ensure seamless logistics operations.',
    },
    {
      id: 4,
      icon: <FaLifeRing className="text-[#f37121] text-3xl" />,
      title: 'Tire Management System',
      description:
        'Advanced TPMS to monitor, track, and optimize tire performance, pressure, and maintenance schedules - ensuring maximum safety, efficiency, and reduced operational costs.',
    },
    {
      id: 5,
      icon: <FaCogs className="text-[#f37121] text-3xl" />,
      title: 'Fleet Management',
      description:
        'Smart fleet management systems designed to optimize vehicle usage, maintenance, and routing—improving efficiency and reducing operational costs.',
    },
    {
      id: 6,
      icon: <FaLaptopCode className="text-[#f37121] text-3xl" />,
      title: 'B2B Tech Solutions',
      description:
        'Innovative business-to-business technology platforms that streamline logistics processes, improve tracking, and enhance communication with partners and clients.',
    },
  ]

  return (
    <section id="services" className="relative py-16 bg-gray-800 overflow-hidden">
      {/* ✨ لمسة الخلفية البرتقالية الناعمة */}
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

      <div className="relative z-10 w-full text-center px-6 sm:px-8 md:px-10">
        <h2 className="text-2xl font-bold mb-10 text-white">
          Our Services
        </h2>

        <div className="flex flex-col gap-10 items-center">
          {/* الصف الأول */}
          <div className="flex flex-wrap justify-center gap-8">
            {services.slice(0, 3).map((s, idx) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ delay: idx * 0.12 }}
                className="w-full sm:w-[330px] md:w-[350px] py-5 px-3 rounded-lg bg-gray-900 flex flex-col items-center text-center shadow-sm"
              >
                <div className="mb-3">{s.icon}</div>
                <h3 className="font-bold text-base mb-3 text-2xl text-white">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-400 leading-snug">
                  {s.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* الصف الثاني */}
          <div className="flex flex-wrap justify-center gap-8">
            {services.slice(3).map((s, idx) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ delay: idx * 0.12 }}
                className="w-full sm:w-[330px] md:w-[350px] py-5 px-3 rounded-lg bg-gray-900 flex flex-col items-center text-center shadow-sm"
              >
                <div className="mb-3">{s.icon}</div>
                <h3 className="font-bold text-base mb-3 text-white">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-300 leading-snug">
                  {s.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}