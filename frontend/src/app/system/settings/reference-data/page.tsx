'use client';
// الشاشة العامّة لكلّ القوائم المرجعيّة. جسمُها في مكوّنٍ مستقلّ لأنّ إعدادات
// الأقسام تعرض المكوّن نفسه مقصورًا على قوائم قسمها — ومسارُ Next لا يقبل
// خصائص مخصَّصة، فبقاؤه هنا كان يعني نسخةً ثانية تتباعد عن الأولى.
import ReferenceDataManager from '@/components/system/ReferenceDataManager';

export default function Page() {
  return <ReferenceDataManager />;
}
