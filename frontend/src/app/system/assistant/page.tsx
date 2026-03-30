'use client';
import { useState, useRef, useEffect } from 'react';
import api from '@/lib/api';
import { motion } from 'framer-motion';
import { Bot, Send, User, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { getAssistantTranslations } from '@/lib/translations';

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
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your Collection Intelligence Assistant. Ask me your daily business questions — I\'ll give you real-time answers from your data.',
      suggestions: [
        'Total outstanding right now',
        "How much was collected yesterday?",
        'Invoices due soon',
        'Collection rate vs last week',
        'This month vs last month',
        'Top debtors',
        'Show high risk clients',
        'Show stopped clients',
        "Today's collections",
        'Show overdue invoices',
        'Collector ranking',
        'Customers near credit limit',
        'New customers this month',
        'Show frozen invoices',
        'Which clients exceed credit limit?',
        'Show aging breakdown',
        'Clients under review',
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
        content: data.summary || 'Here are the results:',
        data: data.data,
        type: data.type,
        suggestions: data.suggestions,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message || 'Failed to process query'}` },
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
      <h1 className="text-2xl font-bold text-white mb-4">{T.title}</h1>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
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
                : 'bg-gray-800 border border-gray-700 text-gray-200'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

              {/* Data table for results */}
              {msg.data && Array.isArray(msg.data) && msg.data.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <div className="space-y-2">
                    {msg.data.slice(0, 10).map((item: any, j: number) => (
                      <div key={j} className="bg-gray-700/50 rounded-lg p-2 text-xs">
                        {Object.entries(item).filter(([k]) => !k.startsWith('_') && k !== '__v').slice(0, 5).map(([key, val]) => (
                          <div key={key} className="flex justify-between gap-2">
                            <span className="text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                            <span className="text-white font-medium truncate max-w-[200px]">
                              {typeof val === 'object' && val !== null
                                ? (val as any).companyName || (val as any).name || JSON.stringify(val).slice(0, 30)
                                : String(val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {msg.data.length > 10 && (
                      <p className="text-xs text-gray-500">... and {msg.data.length - 10} more</p>
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
                      className="px-3 py-1 rounded-full bg-gray-700 hover:bg-[#f37121]/20 text-gray-300 hover:text-[#f37121] text-xs transition-all border border-gray-600 hover:border-[#f37121]/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-gray-300" />
              </div>
            )}
          </motion.div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#f37121]/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-[#f37121]" />
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
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
          className="flex-1 px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 text-sm"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-3 rounded-xl bg-[#f37121] hover:bg-[#e06010] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
