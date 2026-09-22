"use client";

/**
 * اليوم الوطني السعودي ٩٦ — ٢٣ سبتمبر ٢٠٢٦، وهويّتُه «عِزّنا بطبعنا».
 *
 * قسمٌ موسميٌّ في الصفحة الرئيسية: أخضرُ المناسبة لونُه الأوّل، والبرتقاليُّ
 * لونُ الشركة لمسةً فيه، على خلفيّة الموقع الداكنة. ويختفي وحدَه بعد انقضاء
 * المناسبة (HIDE_AFTER) فلا يبقى إعلانٌ عن عيدٍ مضى إن نُسي حذفُه.
 */
import { useEffect, useState } from "react";
import Image from "next/image";

const HIDE_AFTER = new Date("2026-10-01T00:00:00+03:00");

export default function NationalDaySection() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Date.now() >= HIDE_AFTER.getTime()) setVisible(false);
  }, []);
  if (!visible) return null;

  return (
    <section className="relative overflow-hidden bg-[#06261a] text-white">
      {/* the woven banner as the backdrop */}
      <Image
        src="/images/snd-2026-banner.jpg"
        alt="Saudi National Day 96 — عزنا بطبعنا"
        fill
        sizes="100vw"
        className="object-cover opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#041a12]/95 via-[#06261a]/80 to-[#041a12]/60" />
      {/* sadu-style stitched edges */}
      <div className="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(90deg,#1f8a4c_0_14px,#0b3d24_14px_28px)]" />
      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-[repeating-linear-gradient(90deg,#1f8a4c_0_14px,#0b3d24_14px_28px)]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 md:py-20 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#2fa865]/40 bg-[#2fa865]/10 px-4 py-1.5 text-sm font-semibold text-[#7fe0a8]">
            <span className="h-2 w-2 rounded-full bg-[#2fa865]" />
            23 September 2026 · ٢٣ سبتمبر
          </div>

          <h2 className="mt-5 text-3xl font-extrabold leading-tight md:text-5xl">
            Happy <span className="text-[#f37121]">96th</span> Saudi National Day
          </h2>

          <p dir="rtl" className="mt-4 text-left text-2xl font-bold text-[#7fe0a8] md:text-3xl">
            عِزّنا بطبعنا
          </p>
          <p dir="rtl" className="mt-1 text-left text-lg text-white/85">
            كل عام والمملكة بخير — اليوم الوطني السعودي ٩٦
          </p>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 md:text-lg">
            On the Kingdom&apos;s National Day, Energize Logistics celebrates the land we serve and
            the people who move it forward. Proud to be part of Saudi Arabia&apos;s journey — every
            road, every port, every delivery.
          </p>

          <div className="mt-8 grid max-w-md grid-cols-2 gap-3 sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
              <p className="text-3xl font-extrabold text-[#f37121]">96</p>
              <p className="text-xs uppercase tracking-widest text-white/60">Years of unity</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
              <p className="text-3xl font-extrabold text-[#7fe0a8]">1932</p>
              <p className="text-xs uppercase tracking-widest text-white/60">Kingdom unified</p>
            </div>
            <p dir="rtl" className="col-span-2 text-left text-sm text-white/60 sm:col-span-1">هي لنا دار</p>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-[#2fa865]/40 via-transparent to-[#f37121]/30 blur-xl" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/15 shadow-2xl">
            <Image
              src="/images/snd-2026-family.jpg"
              alt="اليوم الوطني السعودي — عزنا بطبعنا"
              width={1600}
              height={900}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-auto w-full"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-12">
              <p className="text-sm font-semibold text-white/90">
                Energize Logistics · <span dir="rtl">دام عزك يا وطن</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
