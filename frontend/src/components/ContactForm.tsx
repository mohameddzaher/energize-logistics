// 'use client'

// import React, { useRef, useState, FormEvent } from 'react'
// import emailjs from '@emailjs/browser'

// export default function ContactForm() {
//   const form = useRef<HTMLFormElement | null>(null)
//   const [loading, setLoading] = useState(false)

//   const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
//     e.preventDefault()
//     setLoading(true)

//     if (!form.current) return

//     try {
//       const result = await emailjs.sendForm(
//         'service_v2cra3g',
//         'template_546bsdh',
//         form.current,
//         'hUIH-7NBh0vPFMSni'
//       )

//       console.log('✅ Message sent:', result.text)
//       alert('✅ Your message has been sent successfully!')
//       form.current.reset()
//     } catch (error: any) {
//       console.error('❌ Error sending message:', error.text || error)
//       alert('❌ Failed to send message. Please try again.')
//     } finally {
//       setLoading(false)
//     }
//   }

//   return (
//     <section className="relative bg-gray-900 text-center px-4 md:px-20 overflow-hidden">
//       {/* 🔸 اللمسة البرتقالية الناعمة (من الشمال فوق) */}
//       <div className="absolute top-[-80px] left-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
//       {/* 🔹 اللمسة الرمادية (من اليمين تحت) */}
//       <div className="absolute bottom-[-80px] right-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

//       <div className="relative z-10">
//         <h3 className="pt-16 text-2xl font-bold text-white">Stay In Touch</h3>
//         <p className="text-gray-300 mt-2">
//           Contact us via the form, email at{' '}
//           <span className="text-[#f37121] font-semibold">
//             info@energize-logistics.com
//           </span>, or call{' '}
//           <a
//             href="tel:+966540958433"
//             className="text-[#f37121] font-semibold hover:underline"
//           >
//             +966 54 095 8433
//           </a>
//         </p>

//         <form
//           ref={form}
//           onSubmit={handleSubmit}
//           className="mt-12 flex flex-col text-white pb-16 items-center space-y-6"
//         >
//           <div className="flex flex-wrap justify-center gap-6 w-full">
//             <input
//               type="text"
//               name="fullName"
//               placeholder="Your Full Name"
//               className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//               required
//             />
//             <input
//               type="text"
//               name="companyName"
//               placeholder="Your Company Name"
//               className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//               required
//             />
//             <input
//               type="email"
//               name="email"
//               placeholder="Your E-mail Address"
//               className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//               required
//             />
//             <input
//               type="tel"
//               name="phone"
//               placeholder="Your Phone Number"
//               className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//               required
//             />
//           </div>

//           <textarea
//             name="message"
//             placeholder="Enter Your Message"
//             rows={5}
//             className="w-full bg-gray-800 md:w-[83%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]"
//             required
//           ></textarea>

//           <button
//             type="submit"
//             disabled={loading}
//             className="bg-gray-800 text-white px-12 py-2 rounded-xl text-sm tracking-widest transition-all duration-300 
//                        hover:bg-[#f37121] hover:text-black disabled:opacity-50"
//           >
//             {loading ? 'Sending...' : 'Send'}
//           </button>
//         </form>
//       </div>
//     </section>
//   )
// }

'use client'

import React, { useRef, useState, FormEvent } from 'react'
import emailjs from '@emailjs/browser'

export default function ContactForm() {
  const form = useRef<HTMLFormElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error";
  }>({
    show: false,
    message: "",
    type: "success",
  })

  const showToast = (message: string, type: "success" | "error") => {
    setToast({
      show: true,
      message,
      type,
    })
    
    // إخفاء التوست بعد 4 ثواني
    setTimeout(() => {
      setToast({
        show: false,
        message: "",
        type: "success",
      })
    }, 4000)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    if (!form.current) return

    try {
      const result = await emailjs.sendForm(
        'service_v2cra3g',
        'template_546bsdh',
        form.current,
        'hUIH-7NBh0vPFMSni'
      )

      console.log('✅ Message sent:', result.text)
      showToast('Your message has been sent successfully!', 'success')
      form.current.reset()
    } catch (error: any) {
      console.error('❌ Error sending message:', error.text || error)
      showToast('Failed to send message. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="relative bg-gray-900 text-center px-4 md:px-20 overflow-hidden">
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

      {/* 🔸 اللمسة البرتقالية الناعمة (من الشمال فوق) */}
      <div className="absolute top-[-80px] left-[-80px] w-[250px] h-[250px] bg-[#f37121]/20 blur-[90px] rounded-full" />
      {/* 🔹 اللمسة الرمادية (من اليمين تحت) */}
      <div className="absolute bottom-[-80px] right-[-80px] w-[250px] h-[250px] bg-gray-600/20 blur-[90px] rounded-full" />

      <div className="relative z-10">
        <h3 className="pt-16 text-2xl font-bold text-white">Stay In Touch</h3>
        <p className="text-gray-300 mt-2">
          Contact us via the form, email at{' '}
          <span className="text-[#f37121] font-semibold">
            info@energize-logistics.com
          </span>, or call{' '}
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
          className="mt-12 flex flex-col text-white pb-16 items-center space-y-6"
        >
          <div className="flex flex-wrap justify-center gap-6 w-full">
            <input
              type="text"
              name="fullName"
              placeholder="Your Full Name"
              className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
              required
            />
            <input
              type="text"
              name="companyName"
              placeholder="Your Company Name"
              className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
              required
            />
            <input
              type="email"
              name="email"
              placeholder="Your E-mail Address"
              className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
              required
            />
            <input
              type="tel"
              name="phone"
              placeholder="Your Phone Number"
              className="w-full bg-gray-800 md:w-[40%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
              required
            />
          </div>

          <textarea
            name="message"
            placeholder="Enter Your Message"
            rows={5}
            className="w-full bg-gray-800 md:w-[83%] rounded-xl shadow-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121] transition-all duration-200"
            required
          ></textarea>

          <button
            type="submit"
            disabled={loading}
            className="bg-gray-800 text-white px-12 py-2 rounded-xl text-sm tracking-widest transition-all duration-300 hover:bg-[#f37121] hover:text-black disabled:opacity-50 font-semibold min-w-[120px]"
          >
            {loading ? 'Sending...' : 'Send Message'}
          </button>
        </form>
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
  )
}