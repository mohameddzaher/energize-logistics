'use client';
// The on-screen half of the report engine.
//
// The backend describes a report as BLOCKS and renders those blocks to PDF. This
// renders the same blocks to the screen — so the preview is not an approximation
// of the printed file, it is the same document drawn twice. Add a block kind on
// the server and it must be added here too; that is the only coupling.
import { ReactNode } from 'react';

export type ReportBlock =
  | { kind: 'title'; text: string; sub?: string }
  | { kind: 'section'; text: string }
  | { kind: 'kv'; items: [string, any][] }
  | { kind: 'stats'; items: { label: string; value: any; accent?: boolean; sub?: string }[] }
  | { kind: 'table'; head: string[]; rows: (any | { t: any; color?: string })[][]; align?: ('start' | 'end' | 'center')[]; emptyText?: string }
  | { kind: 'bars'; items: { label: string; value: number; max?: number; text?: string; color?: string }[] }
  | { kind: 'timeline'; label?: string; items: { title: string; sub?: string; at?: string; color?: string }[] }
  | { kind: 'note'; text: string; tone?: 'info' | 'warn' | 'danger' | 'ok' }
  | { kind: 'callout'; title?: string; lines?: [string, any][] }
  | { kind: 'signatures'; items: { name?: string; title?: string }[] }
  | { kind: 'pagebreak' }
  | { kind: 'spacer'; h?: number };

export interface ReportDoc {
  title: string;
  subtitle?: string;
  blocks: ReportBlock[];
  generatedBy?: string;
  generatedAt?: string;
}

const val = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v));

const NOTE_TONES: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600',
  warn: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  ok: 'bg-green-100 text-green-800',
};

function Block({ b }: { b: ReportBlock }) {
  switch (b.kind) {
    case 'title':
      return (
        <div className="text-center mb-4">
          <h2 className="text-xl font-extrabold text-slate-900">{b.text}</h2>
          {/* Mixed Arabic/Latin runs need isolation or the plate and the dates
              swap places — same reason the PDF isolates them. */}
          {b.sub && <p dir="auto" className="text-[#f37121] text-sm font-bold mt-1" style={{ unicodeBidi: 'isolate' }}>{b.sub}</p>}
          <div className="w-20 h-[3px] bg-[#f37121] rounded mx-auto mt-2" />
        </div>
      );

    case 'section':
      return <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-bold mt-5 mb-2">{b.text}</div>;

    case 'kv':
      if (!b.items?.length) return null;
      return (
        <table className="w-full border-collapse text-xs mb-2">
          <tbody>
            {b.items.map(([k, v], i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                <td className="border border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 w-1/3">{k}</td>
                <td className="border border-slate-200 px-2.5 py-1.5 text-slate-900" dir="auto">{val(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'stats':
      if (!b.items?.length) return null;
      return (
        <div className="flex flex-wrap gap-2 mb-2">
          {b.items.map((s, i) => (
            <div key={i} className="flex-1 min-w-[92px] border border-slate-200 rounded-lg bg-slate-50 px-2 py-2 text-center">
              <p className="text-[10px] text-slate-500 leading-tight">{s.label}</p>
              <p className={`text-base font-extrabold mt-0.5 ${s.accent ? 'text-[#f37121]' : 'text-slate-900'}`}>{val(s.value)}</p>
              {s.sub && <p className="text-[9px] text-slate-400">{s.sub}</p>}
            </div>
          ))}
        </div>
      );

    case 'table': {
      if (!b.rows?.length) {
        return b.emptyText ? <Block b={{ kind: 'note', text: b.emptyText }} /> : null;
      }
      const al = (i: number) => (b.align?.[i] === 'end' ? 'text-end' : b.align?.[i] === 'center' ? 'text-center' : 'text-start');
      return (
        <div className="overflow-x-auto mb-2">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} className={`bg-slate-900 text-slate-300 font-bold px-2 py-1.5 border border-slate-900 ${al(i)}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className={ri % 2 ? 'bg-slate-50' : ''}>
                  {r.map((c, i) => {
                    const cell = (c && typeof c === 'object' && 't' in c) ? c : { t: c, color: undefined };
                    return (
                      <td key={i} className={`border border-slate-200 px-2 py-1 ${al(i)} ${cell.color ? 'font-semibold' : 'text-slate-800'}`}
                        style={cell.color ? { color: cell.color } : undefined} dir="auto">
                        {val(cell.t)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'bars': {
      if (!b.items?.length) return null;
      const max = Math.max(1, ...b.items.map((i) => Number(i.max ?? i.value) || 0));
      return (
        <div className="mb-2 space-y-1.5">
          {b.items.map((i, idx) => (
            <div key={idx} className="flex items-center gap-2 text-[11px]">
              <span className="w-[30%] text-slate-700 font-semibold truncate">{i.label}</span>
              <span className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                <span className="block h-full rounded" style={{ width: `${Math.max(1, Math.min(100, ((Number(i.value) || 0) / max) * 100))}%`, backgroundColor: i.color || '#f37121' }} />
              </span>
              <span className="w-[74px] text-end font-extrabold text-slate-900">{i.text ?? i.value}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'timeline':
      if (!b.items?.length) return null;
      return (
        <div className="mb-2">
          {b.label && <div className="text-[11px] font-extrabold text-slate-500 pt-0.5 pb-1">{b.label}</div>}
          {b.items.map((i, idx) => (
            <div key={idx} className="flex items-start gap-2 py-1.5 border-b border-dashed border-slate-200 text-[11px]">
              <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: i.color || '#f37121' }} />
              <span className="flex-1">
                <span className="block font-bold text-slate-900">{i.title}</span>
                {i.sub && <span className="block text-slate-500">{i.sub}</span>}
              </span>
              <span className="text-slate-400 whitespace-nowrap">{i.at}</span>
            </div>
          ))}
        </div>
      );

    case 'note':
      return <div className={`text-[11px] rounded-md px-2.5 py-1.5 mb-2 leading-relaxed ${NOTE_TONES[b.tone || 'info']}`}>{b.text}</div>;

    // The tinted lead panel at the head of a formal document.
    case 'callout':
      if (!b.lines?.length && !b.title) return null;
      return (
        <div className="mb-2.5 rounded-lg border border-[#f37121]/35 bg-[#fff7f0] px-3 py-2.5">
          {b.title && <div className="text-[11.5px] font-extrabold text-[#f37121] mb-1.5">{b.title}</div>}
          {(b.lines || []).map(([k, v], idx) => (
            <div key={idx} className="flex justify-between gap-3 text-[11px] py-0.5">
              <span className="text-slate-500">{k}</span>
              <span className="text-slate-900 font-semibold text-end">{val(v)}</span>
            </div>
          ))}
        </div>
      );

    // Ruled lines to sign on. Shown in the preview too, so what you read on
    // screen is what comes out of the printer — that is the whole point of
    // describing a report once and rendering it twice.
    case 'signatures':
      if (!b.items?.length) return null;
      return (
        <div className="flex gap-6 mt-7 pt-1.5">
          {b.items.map((i, idx) => (
            <div key={idx} className="flex-1 text-center">
              <div className="border-t border-slate-400 h-[34px] mb-1.5" />
              <div className="text-[11px] font-extrabold text-slate-900">{i.name || ''}</div>
              <div className="text-[9.5px] text-slate-500 mt-0.5">{i.title || ''}</div>
            </div>
          ))}
        </div>
      );

    case 'pagebreak':
      return <div className="my-4 border-t border-dashed border-slate-300" />;

    case 'spacer':
      return <div style={{ height: b.h ?? 10 }} />;

    default:
      return null;
  }
}

/** The whole document, drawn on a sheet that reads like the printed page. */
export default function ReportView({ doc, children }: { doc: ReportDoc; children?: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 md:p-8">
      <Block b={{ kind: 'title', text: doc.title, sub: doc.subtitle }} />
      {children}
      {doc.blocks.map((b, i) => <Block key={i} b={b} />)}
      {(doc.generatedBy || doc.generatedAt) && (
        <p className="text-[10px] text-slate-400 mt-6 pt-2 border-t border-slate-200 flex justify-between">
          <span>{doc.generatedBy}</span>
          <span>{doc.generatedAt ? new Date(doc.generatedAt).toLocaleString() : ''}</span>
        </p>
      )}
    </div>
  );
}

export { Block as ReportBlockView };
