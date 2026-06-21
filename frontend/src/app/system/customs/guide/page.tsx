'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import {
  ScrollText, ArrowLeft, ArrowRight, MapPin, Layers, Server, Truck, Users,
  FileText, ListChecks, Mail, Building2, Anchor,
} from 'lucide-react';

// Static reference guide (التخليص الجمركى). Content is the domain brief, laid out
// as simple, readable cards. Arabic is the source language of the material.
export default function CustomsGuidePage() {
  const { isRTL } = useLanguage();
  const Back = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6 max-w-5xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/system/customs" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"><Back className="w-4 h-4" /></Link>
        <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center"><ScrollText className="w-5 h-5 text-[#f37121]" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">دليل التخليص الجمركي</h1>
          <p className="text-slate-500 text-sm">شرح مبسّط لعملية ودورة التخليص الجمركي</p>
        </div>
      </div>

      {/* Definition — dark hero card */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm">
        <div className="pointer-events-none absolute -top-10 -left-10 w-32 h-32 rounded-full blur-2xl opacity-20 bg-[#f37121]" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2"><Anchor className="w-5 h-5 text-[#f37121]" /><h2 className="text-white font-bold text-lg">التخليص الجمركي</h2></div>
          <p className="text-slate-300 text-sm leading-relaxed">
            هو عملية استخراج الحاويات من الميناء وما يتبعها من إجراءات على المنصات الخدمية ووكلاء الشحن.
          </p>
        </div>
      </div>

      {/* Branches & team */}
      <Card icon={<MapPin className="w-5 h-5 text-[#f37121]" />} title="الفروع والفريق">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Branch name="فرع جدة" people={['أ/ هيثم محمد إبراهيم', 'مهاب نبيل حسن', 'ماجد بامكريت (أبو تركي)', 'حلمي أحمد عبد الحليم']} />
          <Branch name="فرع الدمام" people={['علي باصرة (معقّب)']} />
        </div>
      </Card>

      {/* 3 divisions */}
      <Card icon={<Layers className="w-5 h-5 text-[#f37121]" />} title="ينقسم التخليص الجمركي إلى 3 أقسام">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['المنصات الخدمية', 'وكلاء الشحن', 'خدمة العملاء (نقل وتحصيل)'].map((d, i) => (
            <div key={d} className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#f37121] text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-slate-800 text-sm font-medium">{d}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Service platforms */}
      <Card icon={<Server className="w-5 h-5 text-[#f37121]" />} title="أولاً: المنصات الخدمية">
        <div className="space-y-2">
          <Platform name="TRACE TRACK" desc="متابعة مسار البواخر والحاويات عن طريق رقم البوليصة أو رقم الحاوية." />
          <Platform name="فسح / ZATCA" desc="إنشاء المعاملات (البيانات) وطباعتها وطباعة أجور التفريغ." />
          <Platform name="منصة مواني" desc="طباعة فواتير أجور الموانئ بمدينة جدة والدمام." />
          <Platform name="منصة البحر الأحمر" desc="طباعة وإنشاء أجور التفريغ للمعاملات في جدة القادمة من بوابة البحر الأحمر." />
          <Platform name="منصة دبي وورلد" desc="طباعة وإنشاء أجور التفريغ للمعاملات في جدة القادمة من محطة موانئ دبي جدة." />
        </div>
      </Card>

      {/* Shipping agents */}
      <Card icon={<Building2 className="w-5 h-5 text-[#f37121]" />} title="ثانياً: وكلاء الشحن">
        <p className="text-slate-600 text-sm leading-relaxed mb-3">
          وكيل الشحن هو عنصر الربط بين الميناء والعميل، ولن تُستكمل الإجراءات الجمركية إلا بعد ربط المعاملة على فسح من قِبل الوكيل.
          الطريقة الأكثر شيوعاً للتواصل هي الإيميل الرسمي للوكيل، وتختلف الإيميلات باختلاف الغرض المطلوب.
        </p>
        <p className="text-slate-900 text-sm font-medium mb-2">أمثلة على خدمات وكيل الشحن:</p>
        <ul className="space-y-1.5">
          {['طلب فاتورة إذن التسليم', 'ربط إذن التسليم', 'طلب فاتورة تمديد إرجاع الحاويات', 'الاستفسار عن البوليصة الأصل والتليكس', 'طلب فاتورة الدامج (أضرار الحاويات)'].map((s) => (
            <Bullet key={s}>{s}</Bullet>
          ))}
        </ul>
        <p className="text-slate-500 text-xs mt-3">في حال عدم رد الوكيل على الإيميل يجب الذهاب إلى مقر الوكيل التابع للمدينة المخصصة في بوليصة الشحن.</p>
      </Card>

      {/* Customer service */}
      <Card icon={<Users className="w-5 h-5 text-[#f37121]" />} title="ثالثاً: خدمة العملاء (نقل وتحصيل)">
        <p className="text-slate-600 text-sm leading-relaxed">
          يتم التواصل مع العملاء بشكل دوري بخصوص موعد وصول الشحنات والحاويات والفواتير. بعد إنهاء الإجراءات الجمركية وفسح الحاويات
          يتم نقلها من قِبل موردين من داخل الميناء إلى الساحة للتخزين والتفريغ أو إلى العميل مباشرةً، كما يوجد نقل برّي داخل المملكة
          من الساحة إلى مواقع العميل. بعد إتمام المعاملة بالكامل تُصدر فواتير ضريبية بالتعاون مع قسم الحسابات وتُرسل للعميل.
        </p>
      </Card>

      {/* Cycle */}
      <Card icon={<Truck className="w-5 h-5 text-[#f37121]" />} title="دورة التخليص الجمركي">
        <ol className="space-y-2">
          {[
            'استلام الأوراق',
            'طباعة البيان الجمركي وسداده',
            'إرسال أوراق الوكيل لوكيل الشحن وطلب فاتورة إذن التسليم',
            'ربط إذن التسليم',
            'طباعة فاتورة أجور الموانئ وسدادها',
            'طباعة فاتورة أجور التفريغ وسدادها',
            'عمل أمر نقل',
            'نقل الحاويات إلى العميل أو الساحة',
            'التفريغ والتخزين',
            'إرجاع الحاويات إلى الوكيل',
            'عمل الفواتير',
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
        <Card icon={<FileText className="w-5 h-5 text-[#f37121]" />} title="الأوراق المطلوبة للمعاملات">
          <ul className="space-y-1.5">
            {['البوليصة', 'الفاتورة التجارية', 'شهادة المنشأ', 'بيان التعبئة', 'شهادة سابر (إن وجدت)'].map((d) => <Bullet key={d}>{d}</Bullet>)}
          </ul>
        </Card>
        <Card icon={<ListChecks className="w-5 h-5 text-[#f37121]" />} title="البيانات المطلوبة لعمل المعاملة على فسح">
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {['رقم البوليصة', 'رقم الفاتورة', 'تاريخ الفاتورة', 'اسم الميناء', 'اسم العميل', 'نوع الفاتورة (C&F / CIF / FOB)', 'عدد الحاويات', 'الوزن الإجمالي للبوليصة', 'قيمة الفاتورة', 'نوع العملة', 'اسم الشركة المصدّرة', 'بلد المنشأ', 'البند الجمركي HS', 'رقم شهادة سابر (إن وجدت)'].map((d, i) => (
              <li key={d} className="text-slate-700 text-sm flex gap-2"><span className="text-slate-400">{i + 1}.</span>{d}</li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Agent papers */}
      <Card icon={<FileText className="w-5 h-5 text-[#f37121]" />} title="أوراق الوكيل تتكوّن من">
        <ul className="space-y-1.5">
          {['البوليصة وعليها ختم التخليص مع كتابة رقم المستورد', 'تفويض العميل للشركة', 'تفويض الشركة لمندوب التخليص'].map((d) => <Bullet key={d}>{d}</Bullet>)}
        </ul>
      </Card>

      {/* Email templates */}
      <Card icon={<Mail className="w-5 h-5 text-[#f37121]" />} title="نماذج الإيميل لوكيل الشحن">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <EmailTpl title="طلب فاتورة إذن التسليم" body={'Dear,\nGreetings,\n\nKindly find attached file & issue DO invoice.'} note="مع إرفاق أوراق الوكيل وعمل السيجنتشر وكتابة رقم البوليصة في الـ subject." />
          <EmailTpl title="طلب ربط إذن التسليم" body={'Dear,\nGreetings,\n\nKindly find attached files & link DO.'} note="مع إرفاق أوراق الوكيل + فاتورة سداد إذن التسليم وعمل السيجنتشر." />
          <EmailTpl title="استعلام موعد وصول الباخرة" body={'Dear,\nGreetings,\n\nKindly Provide ETA for the following BL/s:\n1- (رقم البوليصة)'} note="ويُكتب في الـ subject: ETA enquiry" />
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

function EmailTpl({ title, body, note }: { title: string; body: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" dir="ltr">
      <p className="text-slate-900 text-sm font-semibold mb-1.5" dir="rtl">{title}</p>
      <pre className="text-slate-600 text-xs whitespace-pre-wrap font-sans bg-white border border-slate-200 rounded-md p-2">{body}</pre>
      <p className="text-slate-500 text-xs mt-2" dir="rtl">{note}</p>
    </div>
  );
}
