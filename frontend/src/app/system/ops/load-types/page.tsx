'use client';
// Auto-generated thin page — all behaviour lives in <OpsResourceTable/> driven
// by the resource config in lib/ops.ts. Live mirror of UPL "load-types".
import OpsResourceTable from '@/components/ops/OpsResourceTable';
import { resourceByKey, isOpsStaff, opsText } from '@/lib/ops';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function OpsResourcePage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const cfg = resourceByKey('load-types');
  if (!isOpsStaff(user)) return <div className="text-slate-500 p-8">{opsText(lang).notAuthorized}</div>;
  if (!cfg) return null;
  return <OpsResourceTable cfg={cfg} />;
}
