'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

export type Lang = 'en' | 'ar';

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  isRTL: boolean;
  /** Use the language saved for this kind of account (partners: their own, English by default). */
  applyAccountLang: (role: string) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'en',
  setLang: () => {},
  toggleLang: () => {},
  isRTL: false,
  applyAccountLang: () => {},
});

const STAFF_KEY = 'system-lang';
const PARTNER_KEY = 'portal-lang';
const read = (k: string): Lang | null => {
  try { const v = localStorage.getItem(k); return v === 'ar' || v === 'en' ? v : null; } catch { return null; }
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  // Customer/supplier accounts keep their own language, separate from staff on the same browser.
  const keyRef = useRef(STAFF_KEY);

  useEffect(() => {
    const saved = read(STAFF_KEY);
    if (saved) setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(keyRef.current, l); } catch { /* private mode */ }
  }, []);

  const applyAccountLang = useCallback((role: string) => {
    const key = role === 'client' ? PARTNER_KEY : STAFF_KEY;
    if (key === keyRef.current) return;
    keyRef.current = key;
    setLangState(read(key) || 'en');
  }, []);

  const toggleLang = () => {
    setLang(lang === 'en' ? 'ar' : 'en');
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, isRTL: lang === 'ar', applyAccountLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
