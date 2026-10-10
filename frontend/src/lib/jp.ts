/**
 * خطّةُ العمل (JP) — الأنواعُ والكلماتُ التي تقرؤها الشاشتان.
 *
 * الموعدُ يُعرَض كما يُنتظَر أن يُقرأ: «يُسلَّم قبل ٣:٠٠ م — بقي ساعةٌ و٢٠ د»،
 * لا تاريخًا يُحسَب منه. والحسابُ هنا في موضعٍ واحدٍ تقرؤه الخطّةُ واللوحة.
 */
export type JpScope = 'section' | 'management';
export type JpAction = '' | 'call' | 'whatsapp' | 'visit' | 'email' | 'meeting' | 'other';

export interface JpMember { _id: string; name: string; role: string; roleAr: string; roleEn: string; isManager?: boolean }
export interface JpAttachment { _id: string; fileUrl: string; fileName: string; phase: 'brief' | 'done'; uploadedByName?: string; uploadedBy?: string }
export interface JpProject {
  _id: string; name: string; description?: string; status: 'active' | 'closed';
  startDate?: string | null; endDate?: string | null; total?: number; done?: number; overdue?: number;
}
export interface JpTask {
  _id: string; kind: 'task' | 'request'; title: string; details?: string; action: JpAction; contact?: string;
  project?: { _id: string; name: string } | null;
  assignedTo: { _id: string } | string; assignedToName: string; createdByName: string;
  createdBy: { _id: string } | string;
  deadlineKind: '' | 'date' | 'hours'; deadlineHours?: number | null; deadlineAt?: string | null;
  status: 'open' | 'done'; state: 'open' | 'overdue' | 'done'; onTime?: boolean | null;
  doneAt?: string | null; doneNote?: string; createdAt: string;
  attachments: JpAttachment[];
  can: { complete: boolean; edit: boolean; remove: boolean; attach: boolean };
  fromManagement?: boolean;
  handedTo?: { _id: string; name: string; state: string }[];
  canHandDown?: boolean;
}
export interface JpMe {
  scope: JpScope; section: string; canManage: boolean; sectionAr: string; sectionEn: string;
  me: string; team: JpMember[]; projects: JpProject[];
}

export const ACTION_WORDS: Record<Exclude<JpAction, ''>, { ar: string; en: string }> = {
  call: { ar: 'اتصال هاتفي', en: 'Phone call' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  visit: { ar: 'زيارة', en: 'Visit' },
  email: { ar: 'بريد إلكتروني', en: 'Email' },
  meeting: { ar: 'اجتماع', en: 'Meeting' },
  other: { ar: 'أخرى', en: 'Other' },
};

const idOf = (v: { _id: string } | string | null | undefined) => (v && typeof v === 'object' ? v._id : (v || ''));
export const jpId = idOf;

/** «ساعةٌ و٢٠ د» / «٣ أيّام» — مدّةٌ تُقرأ. */
export function spanWords(ms: number, ar: boolean): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (m < 60) return ar ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 24) return ar ? `${h} س${r ? ` و${r} د` : ''}` : `${h}h${r ? ` ${r}m` : ''}`;
  const d = Math.floor(h / 24); const hr = h % 24;
  return ar ? `${d} ي${hr ? ` و${hr} س` : ''}` : `${d}d${hr ? ` ${hr}h` : ''}`;
}

const clock = (d: Date, ar: boolean) => d.toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayWord = (d: Date, ar: boolean) => d.toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** سطرُ الموعد ولونُه. `now` يُمرَّر ليتحرّك العدُّ مع الساعة. */
export function deadlineLine(t: Pick<JpTask, 'deadlineAt' | 'deadlineKind' | 'status' | 'doneAt'>, now: number, ar: boolean):
  { text: string; tone: 'none' | 'ok' | 'soon' | 'late' | 'done' } {
  if (!t.deadlineAt) return { text: ar ? 'بلا موعد' : 'No deadline', tone: 'none' };
  const due = new Date(t.deadlineAt);
  // موعدٌ بالساعات يُقال بساعته؛ وموعدٌ بيومٍ يُقال بيومه.
  const when = t.deadlineKind === 'hours' ? `${clock(due, ar)}${sameDay(due, new Date(now)) ? '' : ` · ${dayWord(due, ar)}`}` : dayWord(due, ar);
  if (t.status === 'done') {
    const late = t.doneAt ? new Date(t.doneAt).getTime() > due.getTime() : false;
    return { text: ar ? `الموعد ${when} — ${late ? 'سُلِّمت بعده' : 'سُلِّمت في موعدها'}` : `Due ${when} — ${late ? 'delivered late' : 'on time'}`, tone: 'done' };
  }
  const left = due.getTime() - now;
  if (left < 0) return { text: ar ? `الموعد ${when} — تأخّرت ${spanWords(left, ar)}` : `Due ${when} — ${spanWords(left, ar)} late`, tone: 'late' };
  return {
    text: ar ? `تُسلَّم قبل ${when} — بقي ${spanWords(left, ar)}` : `Due by ${when} — ${spanWords(left, ar)} left`,
    tone: left <= 2 * 3600000 ? 'soon' : 'ok',
  };
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export const TONE_CLASS: Record<string, string> = {
  none: 'text-slate-400', ok: 'text-slate-600', soon: 'text-amber-600 font-semibold',
  late: 'text-red-600 font-semibold', done: 'text-emerald-700',
};

/** ملفٌّ ← نصُّ base64 يُرسَل في الطلب (الخادمُ لا يقبل رفعًا متعدّدَ الأجزاء). */
export const fileToDataUrl = (file: File) => new Promise<{ dataUrl: string; fileName: string }>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ dataUrl: String(r.result), fileName: file.name });
  r.onerror = () => reject(new Error('read failed'));
  r.readAsDataURL(file);
});

/** رقمٌ في خانة «مع مَن» ← رابطُ اتّصالٍ أو واتساب. */
export function contactHref(action: JpAction, contact?: string): string | null {
  const digits = String(contact || '').replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 8) return null;
  if (action === 'whatsapp') {
    let n = digits.replace(/\D/g, '');
    if (n.startsWith('05')) n = `966${n.slice(1)}`;
    return `https://wa.me/${n}`;
  }
  if (action === 'call') return `tel:${digits}`;
  return null;
}

export const qs = (scope: JpScope, section?: string) => `scope=${scope}${scope === 'section' ? `&section=${encodeURIComponent(section || '')}` : ''}`;
