'use client';
import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { empName } from '@/lib/hr';

// Searchable employee picker used by the authorize/transfer/accident forms.
// Hits the vehicle section's own employee search (reachable by Accounting roles
// that can't call the HR endpoints).
export function EmployeePicker({ value, onChange, placeholder, lang }: {
  value: string;
  onChange: (id: string, employee: any) => void;
  placeholder: string;
  lang: 'en' | 'ar';
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(async () => {
      try {
        const d = await api.get<{ employees: any[] }>(`/api/vehicles/employees?q=${encodeURIComponent(q.trim())}`);
        setResults(d.employees || []);
      } catch {}
    }, 250);
    return () => clearTimeout(h);
  }, [q, open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        value={selected ? empName(selected, lang) : q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setSelected(null); onChange('', null); setQ(e.target.value); setOpen(true); }}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#f37121]"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl">
          {results.map((e) => (
            <button
              key={e._id}
              type="button"
              onClick={() => { setSelected(e); onChange(e._id, e); setOpen(false); }}
              className="w-full text-start px-3 py-2 text-sm hover:bg-slate-100 border-b border-slate-100 last:border-0"
            >
              <span className="text-slate-900 font-medium">{empName(e, lang)}</span>
              <span className="text-slate-400 text-xs block">{[e.employeeNumber, e.jobTitle, e.iqamaNumber].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
