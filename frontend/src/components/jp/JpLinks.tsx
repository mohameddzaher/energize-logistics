'use client';
/**
 * بماذا تتعلّق المهمّة — رقائقُ تُقرأ، ومنتقٍ يربط.
 *
 * «تابِع فاتورةَ النقل» لا تُفهَم إلّا بمعاملتها، و«كلِّم العميل» بعميلها. فتُربَط
 * المهمّةُ بما تخصّه وتُفتَح منه. والأنواعُ المسموحةُ يقولها الخادمُ لكلّ قسم
 * (`linkKinds` في /api/jp/me) — قسمٌ بلا أنواعٍ لا يظهر له شيءٌ من هذا.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { type JpLink, LINK_WORDS, linkHref } from '@/lib/jp';
import { SearchableSelect } from '@/components/hr/HRKit';
import { Ship, Users, Truck, Anchor, X } from 'lucide-react';

const ICON: Record<string, React.ReactNode> = {
  clearance: <Ship className="w-3.5 h-3.5" />, customer: <Users className="w-3.5 h-3.5" />,
  agent: <Anchor className="w-3.5 h-3.5" />, carrier: <Truck className="w-3.5 h-3.5" />,
};

export function LinkChips({ links, ar, onRemove }: { links?: JpLink[]; ar: boolean; onRemove?: (l: JpLink) => void }) {
  if (!links?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.map((l) => {
        const word = LINK_WORDS[l.kind] ? (ar ? LINK_WORDS[l.kind].ar : LINK_WORDS[l.kind].en) : l.kind;
        const body = (
          <>
            {ICON[l.kind]}<span className="text-slate-500">{word}:</span>
            <bdi className="font-semibold text-slate-800 max-w-[16rem] truncate">{l.label || '—'}</bdi>
          </>
        );
        const cls = 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[12px]';
        const href = linkHref(l);
        return (
          <span key={`${l.kind}-${l.ref}`} className="inline-flex items-center">
            {href && !onRemove
              ? <Link href={href} className={`${cls} hover:border-[#f37121] hover:text-[#f37121]`}>{body}</Link>
              : <span className={cls}>{body}</span>}
            {onRemove && (
              <button type="button" onClick={() => onRemove(l)} className="ms-0.5 text-slate-400 hover:text-red-600" aria-label={ar ? 'إزالة الربط' : 'Remove link'}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

type Opt = { value: string; label: string };
const cacheOpts: Record<string, Opt[]> = {};
async function optionsFor(kind: string): Promise<Opt[]> {
  if (cacheOpts[kind]) return cacheOpts[kind];
  let out: Opt[] = [];
  if (kind === 'clearance') {
    // الجاريةُ والقادمةُ معًا: المهمّةُ قد تخصّ معاملةً لم تبدأ بعد.
    const [cur, up] = await Promise.all([
      api.get<{ clearances: any[] }>('/api/customs-clearance'),
      api.get<{ clearances: any[] }>('/api/customs-clearance?upcoming=true').catch(() => ({ clearances: [] })),
    ]);
    out = [...(cur.clearances || []), ...(up.clearances || [])]
      .map((c) => ({ value: String(c._id), label: [c.blNumber || c.refNumber, c.customerName].filter(Boolean).join(' · ') }));
  } else {
    const d = await api.get<{ parties: any[] }>(`/api/customs-clearance/parties?kind=${kind}`);
    out = (d.parties || []).map((p) => ({ value: String(p._id), label: p.name }));
  }
  cacheOpts[kind] = out;
  setTimeout(() => { delete cacheOpts[kind]; }, 60000);
  return out;
}

export function LinkPicker({ kinds, value, onChange, ar }: {
  kinds: string[]; value: JpLink[]; onChange: (links: JpLink[]) => void; ar: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [kind, setKind] = useState(kinds[0] || '');
  const [opts, setOpts] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!kind) return undefined;
    let live = true;
    setLoading(true);
    optionsFor(kind).then((o) => { if (live) setOpts(o); }).catch(() => { if (live) setOpts([]); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [kind]);
  if (!kinds.length) return null;
  const word = (k: string) => (LINK_WORDS[k] ? (ar ? LINK_WORDS[k].ar : LINK_WORDS[k].en) : k);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${kind === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {ICON[k]}{word(k)}
            </button>
          ))}
        </div>
        <div className="min-w-[14rem] flex-1">
          <SearchableSelect value="" searchAfter={0} loading={loading}
            onChange={(v) => {
              const o = opts.find((x) => x.value === v);
              if (!o || value.some((l) => l.kind === kind && l.ref === v)) return;
              onChange([...value, { kind, ref: v, label: o.label }]);
            }}
            placeholder={t(`اختر ${word(kind)} — اكتب للبحث…`, `Pick a ${word(kind)} — type to search…`)}
            searchPlaceholder={t('اكتب للبحث…', 'Type to search…')}
            emptyLabel={t('لا نتائج', 'No match')}
            options={opts} />
        </div>
      </div>
      <LinkChips links={value} ar={ar} onRemove={(l) => onChange(value.filter((x) => !(x.kind === l.kind && x.ref === l.ref)))} />
    </div>
  );
}
