
"use client";

import React from "react";
import Link from "next/link";
import { FaFacebook, FaInstagram, FaLinkedin } from "react-icons/fa";
import Image from "next/image";

interface FooterItem {
  name: string;
  link: string;
  target?: string;
  rel?: string;
}

interface FooterListProps {
  title: string;
  items: FooterItem[];
}

const FooterList: React.FC<FooterListProps> = ({ title, items }) => {
  return (
    <div className="flex flex-col text-center md:text-left">
      <h5 className="mb-3 text-lg font-bold text-[#f37121]">{title}</h5>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index}>
            {item.link.startsWith("/") ? (
              <Link
                href={item.link}
                className="text-sm text-white hover:text-[#f37121] transition duration-300"
              >
                {item.name}
              </Link>
            ) : (
              <a
                href={item.link}
                target={item.target || "_self"}
                rel={item.rel || "noopener noreferrer"}
                className="text-sm text-white hover:text-[#f37121] transition duration-300"
              >
                {item.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const Footer: React.FC = () => {
  const infoItems: FooterItem[] = [
    { name: "About Us", link: "/about" },
    { name: "Services", link: "/services" },
    { name: "Careers", link: "/career" },
    { name: "Contact", link: "/contact" },
  ];

  const branchItems: FooterItem[] = [
    { name: "Riyadh: +966 54 095 8433", link: "tel:+966540958433" },
    { name: "Jeddah: +966 50 234 5678", link: "tel:+966502345678" },
    { name: "Dammam: +966 50 345 6789", link: "tel:+966503456789" },
    { name: "Abha: +966 50 456 7890", link: "tel:+966504567890" },
  ];

  const emailItems: FooterItem[] = [
    {
      name: "info@energize-logistics.com",
      link: "mailto:info@energize-logistics.com",
    },
    { name: "hr@energize-logistics.com", link: "mailto:hr@energize-logistics.com" },
    {
      name: "sales@energize-logistics.com",
      link: "mailto:sales@energize-logistics.com",
    },
  ];

  const socialItems: FooterItem[] = [
    {
      name: "Facebook",
      link: "https://www.facebook.com/energizelco",
      target: "_blank",
    },
    {
      name: "Instagram",
      link: "https://www.instagram.com/energizelco/",
      target: "_blank",
    },
    {
      name: "LinkedIn",
      link: "https://www.linkedin.com/company/energizelco",
      target: "_blank",
    },
  ];

  return (
<footer className="text-white bg-gray-900 pt-16 pb-6 border-t  border-gray-600/40">      <div className="max-w-7xl mx-auto px-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 mb-12 place-items-center items-start whitespace-pre-line">
          {/* --- Logo + Social --- */}
          <div className="flex flex-col items-center gap-4 text-center">
            <Image
              src="/images/Asset 3.png"
              alt="Energize Logistics Logo"
              width={160}
              height={60}
              className="h-10 w-auto"
            />
            <p className="text-gray-400 text-sm max-w-[220px] leading-relaxed">
              Powering Logistics Forward - across the Middle East & Africa.
            </p>
            <div className="flex gap-5 mt-2">
              {socialItems.map((social, index) => (
                <a
                  key={index}
                  href={social.link}
                  target={social.target}
                  rel="noopener noreferrer"
                  className="text-white hover:text-[#f37121] transition-all duration-300"
                >
                  {social.name === "Facebook" && (
                    <FaFacebook className="text-xl" />
                  )}
                  {social.name === "Instagram" && (
                    <FaInstagram className="text-xl" />
                  )}
                  {social.name === "LinkedIn" && (
                    <FaLinkedin className="text-xl" />
                  )}
                </a>
              ))}
            </div>
          </div>

          {/* --- Company Info --- */}
          <FooterList title="Company" items={infoItems} />

          {/* --- Branches --- */}
          <FooterList title="Our Branches" items={branchItems} />

          {/* --- Contact & Emails --- */}
          <FooterList title="Get in Touch" items={emailItems} />
        </section>

        <div className="text-center text-white text-sm mt-8 border-t border-gray-700 pt-6">
          © {new Date().getFullYear()}{" "}
          <span className="text-[#f37121] font-semibold">Energize Logistics</span>.  
          All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;