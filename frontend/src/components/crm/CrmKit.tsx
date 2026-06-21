'use client';
// CRM-specific UI bits. Re-exports the shared HR kit so CRM pages have a single
// import surface, and adds the star-rating widget and the WhatsApp/call/email
// quick-action buttons that the brief asked for.
import { MessageCircle, Phone, Mail, Star, Copy, Check, Globe } from 'lucide-react';
import { useState } from 'react';
import { waLink, telLink, mailLink } from '@/lib/crm';

export * from '@/components/hr/HRKit';

// Inline, clickable 0–5 star rating. `onChange` omitted → read-only display.
export function StarRating({ value = 0, onChange, size = 16 }: { value?: number; onChange?: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const stars = [1, 2, 3, 4, 5];
  const active = hover || value;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {stars.map((s) => (
        <button
          key={s}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(s === value ? 0 : s)}
          onMouseEnter={() => onChange && setHover(s)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
          aria-label={`${s} stars`}
        >
          <Star
            style={{ width: size, height: size }}
            className={s <= active ? 'fill-amber-400 text-amber-700' : 'text-slate-600'}
          />
        </button>
      ))}
    </div>
  );
}

function IconLink({ href, title, color, children, external }: { href: string; title: string; color: string; children: React.ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      title={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={(e) => e.stopPropagation()}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${color}`}
    >
      {children}
    </a>
  );
}

// WhatsApp / call / email / website quick actions. Renders only the channels
// that have a value. `phone` is used for both call and (fallback) WhatsApp;
// pass `whatsapp` to override the WhatsApp number.
export function ContactButtons({
  phone, whatsapp, email, website, messageText, emailSubject, size = 16,
}: {
  phone?: string; whatsapp?: string; email?: string; website?: string;
  messageText?: string; emailSubject?: string; size?: number;
}) {
  const wa = waLink(whatsapp || phone, messageText);
  const tel = telLink(phone);
  const mail = mailLink(email, emailSubject);
  const site = website ? (website.startsWith('http') ? website : `https://${website}`) : null;
  const ico = { width: size, height: size };
  return (
    <div className="flex items-center gap-1.5">
      {wa && (
        <IconLink href={wa} title="WhatsApp" external color="bg-green-500/15 text-green-600 hover:bg-green-500/30">
          <MessageCircle style={ico} />
        </IconLink>
      )}
      {tel && (
        <IconLink href={tel} title="Call" color="bg-blue-500/15 text-blue-600 hover:bg-blue-500/30">
          <Phone style={ico} />
        </IconLink>
      )}
      {mail && (
        <IconLink href={mail} title="Email" color="bg-purple-500/15 text-purple-600 hover:bg-purple-500/30">
          <Mail style={ico} />
        </IconLink>
      )}
      {site && (
        <IconLink href={site} title="Website" external color="bg-slate-500/15 text-slate-700 hover:bg-slate-500/30">
          <Globe style={ico} />
        </IconLink>
      )}
    </div>
  );
}

// Copy-to-clipboard text with a tiny confirmation tick.
export function CopyText({ value, className }: { value?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-500">—</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className={`inline-flex items-center gap-1 text-slate-700 hover:text-[#f37121] ${className || ''}`}
      title="Copy"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
    </button>
  );
}
