'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { MessageSquare, Send, ArrowLeft } from 'lucide-react';
import { isRemoteStaff, fmtDateTime } from '@/lib/remote';

interface Msg {
  _id: string;
  employee?: string;
  sender: { _id: string; firstName: string; lastName: string; role: string };
  body: string;
  createdAt: string;
}
interface Thread {
  employee: { _id: string; firstName: string; lastName: string; email: string };
  lastMessage: { body: string; createdAt: string } | null;
  lastAt: string | null;
  unread: number;
}

export default function RemoteChatPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = isRemoteStaff(user?.role);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeEmployee, setActiveEmployee] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // For employees the thread is themselves; endpoint is /chat (no id).
  const threadPath = staff ? (activeEmployee ? `/api/remote/chat/${activeEmployee}` : null) : '/api/remote/chat';

  const loadThreads = useCallback(async () => {
    if (!staff) return;
    try {
      const data = await api.get<{ threads: Thread[] }>('/api/remote/chat/threads');
      setThreads(data.threads || []);
    } catch {}
  }, [staff]);

  const loadMessages = useCallback(async () => {
    if (!threadPath) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await api.get<{ messages: Msg[] }>(threadPath);
      setMessages(data.messages || []);
    } catch {} finally { setLoading(false); }
  }, [threadPath]);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Real-time incoming messages
  const onIncoming = useCallback((payload: { employee: string; message: Msg }) => {
    if (staff) {
      loadThreads();
      if (activeEmployee && payload.employee === activeEmployee) {
        setMessages((prev) => [...prev, payload.message]);
      }
    } else {
      setMessages((prev) => [...prev, payload.message]);
    }
  }, [staff, activeEmployee, loadThreads]);
  useSocket('remote:message', onIncoming);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !threadPath || sending) return;
    setSending(true);
    const body = text.trim();
    setText('');
    try {
      const data = await api.post<{ message: Msg }>(threadPath, { body });
      setMessages((prev) => [...prev, data.message]);
      if (staff) loadThreads();
    } catch { setText(body); } finally { setSending(false); }
  };

  // ── Staff: thread list when none selected ──
  if (staff && !activeEmployee) {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><MessageSquare className="w-6 h-6 text-[#f37121]" />{ar ? 'الرسائل' : 'Messages'}</h1>
        {threads.length === 0 ? (
          <p className="text-gray-400 text-center py-10">{ar ? 'لا توجد محادثات بعد' : 'No conversations yet'}</p>
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-xl divide-y divide-gray-700/50">
            {threads.map((t) => (
              <button key={t.employee._id} type="button" onClick={() => setActiveEmployee(t.employee._id)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-gray-700/40 text-start transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#f37121]/20 text-[#f37121] flex items-center justify-center font-bold shrink-0">{t.employee.firstName[0]}{t.employee.lastName[0]}</div>
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{t.employee.firstName} {t.employee.lastName}</p>
                    <p className="text-gray-400 text-sm truncate">{t.lastMessage?.body || (ar ? 'لا توجد رسائل' : 'No messages')}</p>
                  </div>
                </div>
                {t.unread > 0 && <span className="bg-[#f37121] text-white text-xs rounded-full px-2 py-0.5 shrink-0">{t.unread}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Conversation view (employee always; staff after selecting) ──
  const activeName = staff ? threads.find((t) => t.employee._id === activeEmployee) : null;
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 pb-3 border-b border-gray-700">
        {staff && (
          <button type="button" onClick={() => { setActiveEmployee(null); setMessages([]); loadThreads(); }} className="text-gray-400 hover:text-white p-1" title="Back"><ArrowLeft className={`w-5 h-5 ${isRTL ? 'rotate-180' : ''}`} /></button>
        )}
        <MessageSquare className="w-5 h-5 text-[#f37121]" />
        <h1 className="text-lg font-bold text-white">
          {staff && activeName ? `${activeName.employee.firstName} ${activeName.employee.lastName}` : (ar ? 'محادثة مع مديرك' : 'Chat with your manager')}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>
        ) : messages.length === 0 ? (
          <p className="text-gray-400 text-center py-10">{ar ? 'ابدأ المحادثة' : 'Start the conversation'}</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender._id === user?._id;
            return (
              <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${mine ? 'bg-[#f37121] text-white' : 'bg-gray-700 text-gray-100'}`}>
                  {!mine && <p className="text-xs opacity-70 mb-0.5">{m.sender.firstName} {m.sender.lastName}</p>}
                  <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="text-[10px] opacity-60 mt-1 text-end">{fmtDateTime(m.createdAt)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2 pt-3 border-t border-gray-700">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ar ? 'اكتب رسالتك...' : 'Type a message...'}
          className="flex-1 px-4 py-3 rounded-full bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
        />
        <button type="submit" disabled={sending || !text.trim()} className="w-12 h-12 rounded-full bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white flex items-center justify-center shrink-0" title="Send">
          <Send className={`w-5 h-5 ${isRTL ? 'rotate-180' : ''}`} />
        </button>
      </form>
    </div>
  );
}
