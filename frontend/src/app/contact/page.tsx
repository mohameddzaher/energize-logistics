// "use client";

// import { motion } from "framer-motion";
// import React, { useRef, useState, FormEvent } from "react";
// import emailjs from "@emailjs/browser";
// import type { Variants } from "framer-motion";

// // Animation
// const fadeInUp: Variants = {
//   hidden: { opacity: 0, y: 40 },
//   visible: {
//     opacity: 1,
//     y: 0,
//     transition: {
//       duration: 0.8,
//       ease: [0.25, 0.1, 0.25, 1],
//     },
//   },
// };

// export default function ContactPage() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     try {
//       const result = await emailjs.sendForm(
//         "service_v2cra3g", // ✅ Service ID
//         "template_546bsdh", // ✅ Template ID
//         form.current,
//         "hUIH-7NBh0vPFMSni" // ✅ Public Key
//       );

//       console.log("✅ Message sent:", result.text);
//       alert("✅ Your message has been sent successfully!");
//       form.current.reset();
//     } catch (error: any) {
//       console.error("❌ Error sending message:", error.text || error);
//       alert("❌ Failed to send message. Please try again.");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <section className="bg-gray-900 text-center text-white px-4 md:px-20 py-16">
//       <h3 className="text-3xl font-bold text-[#f37121] mb-3">Stay In Touch</h3>
//       <p className="text-gray-300 text-sm md:text-base mb-8">
//         Contact us via the form, email at{" "}
//         <span className="text-[#f37121] font-semibold">
//           Info@energize-logistics.com
//         </span>{" "}
//         or call{" "}
//         <a
//           href="tel:+966540958433"
//           className="text-[#f37121] font-semibold hover:underline"
//         >
//           +966 54 095 8433
//         </a>
//       </p>

//       <form
//         ref={form}
//         onSubmit={handleSubmit}
//         className="flex flex-col items-center space-y-6"
//       >
//         <div className="flex flex-wrap justify-center gap-6 w-full">
//           <input
//             type="text"
//             name="fullName"
//             placeholder="Your Full Name"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="text"
//             name="companyName"
//             placeholder="Your Company Name"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="email"
//             name="email"
//             placeholder="Your Email Address"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="tel"
//             name="phone"
//             placeholder="Your Phone Number"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//         </div>

//         <textarea
//           name="message"
//           placeholder="Enter Your Message"
//           rows={5}
//           className="w-full md:w-[83%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//           required
//         ></textarea>

//         <button
//           type="submit"
//           disabled={loading}
//           className="text-[#f37121] px-10 py-2 rounded-xl bg-gray-800 text-sm tracking-widest transition-all duration-300 hover:bg-[#f37121] hover:text-black disabled:opacity-50"
//         >
//           {loading ? "Sending..." : "Send"}
//         </button>
//       </form>

//       {/* --- Google Map Section --- */}
//       <motion.section
//         variants={fadeInUp}
//         initial="hidden"
//         whileInView="visible"
//         viewport={{ once: true }}
//         className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 mt-20 flex justify-center items-center"
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

//      AFTER DELETED MOTION

// "use client";

// import React, { useRef, useState, FormEvent } from "react";
// import emailjs from "@emailjs/browser";

// export default function ContactPage() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     try {
//       const result = await emailjs.sendForm(
//         "service_v2cra3g", // ✅ Service ID
//         "template_546bsdh", // ✅ Template ID
//         form.current,
//         "hUIH-7NBh0vPFMSni" // ✅ Public Key
//       );

//       console.log("✅ Message sent:", result.text);
//       alert("✅ Your message has been sent successfully!");
//       form.current.reset();
//     } catch (error: any) {
//       console.error("❌ Error sending message:", error.text || error);
//       alert("❌ Failed to send message. Please try again.");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <section className="bg-gray-900 text-center text-white px-4 md:px-20 py-16">
//       <h3 className="text-3xl font-bold text-[#f37121] mb-3">Stay In Touch</h3>
//       <p className="text-gray-300 text-sm md:text-base mb-8">
//         Contact us via the form, email at{" "}
//         <span className="text-[#f37121] font-semibold">
//           Info@energize-logistics.com
//         </span>{" "}
//         or call{" "}
//         <a
//           href="tel:+966540958433"
//           className="text-[#f37121] font-semibold hover:underline"
//         >
//           +966 54 095 8433
//         </a>
//       </p>

//       <form
//         ref={form}
//         onSubmit={handleSubmit}
//         className="flex flex-col items-center space-y-6"
//       >
//         <div className="flex flex-wrap justify-center gap-6 w-full">
//           <input
//             type="text"
//             name="fullName"
//             placeholder="Your Full Name"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="text"
//             name="companyName"
//             placeholder="Your Company Name"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="email"
//             name="email"
//             placeholder="Your Email Address"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//           <input
//             type="tel"
//             name="phone"
//             placeholder="Your Phone Number"
//             className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           />
//         </div>

//         <textarea
//           name="message"
//           placeholder="Enter Your Message"
//           rows={5}
//           className="w-full md:w-[83%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//           required
//         ></textarea>

//         <button
//           type="submit"
//           disabled={loading}
//           className="text-[#f37121] px-10 py-2 rounded-xl bg-gray-800 text-sm tracking-widest transition-all duration-300 hover:bg-[#f37121] hover:text-black disabled:opacity-50"
//         >
//           {loading ? "Sending..." : "Send"}
//         </button>
//       </form>

//       {/* --- Google Map Section --- */}
//       <section className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 mt-20 flex justify-center items-center">
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
//       </section>
//     </section>
//   );
// }

//    AFTER ADDED TOAST NOTIFICATION

"use client";

import React, { useRef, useState, FormEvent } from "react";
import emailjs from "@emailjs/browser";

export default function ContactPage() {
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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    if (!form.current) return;

    try {
      const result = await emailjs.sendForm(
        "service_v2cra3g", // ✅ Service ID
        "template_546bsdh", // ✅ Template ID
        form.current,
        "hUIH-7NBh0vPFMSni" // ✅ Public Key
      );

      console.log("✅ Message sent:", result.text);
      showToast("Your message has been sent successfully!", "success");
      form.current.reset();
    } catch (error: any) {
      console.error("❌ Error sending message:", error.text || error);
      showToast("Failed to send message. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-gray-900 text-center text-white px-4 md:px-20 py-16 relative">
      {/* Toast Notification */}
      {toast.show && (
        <div
          className={`fixed top-4 right-4 z-50 max-w-sm ${
            toast.type === "success"
              ? "bg-green-600 border-green-500"
              : "bg-red-600 border-red-500"
          } text-white px-6 py-3 rounded-xl shadow-2xl border transform transition-all duration-300 animate-fade-in`}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">
              {toast.type === "success" ? "✅" : "❌"}
            </span>
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      <h3 className="text-3xl font-bold text-[#f37121] mb-3">Stay In Touch</h3>
      <p className="text-gray-300 text-sm md:text-base mb-8">
        Contact us via the form, email at{" "}
        <span className="text-[#f37121] font-semibold">
          Info@energize-logistics.com
        </span>{" "}
        or call{" "}
        <a
          href="tel:+966540958433"
          className="text-[#f37121] font-semibold hover:underline"
        >
          +966 54 095 8433
        </a>
      </p>

      <form
        ref={form}
        onSubmit={handleSubmit}
        className="flex flex-col items-center space-y-6"
      >
        <div className="flex flex-wrap justify-center gap-6 w-full">
          <input
            type="text"
            name="fullName"
            placeholder="Your Full Name"
            className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            required
          />
          <input
            type="text"
            name="companyName"
            placeholder="Your Company Name"
            className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            required
          />
          <input
            type="email"
            name="email"
            placeholder="Your Email Address"
            className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            required
          />
          <input
            type="tel"
            name="phone"
            placeholder="Your Phone Number"
            className="w-full md:w-[40%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            required
          />
        </div>

        <textarea
          name="message"
          placeholder="Enter Your Message"
          rows={5}
          className="w-full md:w-[83%] rounded-xl bg-gray-800 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
          required
        ></textarea>

        <button
          type="submit"
          disabled={loading}
          className="text-[#f37121] px-10 py-2 rounded-xl bg-gray-800 text-sm tracking-widest transition-all duration-300 hover:bg-[#f37121] hover:text-black disabled:opacity-50 font-semibold"
        >
          {loading ? "Sending..." : "Send Message"}
        </button>
      </form>

      {/* --- Google Map Section --- */}
      <section className="relative w-full bg-gradient-to-b from-gray-900 to-gray-900 py-16 mt-20 flex justify-center items-center">
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
