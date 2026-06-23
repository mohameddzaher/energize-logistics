'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomsGuideTranslations } from '@/lib/translations';
import {
  ScrollText, ArrowLeft, ArrowRight, MapPin, Layers, Server, Truck, Users,
  FileText, ListChecks, Mail, Building2, Anchor,
} from 'lucide-react';

// Static reference guide (التخليص الجمركى). Content is the domain brief, laid out
// as simple, readable cards. Now bilingual via getCustomsGuideTranslations.
export default function CustomsGuidePage() {
  const { isRTL, lang } = useLanguage();
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const tx = getCustomsGuideTranslations(lang);
  const dir = isRTL ? 'rtl' : 'ltr';

  return (
    <div className="space-y-6 max-w-5xl" dir={dir}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/system/customs" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"><Back className="w-4 h-4" /></Link>
        <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center"><ScrollText className="w-5 h-5 text-[#f37121]" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tx.pageTitle}</h1>
          <p className="text-slate-500 text-sm">{tx.pageSubtitle}</p>
        </div>
      </div>

      {/* Definition — dark hero card */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm">
        <div className="pointer-events-none absolute -top-10 -left-10 w-32 h-32 rounded-full blur-2xl opacity-20 bg-[#f37121]" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2"><Anchor className="w-5 h-5 text-[#f37121]" /><h2 className="text-white font-bold text-lg">{tx.definitionTitle}</h2></div>
          <p className="text-slate-300 text-sm leading-relaxed">
            {tx.definitionBody}
          </p>
        </div>
      </div>

      {/* Branches & team */}
      <Card icon={<MapPin className="w-5 h-5 text-[#f37121]" />} title={tx.branchesTitle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Branch name={tx.branchJeddah} people={['أ/ هيثم محمد إبراهيم', 'مهاب نبيل حسن', 'ماجد بامكريت (أبو تركي)', 'حلمي أحمد عبد الحليم']} />
          <Branch name={tx.branchDammam} people={[tx.branchDammamPerson1]} />
        </div>
      </Card>

      {/* 3 divisions */}
      <Card icon={<Layers className="w-5 h-5 text-[#f37121]" />} title={tx.divisionsTitle}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[tx.division1, tx.division2, tx.division3].map((d, i) => (
            <div key={d} className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#f37121] text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-slate-800 text-sm font-medium">{d}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Service platforms */}
      <Card icon={<Server className="w-5 h-5 text-[#f37121]" />} title={tx.platformsTitle}>
        <div className="space-y-2">
          <Platform name="TRACE TRACK" desc={tx.platformTraceTrackDesc} />
          <Platform name={tx.platformFasahName} desc={tx.platformFasahDesc} />
          <Platform name={tx.platformMawaniName} desc={tx.platformMawaniDesc} />
          <Platform name={tx.platformRedSeaName} desc={tx.platformRedSeaDesc} />
          <Platform name={tx.platformDubaiWorldName} desc={tx.platformDubaiWorldDesc} />
        </div>
      </Card>

      {/* Shipping agents */}
      <Card icon={<Building2 className="w-5 h-5 text-[#f37121]" />} title={tx.agentsTitle}>
        <p className="text-slate-600 text-sm leading-relaxed mb-3">
          {tx.agentsIntro}
        </p>
        <p className="text-slate-900 text-sm font-medium mb-2">{tx.agentsServicesLabel}</p>
        <ul className="space-y-1.5">
          {[tx.agentService1, tx.agentService2, tx.agentService3, tx.agentService4, tx.agentService5].map((s) => (
            <Bullet key={s}>{s}</Bullet>
          ))}
        </ul>
        <p className="text-slate-500 text-xs mt-3">{tx.agentsNoReplyNote}</p>
      </Card>

      {/* Customer service */}
      <Card icon={<Users className="w-5 h-5 text-[#f37121]" />} title={tx.customerServiceTitle}>
        <p className="text-slate-600 text-sm leading-relaxed">
          {tx.customerServiceBody}
        </p>
      </Card>

      {/* Cycle */}
      <Card icon={<Truck className="w-5 h-5 text-[#f37121]" />} title={tx.cycleTitle}>
        <ol className="space-y-2">
          {[
            tx.cycleStep1,
            tx.cycleStep2,
            tx.cycleStep3,
            tx.cycleStep4,
            tx.cycleStep5,
            tx.cycleStep6,
            tx.cycleStep7,
            tx.cycleStep8,
            tx.cycleStep9,
            tx.cycleStep10,
            tx.cycleStep11,
          ].map((step, i) => (
            <li key={step} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-slate-800 text-sm">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Required docs + required data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card icon={<FileText className="w-5 h-5 text-[#f37121]" />} title={tx.requiredDocsTitle}>
          <ul className="space-y-1.5">
            {[tx.requiredDoc1, tx.requiredDoc2, tx.requiredDoc3, tx.requiredDoc4, tx.requiredDoc5].map((d) => <Bullet key={d}>{d}</Bullet>)}
          </ul>
        </Card>
        <Card icon={<ListChecks className="w-5 h-5 text-[#f37121]" />} title={tx.requiredDataTitle}>
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {[tx.requiredData1, tx.requiredData2, tx.requiredData3, tx.requiredData4, tx.requiredData5, tx.requiredData6, tx.requiredData7, tx.requiredData8, tx.requiredData9, tx.requiredData10, tx.requiredData11, tx.requiredData12, tx.requiredData13, tx.requiredData14].map((d, i) => (
              <li key={d} className="text-slate-700 text-sm flex gap-2"><span className="text-slate-400">{i + 1}.</span>{d}</li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Agent papers */}
      <Card icon={<FileText className="w-5 h-5 text-[#f37121]" />} title={tx.agentPapersTitle}>
        <ul className="space-y-1.5">
          {[tx.agentPaper1, tx.agentPaper2, tx.agentPaper3].map((d) => <Bullet key={d}>{d}</Bullet>)}
        </ul>
      </Card>

      {/* Email templates */}
      <Card icon={<Mail className="w-5 h-5 text-[#f37121]" />} title={tx.emailTemplatesTitle}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <EmailTpl dir={dir} title={tx.emailTpl1Title} body={'Dear,\nGreetings,\n\nKindly find attached file & issue DO invoice.'} note={tx.emailTpl1Note} />
          <EmailTpl dir={dir} title={tx.emailTpl2Title} body={'Dear,\nGreetings,\n\nKindly find attached files & link DO.'} note={tx.emailTpl2Note} />
          <EmailTpl dir={dir} title={tx.emailTpl3Title} body={`Dear,\nGreetings,\n\nKindly Provide ETA for the following BL/s:\n1- ${tx.emailTpl3BodyPlaceholder}`} note={tx.emailTpl3Note} />
        </div>
      </Card>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">{icon}<h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{title}</h2></div>
      {children}
    </div>
  );
}

function Branch({ name, people }: { name: string; people: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-slate-900 font-semibold text-sm mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#f37121]" />{name}</p>
      <ul className="space-y-1">
        {people.map((p) => <li key={p} className="text-slate-700 text-sm flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#f37121]" />{p}</li>)}
      </ul>
    </div>
  );
}

function Platform({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-slate-900 text-sm font-semibold">{name}</p>
      <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">{desc}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <li className="text-slate-700 text-sm flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#f37121] shrink-0" />{children}</li>;
}

function EmailTpl({ title, body, note, dir }: { title: string; body: string; note: string; dir: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" dir="ltr">
      <p className="text-slate-900 text-sm font-semibold mb-1.5" dir={dir}>{title}</p>
      <pre className="text-slate-600 text-xs whitespace-pre-wrap font-sans bg-white border border-slate-200 rounded-md p-2">{body}</pre>
      <p className="text-slate-500 text-xs mt-2" dir={dir}>{note}</p>
    </div>
  );
}
