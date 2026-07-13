'use client';
import { useState, useRef, useEffect } from 'react';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { Bot, Send, User, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { getAssistantTranslations, getAssistantExtraTranslations } from '@/lib/translations';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  type?: string;
  suggestions?: string[];
}

export default function AssistantPage() {
  const { lang } = useLanguage();
  const T = getAssistantTranslations(lang);
  const txx = getAssistantExtraTranslations(lang);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: txx.greeting,
      suggestions: [
        txx.sgTotalOutstanding,
        txx.sgCollectedYesterday,
        txx.sgInvoicesDueSoon,
        txx.sgCollectionRateVsLastWeek,
        txx.sgThisMonthVsLastMonth,
        txx.sgTopDebtors,
        txx.sgHighRiskClients,
        txx.sgStoppedClients,
        txx.sgTodaysCollections,
        txx.sgOverdueInvoices,
        txx.sgCollectorRanking,
        txx.sgNearCreditLimit,
        txx.sgNewCustomersThisMonth,
        txx.sgFrozenInvoices,
        txx.sgExceedCreditLimit,
        txx.sgAgingBreakdown,
        txx.sgClientsUnderReview,
      ],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendQuery = async (query: string) => {
    if (!query.trim()) return;

    const userMsg: Message = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await api.post<any>('/api/assistant/query', { query });
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.summary || txx.hereAreResults,
        data: data.data,
        type: data.type,
        suggestions: data.suggestions,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `${txx.errorPrefix}${err.message || txx.failedToProcess}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuery(input);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{T.title}</h1>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pe-2">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[#f37121]/20 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-[#f37121]" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-xl p-4 ${
              msg.role === 'user'
                ? 'bg-[#f37121] text-white'
                : 'bg-white border border-slate-200 text-slate-800'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

              {/* Data table for results */}
              {msg.data && Array.isArray(msg.data) && msg.data.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <div className="space-y-2">
                    {msg.data.slice(0, 10).map((item: any, j: number) => (
                      <div key={j} className="bg-slate-100 rounded-lg p-2 text-xs">
                        {Object.entries(item).filter(([k]) => !k.startsWith('_') && k !== '__v').slice(0, 5).map(([key, val]) => (
                          <div key={key} className="flex justify-between gap-2">
                            <span className="text-slate-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                            <span className="text-slate-900 font-medium truncate max-w-[200px]">
                              {typeof val === 'object' && val !== null
                                ? (val as any).companyName || (val as any).name || JSON.stringify(val).slice(0, 30)
                                : String(val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {msg.data.length > 10 && (
                      <p className="text-xs text-slate-500">{txx.andMorePrefix}{msg.data.length - 10}{txx.andMoreSuffix}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {msg.suggestions && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.suggestions.map((s, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => sendQuery(s)}
                      className="px-3 py-1 rounded-full bg-slate-100 hover:bg-[#f37121]/20 text-slate-700 hover:text-[#f37121] text-xs transition-all border border-slate-300 hover:border-[#f37121]/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-slate-700" />
              </div>
            )}
          </motion.div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#f37121]/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-[#f37121]" />
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <Loader2 className="w-5 h-5 text-[#f37121] animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={T.placeholder}
          className="flex-1 px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 text-sm shadow-sm"
          disabled={loading}
        />
        <button
          type="submit"
          aria-label={T.send}
          title={T.send}
          disabled={loading || !input.trim()}
          className="px-5 py-3 rounded-xl bg-[#f37121] hover:bg-[#e06010] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
