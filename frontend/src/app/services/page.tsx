// 'use client'

// import { motion } from 'framer-motion'
// import {
//   FaTruck,
//   FaTasks,
//   FaHeadset,
//   FaLaptopCode,
//   FaCogs,
//   FaLifeRing,
// } from 'react-icons/fa'

// export default function ServicesPage() {
//   const services = [
//     {
//       id: 1,
//       anchor: 'heavy-truck',
//       icon: <FaTruck className="text-[#f37121] text-4xl" />,
//       title: 'Heavy Truck Transportation',
//       details: `
//         ENERGIZE provides reliable and efficient heavy truck transportation services across Saudi Arabia and the region.
//         Our modern fleet ensures safe, on-time, and cost-effective delivery for all cargo types.
//       `,
//     },
//     {
//       id: 2,
//       anchor: 'customs-clearance',
//       icon: <FaTasks className="text-[#f37121] text-4xl" />,
//       title: 'Full Customs Clearance Procedures',
//       details: `
//         We handle all customs clearance operations with precision and speed.
//         Our experienced team ensures compliance with Saudi regulations, minimizing delays and optimizing workflow.
//       `,
//     },
//     {
//       id: 3,
//       anchor: 'support',
//       icon: <FaHeadset className="text-[#f37121] text-4xl" />,
//       title: '24/7 Customer Service and Support',
//       details: `
//         Our dedicated support team is available around the clock to provide real-time updates and
//         assist clients in ensuring smooth and efficient logistics operations, anytime, anywhere.
//       `,
//     },
//     {
//       id: 4,
//       anchor: 'tire-management',
//       icon: <FaLifeRing className="text-[#f37121] text-4xl" />,
//       title: 'Tire Management System',
//       details: `
//         Advanced TPMS (Tire Pressure Monitoring System) designed to monitor and optimize tire performance,
//         pressure, and maintenance schedules - ensuring maximum safety, efficiency, and reduced operational costs.
//       `,
//     },
//     {
//       id: 5,
//       anchor: 'fleet-management',
//       icon: <FaCogs className="text-[#f37121] text-4xl" />,
//       title: 'Fleet Management',
//       details: `
//         Our intelligent fleet management platform enhances vehicle utilization, maintenance planning, and routing efficiency.
//         It helps reduce downtime, optimize costs, and improve logistics productivity.
//       `,
//     },
//     {
//       id: 6,
//       anchor: 'b2b-solutions',
//       icon: <FaLaptopCode className="text-[#f37121] text-4xl" />,
//       title: 'B2B Tech Solutions',
//       details: `
//         Innovative B2B logistics technology solutions that simplify operations,
//         enhance tracking accuracy, and strengthen communication between clients and partners.
//       `,
//     },
//   ]

//   const scrollToTop = () => {
//     window.scrollTo({ top: 0, behavior: 'smooth' })
//   }

//   return (
//     <main className="pt-8 min-h-screen bg-gray-900 text-white py-6 px-6 sm:px-10 relative overflow-hidden scroll-smooth">
//       {/* خلفية متحركة */}
//       <motion.div
//         animate={{ scale: [1, 1.1, 1] }}
//         transition={{ repeat: Infinity, duration: 9, ease: 'easeInOut' }}
//         className="absolute top-[-100px] right-[-100px] w-[300px] h-[300px] bg-[#f37121]/20 rounded-full blur-[100px] opacity-60 z-0"
//       />

//       <div className="relative z-10 max-w-6xl mx-auto text-center">
//         {/* العنوان */}
//         <h1
//           id="services-top"
//           className="text-3xl font-bold mb-10 pt-6 scroll-mt-20"
//         >
//           Our <span className="text-[#f37121]">Services</span>
//         </h1>

//         {/* ✅ كروت الخدمات (Responsive) */}
//         <div className="flex flex-wrap justify-center gap-8 mt-7">
//           {services.map((s) => (
//             <div
//               key={s.id}
//               onClick={() =>
//                 document
//                   .getElementById(s.anchor)
//                   ?.scrollIntoView({ behavior: 'smooth' })
//               }
//               className="relative w-full sm:w-[45%] md:w-[30%] lg:w-[340px] p-6 rounded-2xl cursor-pointer 
//                          bg-gradient-to-b from-gray-800 to-[#1f1f1f] flex flex-col items-center text-center 
//                          shadow-md hover:shadow-[#f37121]/30 hover:scale-[1.04]
//                          border border-gray-700/40 hover:border-[#f37121]/40
//                          transition-all duration-300 overflow-hidden"
//             >
//               <div className="mb-4">{s.icon}</div>
//               <h3 className="font-bold text-md text-white">{s.title}</h3>
//             </div>
//           ))}
//         </div>

//         {/* تفاصيل الخدمات */}
//         <div className="mt-20 mb-16 space-y-20 text-left sm:text-center">
//           {services.map((s) => (
//             <section
//               id={s.anchor}
//               key={s.id}
//               className="max-w-4xl mx-auto border-t border-gray-700/40 pt-10 scroll-mt-20"
//             >
//               <h2 className="text-2xl font-semibold text-[#f37121] mb-4">
//                 {s.title}
//               </h2>
//               <p className="text-gray-300 leading-relaxed text-sm sm:text-base whitespace-pre-line">
//                 {s.details}
//               </p>
//             </section>
//           ))}
//         </div>

//         {/* 🔝 زر العودة للأعلى (اختياري) */}
//         {/* 
//         <button
//           onClick={scrollToTop}
//           className="fixed bottom-8 right-8 bg-[#f37121] text-black font-semibold px-4 py-2 rounded-full shadow-md hover:bg-[#ff8f47] transition-all duration-300"
//         >
//           ↑ Top
//         </button> 
//         */}
//       </div>
//     </main>
//   )
// }

'use client'

import {
  FaTruck,
  FaTasks,
  FaHeadset,
  FaLaptopCode,
  FaCogs,
  FaLifeRing,
} from 'react-icons/fa'

export default function ServicesPage() {
  const services = [
    {
      id: 1,
      anchor: 'heavy-truck',
      icon: <FaTruck className="text-[#f37121] text-4xl" />,
      title: 'Heavy Truck Transportation',
      details: `
        ENERGIZE provides reliable and efficient heavy truck transportation services across Saudi Arabia and the region.
        Our modern fleet ensures safe, on-time, and cost-effective delivery for all cargo types.
      `,
    },
    {
      id: 2,
      anchor: 'customs-clearance',
      icon: <FaTasks className="text-[#f37121] text-4xl" />,
      title: 'Full Customs Clearance Procedures',
      details: `
        We handle all customs clearance operations with precision and speed.
        Our experienced team ensures compliance with Saudi regulations, minimizing delays and optimizing workflow.
      `,
    },
    {
      id: 3,
      anchor: 'support',
      icon: <FaHeadset className="text-[#f37121] text-4xl" />,
      title: '24/7 Customer Service and Support',
      details: `
        Our dedicated support team is available around the clock to provide real-time updates and
        assist clients in ensuring smooth and efficient logistics operations, anytime, anywhere.
      `,
    },
    {
      id: 4,
      anchor: 'tire-management',
      icon: <FaLifeRing className="text-[#f37121] text-4xl" />,
      title: 'Tire Management System',
      details: `
        Advanced TPMS (Tire Pressure Monitoring System) designed to monitor and optimize tire performance,
        pressure, and maintenance schedules - ensuring maximum safety, efficiency, and reduced operational costs.
      `,
    },
    {
      id: 5,
      anchor: 'fleet-management',
      icon: <FaCogs className="text-[#f37121] text-4xl" />,
      title: 'Fleet Management',
      details: `
        Our intelligent fleet management platform enhances vehicle utilization, maintenance planning, and routing efficiency.
        It helps reduce downtime, optimize costs, and improve logistics productivity.
      `,
    },
    {
      id: 6,
      anchor: 'b2b-solutions',
      icon: <FaLaptopCode className="text-[#f37121] text-4xl" />,
      title: 'B2B Tech Solutions',
      details: `
        Innovative B2B logistics technology solutions that simplify operations,
        enhance tracking accuracy, and strengthen communication between clients and partners.
      `,
    },
  ]

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="pt-8 min-h-screen bg-gray-900 text-white py-6 px-6 sm:px-10 relative overflow-hidden scroll-smooth">
      {/* خلفية ثابتة */}
      <div className="absolute top-[-100px] right-[-100px] w-[300px] h-[300px] bg-[#f37121]/20 rounded-full blur-[100px] opacity-60 z-0" />

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        {/* العنوان */}
        <h1
          id="services-top"
          className="text-3xl font-bold mb-10 pt-6 scroll-mt-20"
        >
          Our <span className="text-[#f37121]">Services</span>
        </h1>

        {/* ✅ كروت الخدمات (Responsive) */}
        <div className="flex flex-wrap justify-center gap-8 mt-7">
          {services.map((s) => (
            <div
              key={s.id}
              onClick={() =>
                document
                  .getElementById(s.anchor)
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
              className="relative w-full sm:w-[45%] md:w-[30%] lg:w-[340px] p-6 rounded-2xl cursor-pointer 
                         bg-gradient-to-b from-gray-800 to-[#1f1f1f] flex flex-col items-center text-center 
                         shadow-md hover:shadow-[#f37121]/30 hover:scale-[1.04]
                         border border-gray-700/40 hover:border-[#f37121]/40
                         transition-all duration-300 overflow-hidden"
            >
              <div className="mb-4">{s.icon}</div>
              <h3 className="font-bold text-md text-white">{s.title}</h3>
            </div>
          ))}
        </div>

        {/* تفاصيل الخدمات */}
        <div className="mt-20 mb-16 space-y-20 text-left sm:text-center">
          {services.map((s) => (
            <section
              id={s.anchor}
              key={s.id}
              className="max-w-4xl mx-auto border-t border-gray-700/40 pt-10 scroll-mt-20"
            >
              <h2 className="text-2xl font-semibold text-[#f37121] mb-4">
                {s.title}
              </h2>
              <p className="text-gray-300 leading-relaxed text-sm sm:text-base whitespace-pre-line">
                {s.details}
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}