'use client';
/**
 * توثيقُ الـ API — السطحُ الداخليُّ كلُّه، يُقرأ بالعين (صاحبُ الشركة، ٢٠٢٦/١٠/٢٥).
 *
 * الوثيقةُ تُبنى في الخادم لحظةَ طلبها من الراوتر والكود نفسِه (services/apiDocs
 * و services/apiFieldScan): المساراتُ وحُرّاسُها وفلاترُ القوائم وحقولُ الحفظ.
 * فلا شيءَ هنا يُكتب بيد، وكلُّ تعديلٍ في النظام يظهر فيها مع النشر.
 *
 * للإدارة وحدَها — `/api/docs/internal.json` يردّ ٤٠٣ لغيرها: خريطةُ ما نملك.
 * وواجهةُ الشركاء (ما يُرسَل لمن يتكامل معنا) رابطُها في رأس الصفحة.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import { BookOpen } from 'lucide-react';

const SWAGGER = '5.17.14';
const DOCS_ROLES = ['super_admin', 'it_manager', 'it_specialist'];

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).SwaggerUIBundle) return resolve();
    const s = document.createElement('script'); s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('swagger'));
    document.body.appendChild(s);
  });
}

export default function ApiDocsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const el = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<{ routes: number; groups: number; partner: number; withFields: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // role-only: الوثيقةُ الداخليّة يحرسها الخادمُ بـFULL_ACCESS_ROLES وحدَها (routes/apiDocs).
  const allowed = !!user && DOCS_ROLES.includes(user.role);

  useEffect(() => {
    if (!allowed) return;
    let gone = false;
    (async () => {
      try {
        const [doc, st] = await Promise.all([
          api.get<any>('/api/docs/internal.json'),
          api.get<any>('/api/docs/stats').catch(() => null),
        ]);
        if (gone) return;
        setStats(st);
        loadCss(`https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER}/swagger-ui.min.css`);
        await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER}/swagger-ui-bundle.min.js`);
        if (gone || !el.current) return;
        (window as any).SwaggerUIBundle({
          spec: doc, domNode: el.current, docExpansion: 'none', defaultModelsExpandDepth: -1,
          filter: true, tryItOutEnabled: false, deepLinking: false,
        });
      } catch (e: any) {
        if (!gone) setError(e?.message || t('تعذّر تحميل التوثيق', 'Could not load the documentation'));
      }
      if (!gone) setLoading(false);
    })();
    return () => { gone = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) return <div className="p-8 text-slate-500">{t('للإدارة فقط.', 'Administration only.')}</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<BookOpen className="h-6 w-6" />}
        title={t('توثيق الـ API', 'API documentation')}
        subtitle={t('يُبنى من الكود لحظةَ فتحه — أيُّ إضافةٍ أو تعديلٍ أو حذفٍ يظهر هنا مع النشر', 'Built from the code when opened — every change appears with each deploy')}
      />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px]">
        {stats && (
          <span className="font-semibold text-slate-700">
            {t(`${stats.routes} مسارًا في ${stats.groups} مجموعة · ${stats.withFields} منها بحقولها`, `${stats.routes} endpoints in ${stats.groups} groups · ${stats.withFields} with fields`)}
          </span>
        )}
        <span className="text-slate-500">
          {t('للشركاء (ما يُرسَل لمن يتكامل معنا):', 'For partners (what you send to integrators):')}{' '}
          <a className="font-semibold text-[#f37121] hover:underline" href="https://api.energize-logistics.com/api/docs" target="_blank" rel="noreferrer">api.energize-logistics.com/api/docs</a>
          {t(' — مع مفتاحه: ‎?key=…', ' — with their key: ?key=…')}
        </span>
        <span className="text-red-700">{t('هذه الصفحة خريطةُ النظام كلِّه — لا تُرسَل خارج الشركة.', 'This page maps the whole system — never share it outside.')}</span>
      </div>
      {loading && <Spinner />}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div dir="ltr" ref={el} className="rounded-xl border border-slate-200 bg-white" />
    </div>
  );
}
