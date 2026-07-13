
'use client'

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
      title: 'Customs Clearance & Brokerage',
      description:
        'Efficient customs clearance & brokerage services, ensuring smooth import and export processes with expert handling.',
    },
    {
      id: 3,
      icon: <FaHeadset className="text-[#f37121] text-3xl" />,
      title: '3PL Last-Mile Logistics',
      description:
        'Reliable 3PL last-mile logistics with real-time updates and dedicated support for seamless deliveries.',
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
      title: 'Vehicle Transportation',
      description:
        'Optimized vehicle transportation services, maximizing fleet efficiency and reducing operational costs.',
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
      <div className="absolute top-[-100px] end-[-120px] w-[350px] h-[350px] bg-[#f37121]/20 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-120px] start-[-120px] w-[300px] h-[300px] bg-[#f37121]/15 blur-[110px] rounded-full" />

      <div className="relative z-10 w-full text-center px-6 sm:px-8 md:px-10">
        <h2 className="text-2xl font-bold mb-10 text-white">
          Our Services
        </h2>

        <div className="flex flex-col gap-10 items-center">
          {/* الصف الأول */}
          <div className="flex flex-wrap justify-center gap-8">
            {services.slice(0, 3).map((s, idx) => (
              <div
                key={s.id}
                className="w-full sm:w-[330px] md:w-[350px] py-5 px-3 rounded-lg bg-gray-900 flex flex-col items-center text-center shadow-sm"
              >
                <div className="mb-3">{s.icon}</div>
                <h3 className="font-bold text-base mb-3 text-2xl text-white">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-400 leading-snug">
                  {s.description}
                </p>
              </div>
            ))}
          </div>

          {/* الصف الثاني */}
          <div className="flex flex-wrap justify-center gap-8">
            {services.slice(3).map((s, idx) => (
              <div
                key={s.id}
                className="w-full sm:w-[330px] md:w-[350px] py-5 px-3 rounded-lg bg-gray-900 flex flex-col items-center text-center shadow-sm"
              >
                <div className="mb-3">{s.icon}</div>
                <h3 className="font-bold text-base mb-3 text-white">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-300 leading-snug">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}