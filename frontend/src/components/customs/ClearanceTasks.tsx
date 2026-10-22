'use client';
/**
 * مهامُّ خطّة العمل (JP) المربوطةُ بمعاملةٍ أو طرف — تُقرأ وتُضاف في صفحته.
 *
 * كانت «مهمّة جديدة» تنقل إلى صفحة الخطّة؛ وصاحبُ الشركة (٢٠٢٦/١٠/٢٣): «خلّيني
 * أعملها من نفس المكان جوّا المعاملة». فصارت الصندوقَ المشترك JpTaskPanel الذي
 * يضيف في نافذةٍ فوق الصفحة — وهو نفسُه في صفحات الأقسام الأخرى.
 */
import JpTaskPanel from '@/components/jp/JpTaskPanel';

export default function ClearanceTasks({ kind, refId, ar }: { kind: 'clearance' | 'customer' | 'agent' | 'carrier'; refId: string; ar: boolean }) {
  return <JpTaskPanel section="customs" kind={kind} refId={refId} ar={ar} />;
}
