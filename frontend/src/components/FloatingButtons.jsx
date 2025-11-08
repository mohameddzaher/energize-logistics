'use client'

import { useState, useEffect } from 'react'
import { FaWhatsapp, FaArrowUp } from 'react-icons/fa'

export default function FloatingButtons() {
  const [showScroll, setShowScroll] = useState(false)

  // لما المستخدم ينزل تحت، نعرض زر ↑
  useEffect(() => {
    const handleScroll = () => {
      setShowScroll(window.scrollY > 300)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // وظيفة الزر ↑ للعودة لأعلى الصفحة
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2.5 z-50">
      {/* زر واتساب */}
      <a
        href="https://wa.me/+966540958433"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-green-500 hover:bg-green-600 text-white p-2.5 rounded-full shadow-md transition-transform hover:scale-110"
      >
        <FaWhatsapp className="text-xl" />
      </a>

      {/* زر العودة للأعلى */}
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