'use client';
// Small shared UI kit for the HR section so every page stays consistent and
// short. Pure presentation — all data/logic lives in the pages themselves.
import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Download, Loader2 } from 'lucide-react';

export function Spinner() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function PageHeader({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]">{icon}</div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
    </div>
  );
}

export function ExportButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
      <Download className="w-4 h-4" /> {label}
    </button>
  );
}

export function PrimaryButton({ onClick, children, disabled, type = 'button' }: { onClick?: () => void; children: ReactNode; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
      {children}
    </button>
  );
}

export function Badge({ style, lang }: { style?: { bg: string; text: string; en: string; ar: string } | null; lang: 'en' | 'ar' }) {
  if (!style) return <span className="text-slate-500">—</span>;
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>{lang === 'ar' ? style.ar : style.en}</span>;
}

export function SmallBadge({ bg, text, label }: { bg: string; text: string; label: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>{label}</span>;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()} className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold text-lg mb-3">{title}</h2>
              <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={inputCls} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-2 ${active === t.key ? 'border-[#f37121] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
          {t.badge ? <span className="bg-[#f37121] text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

export { Loader2 };
