'use client';
// داشبورد الموارد البشرية = النظرة الشاملة.
//
// كان فيه صفحتين: دي (أرقام عامة) و«النظرة الشاملة» (كل عمود بكروته). وجود
// اتنين معناه إن حد هيفتح واحدة ويفتكرها كل الحكاية — وده اللي حصل فعلاً.
// بقت واحدة، والمسار ده بيوصّل لها عشان أي لينك قديم يفضل شغّال.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/hr/HRKit';

export default function HrDashboardRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/system/hr/master'); }, [router]);
  return <Spinner />;
}
