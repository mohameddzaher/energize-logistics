// Media Go complaints: types and helpers. The vocabularies (issue, location, time, status) are sent by the server with each list (`meta`) from models/MediaGoComplaint, so their text is not written twice.

export const MEDIAGO_API = '/api/b2c/mediago-complaints';
export const MEDIAGO_ROLE = 'mediago_account';

export type VocabItem = { key: string; ar: string; en: string };
export type Vocab = { issue: VocabItem[]; location: VocabItem[]; availability: VocabItem[]; status: VocabItem[] };
export type Can = { partner: boolean; create: boolean; delete: boolean; edit?: boolean; reply: boolean; statuses: string[] };

export type MgFile = { _id?: string; fileUrl: string; fileName?: string; mimeType?: string; size?: number; kind: 'image' | 'video'; uploadedAt?: string };
export type MgHistory = { status: string; note?: string; byName?: string; side: 'energize' | 'mediago'; at: string };
export type MgReply = { _id?: string; text: string; byName?: string; side: 'energize' | 'mediago'; at: string };

export type MgRow = {
  _id: string; ref: string; seq: number; vehicle?: string | null;
  motorcycleNumber: string; plateNumber: string; serialNumber: string; project: string;
  screenNumber: string;
  issue: string; issueOther: string;
  location: string; availability: string; availabilityOther: string;
  status: string; fixedAt?: string | null; closedAt?: string | null;
  fileCount: number; cover: string; hasVideo: boolean;
  replyCount: number; lastReply?: MgReply | null;
  createdByName: string; createdAt: string; updatedAt: string;
};
export type MgFull = MgRow & { files: MgFile[]; statusHistory: MgHistory[]; replies: MgReply[]; /** What it may become now, from the server. */ nextStatuses?: string[] };

export type MgList = {
  items: MgRow[]; total: number; grandTotal: number;
  counts: Record<'status' | 'issue' | 'location' | 'availability', Record<string, number>>;
  meta: Vocab; can: Can;
};

/** Text in the reader's language, or both languages for the partner screen. */
export const vocabLabel = (meta: Vocab | null | undefined, group: keyof Vocab, key: string, lang: 'ar' | 'en' | 'both' = 'ar') => {
  const x = meta?.[group]?.find((v) => v.key === key);
  if (!x) return key || '';
  if (lang === 'both') return `${x.ar} / ${x.en}`;
  return x[lang];
};

/** 'Other' is read as whatever was written in it. */
export const issueText = (meta: Vocab | null | undefined, r: Pick<MgRow, 'issue' | 'issueOther'>, lang: 'ar' | 'en' | 'both' = 'ar') =>
  (r.issue === 'other' && r.issueOther ? r.issueOther : vocabLabel(meta, 'issue', r.issue, lang));
export const availabilityText = (meta: Vocab | null | undefined, r: Pick<MgRow, 'availability' | 'availabilityOther'>, lang: 'ar' | 'en' | 'both' = 'ar') =>
  (r.availability === 'other' && r.availabilityOther ? r.availabilityOther : vocabLabel(meta, 'availability', r.availability, lang));

/** Status colors, one set for cards, table and detail. */
export const STATUS_TONE: Record<string, { pill: string; dot: string; accent: string }> = {
  // 'New' uses the sidebar color (slate-900), not blue, as the system identity.
  new: { pill: 'bg-slate-100 text-slate-900 ring-slate-300', dot: 'bg-slate-900', accent: 'text-slate-900' },
  in_progress: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500', accent: 'text-amber-600' },
  fixed: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', accent: 'text-emerald-600' },
  closed: { pill: 'bg-white text-slate-500 ring-slate-200', dot: 'bg-slate-300', accent: 'text-slate-400' },
};

export const fmtDateTime = (iso?: string | null, ar = true) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
};

// Attachment limits; same as the server (mediagoComplaintController).
export const MG_LIMITS = { maxFiles: 5, imageMB: 8, videoMB: 15, requestMB: 18 };
