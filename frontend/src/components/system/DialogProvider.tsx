'use client';
// In-app replacements for window.confirm and window.alert.
//
// The native ones render as "localhost:3000 says…", ignore the app's language
// and direction, and cannot be styled — on an Arabic RTL screen they read as a
// browser error rather than part of the system. They also block the main thread.
//
// `confirm` returns a Promise<boolean> instead of a synchronous boolean, so every
// call site has to await it. That is the one real cost of the swap and the reason
// the old calls could not simply be shimmed onto window.
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, CheckCircle2, XCircle, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export type Tone = 'info' | 'success' | 'error' | 'danger';

interface ConfirmOptions {
  message: string;
  title?: string;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogApi {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  notify: (message: string, tone?: Tone) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

const TONE = {
  info: { icon: Info, ring: 'bg-blue-500/15 text-blue-600', btn: 'bg-[#f37121] hover:bg-[#e06010]' },
  success: { icon: CheckCircle2, ring: 'bg-emerald-500/15 text-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700' },
  error: { icon: XCircle, ring: 'bg-red-500/15 text-red-600', btn: 'bg-red-600 hover:bg-red-700' },
  danger: { icon: AlertTriangle, ring: 'bg-red-500/15 text-red-600', btn: 'bg-red-600 hover:bg-red-700' },
} as const;

interface Toast { id: number; message: string; tone: Tone }

export function DialogProvider({ children }: { children: ReactNode }) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';

  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => setAsk({ ...o, resolve }));
  }, []);

  const notify = useCallback((message: string, tone: Tone = 'info') => {
    // Date.now alone collides when two fire in the same tick.
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const api = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  const close = (result: boolean) => {
    ask?.resolve(result);
    setAsk(null);
  };

  const tone = TONE[ask?.tone || 'danger'];
  const Icon = tone.icon;

  return (
    <DialogContext.Provider value={api}>
      {children}

      <AnimatePresence>
        {ask && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            dir={isRTL ? 'rtl' : 'ltr'}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => close(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 flex items-start gap-4">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${tone.ring}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-slate-900">
                    {ask.title || (ar ? 'تأكيد' : 'Please confirm')}
                  </h3>
                  {/* Callers pass multi-line text to explain side effects — keep the breaks. */}
                  <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-line leading-relaxed">{ask.message}</p>
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
                <button type="button" onClick={() => close(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors">
                  {ask.cancelLabel || (ar ? 'إلغاء' : 'Cancel')}
                </button>
                <button type="button" onClick={() => close(true)} autoFocus
                  className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${tone.btn}`}>
                  {ask.confirmLabel || (ar ? 'تأكيد' : 'Confirm')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div dir={isRTL ? 'rtl' : 'ltr'} className="fixed bottom-4 end-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const s = TONE[t.tone];
            const TIcon = s.icon;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                className="pointer-events-auto max-w-sm bg-white border border-slate-200 rounded-xl shadow-lg p-3.5 flex items-start gap-3"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.ring}`}>
                  <TIcon className="w-4 h-4" />
                </div>
                <p className="text-sm text-slate-800 flex-1 whitespace-pre-line break-words">{t.message}</p>
                <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                  className="text-slate-400 hover:text-slate-700 shrink-0" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </DialogContext.Provider>
  );
}

// Falls back to the native dialogs when a component renders outside the provider
// (a stray page, a test) so a missing provider degrades instead of crashing.
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  return ctx || {
    confirm: async (o) => window.confirm(typeof o === 'string' ? o : o.message),
    notify: (m) => window.alert(m),
  };
}
