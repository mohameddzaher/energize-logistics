'use client';
/**
 * API reference — the whole internal surface, generated from the running code
 * (owner, 2026-10-27: "English only, a beautiful professional page, always in
 * sync, with samples, JSON files and an extract button").
 *
 * Nothing on this page is written by hand. The server builds the catalog from
 * the router and the handlers when it is requested (services/apiDocs,
 * services/apiFieldScan, services/apiSamples): routes and their guards, the
 * query/body fields each handler reads, and samples typed from the Mongoose
 * schema the handler uses. The page polls the surface signature every minute
 * and reloads the catalog when a route or field was added, changed or removed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import {
  BookOpen, Search, Download, RefreshCw, Copy, Check, ChevronDown, ChevronRight, Shield, KeyRound, Globe, Lock,
  Database, Braces, Terminal, Layers, Zap, ExternalLink, FileJson, FileText, FileSpreadsheet, Package, X, Filter,
} from 'lucide-react';

// role-only: the server guards the catalog with the same list (routes/apiDocs DOCS_ROLES).
const DOCS_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = typeof METHODS[number];

interface Field { name: string; required: boolean; type: string; example: any; in?: string; description?: string }
interface Endpoint {
  id: string; method: Method; path: string; group: string; auth: 'user' | 'apiKey' | 'public';
  section: string; roles: string[]; model: string; params: Field[]; query: Field[]; body: Field[];
  wholeBody: boolean; requestExample: any; responseExample: any; notes: string;
}
interface Catalog {
  title: string; version: string; baseUrl: string; generatedAt: string; signature: string;
  groups: { name: string; count: number; description: string }[];
  errors: { status: number; description: string }[];
  endpoints: Endpoint[];
}

const METHOD_STYLE: Record<Method, { chip: string; dot: string; soft: string }> = {
  GET: { chip: 'bg-emerald-500 text-white', dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  POST: { chip: 'bg-sky-500 text-white', dot: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 ring-sky-200' },
  PUT: { chip: 'bg-amber-500 text-white', dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PATCH: { chip: 'bg-violet-500 text-white', dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 ring-violet-200' },
  DELETE: { chip: 'bg-rose-500 text-white', dot: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
const AUTH_LABEL = { user: 'User session', apiKey: 'API key', public: 'Public' } as const;
const AUTH_ICON = { user: Lock, apiKey: KeyRound, public: Globe } as const;

const pretty = (v: any) => JSON.stringify(v, null, 2);
const titleCase = (g: string) => g.split('-').map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
const timeOf = (iso: string) => {
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
};

function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** `/api/x/:id` with the example filled in, plus the query string of the examples. */
function urlOf(e: Endpoint, base: string, withQuery = true) {
  let p = e.path;
  for (const prm of e.params) p = p.replace(`:${prm.name}`, String(prm.example ?? prm.name));
  const q = withQuery ? e.query.filter((f) => f.example !== '' && f.example != null).slice(0, 4)
    .map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(String(f.example))}`).join('&') : '';
  return `${base}${p}${q ? `?${q}` : ''}`;
}

function snippets(e: Endpoint, base: string) {
  const url = urlOf(e, base);
  const authH = e.auth === 'apiKey' ? `x-api-key: <YOUR_API_KEY>` : e.auth === 'user' ? 'Authorization: Bearer <TOKEN>' : '';
  const body = e.requestExample ? pretty(e.requestExample) : '';
  const curl = [
    `curl -X ${e.method} '${url}'`,
    authH ? `  -H '${authH}'` : '',
    body ? `  -H 'Content-Type: application/json'` : '',
    body ? `  -d '${JSON.stringify(e.requestExample)}'` : '',
  ].filter(Boolean).join(' \\\n');
  const headersJs = [
    e.auth === 'apiKey' ? `'x-api-key': process.env.ENERGIZE_API_KEY` : e.auth === 'user' ? `Authorization: \`Bearer \${token}\`` : '',
    body ? `'Content-Type': 'application/json'` : '',
  ].filter(Boolean);
  const js = [
    `const res = await fetch('${url}', {`,
    `  method: '${e.method}',`,
    headersJs.length ? `  headers: { ${headersJs.join(', ')} },` : '',
    body ? `  body: JSON.stringify(${body.replace(/\n/g, '\n  ')}),` : '',
    `});`,
    `const data = await res.json();`,
  ].filter(Boolean).join('\n');
  const headersPy = [
    e.auth === 'apiKey' ? `"x-api-key": API_KEY` : e.auth === 'user' ? `"Authorization": f"Bearer {token}"` : '',
  ].filter(Boolean);
  const py = [
    'import requests',
    '',
    `res = requests.${e.method.toLowerCase()}(`,
    `    "${url}",`,
    headersPy.length ? `    headers={${headersPy.join(', ')}},` : '',
    body ? `    json=${JSON.stringify(e.requestExample, null, 4).replace(/\n/g, '\n    ').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')},` : '',
    ')',
    'data = res.json()',
  ].filter(Boolean).join('\n');
  return { curl, js, py };
}

// ── Extract formats ─────────────────────────────────────────────────────────
function postmanOf(c: Catalog, list: Endpoint[]) {
  const byGroup = new Map<string, Endpoint[]>();
  for (const e of list) byGroup.set(e.group, [...(byGroup.get(e.group) || []), e]);
  return {
    info: {
      name: `${c.title} (${list.length} endpoints)`,
      description: `Generated from the running code on ${c.generatedAt}. Signature ${c.signature}.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [{ key: 'baseUrl', value: c.baseUrl }, { key: 'token', value: '' }, { key: 'apiKey', value: '' }],
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: [...byGroup.entries()].map(([g, items]) => ({
      name: titleCase(g),
      item: items.map((e) => ({
        name: `${e.method} ${e.path}`,
        request: {
          method: e.method,
          ...(e.auth === 'apiKey' ? { auth: { type: 'apikey', apikey: [{ key: 'key', value: 'x-api-key' }, { key: 'value', value: '{{apiKey}}' }, { key: 'in', value: 'header' }] } } : {}),
          ...(e.auth === 'public' ? { auth: { type: 'noauth' } } : {}),
          header: e.requestExample ? [{ key: 'Content-Type', value: 'application/json' }] : [],
          url: {
            raw: `{{baseUrl}}${e.path}`,
            host: ['{{baseUrl}}'],
            path: e.path.split('/').filter(Boolean),
            variable: e.params.map((p) => ({ key: p.name, value: String(p.example ?? '') })),
            query: e.query.map((f) => ({ key: f.name, value: String(f.example ?? ''), disabled: !f.required })),
          },
          ...(e.requestExample ? { body: { mode: 'raw', raw: pretty(e.requestExample), options: { raw: { language: 'json' } } } } : {}),
          description: [e.notes, e.model ? `Record model: ${e.model}` : ''].filter(Boolean).join('\n'),
        },
        ...(e.responseExample ? { response: [{ name: 'Sample', status: 'OK', code: 200, _postman_previewlanguage: 'json', body: pretty(e.responseExample) }] } : {}),
      })),
    })),
  };
}

function markdownOf(c: Catalog, list: Endpoint[]) {
  const out: string[] = [
    `# ${c.title}`, '',
    `Version ${c.version} · generated ${c.generatedAt} · signature \`${c.signature}\` · ${list.length} endpoints`, '',
    `Base URL: \`${c.baseUrl}\``, '',
    '## Authentication', '',
    '- **User session** — `Authorization: Bearer <token>` (mobile app) or the `token` cookie (web app).',
    '- **API key** — `x-api-key: <key>`, issued per partner.',
    '', '## Errors', '', '| Status | Meaning |', '| --- | --- |',
    ...c.errors.map((e) => `| ${e.status} | ${e.description} |`), '',
  ];
  let g = '';
  for (const e of list) {
    if (e.group !== g) {
      g = e.group;
      const info = c.groups.find((x) => x.name === g);
      out.push(`## ${titleCase(g)}`, '', info?.description ? `${info.description}\n` : '');
    }
    out.push(`### \`${e.method} ${e.path}\``, '');
    out.push(`- Auth: **${AUTH_LABEL[e.auth]}**${e.section ? ` · section **${e.section}**` : ''}${e.roles.length ? ` · roles ${e.roles.join(', ')}` : ''}`);
    if (e.model) out.push(`- Model: \`${e.model}\``);
    if (e.notes) out.push(`- ${e.notes}`);
    const fields = [...e.params.map((f) => ({ ...f, in: 'path' })), ...e.query.map((f) => ({ ...f, in: 'query' })), ...e.body.map((f) => ({ ...f, in: 'body' }))];
    if (fields.length) {
      out.push('', '| Field | In | Type | Required | Example |', '| --- | --- | --- | --- | --- |');
      for (const f of fields) out.push(`| \`${f.name}\` | ${f.in} | ${f.type} | ${f.required ? 'yes' : ''} | \`${JSON.stringify(f.example)}\` |`);
    }
    if (e.requestExample) out.push('', 'Request:', '', '```json', pretty(e.requestExample), '```');
    if (e.responseExample) out.push('', 'Response:', '', '```json', pretty(e.responseExample), '```');
    out.push('');
  }
  return out.join('\n');
}

function csvOf(list: Endpoint[]) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Method', 'Path', 'Group', 'Auth', 'Section', 'Roles', 'Model', 'Query fields', 'Body fields'].map(esc).join(',')];
  for (const e of list) {
    rows.push([e.method, e.path, e.group, AUTH_LABEL[e.auth], e.section, e.roles.join(' '), e.model,
      e.query.map((f) => f.name).join(' '), e.body.map((f) => f.name).join(' ')].map(esc).join(','));
  }
  return `﻿${rows.join('\n')}`;
}

// ── Small building blocks (top-level: never re-created on render) ──────────
function CopyButton({ text, label = 'Copy', dark = false }: { text: string; label?: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={(ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); }}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition ${dark
        ? 'text-slate-300 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}{done ? 'Copied' : label}
    </button>
  );
}

function CodeBlock({ code, lang, fileName }: { code: string; lang: string; fileName?: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#0b1220] ring-1 ring-white/5">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">{lang}</span>
        <div className="flex items-center gap-0.5">
          {fileName && (
            <button type="button" onClick={() => download(fileName, code, lang === 'json' ? 'application/json' : 'text/plain')}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-slate-300 hover:bg-white/10 hover:text-white">
              <Download className="h-3.5 w-3.5" />.{fileName.split('.').pop()}
            </button>
          )}
          <CopyButton text={code} dark />
        </div>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-slate-200"><code>{code}</code></pre>
    </div>
  );
}

function PathText({ path }: { path: string }) {
  return (
    <span className="font-mono text-[13px] text-slate-800">
      {path.split(/(:[A-Za-z0-9_]+)/g).map((part, i) => (part.startsWith(':')
        ? <span key={i} className="rounded bg-orange-50 px-1 text-[#f37121]">{`{${part.slice(1)}}`}</span>
        : <span key={i}>{part}</span>))}
    </span>
  );
}

function FieldTable({ rows }: { rows: (Field & { in: string })[] }) {
  if (!rows.length) return <p className="text-[13px] text-slate-400">No parameters.</p>;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>{['Name', 'In', 'Type', 'Required', 'Example'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((f) => (
            <tr key={`${f.in}-${f.name}`} className="hover:bg-slate-50/60">
              <td className="px-3 py-2 font-mono font-medium text-slate-900">{f.name}</td>
              <td className="px-3 py-2"><span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{f.in}</span></td>
              <td className="px-3 py-2 font-mono text-[12px] text-indigo-600">{f.type}</td>
              <td className="px-3 py-2">{f.required ? <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600">required</span> : <span className="text-slate-300">optional</span>}</td>
              <td className="max-w-[260px] truncate px-3 py-2 font-mono text-[12px] text-slate-500" title={JSON.stringify(f.example)}>{JSON.stringify(f.example)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = ['Overview', 'Parameters', 'Request', 'Response', 'Code'] as const;
type Tab = typeof TABS[number];

function EndpointDetail({ e, c }: { e: Endpoint; c: Catalog }) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [lang, setLang] = useState<'curl' | 'js' | 'py'>('curl');
  const sn = useMemo(() => snippets(e, c.baseUrl), [e, c.baseUrl]);
  const fileBase = `${e.method.toLowerCase()}${e.path.replace(/[/:]+/g, '_')}`;
  const fields = [...e.params.map((f) => ({ ...f, in: 'path' })), ...e.query.map((f) => ({ ...f, in: 'query' }))];
  const AuthIcon = AUTH_ICON[e.auth];
  const count: Partial<Record<Tab, number>> = { Parameters: fields.length, Request: e.body.length };
  return (
    <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/70 to-white px-4 pb-5 pt-3 sm:px-6">
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${tab === t
              ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
            {t}{count[t] ? <span className={`ml-1.5 rounded px-1 text-[10.5px] ${tab === t ? 'bg-white/20' : 'bg-slate-200 text-slate-600'}`}>{count[t]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard icon={<AuthIcon className="h-4 w-4" />} label="Authentication" value={AUTH_LABEL[e.auth]}
            hint={e.auth === 'apiKey' ? 'Header x-api-key' : e.auth === 'user' ? 'Bearer token or session cookie' : 'No credentials needed'} />
          <InfoCard icon={<Shield className="h-4 w-4" />} label="Section" value={e.section || '—'} hint={e.section ? 'Section permission required' : 'No section gate'} />
          <InfoCard icon={<Database className="h-4 w-4" />} label="Record model" value={e.model || '—'} hint={e.model ? 'Response shape from its schema' : 'No model detected'} />
          <InfoCard icon={<Layers className="h-4 w-4" />} label="Fields" value={`${fields.length} params · ${e.body.length} body`} hint={e.wholeBody ? 'Accepts the record fields as sent' : 'Read from the handler'} />
          {e.roles.length > 0 && (
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:col-span-2 lg:col-span-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Accepted roles</p>
              <div className="flex flex-wrap gap-1.5">{e.roles.map((r) => <span key={r} className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11.5px] text-indigo-700">{r}</span>)}</div>
            </div>
          )}
          {e.notes && <p className="rounded-xl bg-white p-3 text-[13px] leading-relaxed text-slate-600 ring-1 ring-slate-200 sm:col-span-2 lg:col-span-4">{e.notes.replace(/\*\*/g, '').replace(/`/g, '')}</p>}
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:col-span-2 lg:col-span-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Responses</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[12px] text-emerald-700"><b>200</b> Success</span>
              {c.errors.map((x) => <span key={x.status} className="rounded-md bg-slate-50 px-2 py-1 text-[12px] text-slate-600" title={x.description}><b>{x.status}</b> {x.description.split(' — ')[0]}</span>)}
            </div>
          </div>
        </div>
      )}

      {tab === 'Parameters' && <FieldTable rows={fields} />}

      {tab === 'Request' && (e.body.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <FieldTable rows={e.body.map((f) => ({ ...f, in: 'body' }))} />
          <CodeBlock code={pretty(e.requestExample)} lang="json" fileName={`${fileBase}.request.json`} />
        </div>
      ) : (
        <p className="text-[13px] text-slate-400">{e.wholeBody ? 'This endpoint accepts the record fields as sent — see the Response tab for the record shape.' : 'No request body.'}</p>
      ))}

      {tab === 'Response' && (e.responseExample ? (
        <div className="space-y-2">
          {e.model && <p className="text-[12.5px] text-slate-500">Record shape generated from the <span className="font-mono font-semibold text-slate-800">{e.model}</span> schema — it follows every schema change.</p>}
          <CodeBlock code={pretty(e.responseExample)} lang="json" fileName={`${fileBase}.response.json`} />
        </div>
      ) : <p className="text-[13px] text-slate-400">No record model detected for this endpoint — it answers JSON computed by its handler.</p>)}

      {tab === 'Code' && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {([['curl', 'cURL'], ['js', 'JavaScript'], ['py', 'Python']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setLang(k)}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${lang === k ? 'bg-[#f37121] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          <CodeBlock code={sn[lang]} lang={lang === 'curl' ? 'bash' : lang === 'js' ? 'javascript' : 'python'} />
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span></div>
      <p className="mt-1.5 truncate font-semibold text-slate-900" title={value}>{value}</p>
      <p className="mt-0.5 text-[11.5px] text-slate-400">{hint}</p>
    </div>
  );
}

function EndpointRow({ e, c, open, onToggle }: { e: Endpoint; c: Catalog; open: boolean; onToggle: () => void }) {
  const s = METHOD_STYLE[e.method];
  const AuthIcon = AUTH_ICON[e.auth];
  return (
    <div className={`overflow-hidden rounded-xl bg-white ring-1 transition ${open ? 'shadow-md ring-slate-300' : 'ring-slate-200 hover:ring-slate-300 hover:shadow-sm'}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left sm:px-4">
        <span className={`w-[64px] shrink-0 rounded-md py-1 text-center font-mono text-[11px] font-bold tracking-wide ${s.chip}`}>{e.method}</span>
        <span className="min-w-0 flex-1 truncate"><PathText path={e.path} /></span>
        <span className="hidden items-center gap-1.5 md:flex">
          {e.model && <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 ring-1 ring-slate-200"><Database className="h-3 w-3" />{e.model}</span>}
          {e.section && <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">{e.section}</span>}
          <span title={AUTH_LABEL[e.auth]} className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${e.auth === 'public' ? 'bg-amber-50 text-amber-600' : e.auth === 'apiKey' ? 'bg-violet-50 text-violet-600' : 'bg-slate-50 text-slate-500'}`}>
            <AuthIcon className="h-3.5 w-3.5" />
          </span>
        </span>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
      </button>
      {open && <EndpointDetail e={e} c={c} />}
    </div>
  );
}

function ExtractMenu({ c, list }: { c: Catalog; list: Endpoint[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const stamp = c.generatedAt.slice(0, 10);
  const filtered = list.length !== c.endpoints.length;
  const run = async (k: string) => {
    setOpen(false);
    if (k === 'openapi') {
      setBusy(true);
      try { download(`energize-openapi-${stamp}.json`, pretty(await api.get<any>('/api/docs/internal.json'))); } finally { setBusy(false); }
      return;
    }
    if (k === 'postman') download(`energize-postman-${stamp}.json`, pretty(postmanOf(c, list)));
    if (k === 'catalog') download(`energize-api-catalog-${stamp}.json`, pretty({ ...c, endpoints: list }));
    if (k === 'samples') download(`energize-api-samples-${stamp}.json`, pretty(Object.fromEntries(list.filter((e) => e.requestExample || e.responseExample)
      .map((e) => [e.id, { request: e.requestExample, response: e.responseExample, model: e.model || undefined }]))));
    if (k === 'md') download(`energize-api-${stamp}.md`, markdownOf(c, list), 'text/markdown');
    if (k === 'csv') download(`energize-api-endpoints-${stamp}.csv`, csvOf(list), 'text/csv');
  };
  const items: [string, React.ReactNode, string, string][] = [
    ['openapi', <FileJson key="o" className="h-4 w-4" />, 'OpenAPI 3.0 (JSON)', 'Full spec with samples — import into Swagger, Insomnia, code generators'],
    ['postman', <Package key="p" className="h-4 w-4" />, 'Postman collection', 'Folders per group, sample bodies, {{baseUrl}} / {{token}} variables'],
    ['samples', <Braces key="s" className="h-4 w-4" />, 'Sample JSON files', 'Every request and response sample in one file'],
    ['catalog', <Layers key="c" className="h-4 w-4" />, 'Catalog (JSON)', 'Routes, guards, fields and models — machine readable'],
    ['md', <FileText key="m" className="h-4 w-4" />, 'Markdown reference', 'A readable document to share or print'],
    ['csv', <FileSpreadsheet key="v" className="h-4 w-4" />, 'Endpoint list (CSV)', 'One row per endpoint — opens in Excel'],
  ];
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-[#f37121] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-[#e06010] disabled:opacity-60">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Extract
        <ChevronDown className="h-4 w-4 opacity-80" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[340px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-[12px] font-semibold text-slate-900">Download the documentation</p>
            <p className="text-[11.5px] text-slate-500">{filtered ? `Current view — ${list.length} of ${c.endpoints.length} endpoints (OpenAPI is always complete)` : `All ${c.endpoints.length} endpoints`}</p>
          </div>
          {items.map(([k, icon, label, hint]) => (
            <button key={k} type="button" onClick={() => run(k)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
              <span><span className="block text-[13px] font-semibold text-slate-900">{label}</span><span className="block text-[11.5px] leading-snug text-slate-500">{hint}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 backdrop-blur">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>{icon}</div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-white">{value}</p>
      <p className="text-[12px] text-slate-400">{label}</p>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export default function ApiDocsPage() {
  const { user } = useAuth();
  // role-only: the internal API map is for top roles and IT; the server enforces the same list.
  const allowed = !!user && DOCS_ROLES.includes(user.role);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [flash, setFlash] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [methods, setMethods] = useState<Set<Method>>(new Set());
  const [auth, setAuth] = useState<'' | Endpoint['auth']>('');
  const [onlyModel, setOnlyModel] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const sigRef = useRef('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const c = await api.get<Catalog>('/api/docs/catalog.json');
      const changed = sigRef.current && sigRef.current !== c.signature;
      sigRef.current = c.signature;
      setCat(c); setError(''); setCheckedAt(new Date());
      if (changed) { setFlash(`Documentation updated — the API changed (${c.endpoints.length} endpoints)`); setTimeout(() => setFlash(''), 6000); }
    } catch (e: any) { setError(e?.message || 'Could not load the documentation'); }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // Always in sync: poll the surface signature; reload the catalog the moment it changes.
  useEffect(() => {
    if (!allowed) return;
    const tick = async () => {
      try {
        const s = await api.get<{ signature: string }>('/api/docs/stats');
        setCheckedAt(new Date());
        if (sigRef.current && s.signature !== sigRef.current) load(true);
      } catch { /* next tick */ }
    };
    const t = setInterval(tick, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [allowed, load]);

  const list = useMemo(() => {
    if (!cat) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return cat.endpoints.filter((e) => {
      if (group && e.group !== group) return false;
      if (methods.size && !methods.has(e.method)) return false;
      if (auth && e.auth !== auth) return false;
      if (onlyModel && !e.model) return false;
      if (!words.length) return true;
      const hay = `${e.method} ${e.path} ${e.group} ${e.model} ${e.section} ${e.roles.join(' ')} ${e.query.map((f) => f.name).join(' ')} ${e.body.map((f) => f.name).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [cat, q, group, methods, auth, onlyModel]);

  const byGroup = useMemo(() => {
    const m = new Map<string, Endpoint[]>();
    for (const e of list) m.set(e.group, [...(m.get(e.group) || []), e]);
    return [...m.entries()];
  }, [list]);

  const methodCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of cat?.endpoints || []) m[e.method] = (m[e.method] || 0) + 1;
    return m;
  }, [cat]);

  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const active = !!(q || group || methods.size || auth || onlyModel);
  const clear = () => { setQ(''); setGroup(''); setMethods(new Set()); setAuth(''); setOnlyModel(false); };

  if (!allowed) return <div className="p-8 text-slate-500" dir="ltr">Administration and IT only.</div>;

  return (
    <div dir="ltr" lang="en" className="-mx-4 -mt-4 min-h-screen bg-slate-50 font-sans sm:-mx-6 lg:-mx-8">
      {/* ── Hero ── */}
      {/* The hero does not clip (the Extract menu drops below it); only its decoration does. */}
      <div className="relative z-30 bg-[#0b1220] px-4 pb-8 pt-8 sm:px-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '36px 36px' }} />
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#f37121] opacity-20 blur-3xl" />
          <div className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-indigo-500 opacity-20 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f7a26b]">
                <BookOpen className="h-4 w-4" />Developer reference
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Energize Logistics API</h1>
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-400">
                Every endpoint of the platform, generated from the running code — routes, guards, fields and samples.
                Add, change or remove anything in the system and it appears here automatically.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
                  Live{checkedAt ? ` · checked ${checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
                {cat && <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-slate-300 ring-1 ring-white/10">v{cat.version} · {cat.signature}</span>}
                {cat && <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300 ring-1 ring-white/10">Generated {timeOf(cat.generatedAt)}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/api/docs" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/10">
                <ExternalLink className="h-4 w-4" />Partner docs
              </a>
              <button type="button" onClick={() => load(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/10">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh
              </button>
              {cat && <ExtractMenu c={cat} list={list} />}
            </div>
          </div>

          {cat && (
            <>
              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Base URL</span>
                <code className="font-mono text-[13px] text-slate-200">{cat.baseUrl}</code>
                <CopyButton text={cat.baseUrl} dark />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Endpoints" value={cat.endpoints.length} icon={<Zap className="h-4 w-4 text-white" />} accent="bg-[#f37121]" />
                <Stat label="Groups" value={cat.groups.length} icon={<Layers className="h-4 w-4 text-white" />} accent="bg-indigo-500" />
                <Stat label="With documented fields" value={cat.endpoints.filter((e) => e.query.length || e.body.length).length} icon={<Braces className="h-4 w-4 text-white" />} accent="bg-sky-500" />
                <Stat label="Linked to a data model" value={cat.endpoints.filter((e) => e.model).length} icon={<Database className="h-4 w-4 text-white" />} accent="bg-emerald-500" />
                <Stat label="Partner (API key)" value={cat.endpoints.filter((e) => e.auth === 'apiKey').length} icon={<KeyRound className="h-4 w-4 text-white" />} accent="bg-violet-500" />
              </div>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div className="sticky top-2 z-40 mx-auto -mt-4 flex w-fit items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-medium text-white shadow-lg">
          <RefreshCw className="h-4 w-4" />{flash}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-28 text-slate-400">
          <RefreshCw className="h-7 w-7 animate-spin text-[#f37121]" />
          <p className="mt-3 text-sm">Reading the routes from the running code…</p>
        </div>
      ) : error ? (
        <div className="mx-auto mt-10 max-w-lg rounded-2xl bg-white p-6 text-center ring-1 ring-rose-200">
          <p className="font-semibold text-rose-600">Could not load the documentation</p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          <button type="button" onClick={() => load()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Try again</button>
        </div>
      ) : cat && (
        <div className="flex gap-6 px-4 py-6 sm:px-8">
          {/* ── Sidebar: groups ── */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white p-2 ring-1 ring-slate-200">
              <button type="button" onClick={() => setGroup('')}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] font-semibold ${!group ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
                All groups<span className={`rounded px-1.5 text-[11px] ${!group ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{cat.endpoints.length}</span>
              </button>
              <div className="my-2 h-px bg-slate-100" />
              {cat.groups.map((g) => (
                <button key={g.name} type="button" onClick={() => setGroup(g.name === group ? '' : g.name)} title={g.description}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] ${group === g.name ? 'bg-orange-50 font-semibold text-[#c2410c]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
                  <span className="truncate">{titleCase(g.name)}</span>
                  <span className="ml-2 shrink-0 text-[11px] tabular-nums text-slate-400">{g.count}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {/* ── Toolbar ── */}
            <div className="sticky top-0 z-20 -mx-1 mb-5 space-y-3 rounded-2xl bg-slate-50/90 px-1 pb-3 pt-1 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search paths, models, fields, sections, roles…"
                    className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-9 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-[#f37121]" />
                  {q && <button type="button" onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}
                </div>
                <select value={group} onChange={(ev) => setGroup(ev.target.value)}
                  className="rounded-xl border-0 bg-white py-2.5 pl-3 pr-8 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 lg:hidden">
                  <option value="">All groups</option>
                  {cat.groups.map((g) => <option key={g.name} value={g.name}>{titleCase(g.name)} ({g.count})</option>)}
                </select>
                <select value={auth} onChange={(ev) => setAuth(ev.target.value as any)}
                  className="rounded-xl border-0 bg-white py-2.5 pl-3 pr-8 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <option value="">Any authentication</option>
                  <option value="user">User session</option>
                  <option value="apiKey">API key</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Filter className="mr-1 h-3.5 w-3.5 text-slate-400" />
                {METHODS.map((m) => {
                  const on = methods.has(m);
                  return (
                    <button key={m} type="button"
                      onClick={() => setMethods((prev) => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n; })}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11.5px] font-bold ring-1 transition ${on ? METHOD_STYLE[m].soft : 'bg-white text-slate-500 ring-slate-200 hover:text-slate-800'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${METHOD_STYLE[m].dot}`} />{m}<span className="font-sans font-medium opacity-60">{methodCounts[m] || 0}</span>
                    </button>
                  );
                })}
                <button type="button" onClick={() => setOnlyModel((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ring-1 ${onlyModel ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-slate-500 ring-slate-200 hover:text-slate-800'}`}>
                  <Database className="h-3 w-3" />Has data model
                </button>
                <span className="ml-auto text-[12px] text-slate-500"><b className="text-slate-900">{list.length}</b> of {cat.endpoints.length} endpoints</span>
                {active && <button type="button" onClick={clear} className="rounded-lg px-2 py-1 text-[12px] font-semibold text-[#f37121] hover:bg-orange-50">Clear filters</button>}
                {open.size > 0 && <button type="button" onClick={() => setOpen(new Set())} className="rounded-lg px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100">Collapse all</button>}
              </div>
            </div>

            {/* ── Endpoints ── */}
            {byGroup.length === 0 ? (
              <div className="rounded-2xl bg-white py-16 text-center ring-1 ring-slate-200">
                <Terminal className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 font-semibold text-slate-700">No endpoints match</p>
                <p className="text-sm text-slate-400">Try another word or clear the filters.</p>
              </div>
            ) : byGroup.map(([g, items]) => {
              const info = cat.groups.find((x) => x.name === g);
              return (
                <section key={g} className="mb-8" style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${items.length * 52 + 80}px` } as any}>
                  <div className="mb-3 flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold tracking-tight text-slate-900">{titleCase(g)}</h2>
                      <p className="truncate text-[12.5px] text-slate-500"><span className="font-mono text-slate-400">/api/{g}</span>{info?.description ? ` — ${info.description}` : ''}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-600">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((e) => <EndpointRow key={e.id} e={e} c={cat} open={open.has(e.id)} onToggle={() => toggle(e.id)} />)}
                  </div>
                </section>
              );
            })}
          </main>
        </div>
      )}
    </div>
  );
}
