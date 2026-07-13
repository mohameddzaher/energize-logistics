'use client';
// Generic, config-driven CRUD table for the Operations Platform. One component
// powers every entity page (drivers, cars, branches, …): it lists live data
// from UPL via /api/ops/<key>, supports search/filter/pagination, opens a full
// detail view, and — for the admin tier — create / edit / delete. It refetches
// automatically whenever the backend broadcasts `ops:<key>:changed`.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Plus, Edit, Trash2, Eye, Check, X, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, Loader2,
} from '@/components/hr/HRKit';
import {
  ResourceCfg, Col, FieldDef, Paginated, opsText, locName, statusStyle, fmtDateTime, fmtMoney, fmtNum,
  isOpsAdmin,
} from '@/lib/ops';

const LIMIT = 25;

export default function OpsResourceTable({ cfg }: { cfg: ResourceCfg }) {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const tx = opsText(lang);
  // Some resources (e.g. customers) open a full profile page instead of a modal.
  const openRow = (row: Record<string, unknown>) => {
    if (cfg.profile && row.id) router.push(`/system/ops/${cfg.key}/${row.id}`);
    else setDetail(row);
  };
  const admin = isOpsAdmin(user?.role);
  const writable = admin && Array.isArray(cfg.fields) && cfg.fields.length > 0;

  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<Paginated<unknown>['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false); // true after the first load — gates the full-screen spinner so the search box never unmounts (keeps focus)
  const [stale, setStale] = useState(false); // last fetch failed — keep showing the previous data instead of blanking it
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Debounce the search box (UPL `search` param).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [debounced, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('limit', String(LIMIT));
      qs.set('lang', lang);
      if (debounced) qs.set('search', debounced);
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const d = await api.get<Paginated<Record<string, unknown>>>(`/api/ops/${cfg.key}?${qs.toString()}`);
      setItems(d.items || []);
      setMeta(d.meta || null);
      setStale(false);
    } catch (e) {
      // Keep the last successful data on screen if the API hiccups — don't blank it.
      setStale(true);
    }
    setLoading(false); setLoaded(true);
  }, [cfg.key, page, debounced, filters, lang]);

  useEffect(() => { load(); }, [load]);

  // Live: refetch when this resource changes upstream (our own edits emit the
  // per-resource event instantly; the polled `ops:stats` catches add/delete made
  // directly on the UPL system since those move the counts).
  const onLive = useCallback(() => { load(); }, [load]);
  useSocket(`ops:${cfg.key}:changed`, onLive);
  useSocket('ops:stats', onLive);

  // ---- cell rendering ----
  const renderCell = (row: Record<string, unknown>, col: Col) => {
    const raw = row[col.key];
    switch (col.kind) {
      case 'badge': {
        const s = statusStyle(String(raw));
        return s
          ? <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{lang === 'ar' ? s.ar : s.en}</span>
          : <span className="text-slate-400">{String(raw ?? '—')}</span>;
      }
      case 'bool': {
        const on = raw === true || raw === 'true' || raw === 1;
        return on
          ? <Check className="w-4 h-4 text-emerald-600" />
          : <X className="w-4 h-4 text-slate-300" />;
      }
      case 'date': return <span className="text-slate-600 whitespace-nowrap">{fmtDateTime(raw as string, lang)}</span>;
      case 'money': return <span className="text-slate-800 font-medium">{fmtMoney(raw as number)}</span>;
      case 'num': return <span>{fmtNum(raw as number)}</span>;
      case 'phone': return raw ? <a href={`tel:${raw}`} className="text-[#f37121] hover:underline" dir="ltr">{String(raw)}</a> : <span className="text-slate-400">—</span>;
      case 'rel': return <span>{locName((raw as Record<string, unknown>)?.[col.rel || 'name'], lang) || '—'}</span>;
      case 'img': return raw ? <img src={String(raw)} alt="" className="w-8 h-8 rounded object-contain bg-slate-100" /> : <span className="text-slate-300">—</span>;
      default: {
        const v = locName(raw, lang);
        return <span className="text-slate-800">{v || '—'}</span>;
      }
    }
  };

  // ---- form helpers ----
  const openCreate = () => {
    const init: Record<string, unknown> = {};
    (cfg.fields || []).forEach((f) => { init[f.key] = f.type === 'bool' ? true : ''; });
    setForm(init); setEditing(null); setErr(''); setShowForm(true);
  };
  const openEdit = (row: Record<string, unknown>) => {
    const init: Record<string, unknown> = {};
    (cfg.fields || []).forEach((f) => {
      const v = row[f.key];
      if (f.type === 'localized') init[f.key] = { en: (v as any)?.en ?? (typeof v === 'string' ? v : ''), ar: (v as any)?.ar ?? '' };
      else if (f.type === 'bool') init[f.key] = v === true || v === 'true';
      else if (f.type === 'ref') init[f.key] = (v as any)?.id ?? v ?? '';
      else init[f.key] = v ?? '';
    });
    setForm(init); setEditing(row); setErr(''); setShowForm(true);
  };

  const setField = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const buildPayload = () => {
    const out: Record<string, unknown> = {};
    (cfg.fields || []).forEach((f) => {
      const v = form[f.key];
      if (f.type === 'localized') {
        const o = v as { en?: string; ar?: string };
        if (o && (o.en || o.ar)) out[f.key] = { en: o.en || o.ar, ar: o.ar || o.en };
      } else if (f.type === 'bool') {
        out[f.key] = v ? 'true' : 'false';
      } else if (f.type === 'number') {
        if (v !== '' && v != null) out[f.key] = Number(v);
      } else if (v !== '' && v != null) {
        out[f.key] = v;
      }
    });
    return out;
  };

  const validate = () => (cfg.fields || []).every((f) => {
    if (!f.required) return true;
    const v = form[f.key];
    if (f.type === 'localized') return !!((v as any)?.en || (v as any)?.ar);
    if (f.type === 'bool') return true;
    return v !== '' && v != null;
  });

  const save = async () => {
    if (!validate()) { setErr(tx.required); return; }
    setSaving(true); setErr('');
    try {
      const body = buildPayload();
      if (editing) await api.patch(`/api/ops/${cfg.key}/${editing.id}`, body);
      else await api.post(`/api/ops/${cfg.key}`, body);
      setShowForm(false);
      load();
    } catch (e: any) {
      setErr(e?.message || tx.saveFailed);
    }
    setSaving(false);
  };

  const remove = async (row: Record<string, unknown>) => {
    if (!confirm(tx.confirmDelete)) return;
    try { await api.delete(`/api/ops/${cfg.key}/${row.id}`); load(); }
    catch (e: any) { alert(e?.message || 'Delete failed'); }
  };

  const totalPages = meta?.totalPages || 1;
  const title = lang === 'ar' ? cfg.ar : cfg.en;
  const Icon = cfg.icon;

  if (!loaded) return <Spinner />;
  const anyFilter = !!search || Object.values(filters).some(Boolean);

  // detail rows = every key on the record, formatted lightly. Plain const (NOT a
  // hook) so it stays after the early return without breaking the Rules of Hooks.
  const detailEntries = detail ? Object.entries(detail) : [];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Icon className="w-5 h-5" />}
        title={title}
        subtitle={`${fmtNum(meta?.totalItems ?? items.length)} ${tx.total} · ${tx.live}`}
      >
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className="w-4 h-4" /> {tx.refresh}
        </button>
        {writable && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.add}</PrimaryButton>}
      </PageHeader>

      {stale && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> {lang === 'ar' ? 'تعذّر تحديث البيانات — معروض آخر نسخة محفوظة، وجاري إعادة المحاولة…' : 'Could not refresh — showing last known data, retrying…'}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center flex-wrap">
        <div className="flex-1 relative min-w-[200px]">
          <SearchInput value={search} onChange={setSearch} placeholder={tx.search} />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear search'}><X className="w-4 h-4" /></button>}
        </div>
        {(cfg.filters || []).map((f) => (
          <div key={f.key} className="flex items-center gap-1">
            <Select value={filters[f.key] || ''} onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))}>
              <option value="">{lang === 'ar' ? f.ar : f.en} · {tx.all}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{lang === 'ar' ? o.ar : o.en}</option>)}
            </Select>
            {filters[f.key] && <button type="button" onClick={() => setFilters((p) => ({ ...p, [f.key]: '' }))} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100" aria-label={lang === 'ar' ? 'إلغاء الفلتر' : 'Clear filter'}><X className="w-4 h-4" /></button>}
          </div>
        ))}
        {anyFilter && (
          <button type="button" onClick={() => { setSearch(''); setFilters({}); }} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm whitespace-nowrap">
            <X className="w-4 h-4" /> {lang === 'ar' ? 'مسح الكل' : 'Reset all'}
          </button>
        )}
        {loading && <span className="text-xs text-slate-400 flex items-center gap-1"><span className="w-3 h-3 border-2 border-slate-300 border-t-[#f37121] rounded-full animate-spin" /></span>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-300">
              {cfg.columns.map((c) => <th key={c.key} className="text-start font-semibold px-4 py-3 whitespace-nowrap">{lang === 'ar' ? c.ar : c.en}</th>)}
              <th className="text-end font-semibold px-4 py-3">{tx.actions}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={cfg.columns.length + 1} className="text-center text-slate-800 py-12">{tx.noData}</td></tr>
            ) : items.map((row, i) => (
              <tr key={String(row.id ?? i)} className="border-b border-slate-200/70 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => openRow(row)}>
                {cfg.columns.map((c) => <td key={c.key} className="px-4 py-3 align-middle max-w-[220px] truncate">{renderCell(row, c)}</td>)}
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openRow(row)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" title={tx.details}><Eye className="w-4 h-4" /></button>
                    {writable && <button type="button" onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={tx.edit}><Edit className="w-4 h-4" /></button>}
                    {admin && <button type="button" onClick={() => remove(row)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={tx.delete}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{tx.page} {meta?.currentPage || page} {tx.of} {totalPages}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {tx.prev}</button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center gap-1">{tx.next} <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* detail modal — shows the full raw record */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={`${title} · ${tx.details}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {detailEntries.map(([k, v]) => (
            <div key={k} className="border-b border-slate-100 pb-2">
              <p className="text-slate-400 text-[11px] uppercase tracking-wide">{k}</p>
              <p className="text-slate-800 text-sm break-words">{renderDetailValue(v, lang)}</p>
            </div>
          ))}
        </div>
      </Modal>

      {/* create / edit modal */}
      {writable && (
        <Modal open={showForm} onClose={() => setShowForm(false)} wide
          title={editing ? `${tx.edit} · ${title}` : `${tx.add} · ${title}`}
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
            <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.save}</PrimaryButton>
          </>}
        >
          {err && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(cfg.fields || []).map((f) => <FormField key={f.key} f={f} lang={lang} value={form[f.key]} onChange={(v) => setField(f.key, v)} />)}
          </div>
        </Modal>
      )}
    </div>
  );
}

function renderDetailValue(v: unknown, lang: 'en' | 'ar') {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'object') {
    const ln = locName(v, lang);
    if (ln) return ln;
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v, lang);
  return String(v);
}

function FormField({ f, lang, value, onChange }: { f: FieldDef; lang: 'en' | 'ar'; value: unknown; onChange: (v: unknown) => void }) {
  const label = (lang === 'ar' ? f.ar : f.en) + (f.required ? ' *' : '');
  const span2 = f.type === 'localized';
  if (f.type === 'localized') {
    const o = (value as { en?: string; ar?: string }) || {};
    return (
      <Field label={label} span2>
        <div className="grid grid-cols-2 gap-2">
          <TextInput placeholder="English" value={o.en || ''} onChange={(e) => onChange({ ...o, en: e.target.value })} />
          <TextInput placeholder="العربية" dir="rtl" value={o.ar || ''} onChange={(e) => onChange({ ...o, ar: e.target.value })} />
        </div>
      </Field>
    );
  }
  if (f.type === 'bool') {
    return (
      <Field label={label}>
        <Select value={value ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
          <option value="true">{lang === 'ar' ? 'نعم' : 'Yes'}</option>
          <option value="false">{lang === 'ar' ? 'لا' : 'No'}</option>
        </Select>
      </Field>
    );
  }
  if (f.type === 'select' && f.options) {
    return (
      <Field label={label}>
        <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{lang === 'ar' ? o.ar : o.en}</option>)}
        </Select>
      </Field>
    );
  }
  const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return (
    <Field label={label} span2={f.type === 'image'}>
      <TextInput type={type} value={String(value ?? '')} placeholder={f.note || (f.type === 'ref' ? f.ref + ' id' : '')} onChange={(e) => onChange(e.target.value)} />
      {f.note && <p className="text-[11px] text-slate-400 mt-1">{f.note}</p>}
    </Field>
  );
}
