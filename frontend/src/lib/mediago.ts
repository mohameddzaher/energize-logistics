// شكاوى Media Go — الأنواعُ والمساعدات. المفرداتُ (المشكلة، الموقع، الوقت،
// الحالة) يرسلها الخادمُ مع كلّ قائمة (`meta`) من models/MediaGoComplaint —
// فلا تُكتب نصوصُها هنا مرّةً ثانية.

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
export type MgFull = MgRow & { files: MgFile[]; statusHistory: MgHistory[]; replies: MgReply[]; /** ما يجوز أن تصير إليه الآن — من الخادم. */ nextStatuses?: string[] };

export type MgList = {
  items: MgRow[]; total: number; grandTotal: number;
  counts: Record<'status' | 'issue' | 'location' | 'availability', Record<string, number>>;
  meta: Vocab; can: Can;
};

/** النصُّ بلغة القارئ — أو باللغتين معًا لشاشة الشريك. */
export const vocabLabel = (meta: Vocab | null | undefined, group: keyof Vocab, key: string, lang: 'ar' | 'en' | 'both' = 'ar') => {
  const x = meta?.[group]?.find((v) => v.key === key);
  if (!x) return key || '';
  if (lang === 'both') return `${x.ar} / ${x.en}`;
  return x[lang];
};

/** «أخرى» تُقرأ بما كُتب فيها. */
export const issueText = (meta: Vocab | null | undefined, r: Pick<MgRow, 'issue' | 'issueOther'>, lang: 'ar' | 'en' | 'both' = 'ar') =>
  (r.issue === 'other' && r.issueOther ? r.issueOther : vocabLabel(meta, 'issue', r.issue, lang));
export const availabilityText = (meta: Vocab | null | undefined, r: Pick<MgRow, 'availability' | 'availabilityOther'>, lang: 'ar' | 'en' | 'both' = 'ar') =>
  (r.availability === 'other' && r.availabilityOther ? r.availabilityOther : vocabLabel(meta, 'availability', r.availability, lang));

/** ألوانُ الحالات — واحدةٌ في البطاقات والجدول والتفصيل. */
export const STATUS_TONE: Record<string, { pill: string; dot: string; accent: string }> = {
  // «جديدة» بلون الشريط الجانبيّ (slate-900) لا بالأزرق — هويّةُ النظام.
  new: { pill: 'bg-slate-100 text-slate-900 ring-slate-300', dot: 'bg-slate-900', accent: 'text-slate-900' },
  in_progress: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500', accent: 'text-amber-600' },
  fixed: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', accent: 'text-emerald-600' },
  closed: { pill: 'bg-white text-slate-500 ring-slate-200', dot: 'bg-slate-300', accent: 'text-slate-400' },
};

export const fmtDateTime = (iso?: string | null, ar = true) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
};

// ── حدودُ المرفقات — نفسُها في الخادم (mediagoComplaintController) ─────────
export const MG_LIMITS = { maxFiles: 5, imageMB: 8, videoMB: 15, requestMB: 18 };
