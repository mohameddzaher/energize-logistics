/**
 * مراحلُ دورة التخليص كما يرسلها الخادم — وما يُشتقّ منها للعرض.
 *
 * القواعدُ (أيُّ المراحل تَلزم هذه المعاملة، وأيُّها أُغلِق، وكم النسبة) في
 * الخادم وحدَه: `pipelineOf` في backend/src/models/CustomsClearance. والشاشةُ
 * ترسم ما وصلها — فلا تُكتب القاعدةُ مرّتين فتختلفان.
 */
export interface PipelineStep { key: string; done: boolean; locked: boolean; reason?: string; /** الطريقُ الآخر: يُضغَط فيتحوّل الاختيارُ إليه. */ switchable?: boolean }
export interface Pipeline {
  route: '' | 'yard' | 'customer';
  cargoType: 'containers' | 'vehicles';
  steps: PipelineStep[];
  done: number; total: number; percent: number; next: string;
}

export type CargoType = 'containers' | 'vehicles';

/** المراحلُ التي هي نقلٌ — لكلٍّ منها بيانُ سيّاراته في خانات الحاويات. */
export const TRANSPORT_LEGS = ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'] as const;
export const isTransportLeg = (key: string) => (TRANSPORT_LEGS as readonly string[]).includes(key);

/** اسمُ المرحلة — و«الحاويات» تصير «السيّارات» في معاملة السيّارات. */
export const stageName = (stages: Record<string, string>, key: string, cargoType?: string) => {
  const base = stages?.[key] || key;
  if (cargoType !== 'vehicles') return base;
  return base.replace('الحاويات', 'السيّارات').replace('Containers', 'Vehicles');
};

export const unitWord = (cargoType: string | undefined, ar: boolean, plural = true) => {
  if (cargoType === 'vehicles') return ar ? (plural ? 'السيّارات' : 'السيّارة') : (plural ? 'Vehicles' : 'Vehicle');
  return ar ? (plural ? 'الحاويات' : 'الحاوية') : (plural ? 'Containers' : 'Container');
};

/**
 * ترقيمُ ما تكرّر: «سداد أجور الموانئ» دفعتان فهما (١) و(٢) — بترتيب ورودهما.
 * يردّ لكلّ عنصرٍ رقمَه بين أمثاله، أو صفرًا إن كان وحيدًا.
 */
export function ordinals<T>(list: T[], nameOf: (x: T) => string): number[] {
  const total = new Map<string, number>();
  for (const x of list) { const k = nameOf(x).trim(); total.set(k, (total.get(k) || 0) + 1); }
  const seen = new Map<string, number>();
  return list.map((x) => {
    const k = nameOf(x).trim();
    if ((total.get(k) || 0) < 2) return 0;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n;
  });
}

/**
 * اسمُ الملفّ عند تنزيله: «BL-123 - سداد أجور الموانئ (2).pdf».
 * كان يُنزَّل باسمه على القرص — أرقامٌ عشوائيّةٌ لا تقول من أيّ معاملةٍ هو ولا
 * أيَّ ورقة.
 */
export function downloadName(ref: string | undefined, title: string | undefined, n: number, fileName?: string, fileUrl?: string) {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(fileName || '') || /\.([a-z0-9]{2,5})$/i.exec(fileUrl || '') || [])[1] || '';
  const clean = (v: string) => v.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = [clean(ref || ''), clean(title || '') || 'مرفق'].filter(Boolean).join(' - ');
  return `${base}${n ? ` (${n})` : ''}${ext ? `.${ext.toLowerCase()}` : ''}`;
}
