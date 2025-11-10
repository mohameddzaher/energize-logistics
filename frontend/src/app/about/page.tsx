// "use client";

// import { motion, easeOut } from "framer-motion";
// import Image from "next/image";
// import { FaLinkedin, FaFacebook } from "react-icons/fa";

// const fadeInUp = {
//   hidden: { opacity: 0, y: 30 },
//   visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: easeOut } },
// };

// export default function AboutPage() {
//   return (
//     <section className="bg-gray-900 text-white overflow-hidden">
//       {/* --- COMPANY INTRO (بدون animation - يظهر فوراً) --- */}
//       <div className="max-w-6xl mx-auto px-6 py-20 text-center">
//         <div className="flex justify-center mb-8">
//           <Image
//             src="/images/Asset 3.png"
//             alt="Energize Logistics Logo"
//             width={160}
//             height={160}
//             priority
//           />
//         </div>

// {/* <div className="absolute top-[-80px] left-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" /> */}

//         <h1 className="text-3xl font-bold mb-6 text-[#f37121]">About Energize</h1>
//         <p className="text-gray-300 max-w-4xl mx-auto leading-relaxed text-lg">
//           Founded in <span className="text-[#f37121] font-semibold">2020</span>,{" "}
//           <strong> ENERGIZE </strong> has grown rapidly into one of the leading logistics
//           and transportation companies across the Middle East and Africa. We specialize
//           in providing smart, integrated, and technology-driven logistics solutions –
//           including heavy truck transportation, customs clearance, import/export
//           operations, and 24/7 customer support – ensuring efficient and cost-effective
//           supply chain management for our partners.
//         </p>
        
//       </div>
      

//       {/* --- VISION & MISSION --- */}
//       <motion.div
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="bg-gray-800 py-16 px-6 text-center"
//       >
//         <h2 className="text-3xl font-bold text-[#f37121] mb-10">Vision & Mission</h2>
//         <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
//           {[
//             {
//               title: "Our Vision",
//               text: "To redefine logistics excellence across the region by delivering sustainable, technology-backed, and customer-centered transport solutions.",
//             },
//             {
//               title: "Our Mission",
//               text: "To empower businesses with reliable logistics services, supported by innovation, professionalism, and a dedicated team committed to exceeding customer expectations.",
//             },
//           ].map((item) => (
//             <motion.div
//               key={item.title}
//               whileHover={{ scale: 1.03 }}
//               transition={{ duration: 0.3 }}
//               className="bg-gray-900 rounded-xl p-6 shadow-md border border-gray-700/40 hover:border-[#f37121]/50 transition-all"
//             >
//               <h3 className="text-2xl font-semibold text-[#f37121] mb-4">{item.title}</h3>
//               <p className="text-gray-300">{item.text}</p>
//             </motion.div>
//           ))}
//         </div>
//       </motion.div>

//       {/* --- ACHIEVEMENTS --- */}
//       <motion.section
//         initial={{ opacity: 0, y: 40 }}
//         whileInView={{ opacity: 1, y: 0 }}
//         transition={{ duration: 1 }}
//         viewport={{ once: true }}
//         className="relative bg-gradient-to-b from-gray-900 to-gray-800 py-20 overflow-hidden"
//       >
//         <motion.div
//           animate={{ scale: [1, 1.15, 1] }}
//           transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
//           className="absolute top-[-100px] right-[-100px] w-[320px] h-[320px] bg-[#f37121]/25 rounded-full blur-[120px] opacity-70 z-0"
//         />
//         <motion.div
//           animate={{ scale: [1, 1.1, 1] }}
//           transition={{ repeat: Infinity, duration: 10, ease: "easeInOut", delay: 1 }}
//           className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 rounded-full blur-[90px] opacity-60 z-0"
//         />

//         <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
//           <h2 className="text-2xl md:text-2xl font-bold text-[#f37121] mb-12">
//             Our Achievements
//           </h2>

//           <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-6">
//             {[
//               { label: "Successful Shipments", value: "1M+" },
//               { label: "Tons Delivered", value: "1M+" },
//               { label: "Clients Served", value: "100+" },
//               { label: "Cities Covered Across KSA", value: "50+" },
//               { label: "Employees & Drivers", value: "360+" },
//               { label: "Operational Branches", value: "7" },
//             ].map((stat, index) => (
//               <motion.div
//                 key={index}
//                 whileHover={{ scale: 1.05 }}
//                 transition={{ duration: 0.25 }}
//                 className="relative bg-gradient-to-br from-gray-800/60 to-gray-700/40
//                   p-3 rounded-2xl shadow-md border border-gray-700/40
//                   hover:border-[#f37121]/50 transition-all text-center"
//               >
//                 <div className="text-2xl font-bold text-[#f37121] mb-1">
//                   {stat.value}
//                 </div>
//                 <div className="text-xs sm:text-sm font-medium text-gray-300 tracking-wide">
//                   {stat.label}
//                 </div>
//                 <div className="w-8 h-[3px] bg-[#f37121] rounded-full mt-3 mx-auto"></div>
//               </motion.div>
//             ))}
//           </div>
//         </div>
//       </motion.section>

//       {/* --- EXPERTISE --- */}
//       <motion.div
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="bg-gray-900 py-16 text-center px-6"
//       >
//         <h2 className="text-3xl font-bold text-[#f37121] mb-8">Our Expertise</h2>
//         <p className="max-w-4xl mx-auto text-gray-300 text-lg leading-relaxed">
//           ENERGIZE provides complete logistics and transportation services across Saudi
//           Arabia and the region, covering{" "}
//           <span className="text-[#f37121] font-semibold">
//             heavy truck transport, fleet management, import/export operations
//           </span>
//           , and comprehensive customs clearance. With a dedicated team of 300+ professionals
//           and a rapidly expanding fleet, we serve businesses of all sizes with unmatched
//           efficiency.
//         </p>
//       </motion.div>

//       {/* --- CORE VALUES --- */}
//       <motion.div
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="bg-gray-800 py-16 text-center"
//       >
//         <h2 className="text-2xl font-bold text-[#f37121] mb-10">Core Values</h2>
//         <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
//           {[
//             { title: "Integrity", desc: "We act with honesty, transparency, and responsibility in everything we do." },
//             { title: "Partnership", desc: "We build lasting relationships with clients, suppliers, and employees based on trust and respect." },
//             { title: "Excellence", desc: "We pursue continuous improvement, innovation, and operational excellence." },
//           ].map((val) => (
//             <motion.div
//               key={val.title}
//               whileHover={{ scale: 1.04 }}
//               transition={{ duration: 0.3 }}
//               className="bg-gray-900 p-6 rounded-xl shadow-md border border-gray-700/40 hover:border-[#f37121]/50"
//             >
//               <h3 className="text-xl font-semibold text-[#f37121] mb-2">{val.title}</h3>
//               <p className="text-gray-300">{val.desc}</p>
//             </motion.div>
//           ))}
//         </div>
//       </motion.div>

//       {/* --- TOP MANAGEMENT --- */}
// <motion.div
//   variants={fadeInUp}
//   initial="hidden"
//   whileInView="visible"
//   viewport={{ once: true }}
//   className="bg-gray-900 py-14 px-4 text-center"
// >
//   <h2 className="text-2xl font-semibold text-[#f37121] mb-8">
//     Founder & Executive Team
//   </h2>

//   <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 justify-center max-w-5xl mx-auto">
//     {/* Dulaim (يظهر أول واحد في الموبايل فقط) */}
//     <motion.div
//       whileHover={{ scale: 1.04 }}
//       className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-1 sm:order-2 md:order-2"
//     >
//       <Image
//         src="/images/dulaim.jpeg"
//         alt="Dulaim Al Nasher"
//         width={150}
//         height={150}
//         className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
//         loading="lazy"
//       />
//       <h3 className="text-lg font-semibold text-white mb-1">
//         Dulaim Al Nasher
//       </h3>
//       <p className="text-gray-400 text-xs mb-2">Founder and Chairman</p>
//       <div className="flex justify-center gap-3">
//         <a
//           href="https://www.linkedin.com/in/dulaim-al-nasher-492507166/"
//           target="_blank"
//           rel="noopener noreferrer"
//           className="text-[#f37121] hover:text-white transition"
//         >
//           <FaLinkedin size={18} />
//         </a>
//       </div>
//     </motion.div>

//     {/* Sameh */}
//     <motion.div
//       whileHover={{ scale: 1.04 }}
//       className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-2 sm:order-1 md:order-1"
//     >
//       <Image
//         src="/images/mrsam2.jpg"
//         alt="Sameh Hassan"
//         width={150}
//         height={150}
//         className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
//         loading="lazy"
//       />
//       <h3 className="text-lg font-semibold text-white mb-1">Sameh Hassan</h3>
//       <p className="text-gray-400 text-xs mb-2">COO</p>
//       <div className="flex justify-center gap-3">
//         <a
//           href="https://www.linkedin.com/in/sameh-hassan-en/"
//           target="_blank"
//           rel="noopener noreferrer"
//           className="text-[#f37121] hover:text-white transition"
//         >
//           <FaLinkedin size={18} />
//         </a>
//       </div>
//     </motion.div>

//     {/* Nader */}
//     <motion.div
//       whileHover={{ scale: 1.04 }}
//       className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-3 sm:order-3 md:order-3"
//     >
//       <Image
//         src="/images/nader.jpeg"
//         alt="Nader Magdy"
//         width={150}
//         height={150}
//         className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
//         loading="lazy"
//       />
//       <h3 className="text-lg font-semibold text-white mb-1">Nader Magdy</h3>
//       <p className="text-gray-400 text-xs mb-2">CEO</p>
//       <div className="flex justify-center gap-3">
//         <a
//           href="https://www.linkedin.com/in/nader-magdy-en/"
//           target="_blank"
//           rel="noopener noreferrer"
//           className="text-[#f37121] hover:text-white transition"
//         >
//           <FaLinkedin size={18} />
//         </a>
//       </div>
//     </motion.div>
//   </div>
// </motion.div>

//       {/* --- DEPARTMENT HEADS --- */}
//       <motion.div
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="bg-gray-800 py-14 px-4 text-center"
//       >
//         <h2 className="text-xl md:text-xl font-bold text-[#f37121] mb-8">
//           Team Leaders
//         </h2>

//         <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 justify-center max-w-6xl mx-auto">
//           {[
//             { name: "Mohamed Al Zahrani", role: "HR Manager", img: "/images/zaa.png" },
//             { name: "Haitham Omar", role: "B2B HOD", img: "/images/haithamomar.jpeg" },
//             { name: "Islam Suror", role: "B2C HOD", img: "/images/eslam.jpeg" },
//             { name: "Mohamed Zaher", role: "Software Head", img: "/images/darr.png" },
//             { name: "Ahmed Mahmoud", role: "Head of Operation", img: "/images/ahmedmahmoud.jpeg" },
//             { name: "Adel Hasaballah", role: "BDM", img: "/images/adel.jpeg" },
//           ].map((head) => (
//             <motion.div
//               key={head.name}
//               whileHover={{ scale: 1.04 }}
//               transition={{ duration: 0.25 }}
//               className="rounded-lg shadow-md p-4 bg-gray-900 border border-gray-700/40
//                          hover:border-[#f37121]/50 hover:shadow-lg transition-all duration-300"
//             >
//               <div className="flex justify-center">
//                 <Image
//                   src={head.img}
//                   alt={head.name}
//                   width={100}
//                   height={100}
//                   className="rounded-xl object-cover shadow-md"
//                   loading="lazy"
//                 />
//               </div>
//               <h3 className="text-base mt-4 mb-1 font-semibold text-white">
//                 {head.name}
//               </h3>
//               <p className="text-gray-400 text-sm">{head.role}</p>
//             </motion.div>
//           ))}
//         </div>
//       </motion.div>

//       {/* --- TEAM PHOTO --- */}
//       <motion.div
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="bg-gray-900 py-16 text-center"
//       >
//         <div className="max-w-5xl mx-auto">
//           <Image
//             src="/images/energize familyn.jpg"
//             alt="Our Team"
//             width={600}
//             height={250}
//             className="rounded-xl mx-auto shadow-lg"
//             loading="lazy"
//           />
//           <p className="text-gray-300 mt-6 text-lg italic">
//             Together, we are more than a team - we are the driving force behind the success of Energize Logistics.
//           </p>
//         </div>
//       </motion.div>

//       {/* --- IMAGE SECTION --- */}
//       <motion.section
//         initial={{ opacity: 0, y: 30 }}
//         whileInView={{ opacity: 1, y: 0 }}
//         transition={{ duration: 0.8, ease: "easeOut" }}
//         viewport={{ once: true }}
//         className="relative bg-gray-800 py-20 overflow-hidden"
//       >
//         <motion.div
//           animate={{ scale: [1, 1.1, 1] }}
//           transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
//           className="absolute top-[-100px] left-[-100px] w-[300px] h-[300px] bg-[#f37121]/30 rounded-full blur-[100px] opacity-70 z-0"
//         />

//         <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
//           <h2 className="text-xl text-[#f37121] mb-6">
//             We Move Your World 🌍
//           </h2>

//           <motion.img
//             src="/images/scrrr.png"
//             alt="Energize Logistics"
//             initial={{ opacity: 0, scale: 0.95 }}
//             whileInView={{ opacity: 1, scale: 1 }}
//             transition={{ duration: 0.8, ease: "easeOut" }}
//             viewport={{ once: true }}
//             loading="lazy"
//             className="rounded-3xl shadow-2xl mx-auto w-full max-w-[650px] h-[280px] md:h-[380px] object-cover border border-gray-800"
//           />
//         </div>
//       </motion.section>

//       {/* --- GOOGLE MAP SECTION --- */}
//       <motion.section
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 flex justify-center items-center"
//       >
//         <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full"></div>
//         <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full"></div>

//         <div className="relative z-10 w-[92%] sm:w-[85%] md:w-[70%] lg:w-[55%] rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.4)] border border-gray-700/50">
//           <div className="bg-gray-950/70 text-center py-3 border-b border-gray-700/50">
//             <h2 className="text-xl font-bold text-white">
//               Visit Our <span className="text-[#f37121]">Main Office</span>
//             </h2>
//             <p className="text-gray-400 mt-1 text-sm">Jeddah, Saudi Arabia</p>
//           </div>

//           <div className="relative w-full h-[350px]">
//             <iframe
//               src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3710.23113884275!2d39.16732!3d21.576898999999994!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjHCsDM0JzM2LjgiTiAzOcKwMTAnMDIuNCJF!5e0!3m2!1sen!2ssa!4v1760014775791!5m2!1sen!2ssa"
//               className="absolute top-0 left-0 w-full h-full border-0"
//               loading="lazy"
//               allowFullScreen
//               referrerPolicy="no-referrer-when-downgrade"
//             ></iframe>
//           </div>
//         </div>
//       </motion.section>
//     </section>
//   );
// }

"use client";

import Image from "next/image";
import { FaLinkedin } from "react-icons/fa";

export default function AboutPage() {
  return (
    <section className="bg-gray-900 text-white overflow-hidden">
      {/* --- COMPANY INTRO (يظهر فوراً) --- */}
      <div className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="flex justify-center mb-8">
          <Image
            src="/images/Asset 3.png"
            alt="Energize Logistics Logo"
            width={160}
            height={160}
            priority
          />
        </div>

        <h1 className="text-3xl font-bold mb-6 text-[#f37121]">About Energize</h1>
        <p className="text-gray-300 max-w-4xl mx-auto leading-relaxed text-lg">
          Founded in <span className="text-[#f37121] font-semibold">2020</span>,{" "}
          <strong> ENERGIZE </strong> has grown rapidly into one of the leading logistics
          and transportation companies across the Middle East and Africa. We specialize
          in providing smart, integrated, and technology-driven logistics solutions –
          including heavy truck transportation, customs clearance, import/export
          operations, and 24/7 customer support – ensuring efficient and cost-effective
          supply chain management for our partners.
        </p>
      </div>

      {/* --- VISION & MISSION --- */}
      <div className="bg-gray-800 py-16 px-6 text-center">
        <h2 className="text-3xl font-bold text-[#f37121] mb-10">Vision & Mission</h2>
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {[
            {
              title: "Our Vision",
              text: "To redefine logistics excellence across the region by delivering sustainable, technology-backed, and customer-centered transport solutions.",
            },
            {
              title: "Our Mission",
              text: "To empower businesses with reliable logistics services, supported by innovation, professionalism, and a dedicated team committed to exceeding customer expectations.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="bg-gray-900 rounded-xl p-6 shadow-md border border-gray-700/40 hover:border-[#f37121]/50 transition-all"
            >
              <h3 className="text-2xl font-semibold text-[#f37121] mb-4">{item.title}</h3>
              <p className="text-gray-300">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* --- ACHIEVEMENTS --- */}
      <section className="relative bg-gradient-to-b from-gray-900 to-gray-800 py-20 overflow-hidden">
        <div className="absolute top-[-100px] right-[-100px] w-[320px] h-[320px] bg-[#f37121]/25 rounded-full blur-[120px] opacity-70 z-0" />
        <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 rounded-full blur-[90px] opacity-60 z-0" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-2xl font-bold text-[#f37121] mb-12">
            Our Achievements
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-6">
            {[
              { label: "Successful Shipments", value: "1M+" },
              { label: "Tons Delivered", value: "1M+" },
              { label: "Clients Served", value: "100+" },
              { label: "Cities Covered Across KSA", value: "50+" },
              { label: "Employees & Drivers", value: "360+" },
              { label: "Operational Branches", value: "7" },
            ].map((stat, index) => (
              <div
                key={index}
                className="relative bg-gradient-to-br from-gray-800/60 to-gray-700/40 p-3 rounded-2xl shadow-md border border-gray-700/40 hover:border-[#f37121]/50 transition-all text-center"
              >
                <div className="text-2xl font-bold text-[#f37121] mb-1">
                  {stat.value}
                </div>
                <div className="text-xs sm:text-sm font-medium text-gray-300 tracking-wide">
                  {stat.label}
                </div>
                <div className="w-8 h-[3px] bg-[#f37121] rounded-full mt-3 mx-auto"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- EXPERTISE --- */}
      <div className="bg-gray-900 py-16 text-center px-6">
        <h2 className="text-3xl font-bold text-[#f37121] mb-8">Our Expertise</h2>
        <p className="max-w-4xl mx-auto text-gray-300 text-lg leading-relaxed">
          ENERGIZE provides complete logistics and transportation services across Saudi
          Arabia and the region, covering{" "}
          <span className="text-[#f37121] font-semibold">
            heavy truck transport, fleet management, import/export operations
          </span>
          , and comprehensive customs clearance. With a dedicated team of 300+ professionals
          and a rapidly expanding fleet, we serve businesses of all sizes with unmatched
          efficiency.
        </p>
      </div>

      {/* --- CORE VALUES --- */}
      <div className="bg-gray-800 py-16 text-center">
        <h2 className="text-2xl font-bold text-[#f37121] mb-10">Core Values</h2>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {[
            { title: "Integrity", desc: "We act with honesty, transparency, and responsibility in everything we do." },
            { title: "Partnership", desc: "We build lasting relationships with clients, suppliers, and employees based on trust and respect." },
            { title: "Excellence", desc: "We pursue continuous improvement, innovation, and operational excellence." },
          ].map((val) => (
            <div
              key={val.title}
              className="bg-gray-900 p-6 rounded-xl shadow-md border border-gray-700/40 hover:border-[#f37121]/50"
            >
              <h3 className="text-xl font-semibold text-[#f37121] mb-2">{val.title}</h3>
              <p className="text-gray-300">{val.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* --- TOP MANAGEMENT --- */}
      <div className="bg-gray-900 py-14 px-4 text-center">
        <h2 className="text-2xl font-semibold text-[#f37121] mb-8">
          Founder & Executive Team
        </h2>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 justify-center max-w-5xl mx-auto">
          {/* Dulaim */}
          <div className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-1 sm:order-2 md:order-2">
            <Image
              src="/images/dulaim.jpeg"
              alt="Dulaim Al Nasher"
              width={150}
              height={150}
              className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
              loading="lazy"
            />
            <h3 className="text-lg font-semibold text-white mb-1">
              Dulaim Al Nasher
            </h3>
            <p className="text-gray-400 text-xs mb-2">Founder and Chairman</p>
            <div className="flex justify-center gap-3">
              <a
                href="https://www.linkedin.com/in/dulaim-al-nasher-492507166/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f37121] hover:text-white transition"
              >
                <FaLinkedin size={18} />
              </a>
            </div>
          </div>

          {/* Sameh */}
          <div className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-2 sm:order-1 md:order-1">
            <Image
              src="/images/mrsam2.jpg"
              alt="Sameh Hassan"
              width={150}
              height={150}
              className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
              loading="lazy"
            />
            <h3 className="text-lg font-semibold text-white mb-1">Sameh Hassan</h3>
            <p className="text-gray-400 text-xs mb-2">COO</p>
            <div className="flex justify-center gap-3">
              <a
                href="https://www.linkedin.com/in/sameh-hassan-en/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f37121] hover:text-white transition"
              >
                <FaLinkedin size={18} />
              </a>
            </div>
          </div>

          {/* Nader */}
          <div className="rounded-lg shadow-xl p-4 hover:shadow-2xl transition bg-gray-800 border border-gray-700/40 order-3 sm:order-3 md:order-3">
            <Image
              src="/images/nader.jpeg"
              alt="Nader Magdy"
              width={150}
              height={150}
              className="mx-auto rounded-xl mb-3 object-cover object-center w-[160px] h-[220px]"
              loading="lazy"
            />
            <h3 className="text-lg font-semibold text-white mb-1">Nader Magdy</h3>
            <p className="text-gray-400 text-xs mb-2">CEO</p>
            <div className="flex justify-center gap-3">
              <a
                href="https://www.linkedin.com/in/nader-magdy-en/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f37121] hover:text-white transition"
              >
                <FaLinkedin size={18} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* --- DEPARTMENT HEADS --- */}
      <div className="bg-gray-800 py-14 px-4 text-center">
        <h2 className="text-xl md:text-xl font-bold text-[#f37121] mb-8">
          Team Leaders
        </h2>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 justify-center max-w-6xl mx-auto">
          {[
            { name: "Mohamed Al Zahrani", role: "HR Manager", img: "/images/zaa.png" },
            { name: "Haitham Omar", role: "B2B HOD", img: "/images/haithamomar.jpeg" },
            { name: "Islam Suror", role: "B2C HOD", img: "/images/eslam.jpeg" },
            { name: "Mohamed Zaher", role: "Software Head", img: "/images/darr.png" },
            { name: "Ahmed Mahmoud", role: "Head of Operation", img: "/images/ahmedmahmoud.jpeg" },
            { name: "Adel Hasaballah", role: "BDM", img: "/images/adel.jpeg" },
          ].map((head) => (
            <div
              key={head.name}
              className="rounded-lg shadow-md p-4 bg-gray-900 border border-gray-700/40 hover:border-[#f37121]/50 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex justify-center">
                <Image
                  src={head.img}
                  alt={head.name}
                  width={100}
                  height={100}
                  className="rounded-xl object-cover shadow-md"
                  loading="lazy"
                />
              </div>
              <h3 className="text-base mt-4 mb-1 font-semibold text-white">
                {head.name}
              </h3>
              <p className="text-gray-400 text-sm">{head.role}</p>
            </div>
          ))}
        </div>
      </div>

      {/* --- TEAM PHOTO --- */}
      <div className="bg-gray-900 py-16 text-center">
        <div className="max-w-5xl mx-auto">
          <Image
            src="/images/energize familyn.jpg"
            alt="Our Team"
            width={600}
            height={250}
            className="rounded-xl mx-auto shadow-lg"
            loading="lazy"
          />
          <p className="text-gray-300 mt-6 text-lg italic">
            Together, we are more than a team - we are the driving force behind the success of Energize Logistics.
          </p>
        </div>
      </div>

      {/* --- IMAGE SECTION --- */}
      <section className="relative bg-gray-800 py-20 overflow-hidden">
        <div className="absolute top-[-100px] left-[-100px] w-[300px] h-[300px] bg-[#f37121]/30 rounded-full blur-[100px] opacity-70 z-0" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-xl text-[#f37121] mb-6">
            We Move Your World 🌍
          </h2>

          <img
            src="/images/scrrr.png"
            alt="Energize Logistics"
            loading="lazy"
            className="rounded-3xl shadow-2xl mx-auto w-full max-w-[650px] h-[280px] md:h-[380px] object-cover border border-gray-800"
          />
        </div>
      </section>

      {/* --- GOOGLE MAP SECTION --- */}
      <section className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 flex justify-center items-center">
        <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full"></div>
        <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full"></div>

        <div className="relative z-10 w-[92%] sm:w-[85%] md:w-[70%] lg:w-[55%] rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.4)] border border-gray-700/50">
          <div className="bg-gray-950/70 text-center py-3 border-b border-gray-700/50">
            <h2 className="text-xl font-bold text-white">
              Visit Our <span className="text-[#f37121]">Main Office</span>
            </h2>
            <p className="text-gray-400 mt-1 text-sm">Jeddah, Saudi Arabia</p>
          </div>

          <div className="relative w-full h-[350px]">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3710.23113884275!2d39.16732!3d21.576898999999994!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m2!1m1!2zMjHCsDM0JzM2LjgiTiAzOcKwMTAnMDIuNCJF!5e0!3m2!1sen!2ssa!4v1760014775791!5m2!1sen!2ssa"
              className="absolute top-0 left-0 w-full h-full border-0"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            ></iframe>
          </div>
        </div>
      </section>
    </section>
  );
}