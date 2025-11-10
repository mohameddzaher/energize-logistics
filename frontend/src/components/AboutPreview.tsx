// "use client";

// import { motion } from "framer-motion";
// import { useEffect, useState } from "react";
// import { ArrowRight } from "lucide-react";

// export default function AboutPreview() {
//   const [counters, setCounters] = useState({
//     experience: 0,
//     clients: 0,
//     products: 0,
//     team: 0,
//   });

//   useEffect(() => {
//     const targets = { experience: 12, clients: 35, products: 12000, team: 35 };
//     const duration = 1500;
//     const start = performance.now();

//     const animate = (time: number) => {
//       const progress = Math.min((time - start) / duration, 1);
//       setCounters({
//         experience: Math.floor(progress * targets.experience),
//         clients: Math.floor(progress * targets.clients),
//         products: Math.floor(progress * targets.products),
//         team: Math.floor(progress * targets.team),
//       });
//       if (progress < 1) requestAnimationFrame(animate);
//     };

//     requestAnimationFrame(animate);
//   }, []);

//   return (
//     <section className="relative bg-gray-900 text-white py-20 px-6 overflow-hidden">
//       {/* 🔥 خلفية subtle orange gradient effect */}
//       <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl animate-pulse-slow pointer-events-none" />

//       <div className="max-w-6xl mx-auto relative z-10">
//         {/* --- 1️⃣ INTRO --- */}
//         <motion.div
//           initial={{ opacity: 0, y: 20 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.6 }}
//           className="flex flex-col md:flex-row items-center gap-8 mt-10"
//         >
//           <div className="md:w-1/2 text-left space-y-4">
//             <h2 className="text-2xl md:text-2xl font-extrabold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
//               Powering Logistics Forward ⚡
//             </h2>
//             <div className="w-20 h-[3px] bg-gradient-to-r from-[#f37121] to-orange-600 rounded-full" />
//             <p className="text-gray-300 text-base md:text-md leading-relaxed">
//               <strong>ENERGIZE</strong> is one of the leading logistics and
//               transportation companies across the Middle East and Africa -
//               providing smart, integrated, and technology-driven logistics
//               solutions for businesses of all sizes.
//             </p>
//           </div>

//           <div className="md:w-1/2 flex justify-center">
//             <img
//               src="/images/newai.jpg"
//               alt="About Energize"
//               className="rounded-2xl shadow-lg w-full max-w-[420px] md:max-w-[480px] h-[220px] md:h-[260px] object-cover"
//             />
//           </div>
//         </motion.div>

//         {/* --- 2️⃣ STATS COUNTER --- */}
//         <motion.div
//           initial={{ opacity: 0, y: 20 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ delay: 0.5 }}
//           className="relative mt-28"
//         >
//           {/* 🟠 خلفية دائرية متحركة */}
//           <motion.div
//             animate={{ scale: [1, 1.15, 1] }}
//             transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
//             className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] bg-[#f37121]/30 rounded-full blur-[100px] opacity-60 z-0"
//           />

//           <motion.div
//             animate={{ scale: [1, 1.1, 1] }}
//             transition={{
//               repeat: Infinity,
//               duration: 10,
//               ease: "easeInOut",
//               delay: 1,
//             }}
//             className="absolute bottom-[-60px] left-[-60px] w-[250px] h-[250px] bg-gray-400/30 rounded-full blur-[90px] opacity-50 z-0"
//           />

//           <div className="relative z-10 max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-10">
//             <div className="md:w-1/2 w-full">
//               <img
//                 src="/images/4.jpg"
//                 alt="Company Stats"
//                 className="rounded-3xl shadow-xl w-full h-auto object-cover"
//               />
//             </div>

//             <div className="grid grid-cols-2 gap-6 md:w-1/2 w-full">
//               {[
//                 { label: "Successful Shipments", value: "1M+" },
//                 { label: "Tons Delivered", value: "1M+" },
//                 { label: "Clients Served", value: "100+" },
//                 { label: "Cities Covered Across KSA", value: "50+" },
//                 { label: "Employees & Drivers", value: "360+" },
//                 { label: "Operational Branches", value: "7" },
//               ].map((stat, index) => (
//                 <div
//                   key={index}
//                   className="relative bg-gradient-to-br from-[#1a1a1a] to-[#2d2d2d]
//                              p-6 rounded-2xl shadow-md hover:shadow-lg transition-all duration-300"
//                 >
//                   <div className="text-3xl font-bold text-[#f37121] mb-1">
//                     {stat.value}
//                   </div>
//                   <div className="text-sm font-medium text-gray-300 tracking-wide">
//                     {stat.label}
//                   </div>
//                   <div className="w-8 h-1 bg-[#f37121] rounded-full mt-2"></div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </motion.div>

//         {/* --- 3️⃣ WHY CHOOSE ENERGIZE --- */}
//         <motion.div
//           initial={{ opacity: 0, y: 30 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.6 }}
//           className="mt-20"
//         >
//           <h3 className="text-2xl font-bold text-[#f37121] mb-8 text-center">
//             Why Choose <span className="text-white">ENERGIZE?</span>
//           </h3>

//           <div className="flex flex-col md:flex-row items-center gap-8">
//             <div className="grid sm:grid-cols-2 gap-4 md:w-2/3">
//               {[
//                 {
//                   title: "Proven Track Record",
//                   desc: "Over a million successful shipments — trusted by leaders across the region.",
//                   icon: "🚚",
//                 },
//                 {
//                   title: "Cutting-Edge Technology",
//                   desc: "Advanced tracking and digital fleet management for full transparency.",
//                   icon: "⚙️",
//                 },
//                 {
//                   title: "Reliable Coverage",
//                   desc: "Serving 50+ cities in Saudi Arabia with 7 fully equipped branches.",
//                   icon: "📍",
//                 },
//                 {
//                   title: "Professional Team",
//                   desc: "360+ skilled drivers and staff ensuring seamless delivery operations.",
//                   icon: "👷‍♂️",
//                 },
//                 {
//                   title: "Customer-Centered",
//                   desc: "24/7 support and customized logistics solutions for every business.",
//                   icon: "🤝",
//                 },
//                 {
//                   title: "Sustainable Growth",
//                   desc: "Focused on efficiency and eco-friendly logistics innovation.",
//                   icon: "🌱",
//                 },
//               ].map((item, index) => (
//                 <motion.div
//                   key={index}
//                   // whileHover={{ scale: 1.03 }}
//                   transition={{ type: "spring", stiffness: 200 }}
//                   className="text-center relative bg-gradient-to-b from-gray-800 to-[#242424]
//                              p-3 rounded-lg shadow-md hover:shadow-lg
//                              border border-[#2f2f2f] hover:border-[#f37121]/40
//                              transition-all duration-300"
//                 >
//                   <div className="text-xl mb-2">{item.icon}</div>
//                   <h4 className="text-sm font-semibold text-[#f37121] mb-1">
//                     {item.title}
//                   </h4>
//                   <p className="text-gray-400 text-xs leading-relaxed">
//                     {item.desc}
//                   </p>
//                 </motion.div>
//               ))}
//             </div>

//             <div className="md:w-1/3 flex justify-center">
//               <motion.img
//                 src="/images/Photo front view of truck in low lights _ Premium… (1).jpeg"
//                 alt="Why Choose Energize"
//                 initial={{ opacity: 0, scale: 0.95 }}
//                 whileInView={{ opacity: 1, scale: 1 }}
//                 transition={{ duration: 0.8, ease: "easeOut" }}
//                 viewport={{ once: true }}
//                 className="rounded-3xl shadow-xl object-cover w-full max-w-[280px] h-[400px] md:max-w-[280px] md:h-[400px]"
//               />
//             </div>
//           </div>
//         </motion.div>

//         {/* --- 0️⃣ CONTAINER IMAGE WITH TEXT --- */}
//         <motion.div
//           initial={{ opacity: 0, y: -30 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.7 }}
//           className="relative mb-12 mt-4 flex justify-center"
//         >
//           <div className="relative w-full max-w-xl">
//             {/* الصورة الرئيسية */}
//             <motion.img
//               src="/images/Picture1.png"
//               alt="Shipping Container"
//               className="w-full h-auto rounded-xl shadow-lg"
//               whileHover={{ scale: 1.02 }}
//               transition={{ type: "spring", stiffness: 300 }}
//             />

//             {/* النص فوق الصورة */}
//             <div className="absolute inset-0 flex flex-col items-center justify-end text-center p-6 mb-16 !mb-2 md:!mb-16 ">
//               <motion.h2
//                 initial={{ opacity: 0, y: 15 }}
//                 whileInView={{ opacity: 1, y: 0 }}
//                 transition={{ delay: 0.3, duration: 0.5 }}
//                 className="text-xl md:text-xl font-bold text-white mb-2 drop-shadow-lg"
//               >
//                 Your Trusted Partner in{" "}
//                 <span className="text-[#f37121]">Global Shipping</span>
//               </motion.h2>

//               <motion.p
//                 initial={{ opacity: 0, y: 15 }}
//                 whileInView={{ opacity: 1, y: 0 }}
//                 transition={{ delay: 0.5, duration: 0.5 }}
//                 className="text-base md:text-sm text-gray-100 max-w-xl mx-auto leading-relaxed drop-shadow-md"
//               >
//                 We ensure your goods reach any destination worldwide safely and
//                 efficiently
//               </motion.p>

//               <motion.div
//                 initial={{ opacity: 0, scale: 0.9 }}
//                 whileInView={{ opacity: 1, scale: 1 }}
//                 transition={{ delay: 0.7, duration: 0.4 }}
//                 className="mt-4"
//               >
//                 {/* زر Contact Us */}
//                 <a
//                   href="/contact"
//                   className="group flex items-center gap-3 px-6 py-2 rounded-lg border border-gray-400 hover:border-white hover:bg-white/10 text-white text-sm transition-all duration-300"
//                 >
//                   <span>Contact Us</span>
//                   <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
//                 </a>
//               </motion.div>
//             </div>
//           </div>
//         </motion.div>

//         {/* --- 4️⃣ OUR MISSION & VISION --- */}
//         <motion.div
//           initial={{ opacity: 0, y: 30 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.8, ease: "easeOut" }}
//           viewport={{ once: true }}
//           className="mt-20 text-center"
//         >
//           <h2 className="text-2xl font-bold text-[#f37121] mb-6">
//             Our Mission & Vision
//           </h2>

//           <motion.img
//             src="/images/40.jpeg"
//             alt="Mission & Vision"
//             initial={{ opacity: 0, scale: 0.95 }}
//             whileInView={{ opacity: 1, scale: 1 }}
//             transition={{ duration: 0.8, ease: "easeOut" }}
//             viewport={{ once: true }}
//             className="rounded-2xl shadow-lg w-full max-w-[500px] h-[200px] object-cover mx-auto"
//           />

//           <motion.div
//             initial={{ opacity: 0, y: 40 }}
//             whileInView={{ opacity: 1, y: 0 }}
//             transition={{ duration: 0.9, delay: 0.2 }}
//             viewport={{ once: true }}
//             className="bg-gray-900 py-10 px-4 text-center rounded-2xl shadow-md"
//           >
//             <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
//               <motion.div
//                 whileHover={{ scale: 1.03 }}
//                 transition={{ type: "spring", stiffness: 200 }}
//                 className="bg-gray-800 rounded-xl p-4 shadow-sm"
//               >
//                 <h3 className="text-xl font-semibold text-[#f37121] mb-2">
//                   Our Vision
//                 </h3>
//                 <p className="text-gray-300 text-sm leading-relaxed">
//                   To redefine logistics excellence across the region by
//                   delivering sustainable, technology-backed, and
//                   customer-centered transport solutions.
//                 </p>
//               </motion.div>

//               <motion.div
//                 whileHover={{ scale: 1.03 }}
//                 transition={{ type: "spring", stiffness: 200 }}
//                 className="bg-gray-800 rounded-xl p-4 shadow-sm"
//               >
//                 <h3 className="text-xl font-semibold text-[#f37121] mb-2">
//                   Our Mission
//                 </h3>
//                 <p className="text-gray-300 text-sm leading-relaxed">
//                   To empower businesses with reliable logistics services,
//                   supported by innovation, professionalism, and a dedicated team
//                   committed to exceeding customer expectations.
//                 </p>
//               </motion.div>
//             </div>
//           </motion.div>
//         </motion.div>

//         {/* --- 5️⃣ CLIENTS CAROUSEL --- */}
//         <motion.div
//           initial={{ opacity: 0, y: 30 }}
//           whileInView={{ opacity: 1, y: 0 }}
//           transition={{ duration: 0.6 }}
//           className="mt-24 text-center overflow-hidden"
//         >
//           <h3 className="text-3xl font-bold text-[#f37121] mb-10">
//             Our Valued Clients
//           </h3>

//           <div className="relative w-full overflow-hidden">
//             <motion.div
//               animate={{ x: ["0%", "-500%"] }}
//               transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
//               className="flex gap-8"
//             >
//               {[...Array(2)].map((_, loopIndex) => (
//                 <div key={loopIndex} className="flex gap-8">
//                   {Array.from(
//                     { length: 50 },
//                     (_, i) => `/images/clients/${i + 1}.jpeg`
//                   ).map((logo, index) => (
//                     <div
//                       key={`${loopIndex}-${index}`}
//                       className="flex items-center justify-center bg-white/5 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-gray-700/30 hover:border-[#f37121]/50 transition-all duration-300 min-w-[220px] h-[130px]"
//                     >
//                       <img
//                         src={logo}
//                         alt={`Client ${index + 1}`}
//                         className="max-w-full max-h-full object-contain drop-shadow-lg"
//                         onError={(e) =>
//                           ((e.target as HTMLImageElement).style.display =
//                             "none")
//                         }
//                       />
//                     </div>
//                   ))}
//                 </div>
//               ))}
//             </motion.div>
//           </div>
//         </motion.div>
//       </div>
//     </section>
//   );
// }

// -------------------

// "use client";

// import { motion } from "framer-motion";
// import { useEffect, useState } from "react";
// import { ArrowRight } from "lucide-react";

// export default function AboutPreview() {
//   const [counters, setCounters] = useState({
//     experience: 0,
//     clients: 0,
//     products: 0,
//     team: 0,
//   });

//   useEffect(() => {
//     const targets = { experience: 12, clients: 35, products: 12000, team: 35 };
//     const duration = 1500;
//     const start = performance.now();

//     const animate = (time: number) => {
//       const progress = Math.min((time - start) / duration, 1);
//       setCounters({
//         experience: Math.floor(progress * targets.experience),
//         clients: Math.floor(progress * targets.clients),
//         products: Math.floor(progress * targets.products),
//         team: Math.floor(progress * targets.team),
//       });
//       if (progress < 1) requestAnimationFrame(animate);
//     };

//     requestAnimationFrame(animate);
//   }, []);

//   return (
//     <section className="relative bg-gray-900 text-white py-20 px-6 overflow-hidden">
//       {/* 🔥 خلفية subtle orange gradient effect */}
//       <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl animate-pulse-slow pointer-events-none" />

//       <div className="max-w-6xl mx-auto relative z-10">
//         {/* --- 1️⃣ INTRO --- */}
//         <div className="flex flex-col md:flex-row items-center gap-8 mt-10">
//           <div className="md:w-1/2 text-left space-y-4">
//             <h2 className="text-2xl md:text-2xl font-extrabold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
//               Powering Logistics Forward ⚡
//             </h2>
//             <div className="w-20 h-[3px] bg-gradient-to-r from-[#f37121] to-orange-600 rounded-full" />
//             <p className="text-gray-300 text-base md:text-md leading-relaxed">
//               <strong>ENERGIZE</strong> is one of the leading logistics and
//               transportation companies across the Middle East and Africa -
//               providing smart, integrated, and technology-driven logistics
//               solutions for businesses of all sizes.
//             </p>
//           </div>

//           <div className="md:w-1/2 flex justify-center">
//             <img
//               src="/images/newai.jpg"
//               alt="About Energize"
//               className="rounded-2xl shadow-lg w-full max-w-[420px] md:max-w-[480px] h-[220px] md:h-[260px] object-cover"
//               loading="lazy"
//             />
//           </div>
//         </div>

//         {/* --- 2️⃣ STATS COUNTER --- */}
//         <div className="relative mt-28">
//           {/* 🟠 خلفية دائرية متحركة */}
//           <div className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] bg-[#f37121]/30 rounded-full blur-[100px] opacity-60 z-0" />

//           <div className="absolute bottom-[-60px] left-[-60px] w-[250px] h-[250px] bg-gray-400/30 rounded-full blur-[90px] opacity-50 z-0" />

//           <div className="relative z-10 max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-10">
//             <div className="md:w-1/2 w-full">
//               <img
//                 src="/images/4.jpg"
//                 alt="Company Stats"
//                 className="rounded-3xl shadow-xl w-full h-auto object-cover"
//                 loading="lazy"
//               />
//             </div>

//             <div className="grid grid-cols-2 gap-6 md:w-1/2 w-full">
//               {[
//                 { label: "Successful Shipments", value: "1M+" },
//                 { label: "Tons Delivered", value: "1M+" },
//                 { label: "Clients Served", value: "100+" },
//                 { label: "Cities Covered Across KSA", value: "50+" },
//                 { label: "Employees & Drivers", value: "360+" },
//                 { label: "Operational Branches", value: "7" },
//               ].map((stat, index) => (
//                 <div
//                   key={index}
//                   className="relative bg-gradient-to-br from-[#1a1a1a] to-[#2d2d2d] p-6 rounded-2xl shadow-md hover:shadow-lg transition-all duration-300"
//                 >
//                   <div className="text-3xl font-bold text-[#f37121] mb-1">
//                     {stat.value}
//                   </div>
//                   <div className="text-sm font-medium text-gray-300 tracking-wide">
//                     {stat.label}
//                   </div>
//                   <div className="w-8 h-1 bg-[#f37121] rounded-full mt-2"></div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>

//         {/* --- 3️⃣ WHY CHOOSE ENERGIZE --- */}
//         <div className="mt-20">
//           <h3 className="text-2xl font-bold text-[#f37121] mb-8 text-center">
//             Why Choose <span className="text-white">ENERGIZE?</span>
//           </h3>

//           <div className="flex flex-col md:flex-row items-center gap-8">
//             <div className="grid sm:grid-cols-2 gap-4 md:w-2/3">
//               {[
//                 {
//                   title: "Proven Track Record",
//                   desc: "Over a million successful shipments — trusted by leaders across the region.",
//                   icon: "🚚",
//                 },
//                 {
//                   title: "Cutting-Edge Technology",
//                   desc: "Advanced tracking and digital fleet management for full transparency.",
//                   icon: "⚙️",
//                 },
//                 {
//                   title: "Reliable Coverage",
//                   desc: "Serving 50+ cities in Saudi Arabia with 7 fully equipped branches.",
//                   icon: "📍",
//                 },
//                 {
//                   title: "Professional Team",
//                   desc: "360+ skilled drivers and staff ensuring seamless delivery operations.",
//                   icon: "👷‍♂️",
//                 },
//                 {
//                   title: "Customer-Centered",
//                   desc: "24/7 support and customized logistics solutions for every business.",
//                   icon: "🤝",
//                 },
//                 {
//                   title: "Sustainable Growth",
//                   desc: "Focused on efficiency and eco-friendly logistics innovation.",
//                   icon: "🌱",
//                 },
//               ].map((item, index) => (
//                 <div
//                   key={index}
//                   className="text-center relative bg-gradient-to-b from-gray-800 to-[#242424] p-3 rounded-lg shadow-md hover:shadow-lg border border-[#2f2f2f] hover:border-[#f37121]/40 transition-all duration-300"
//                 >
//                   <div className="text-xl mb-2">{item.icon}</div>
//                   <h4 className="text-sm font-semibold text-[#f37121] mb-1">
//                     {item.title}
//                   </h4>
//                   <p className="text-gray-400 text-xs leading-relaxed">
//                     {item.desc}
//                   </p>
//                 </div>
//               ))}
//             </div>

//             <div className="md:w-1/3 flex justify-center">
//               <img
//                 src="/images/Photo front view of truck in low lights _ Premium… (1).jpeg"
//                 alt="Why Choose Energize"
//                 className="rounded-3xl shadow-xl object-cover w-full max-w-[280px] h-[400px] md:max-w-[280px] md:h-[400px]"
//                 loading="lazy"
//               />
//             </div>
//           </div>
//         </div>

//         {/* --- 0️⃣ CONTAINER IMAGE WITH TEXT --- */}
//         <div className="relative mb-12 mt-4 flex justify-center">
//           <div className="relative w-full max-w-xl">
//             {/* الصورة الرئيسية */}
//             <img
//               src="/images/Picture1.png"
//               alt="Shipping Container"
//               className="w-full h-auto rounded-xl shadow-lg"
//             />

//             {/* النص فوق الصورة */}
//             <div className="absolute inset-0 flex flex-col items-center justify-end text-center p-6 mb-16 !mb-2 md:!mb-16">
//               <h2 className="text-xl md:text-xl font-bold text-white mb-2 drop-shadow-lg">
//                 Your Trusted Partner in{" "}
//                 <span className="text-[#f37121]">Global Shipping</span>
//               </h2>

//               <p className="text-base md:text-sm text-gray-100 max-w-xl mx-auto leading-relaxed drop-shadow-md">
//                 We ensure your goods reach any destination worldwide safely and
//                 efficiently
//               </p>

//               <div className="mt-4">
//                 {/* زر Contact Us */}
//                 <a
//                   href="/contact"
//                   className="group flex items-center gap-3 px-6 py-2 rounded-lg border border-gray-400 hover:border-white hover:bg-white/10 text-white text-sm transition-all duration-300"
//                 >
//                   <span>Contact Us</span>
//                   <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
//                 </a>
//               </div>
//             </div>
//           </div>
//         </div>

//         {/* --- 4️⃣ OUR MISSION & VISION --- */}
//         <div className="mt-20 text-center">
//           <h2 className="text-2xl font-bold text-[#f37121] mb-6">
//             Our Mission & Vision
//           </h2>

//           <img
//             src="/images/40.jpeg"
//             alt="Mission & Vision"
//             className="rounded-2xl shadow-lg w-full max-w-[500px] h-[200px] object-cover mx-auto"
//             loading="lazy"
//           />

//           <div className="bg-gray-900 py-10 px-4 text-center rounded-2xl shadow-md">
//             <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
//               <div className="bg-gray-800 rounded-xl p-4 shadow-sm">
//                 <h3 className="text-xl font-semibold text-[#f37121] mb-2">
//                   Our Vision
//                 </h3>
//                 <p className="text-gray-300 text-sm leading-relaxed">
//                   To redefine logistics excellence across the region by
//                   delivering sustainable, technology-backed, and
//                   customer-centered transport solutions.
//                 </p>
//               </div>

//               <div className="bg-gray-800 rounded-xl p-4 shadow-sm">
//                 <h3 className="text-xl font-semibold text-[#f37121] mb-2">
//                   Our Mission
//                 </h3>
//                 <p className="text-gray-300 text-sm leading-relaxed">
//                   To empower businesses with reliable logistics services,
//                   supported by innovation, professionalism, and a dedicated team
//                   committed to exceeding customer expectations.
//                 </p>
//               </div>
//             </div>
//           </div>
//         </div>

//         {/* --- 5️⃣ CLIENTS CAROUSEL --- */}
//         <div className="mt-24 text-center overflow-hidden">
//           <h3 className="text-3xl font-bold text-[#f37121] mb-10">
//             Our Valued Clients
//           </h3>

//           <div className="relative w-full overflow-hidden">
//             <div className="flex gap-8 animate-scroll">
//               {[...Array(2)].map((_, loopIndex) => (
//                 <div key={loopIndex} className="flex gap-8">
//                   {Array.from(
//                     { length: 50 },
//                     (_, i) => `/images/clients/${i + 1}.jpeg`
//                   ).map((logo, index) => (
//                     <div
//                       key={`${loopIndex}-${index}`}
//                       className="flex items-center justify-center bg-white/5 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-gray-700/30 hover:border-[#f37121]/50 transition-all duration-300 min-w-[220px] h-[130px]"
//                     >
//                       <img
//                         src={logo}
//                         alt={`Client ${index + 1}`}
//                         className="max-w-full max-h-full object-contain drop-shadow-lg"
//                         onError={(e) =>
//                           ((e.target as HTMLImageElement).style.display =
//                             "none")
//                         }
//                         loading="lazy"
//                       />
//                     </div>
//                   ))}
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       </div>

//       <style jsx>{`
//         @keyframes scroll {
//           0% {
//             transform: translateX(0);
//           }
//           100% {
//             transform: translateX(-500%);
//           }
//         }
//         .animate-scroll {
//           animation: scroll 120s linear infinite;
//         }
//         @media (max-width: 768px) {
//           .animate-scroll {
//             animation: scroll 180s linear infinite;
//           }
//         }
//       `}</style>
//     </section>
//   );
// }


"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

export default function AboutPreview() {
  const [counters, setCounters] = useState({
    experience: 0,
    clients: 0,
    products: 0,
    team: 0,
  });

  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error";
  }>({
    show: false,
    message: "",
    type: "success",
  });

  const showToast = (message: string, type: "success" | "error") => {
    setToast({
      show: true,
      message,
      type,
    });
    
    // إخفاء التوست بعد 4 ثواني
    setTimeout(() => {
      setToast({
        show: false,
        message: "",
        type: "success",
      });
    }, 4000);
  };

  useEffect(() => {
    const targets = { experience: 12, clients: 35, products: 12000, team: 35 };
    const duration = 1500;
    const start = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - start) / duration, 1);
      setCounters({
        experience: Math.floor(progress * targets.experience),
        clients: Math.floor(progress * targets.clients),
        products: Math.floor(progress * targets.products),
        team: Math.floor(progress * targets.team),
      });
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, []);

  // دالة محاكاة لإرسال الفورم (يمكن استبدالها بالوظيفة الفعلية)
  const handleContactClick = (e: React.MouseEvent) => {
    e.preventDefault();
    showToast("📧 Redirecting to contact page...", "success");
    
    // محاكاة الانتقال للصفحة بعد ثانية
    setTimeout(() => {
      window.location.href = "/contact";
    }, 1000);
  };

  return (
    <section className="relative bg-gray-900 text-white py-20 px-6 overflow-hidden">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-4 right-4 z-50 max-w-sm ${
          toast.type === "success" 
            ? "bg-green-100 border-green-100" 
            : "bg-red-100 border-red-500"
        } text-white px-6 py-3 rounded-xl shadow-2xl border transform transition-all duration-300 animate-fade-in`}>
          <div className="flex items-center gap-3">
            <span className="text-lg">
              {toast.type === "success" ? "✅" : "❌"}
            </span>
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      {/* 🔥 خلفية subtle orange gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl animate-pulse-slow pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* --- 1️⃣ INTRO --- */}
        <div className="flex flex-col md:flex-row items-center gap-8 mt-10">
          <div className="md:w-1/2 text-left space-y-4">
            <h2 className="text-2xl md:text-2xl font-extrabold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
              Powering Logistics Forward ⚡
            </h2>
            <div className="w-20 h-[3px] bg-gradient-to-r from-[#f37121] to-orange-600 rounded-full" />
            <p className="text-gray-300 text-base md:text-md leading-relaxed">
              <strong>ENERGIZE</strong> is one of the leading logistics and
              transportation companies across the Middle East and Africa -
              providing smart, integrated, and technology-driven logistics
              solutions for businesses of all sizes.
            </p>
          </div>

          <div className="md:w-1/2 flex justify-center">
            <img
              src="/images/newai.jpg"
              alt="About Energize"
              className="rounded-2xl shadow-lg w-full max-w-[420px] md:max-w-[480px] h-[220px] md:h-[260px] object-cover"
              loading="lazy"
            />
          </div>
        </div>

        {/* --- 2️⃣ STATS COUNTER --- */}
        <div className="relative mt-28">
          {/* 🟠 خلفية دائرية متحركة */}
          <div className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] bg-[#f37121]/30 rounded-full blur-[100px] opacity-60 z-0" />

          <div className="absolute bottom-[-60px] left-[-60px] w-[250px] h-[250px] bg-gray-400/30 rounded-full blur-[90px] opacity-50 z-0" />

          <div className="relative z-10 max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-10">
            <div className="md:w-1/2 w-full">
              <img
                src="/images/4.jpg"
                alt="Company Stats"
                className="rounded-3xl shadow-xl w-full h-auto object-cover"
                loading="lazy"
              />
            </div>

            <div className="grid grid-cols-2 gap-6 md:w-1/2 w-full">
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
                  className="relative bg-gradient-to-br from-[#1a1a1a] to-[#2d2d2d] p-6 rounded-2xl shadow-md hover:shadow-lg transition-all duration-300"
                >
                  <div className="text-3xl font-bold text-[#f37121] mb-1">
                    {stat.value}
                  </div>
                  <div className="text-sm font-medium text-gray-300 tracking-wide">
                    {stat.label}
                  </div>
                  <div className="w-8 h-1 bg-[#f37121] rounded-full mt-2"></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* --- 3️⃣ WHY CHOOSE ENERGIZE --- */}
        <div className="mt-20">
          <h3 className="text-2xl font-bold text-[#f37121] mb-8 text-center">
            Why Choose <span className="text-white">ENERGIZE?</span>
          </h3>

          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="grid sm:grid-cols-2 gap-4 md:w-2/3">
              {[
                {
                  title: "Proven Track Record",
                  desc: "Over a million successful shipments — trusted by leaders across the region.",
                  icon: "🚚",
                },
                {
                  title: "Cutting-Edge Technology",
                  desc: "Advanced tracking and digital fleet management for full transparency.",
                  icon: "⚙️",
                },
                {
                  title: "Reliable Coverage",
                  desc: "Serving 50+ cities in Saudi Arabia with 7 fully equipped branches.",
                  icon: "📍",
                },
                {
                  title: "Professional Team",
                  desc: "360+ skilled drivers and staff ensuring seamless delivery operations.",
                  icon: "👷‍♂️",
                },
                {
                  title: "Customer-Centered",
                  desc: "24/7 support and customized logistics solutions for every business.",
                  icon: "🤝",
                },
                {
                  title: "Sustainable Growth",
                  desc: "Focused on efficiency and eco-friendly logistics innovation.",
                  icon: "🌱",
                },
              ].map((item, index) => (
                <div
                  key={index}
                  className="text-center relative bg-gradient-to-b from-gray-800 to-[#242424] p-3 rounded-lg shadow-md hover:shadow-lg border border-[#2f2f2f] hover:border-[#f37121]/40 transition-all duration-300"
                >
                  <div className="text-xl mb-2">{item.icon}</div>
                  <h4 className="text-sm font-semibold text-[#f37121] mb-1">
                    {item.title}
                  </h4>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="md:w-1/3 flex justify-center">
              <img
                src="/images/Photo front view of truck in low lights _ Premium… (1).jpeg"
                alt="Why Choose Energize"
                className="rounded-3xl shadow-xl object-cover w-full max-w-[280px] h-[400px] md:max-w-[280px] md:h-[400px]"
                loading="lazy"
              />
            </div>
          </div>
        </div>

        {/* --- 0️⃣ CONTAINER IMAGE WITH TEXT --- */}
        <div className="relative mb-12 mt-4 flex justify-center">
          <div className="relative w-full max-w-xl">
            {/* الصورة الرئيسية */}
            <img
              src="/images/Picture1.png"
              alt="Shipping Container"
              className="w-full h-auto rounded-xl shadow-lg"
            />

            {/* النص فوق الصورة */}
            <div className="absolute inset-0 flex flex-col items-center justify-end text-center p-6 mb-16 !mb-2 md:!mb-16">
              <h2 className="text-xl md:text-xl font-bold text-white mb-2 drop-shadow-lg">
                Your Trusted Partner in{" "}
                <span className="text-[#f37121]">Global Shipping</span>
              </h2>

              <p className="text-base md:text-sm text-gray-100 max-w-xl mx-auto leading-relaxed drop-shadow-md">
                We ensure your goods reach any destination worldwide safely and
                efficiently
              </p>

              <div className="mt-4">
                {/* زر Contact Us مع التوست */}
                <a
                  href="/contact"
                  onClick={handleContactClick}
                  className="group flex items-center gap-3 px-6 py-2 rounded-lg border border-gray-400 hover:border-white hover:bg-white/10 text-white text-sm transition-all duration-300 cursor-pointer"
                >
                  <span>Contact Us</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* --- 4️⃣ OUR MISSION & VISION --- */}
        <div className="mt-20 text-center">
          <h2 className="text-2xl font-bold text-[#f37121] mb-6">
            Our Mission & Vision
          </h2>

          <img
            src="/images/40.jpeg"
            alt="Mission & Vision"
            className="rounded-2xl shadow-lg w-full max-w-[500px] h-[200px] object-cover mx-auto"
            loading="lazy"
          />

          <div className="bg-gray-900 py-10 px-4 text-center rounded-2xl shadow-md">
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              <div className="bg-gray-800 rounded-xl p-4 shadow-sm">
                <h3 className="text-xl font-semibold text-[#f37121] mb-2">
                  Our Vision
                </h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                  To redefine logistics excellence across the region by
                  delivering sustainable, technology-backed, and
                  customer-centered transport solutions.
                </p>
              </div>

              <div className="bg-gray-800 rounded-xl p-4 shadow-sm">
                <h3 className="text-xl font-semibold text-[#f37121] mb-2">
                  Our Mission
                </h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                  To empower businesses with reliable logistics services,
                  supported by innovation, professionalism, and a dedicated team
                  committed to exceeding customer expectations.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* --- 5️⃣ CLIENTS CAROUSEL --- */}
        <div className="mt-24 text-center overflow-hidden">
          <h3 className="text-3xl font-bold text-[#f37121] mb-10">
            Our Valued Clients
          </h3>

          <div className="relative w-full overflow-hidden">
            <div className="flex gap-8 animate-scroll">
              {[...Array(2)].map((_, loopIndex) => (
                <div key={loopIndex} className="flex gap-8">
                  {Array.from(
                    { length: 50 },
                    (_, i) => `/images/clients/${i + 1}.jpeg`
                  ).map((logo, index) => (
                    <div
                      key={`${loopIndex}-${index}`}
                      className="flex items-center justify-center bg-white/5 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-gray-700/30 hover:border-[#f37121]/50 transition-all duration-300 min-w-[220px] h-[130px]"
                    >
                      <img
                        src={logo}
                        alt={`Client ${index + 1}`}
                        className="max-w-full max-h-full object-contain drop-shadow-lg"
                        onError={(e) =>
                          ((e.target as HTMLImageElement).style.display =
                            "none")
                        }
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-500%);
          }
        }
        .animate-scroll {
          animation: scroll 120s linear infinite;
        }
        @media (max-width: 768px) {
          .animate-scroll {
            animation: scroll 180s linear infinite;
          }
        }
        
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </section>
  );
}