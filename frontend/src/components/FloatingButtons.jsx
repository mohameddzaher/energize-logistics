'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { FaWhatsapp, FaArrowUp } from 'react-icons/fa'

// WhatsApp button for visitors only; hidden on the login page and inside the system.
const APP_PATHS = ['/system', '/login']

export default function FloatingButtons() {
  const pathname = usePathname() || ''
  const [showScroll, setShowScroll] = useState(false)

  // Show the scroll-up button once the user scrolls down.
  useEffect(() => {
    const handleScroll = () => {
      setShowScroll(window.scrollY > 300)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Scroll-to-top button handler.
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null

  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2.5 z-50">
      {/* WhatsApp button. */}
      <a
        href="https://wa.me/+966540958433"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-green-500 hover:bg-green-600 text-white p-2.5 rounded-full shadow-md transition-transform hover:scale-110"
      >
        <FaWhatsapp className="text-xl" />
      </a>

      {/* Scroll-to-top button. */}
      {/* {showScroll && (
        <button
          onClick={scrollToTop}
          className="bg-gray-700 hover:bg-gray-600 text-white p-2.5 rounded-full shadow-md transition-transform hover:scale-110"
        >
          <FaArrowUp className="text-xl" />
        </button>
      )} */}
    </div>
  )
}