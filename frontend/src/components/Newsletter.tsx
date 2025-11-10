// "use client";

// import React, { useRef, useState } from "react";
// import emailjs from "@emailjs/browser";

// export default function Newsletter() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     emailjs
//       .sendForm(
//         "service_gl3kypn",
//         "template_l78no3c",
//         form.current,
//         "qxwOsIvUcT67V-62A"
//       )
//       .then(
//         () => {
//           alert("✅ Thank you for subscribing!");
//           form.current?.reset();
//           setLoading(false);
//         },
//         (error) => {
//           console.error("Error:", error.text);
//           alert("❌ Something went wrong, please try again later.");
//           setLoading(false);
//         }
//       );
//   };

//   return (
//     <section className="relative bg-gray-900 text-white py-14 px-6 md:px-16 text-center overflow-hidden">
//       {/* 🔸 اللمسة البرتقالية الناعمة */}
//       <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
//       <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

//       <div className="relative z-10">
//         <h2 className="text-2xl md:text-3xl font-bold text-[#f37121] mb-3">
//           Stay Updated
//         </h2>
//         <p className="text-gray-400 max-w-xl mx-auto mb-7 text-sm md:text-base leading-relaxed">
//           Subscribe to our newsletter and stay updated with the latest news,
//           insights, and innovations in logistics.
//         </p>

//         <form
//           ref={form}
//           onSubmit={handleSubmit}
//           className="flex flex-col md:flex-row gap-3 justify-center items-center max-w-md mx-auto"
//         >
//           <input
//             type="email"
//             name="subscriberEmail"
//             placeholder="Enter your email"
//             required
//             className="p-2.5 w-full md:w-72 rounded-lg bg-gray-800/70 border border-gray-700/60 text-sm text-gray-200
//                        placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/60 transition-all duration-200"
//           />
//           <button
//             type="submit"
//             disabled={loading}
//             className="px-5 py-2.5 border border-[#f37121]/70 text-[#f37121] rounded-lg font-medium
//                        hover:bg-[#f37121] hover:text-black transition-all duration-300 disabled:opacity-50 text-sm"
//           >
//             {loading ? "Submitting..." : "Subscribe"}
//           </button>
//         </form>

//         <p className="text-xs text-gray-500 mt-5">
//           We respect your privacy. Unsubscribe anytime.
//         </p>
//       </div>
//     </section>
//   );
// }

// "use client";

// import React, { useRef, useState } from "react";
// import emailjs from "@emailjs/browser";

// export default function Newsletter() {
//   const form = useRef<HTMLFormElement | null>(null);
//   const [loading, setLoading] = useState(false);

//   const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
//     e.preventDefault();
//     setLoading(true);

//     if (!form.current) return;

//     emailjs
//       .sendForm(
//         "service_gl3kypn",
//         "template_l78no3c",
//         form.current,
//         "qxwOsIvUcT67V-62A"
//       )
//       .then(
//         () => {
//           alert("✅ Thank you for subscribing!");
//           form.current?.reset();
//           setLoading(false);
//         },
//         (error) => {
//           console.error("Error:", error.text);
//           alert("❌ Something went wrong, please try again later.");
//           setLoading(false);
//         }
//       );
//   };

//   return (
//     <section className="relative bg-gray-900 text-white py-14 px-6 md:px-16 text-center overflow-hidden">
//       {/* 🔸 اللمسة البرتقالية الناعمة */}
//       <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
//       <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

//       <div className="relative z-10">
//         <h2 className="text-2xl md:text-3xl font-bold text-[#f37121] mb-3">
//           Stay Updated
//         </h2>
//         <p className="text-gray-400 max-w-xl mx-auto mb-7 text-sm md:text-base leading-relaxed">
//           Subscribe to our newsletter and stay updated with the latest news,
//           insights, and innovations in logistics.
//         </p>

//         <form
//           ref={form}
//           onSubmit={handleSubmit}
//           className="flex flex-col md:flex-row gap-3 justify-center items-center max-w-md mx-auto"
//         >
//           <input
//             type="email"
//             name="subscriberEmail"
//             placeholder="Enter your email"
//             required
//             className="p-2.5 w-full md:w-72 rounded-lg bg-gray-800/70 border border-gray-700/60 text-sm text-gray-200
//                        placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/60 transition-all duration-200"
//           />
//           <button
//             type="submit"
//             disabled={loading}
//             className="px-5 py-2.5 border border-[#f37121]/70 text-[#f37121] rounded-lg font-medium
//                        hover:bg-[#f37121] hover:text-black transition-all duration-300 disabled:opacity-50 text-sm"
//           >
//             {loading ? "Submitting..." : "Subscribe"}
//           </button>
//         </form>

//         <p className="text-xs text-gray-500 mt-5">
//           We respect your privacy. Unsubscribe anytime.
//         </p>
//       </div>
//     </section>
//   );
// }

"use client";

import React, { useRef, useState } from "react";
import emailjs from "@emailjs/browser";

export default function Newsletter() {
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    if (!form.current) return;

    emailjs
      .sendForm(
        "service_gl3kypn",
        "template_l78no3c",
        form.current,
        "qxwOsIvUcT67V-62A"
      )
      .then(
        () => {
          showToast("Thank you for subscribing!", "success");
          form.current?.reset();
          setLoading(false);
        },
        (error) => {
          console.error("Error:", error.text);
          showToast("Something went wrong, please try again later.", "error");
          setLoading(false);
        }
      );
  };

  return (
    <section className="relative bg-gray-900 text-white py-14 px-6 md:px-16 text-center overflow-hidden">
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

      {/* 🔸 اللمسة البرتقالية الناعمة */}
      <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
      <div className="absolute bottom-[-80px] left-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

      <div className="relative z-10">
        <h2 className="text-2xl md:text-3xl font-bold text-[#f37121] mb-3">
          Stay Updated
        </h2>
        <p className="text-gray-400 max-w-xl mx-auto mb-7 text-sm md:text-base leading-relaxed">
          Subscribe to our newsletter and stay updated with the latest news,
          insights, and innovations in logistics.
        </p>

        <form
          ref={form}
          onSubmit={handleSubmit}
          className="flex flex-col md:flex-row gap-3 justify-center items-center max-w-md mx-auto"
        >
          <input
            type="email"
            name="subscriberEmail"
            placeholder="Enter your email"
            required
            className="p-2.5 w-full md:w-72 rounded-lg bg-gray-800/70 border border-gray-700/60 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/60 transition-all duration-200"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 border border-[#f37121]/70 text-[#f37121] rounded-lg font-medium hover:bg-[#f37121] hover:text-black transition-all duration-300 disabled:opacity-50 text-sm min-w-[120px]"
          >
            {loading ? "Submitting..." : "Subscribe"}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-5">
          We respect your privacy. Unsubscribe anytime.
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