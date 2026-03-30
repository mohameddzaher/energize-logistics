"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FaFacebook, FaInstagram, FaLinkedin, FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import { useAuth } from "@/context/AuthContext";

export default function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, user } = useAuth();

  const links = [
    { href: "/", label: "Home" },
    { href: "/about", label: "About us" },
    { href: "/services", label: "Services" },
    { href: "/gallery", label: "Gallery" },
    { href: "/clients", label: "Clients" },
    { href: "/contact", label: "Contact" },
    { href: "/career", label: "Career" },
  ];

  const handlePortalClick = () => {
    setOpen(false);
    if (isAuthenticated) {
      const route = user?.role === 'client' ? '/system/portal' : '/system/dashboard';
      router.push(route);
    } else {
      router.push('/login?returnTo=/system/dashboard');
    }
  };

  const socialLinks = [
    {
      href: "https://www.linkedin.com/company/energizelco",
      icon: <FaLinkedin />,
      color: "text-[#0077b5]",
    },
    {
      href: "https://x.com/energizelco",
      icon: <FaXTwitter />,
      color: "text-black",
    },
    {
      href: "https://www.instagram.com/energizelco/",
      icon: <FaInstagram />,
      color: "text-[#E4405F]",
    },
    {
      href: "https://www.youtube.com/@energizelco",
      icon: <FaYoutube />,
      color: "text-[#FF0000]",
    },
    {
      href: "https://www.facebook.com/energizelco",
      icon: <FaFacebook />,
      color: "text-[#1877F2]",
    },
  ];

  const isActiveLink = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Hide header on system pages (system has its own layout)
  if (pathname.startsWith("/system")) return null;

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* --- Top Bar --- */}
      <div className="w-full py-2 bg-gray-800 text-white flex justify-center items-center text-xs font-light tracking-wide shadow-sm">
        <h6 className="text-center font-bold whitespace-nowrap">
          Energize Your Logistics.
        </h6>
      </div>

      {/* --- Navbar --- */}
      <div className="w-full bg-white backdrop-blur-md shadow-xl">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* --- Logo --- */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <Image
              src="/images/logoo.png"
              alt="Energize Logistics Logo"
              width={120}
              height={28}
              className="h-7 w-auto"
              priority
            />
          </Link>

          {/* --- Desktop Navigation --- */}
          <div className="hidden md:flex items-center gap-8">
            <nav className="flex items-center gap-5 text-sm font-bold text-gray-800">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`transition-all duration-200 ${
                    isActiveLink(link.href)
                      ? "text-[#f37121] font-bold"
                      : "text-gray-800 hover:text-[#f37121]"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={handlePortalClick}
                className="ml-1 px-3 py-1.5 rounded-md bg-[#f37121] text-white text-xs font-bold hover:bg-[#e06010] transition-all duration-200"
              >
                Collections Portal
              </button>
            </nav>
          </div>

          {/* --- Social Icons --- */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            {socialLinks.map((social, index) => (
              <a
                key={index}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${social.color} hover:opacity-80 transition-opacity duration-300 text-lg`}
              >
                {social.icon}
              </a>
            ))}
          </div>

          {/* --- Mobile Menu Button --- */}
          <div className="md:hidden">
            <button
              onClick={() => setOpen(!open)}
              className="p-2 rounded-md border border-gray-300 hover:border-[#f37121] hover:bg-[#f37121] hover:text-white transition-all duration-300"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* --- Mobile Menu --- */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="md:hidden bg-gradient-to-b from-gray-900 to-gray-800 border-t border-gray-700 shadow-2xl"
          >
            <div className="p-3 space-y-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block py-2 px-3 rounded text-sm font-medium transition-all duration-200 border text-center ${
                    isActiveLink(link.href)
                      ? "bg-[#f37121] text-white border-[#f37121] font-bold"
                      : "bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700 hover:text-[#f37121] hover:border-[#f37121]/50"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}

              {/* Collections Portal - Mobile */}
              <button
                onClick={handlePortalClick}
                className="block w-full py-2 px-3 rounded text-sm font-bold transition-all duration-200 border text-center bg-[#f37121] text-white border-[#f37121] hover:bg-[#e06010]"
              >
                Collections Portal
              </button>

              {/* Social Icons */}
              <div className="flex gap-2 justify-center mt-2 pt-2 border-t border-gray-700">
                {socialLinks.map((social, index) => (
                  <a
                    key={index}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${social.color} bg-gray-700 hover:bg-[#f37121] hover:text-white p-1.5 rounded transition-all duration-200 text-sm`}
                    onClick={() => setOpen(false)}
                  >
                    {social.icon}
                  </a>
                ))}
              </div>

              <button
                onClick={() => setOpen(false)}
                className="w-full mt-2 py-1.5 bg-gray-700 hover:bg-[#f37121] text-white rounded font-medium transition-all duration-200 text-xs"
              >
                Close
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
