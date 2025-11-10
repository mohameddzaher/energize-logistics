// "use client";

// import React, { useRef, useState, FormEvent } from "react";
// import emailjs from "@emailjs/browser";
// import { motion } from "framer-motion";

// export default function CareerPage() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     emailjs
//       .sendForm(
//         "service_v2cra3g", // ✅ Service ID من EmailJS
//         "template_b3t6ueb", // ✅ Template ID من EmailJS
//         form.current,
//         "hUIH-7NBh0vPFMSni" // ✅ Public Key من EmailJS
//       )
//       .then(
//         (result) => {
//           console.log("Application Sent:", result.text);
//           alert("✅ Your application has been submitted successfully!");
//           form.current?.reset();
//           setLoading(false);
//         },
//         (error) => {
//           console.error("Error:", error.text);
//           alert("❌ Failed to submit application, please try again later.");
//           setLoading(false);
//         }
//       );
//   };

//   const fadeUp = {
//     hidden: { opacity: 0, y: 40 },
//     visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
//   };

//   return (
//     <section className="min-h-screen bg-gray-900 text-white py-16 px-6 md:px-20">
//       {/* ===================== HERO ===================== */}
//       <motion.div
//         variants={fadeUp}
//         initial="hidden"
//         animate="visible"
//         className="text-center mb-16"
//       >
//         <h1 className="text-3xl md:text-2xl font-bold text-[#f37121] mb-4">
//           Join Our Team
//         </h1>
//         <p className="text-gray-300 max-w-3xl mx-auto">
//           At{" "}
//           <span className="text-[#f37121] font-semibold">
//             Energize Logistics
//           </span>
//           , we believe in innovation, dedication, and teamwork. Explore our open
//           positions below and become part of a team shaping the future of
//           logistics.
//         </p>
//       </motion.div>

//       {/* ===================== JOB LISTINGS ===================== */}
//       <div className="max-w-5xl mx-auto space-y-12 mb-24">
//         {/* ===== Accountant ===== */}
//         <motion.div
//           variants={fadeUp}
//           initial="hidden"
//           whileInView="visible"
//           viewport={{ once: true }}
//           className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40"
//         >
//           <h2 className="text-2xl font-bold text-[#f37121] mb-4">Accountant</h2>
//           <p className="text-gray-400 text-sm mb-2">
//             📅 Posted: October 5, 2025
//           </p>
//           <p className="text-gray-400 text-sm mb-6">
//             📍 Location: Riyadh, Saudi Arabia
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Job Summary:
//           </h3>
//           <p className="text-gray-300 mb-4">
//             The Accountant will be responsible for managing company finances,
//             preparing reports, and ensuring compliance with all financial
//             regulations. The role requires accuracy, attention to detail, and a
//             solid understanding of accounting principles.
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Responsibilities:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Prepare and maintain financial statements and balance sheets.
//             </li>
//             <li>Handle daily accounting operations and reconciliation.</li>
//             <li>
//               Monitor company expenses, budgets, and financial performance.
//             </li>
//             <li>Prepare VAT, Zakat, and other tax-related documents.</li>
//             <li>
//               Collaborate with external auditors and provide required
//               documentation.
//             </li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Requirements:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>Bachelor’s degree in Accounting or Finance.</li>
//             <li>
//               3+ years of accounting experience (preferably in logistics or
//               trading).
//             </li>
//             <li>Proficiency in MS Excel and accounting software.</li>
//             <li>Strong understanding of Saudi tax laws and regulations.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2">
//             <li>Competitive salary package.</li>
//             <li>Annual performance bonuses.</li>
//             <li>Health insurance and paid vacation.</li>
//             <li>Opportunities for professional growth.</li>
//           </ul>
//         </motion.div>

//         {/* ===== Operation Specialist ===== */}
//         <motion.div
//           variants={fadeUp}
//           initial="hidden"
//           whileInView="visible"
//           viewport={{ once: true }}
//           className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40"
//         >
//           <h2 className="text-2xl font-bold text-[#f37121] mb-4">
//             Operation Specialist
//           </h2>
//           <p className="text-gray-400 text-sm mb-2">
//             📅 Posted: October 8, 2025
//           </p>
//           <p className="text-gray-400 text-sm mb-6">
//             📍 Location: Dammam, Saudi Arabia
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Job Summary:
//           </h3>
//           <p className="text-gray-300 mb-4">
//             We are seeking a highly organized and proactive Operation Specialist
//             to manage daily logistics operations, ensure smooth shipment
//             processing, and coordinate between clients, customs, and
//             transportation teams.
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Responsibilities:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Oversee import and export operations across air, sea, and land.
//             </li>
//             <li>
//               Coordinate with customs clearance agents and transport providers.
//             </li>
//             <li>Track shipments and update clients on delivery status.</li>
//             <li>
//               Ensure compliance with company policies and Saudi regulations.
//             </li>
//             <li>Prepare daily operational reports for management.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Requirements:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Bachelor’s degree in Supply Chain, Business, or related field.
//             </li>
//             <li>2+ years of experience in logistics or operations.</li>
//             <li>Excellent communication and multitasking skills.</li>
//             <li>Proficiency in logistics software and MS Office.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2">
//             <li>Attractive salary and benefits package.</li>
//             <li>Supportive and dynamic work environment.</li>
//             <li>Career advancement opportunities.</li>
//           </ul>
//         </motion.div>
//       </div>

//       {/* ===================== APPLICATION FORM ===================== */}
//       <motion.div
//         variants={fadeUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="max-w-4xl mx-auto bg-gray-800 p-10 rounded-2xl shadow-lg"
//       >
//         <h2 className="text-2xl font-bold text-center text-[#f37121] mb-8">
//           Submit Your Application
//         </h2>

//         <form ref={form} onSubmit={handleSubmit} className="space-y-6">
//           <div className="grid md:grid-cols-2 gap-6">
//             <input
//               type="text"
//               name="fullName"
//               placeholder="Full Name"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="email"
//               name="email"
//               placeholder="Email Address"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="tel"
//               name="phone"
//               placeholder="Phone Number"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="text"
//               name="position"
//               placeholder="Position You're Applying For"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//           </div>

//           <textarea
//             name="message"
//             placeholder="Write a brief cover letter or message..."
//             rows={5}
//             required
//             className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//           ></textarea>

//           {/* 🔗 CV Link Field */}
//           <div>
//             <label className="block text-sm mb-2 text-gray-400">
//               CV Link (Google Drive, Dropbox, etc.)
//             </label>
//             <input
//               type="url"
//               name="cvLink"
//               placeholder="https://drive.google.com/your-cv-link"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//           </div>

//           <div className="text-center pt-4">
//             <button
//               type="submit"
//               disabled={loading}
//               className="px-6 py-2 bg-[#f37121] text-black rounded-xl font-semibold tracking-wide 
//                          hover:bg-[#d65d12] transition disabled:opacity-50"
//             >
//               {loading ? "Submitting..." : "Submit Application"}
//             </button>
//           </div>
//         </form>
//       </motion.div>

//       {/* ===================== FOOTER ===================== */}
//       <div className="text-center mt-16 text-gray-400 text-sm">
//         <p>
//           For inquiries, contact us at{" "}
//           <span className="text-[#f37121] font-semibold">
//             HR@energize-logistics.com
//           </span>
//         </p>
//       </div>
//     </section>
//   );
// }


// "use client";

// import React, { useRef, useState, FormEvent } from "react";
// import emailjs from "@emailjs/browser";

// export default function CareerPage() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     emailjs
//       .sendForm(
//         "service_v2cra3g", // ✅ Service ID من EmailJS
//         "template_b3t6ueb", // ✅ Template ID من EmailJS
//         form.current,
//         "hUIH-7NBh0vPFMSni" // ✅ Public Key من EmailJS
//       )
//       .then(
//         (result) => {
//           console.log("Application Sent:", result.text);
//           alert("✅ Your application has been submitted successfully!");
//           form.current?.reset();
//           setLoading(false);
//         },
//         (error) => {
//           console.error("Error:", error.text);
//           alert("❌ Failed to submit application, please try again later.");
//           setLoading(false);
//         }
//       );
//   };

//   return (
//     <section className="min-h-screen bg-gray-900 text-white py-16 px-6 md:px-20">
//       {/* ===================== HERO ===================== */}
//       <div className="text-center mb-16">
//         <h1 className="text-3xl md:text-2xl font-bold text-[#f37121] mb-4">
//           Join Our Team
//         </h1>
//         <p className="text-gray-300 max-w-3xl mx-auto">
//           At{" "}
//           <span className="text-[#f37121] font-semibold">
//             Energize Logistics
//           </span>
//           , we believe in innovation, dedication, and teamwork. Explore our open
//           positions below and become part of a team shaping the future of
//           logistics.
//         </p>
//       </div>

//       {/* ===================== JOB LISTINGS ===================== */}
//       <div className="max-w-5xl mx-auto space-y-12 mb-24">
//         {/* ===== Accountant ===== */}
//         <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40">
//           <h2 className="text-2xl font-bold text-[#f37121] mb-4">Accountant</h2>
//           <p className="text-gray-400 text-sm mb-2">
//             📅 Posted: October 5, 2025
//           </p>
//           <p className="text-gray-400 text-sm mb-6">
//             📍 Location: Riyadh, Saudi Arabia
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Job Summary:
//           </h3>
//           <p className="text-gray-300 mb-4">
//             The Accountant will be responsible for managing company finances,
//             preparing reports, and ensuring compliance with all financial
//             regulations. The role requires accuracy, attention to detail, and a
//             solid understanding of accounting principles.
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Responsibilities:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Prepare and maintain financial statements and balance sheets.
//             </li>
//             <li>Handle daily accounting operations and reconciliation.</li>
//             <li>
//               Monitor company expenses, budgets, and financial performance.
//             </li>
//             <li>Prepare VAT, Zakat, and other tax-related documents.</li>
//             <li>
//               Collaborate with external auditors and provide required
//               documentation.
//             </li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Requirements:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>Bachelor degree in Accounting or Finance.</li>
//             <li>
//               3+ years of accounting experience (preferably in logistics or
//               trading).
//             </li>
//             <li>Proficiency in MS Excel and accounting software.</li>
//             <li>Strong understanding of Saudi tax laws and regulations.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2">
//             <li>Competitive salary package.</li>
//             <li>Annual performance bonuses.</li>
//             <li>Health insurance and paid vacation.</li>
//             <li>Opportunities for professional growth.</li>
//           </ul>
//         </div>

//         {/* ===== Operation Specialist ===== */}
//         <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40">
//           <h2 className="text-2xl font-bold text-[#f37121] mb-4">
//             Operation Specialist
//           </h2>
//           <p className="text-gray-400 text-sm mb-2">
//             📅 Posted: October 8, 2025
//           </p>
//           <p className="text-gray-400 text-sm mb-6">
//             📍 Location: Dammam, Saudi Arabia
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Job Summary:
//           </h3>
//           <p className="text-gray-300 mb-4">
//             We are seeking a highly organized and proactive Operation Specialist
//             to manage daily logistics operations, ensure smooth shipment
//             processing, and coordinate between clients, customs, and
//             transportation teams.
//           </p>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Responsibilities:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Oversee import and export operations across air, sea, and land.
//             </li>
//             <li>
//               Coordinate with customs clearance agents and transport providers.
//             </li>
//             <li>Track shipments and update clients on delivery status.</li>
//             <li>
//               Ensure compliance with company policies and Saudi regulations.
//             </li>
//             <li>Prepare daily operational reports for management.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">
//             Requirements:
//           </h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
//             <li>
//               Bachelor degree in Supply Chain, Business, or related field.
//             </li>
//             <li>2+ years of experience in logistics or operations.</li>
//             <li>Excellent communication and multitasking skills.</li>
//             <li>Proficiency in logistics software and MS Office.</li>
//           </ul>

//           <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
//           <ul className="list-disc pl-6 text-gray-300 space-y-2">
//             <li>Attractive salary and benefits package.</li>
//             <li>Supportive and dynamic work environment.</li>
//             <li>Career advancement opportunities.</li>
//           </ul>
//         </div>
//       </div>

//       {/* ===================== APPLICATION FORM ===================== */}
//       <div className="max-w-4xl mx-auto bg-gray-800 p-10 rounded-2xl shadow-lg">
//         <h2 className="text-2xl font-bold text-center text-[#f37121] mb-8">
//           Submit Your Application
//         </h2>

//         <form ref={form} onSubmit={handleSubmit} className="space-y-6">
//           <div className="grid md:grid-cols-2 gap-6">
//             <input
//               type="text"
//               name="fullName"
//               placeholder="Full Name"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="email"
//               name="email"
//               placeholder="Email Address"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="tel"
//               name="phone"
//               placeholder="Phone Number"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//             <input
//               type="text"
//               name="position"
//               placeholder="Position You're Applying For"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//           </div>

//           <textarea
//             name="message"
//             placeholder="Write a brief cover letter or message..."
//             rows={5}
//             required
//             className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//           ></textarea>

//           {/* 🔗 CV Link Field */}
//           <div>
//             <label className="block text-sm mb-2 text-gray-400">
//               CV Link (Google Drive, Dropbox, etc.)
//             </label>
//             <input
//               type="url"
//               name="cvLink"
//               placeholder="https://drive.google.com/your-cv-link"
//               required
//               className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             />
//           </div>

//           <div className="text-center pt-4">
//             <button
//               type="submit"
//               disabled={loading}
//               className="px-6 py-2 bg-[#f37121] text-black rounded-xl font-semibold tracking-wide 
//                          hover:bg-[#d65d12] transition disabled:opacity-50"
//             >
//               {loading ? "Submitting..." : "Submit Application"}
//             </button>
//           </div>
//         </form>
//       </div>

//       {/* ===================== FOOTER ===================== */}
//       <div className="text-center mt-16 text-gray-400 text-sm">
//         <p>
//           For inquiries, contact us at{" "}
//           <span className="text-[#f37121] font-semibold">
//             HR@energize-logistics.com
//           </span>
//         </p>
//       </div>
//     </section>
//   );
// }


"use client";

import React, { useRef, useState, FormEvent } from "react";
import emailjs from "@emailjs/browser";

export default function CareerPage() {
  const form = useRef<HTMLFormElement | null>(null);
  const [loading, setLoading] = useState(false);
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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    if (!form.current) return;

    emailjs
      .sendForm(
        "service_v2cra3g", // ✅ Service ID من EmailJS
        "template_b3t6ueb", // ✅ Template ID من EmailJS
        form.current,
        "hUIH-7NBh0vPFMSni" // ✅ Public Key من EmailJS
      )
      .then(
        (result) => {
          console.log("Application Sent:", result.text);
          showToast("Your application has been submitted successfully!", "success");
          form.current?.reset();
          setLoading(false);
        },
        (error) => {
          console.error("Error:", error.text);
          showToast("Failed to submit application, please try again later.", "error");
          setLoading(false);
        }
      );
  };

  return (
    <section className="min-h-screen bg-gray-900 text-white py-16 px-6 md:px-20 relative">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-4 right-4 z-50 max-w-sm ${
          toast.type === "success" 
            ? "bg-green-600 border-green-500" 
            : "bg-red-600 border-red-500"
        } text-white px-6 py-3 rounded-xl shadow-2xl border transform transition-all duration-300 animate-fade-in`}>
          <div className="flex items-center gap-3">
            <span className="text-lg">
              {toast.type === "success" ? "✅" : "❌"}
            </span>
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      {/* ===================== HERO ===================== */}
      <div className="text-center mb-16">
        <h1 className="text-3xl md:text-2xl font-bold text-[#f37121] mb-4">
          Join Our Team
        </h1>
        <p className="text-gray-300 max-w-3xl mx-auto">
          At{" "}
          <span className="text-[#f37121] font-semibold">
            Energize Logistics
          </span>
          , we believe in innovation, dedication, and teamwork. Explore our open
          positions below and become part of a team shaping the future of
          logistics.
        </p>
      </div>

      {/* ===================== JOB LISTINGS ===================== */}
      <div className="max-w-5xl mx-auto space-y-12 mb-24">
        {/* ===== Accountant ===== */}
        <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40">
          <h2 className="text-2xl font-bold text-[#f37121] mb-4">Accountant</h2>
          <p className="text-gray-400 text-sm mb-2">
            📅 Posted: October 5, 2025
          </p>
          <p className="text-gray-400 text-sm mb-6">
            📍 Location: Riyadh, Saudi Arabia
          </p>

          <h3 className="text-lg font-semibold text-white mb-2">
            Job Summary:
          </h3>
          <p className="text-gray-300 mb-4">
            The Accountant will be responsible for managing company finances,
            preparing reports, and ensuring compliance with all financial
            regulations. The role requires accuracy, attention to detail, and a
            solid understanding of accounting principles.
          </p>

          <h3 className="text-lg font-semibold text-white mb-2">
            Responsibilities:
          </h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
            <li>
              Prepare and maintain financial statements and balance sheets.
            </li>
            <li>Handle daily accounting operations and reconciliation.</li>
            <li>
              Monitor company expenses, budgets, and financial performance.
            </li>
            <li>Prepare VAT, Zakat, and other tax-related documents.</li>
            <li>
              Collaborate with external auditors and provide required
              documentation.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-white mb-2">
            Requirements:
          </h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
            <li>Bachelor degree in Accounting or Finance.</li>
            <li>
              3+ years of accounting experience (preferably in logistics or
              trading).
            </li>
            <li>Proficiency in MS Excel and accounting software.</li>
            <li>Strong understanding of Saudi tax laws and regulations.</li>
          </ul>

          <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2">
            <li>Competitive salary package.</li>
            <li>Annual performance bonuses.</li>
            <li>Health insurance and paid vacation.</li>
            <li>Opportunities for professional growth.</li>
          </ul>
        </div>

        {/* ===== Operation Specialist ===== */}
        <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700/40">
          <h2 className="text-2xl font-bold text-[#f37121] mb-4">
            Operation Specialist
          </h2>
          <p className="text-gray-400 text-sm mb-2">
            📅 Posted: October 8, 2025
          </p>
          <p className="text-gray-400 text-sm mb-6">
            📍 Location: Dammam, Saudi Arabia
          </p>

          <h3 className="text-lg font-semibold text-white mb-2">
            Job Summary:
          </h3>
          <p className="text-gray-300 mb-4">
            We are seeking a highly organized and proactive Operation Specialist
            to manage daily logistics operations, ensure smooth shipment
            processing, and coordinate between clients, customs, and
            transportation teams.
          </p>

          <h3 className="text-lg font-semibold text-white mb-2">
            Responsibilities:
          </h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
            <li>
              Oversee import and export operations across air, sea, and land.
            </li>
            <li>
              Coordinate with customs clearance agents and transport providers.
            </li>
            <li>Track shipments and update clients on delivery status.</li>
            <li>
              Ensure compliance with company policies and Saudi regulations.
            </li>
            <li>Prepare daily operational reports for management.</li>
          </ul>

          <h3 className="text-lg font-semibold text-white mb-2">
            Requirements:
          </h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2 mb-4">
            <li>
              Bachelor degree in Supply Chain, Business, or related field.
            </li>
            <li>2+ years of experience in logistics or operations.</li>
            <li>Excellent communication and multitasking skills.</li>
            <li>Proficiency in logistics software and MS Office.</li>
          </ul>

          <h3 className="text-lg font-semibold text-white mb-2">Benefits:</h3>
          <ul className="list-disc pl-6 text-gray-300 space-y-2">
            <li>Attractive salary and benefits package.</li>
            <li>Supportive and dynamic work environment.</li>
            <li>Career advancement opportunities.</li>
          </ul>
        </div>
      </div>

      {/* ===================== APPLICATION FORM ===================== */}
      <div className="max-w-4xl mx-auto bg-gray-800 p-10 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-bold text-center text-[#f37121] mb-8">
          Submit Your Application
        </h2>

        <form ref={form} onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <input
              type="text"
              name="fullName"
              placeholder="Full Name"
              required
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            />
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              required
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            />
            <input
              type="tel"
              name="phone"
              placeholder="Phone Number"
              required
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            />
            <input
              type="text"
              name="position"
              placeholder="Position You're Applying For"
              required
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            />
          </div>

          <textarea
            name="message"
            placeholder="Write a brief cover letter or message..."
            rows={5}
            required
            className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
          ></textarea>

          {/* 🔗 CV Link Field */}
          <div>
            <label className="block text-sm mb-2 text-gray-400">
              CV Link (Google Drive, Dropbox, etc.)
            </label>
            <input
              type="url"
              name="cvLink"
              placeholder="https://drive.google.com/your-cv-link"
              required
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            />
          </div>

          <div className="text-center pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-[#f37121] text-black rounded-xl font-semibold tracking-wide hover:bg-[#d65d12] transition-all duration-300 disabled:opacity-50 min-w-[160px]"
            >
              {loading ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        </form>
      </div>

      {/* ===================== FOOTER ===================== */}
      <div className="text-center mt-16 text-gray-400 text-sm">
        <p>
          For inquiries, contact us at{" "}
          <span className="text-[#f37121] font-semibold">
            HR@energize-logistics.com
          </span>
        </p>
      </div>

      <style jsx>{`
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