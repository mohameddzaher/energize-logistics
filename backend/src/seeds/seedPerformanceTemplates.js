/**
 * Seed the performance-evaluation templates with the company's REAL criteria,
 * exactly as the departments already use them on paper.
 *
 * Idempotent: templates are matched by (department + nameAr) and updated in
 * place, so re-running refreshes the wording without creating duplicates and
 * without disturbing any evaluation already filled in against them.
 *
 * Run: node src/seeds/seedPerformanceTemplates.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const PerfTemplate = require('../models/PerfTemplate');
const PerfSettings = require('../models/PerfSettings');

// Shorthand: build the 1..5 scale from five Arabic labels, best-first as they
// are written in the source documents (٥ … ١).
const scale = (s5, s4, s3, s2, s1) => [
  { score: 1, label: 'Poor', labelAr: s1 },
  { score: 2, label: 'Below', labelAr: s2 },
  { score: 3, label: 'Acceptable', labelAr: s3 },
  { score: 4, label: 'Good', labelAr: s4 },
  { score: 5, label: 'Excellent', labelAr: s5 },
];

const TEMPLATES = [
  {
    nameAr: 'التخليص والمعقبون',
    name: 'Customs clearance officers',
    department: 'تخليص جمركي',
    tier: 1,
    criteria: [
      {
        titleAr: 'سرعة إنجاز المعاملات الجمركية', weight: 30,
        descriptionAr: 'إنجاز المعاملة الجمركية في وقتها دون تأخير يؤثر على الشحنة.',
        dataSourceAr: 'سجل المعاملات ومواعيد الإنجاز',
        scale: scale('دائماً في الوقت', 'نادراً ما يتأخر', 'أحياناً', 'متأخر', 'مزمن'),
      },
      {
        titleAr: 'دقة الإجراءات والمستندات الجمركية', weight: 25,
        descriptionAr: 'صحة واكتمال البيانات والمستندات دون أخطاء تستوجب التعديل.',
        dataSourceAr: 'مراجعة المستندات والبيانات الجمركية',
        scale: scale('بلا أخطاء', 'خطأ نادر', 'أخطاء بسيطة', 'متكررة', 'مؤثرة'),
      },
      {
        titleAr: 'متابعة الشحنات وتجنّب الغرامات والأرضيات', weight: 20,
        descriptionAr: 'متابعة الحاويات لتفادي الأرضيات والغرامات وتكاليف التأخير.',
        dataSourceAr: 'سجل الأرضيات والغرامات',
        scale: scale('بلا غرامات', 'نادرة', 'أحياناً', 'متكررة', 'مؤثرة'),
      },
      {
        titleAr: 'التنسيق مع العملاء ووكلاء الشحن', weight: 15,
        descriptionAr: 'جودة التواصل مع العميل ووكيل الشحن وسرعة الرد والمتابعة.',
        dataSourceAr: 'مراسلات العملاء والوكلاء',
        scale: scale('استثنائي', 'يفوق المتوقع', 'يلبّي المتوقع', 'دون المتوقع', 'ضعيف'),
      },
      {
        titleAr: 'الالتزام بمنصة فسح والأنظمة الجمركية', weight: 5,
        descriptionAr: 'الالتزام بمتطلبات المنصات والأنظمة الجمركية دون مخالفات.',
        dataSourceAr: 'منصة فسح وسجل المخالفات',
        scale: scale('التزام كامل', 'ملاحظات نادرة', 'بسيطة', 'مخالفات', 'مؤثرة'),
      },
      {
        titleAr: 'رضا العملاء والفرق الداخلية', weight: 5,
        descriptionAr: 'رضا العملاء والفرق الداخلية عن التعاون وجودة الخدمة.',
        dataSourceAr: 'سجل الشكاوى والملاحظات',
        scale: scale('بلا شكاوى', 'نادرة', 'شكوى', 'شكويان', 'متكررة'),
      },
    ],
  },
  {
    nameAr: 'التشغيل — مسؤولو تشغيل الفروع',
    name: 'Branch operations officers',
    department: 'النقل الثقيل',
    tier: 1,
    // No jobTitles → this is the department-wide default form.
    criteria: [
      {
        titleAr: 'المحقَّق (نسبة تنفيذ الحمولات)', weight: 60,
        descriptionAr: 'نسبة الحمولات المنفّذة فعلياً من المستهدف الشهري للفرع.',
        dataSourceAr: 'تقارير التشغيل + سندات الشحن',
        scale: scale('٩٥٪ فأكثر', '٨٥ – ٩٤٪', '٧٥ – ٨٤٪', '٦٥ – ٧٤٪', 'أقل من ٦٥٪'),
      },
      {
        titleAr: 'العميل (متابعة ورضا عملاء الفرع)', weight: 15,
        descriptionAr: 'جودة التعامل مع عملاء الفرع ومتابعة طلباتهم دون شكاوى.',
        dataSourceAr: 'سجل شكاوى ورضا العملاء',
        scale: scale('بلا شكاوى', 'ملاحظات نادرة', 'ملاحظات بسيطة', 'شكاوى متكررة', 'شكاوى مؤثرة'),
      },
      {
        titleAr: 'المورد (إدارة السائقين والموردين)', weight: 15,
        descriptionAr: 'توفير وإدارة السائقين والموردين وتغطية الطلبات في الوقت.',
        dataSourceAr: 'سجل الموردين وحركة السندات',
        scale: scale('تغطية كاملة بلا تأخر', 'تأخر نادر', 'تأخر أحياناً', 'نقص متكرر', 'نقص مؤثر'),
      },
      {
        titleAr: 'الفرع (انضباط تشغيل الفرع)', weight: 5,
        descriptionAr: 'انتظام حركة السندات والاستلامات وانضباط تشغيل الفرع.',
        dataSourceAr: 'سجل حركة السندات والاستلامات',
        scale: scale('منضبط تماماً', 'ملاحظات نادرة', 'ملاحظات', 'خلل متكرر', 'خلل مؤثر'),
      },
      {
        titleAr: 'الوجهات (تغطية الوجهات)', weight: 5,
        descriptionAr: 'تغطية الوجهات المطلوبة وكفاءة توزيعها على الفرع.',
        dataSourceAr: 'تقارير الوجهات',
        scale: scale('تغطية كاملة', 'نقص نادر', 'نقص بسيط', 'نقص متكرر', 'نقص مؤثر'),
      },
    ],
  },
  {
    nameAr: 'المتابعة — متابعة الحمولات والسائقين والسندات',
    name: 'Follow-up team',
    department: 'النقل الثقيل',
    tier: 1,
    criteria: [
      {
        titleAr: 'استلام صور POD (خلال ٤٨ ساعة)', weight: 30,
        descriptionAr: 'تحصيل صور سند التسليم من السائق/المورد خلال ٤٨ ساعة (الهدف ٨٠٪ فأكثر).',
        dataSourceAr: 'سجل استلام POD',
        scale: scale('٩٥٪ فأكثر', '٨٥ – ٩٤٪', '٨٠ – ٨٤٪', '٧٠ – ٧٩٪', 'أقل من ٧٠٪'),
      },
      {
        titleAr: 'ترحيل حالة الطلب والمكالمات', weight: 25,
        descriptionAr: 'ترحيل حالة كل طلب وتسجيل المكالمات بدقة ١٠٠٪ دون أخطاء.',
        dataSourceAr: 'نظام تتبع الطلبات',
        scale: scale('بلا أخطاء', 'خطأ نادر', 'خطأ', 'متكرر', 'مزمن'),
      },
      {
        titleAr: 'مطابقة السائق وقص الكشوفات', weight: 20,
        descriptionAr: 'مطابقة بيانات السائق وقص الكشوفات بدقة ٩٠٪ فأكثر دون أخطاء.',
        dataSourceAr: 'كشوفات المطابقة',
        scale: scale('٩٥٪ فأكثر', '٩٠ – ٩٤٪', '٨٥ – ٨٩٪', '٧٥ – ٨٤٪', 'أقل من ٧٥٪'),
      },
      {
        titleAr: 'وقت الاستجابة والإبلاغ لحل المشكلة', weight: 15,
        descriptionAr: 'سرعة الاستجابة والإبلاغ عن المشكلة واتخاذ إجراء قبل أن يكتشفها العميل.',
        dataSourceAr: 'سجل المشكلات والتصعيد',
        scale: scale('إبلاغ استباقي', 'سريع', 'مقبول', 'متأخر', 'العميل يكتشف أولاً'),
      },
      {
        titleAr: 'رضا الفرق الداخلية', weight: 5,
        descriptionAr: 'تقييم المدير المباشر أسبوعياً لرضا الفرق عن التعاون.',
        dataSourceAr: 'تقييم المدير المباشر',
        scale: scale('ممتاز', 'جيد', 'مقبول', 'دون المتوقع', 'ضعيف'),
      },
      {
        titleAr: 'الوثائق', weight: 5,
        descriptionAr: 'دقة واكتمال الوثائق المطلوبة (غرامة عند الخطأ).',
        dataSourceAr: 'سجل الوثائق',
        scale: scale('دقيقة دائماً', 'خطأ نادر', 'خطأ', 'متكرر', 'مزمن'),
      },
    ],
  },
  {
    nameAr: 'خدمة العملاء — استلام الطلبات والتنسيق',
    name: 'Customer service',
    department: 'خدمة عملاء',
    tier: 1,
    criteria: [
      {
        titleAr: 'دقة استلام تفاصيل الطلب', weight: 30,
        descriptionAr: 'استلام تفاصيل الطلب بدقة دون أخطاء في البيانات المرسلة للعميل (يُسمح بخطأ واحد في اليوم).',
        dataSourceAr: 'التقييم اليومي + ملاحظات المدير',
        scale: scale('بلا أخطاء', 'خطأ نادر', 'خطأ في اليوم', 'أكثر من خطأ', 'أخطاء متكررة'),
      },
      {
        titleAr: 'سؤال العميل + وقت مشاركة الطلب', weight: 20,
        descriptionAr: 'سرعة السؤال عن الطلبات ومشاركتها في الوقت (خصم عن كل نصف ساعة تأخر).',
        dataSourceAr: 'سجل أوقات استلام ومشاركة الطلبات',
        scale: scale('فوري بلا تأخر', 'تأخر بسيط', 'تأخر أحياناً', 'تأخر متكرر', 'تأخر مزمن'),
      },
      {
        titleAr: 'التحديث الاستباقي للعميل (تحميل + تحصيل)', weight: 20,
        descriptionAr: 'تحديث موقف السيارات من التحميل وبيانات التحصيل للعميل بشكل استباقي دون طلب.',
        dataSourceAr: 'جروبات وميلات العملاء',
        scale: scale('استباقي دائماً', 'نادراً ما يتأخر', 'أحياناً بطلب', 'غالباً بطلب', 'لا يحدّث'),
      },
      {
        titleAr: 'حل المشكلات دون تصعيد للعميل', weight: 20,
        descriptionAr: 'معالجة المشكلات داخلياً دون تصعيدها للعميل (خصم عن كل تصعيد غير مبرر).',
        dataSourceAr: 'سجل التصعيدات',
        scale: scale('بلا تصعيد', 'تصعيد نادر', 'تصعيد مبرر', 'تصعيد متكرر', 'تصعيد مؤثر'),
      },
      {
        titleAr: 'رضا الفرق الداخلية', weight: 5,
        descriptionAr: 'رضا الفرق الداخلية عن التعاون (خصم عن كل شكوى صحيحة).',
        dataSourceAr: 'سجل شكاوى الفرق',
        scale: scale('بلا شكاوى', 'شكوى نادرة', 'شكوى', 'شكويان', 'متكررة'),
      },
      {
        titleAr: 'المتابعة مع العملاء للتحصيل (كل ١٠ أيام)', weight: 5,
        descriptionAr: 'متابعة العملاء لدعم التحصيل المالي دورياً كل عشرة أيام.',
        dataSourceAr: 'سجل المتابعة',
        scale: scale('منتظمة دائماً', 'نادراً ما تتأخر', 'أحياناً', 'متأخرة', 'غائبة'),
      },
    ],
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    await PerfSettings.getOrCreate();

    let created = 0; let updated = 0;
    for (const t of TEMPLATES) {
      const total = t.criteria.reduce((s, c) => s + c.weight, 0);
      if (total !== 100) throw new Error(`"${t.nameAr}" weights total ${total}%, expected 100%`);

      const criteria = t.criteria.map((c, i) => ({
        ...c,
        key: `c${i + 1}`,          // stable across re-runs, so saved answers keep resolving
        order: i,
        title: c.title || '',
        description: c.description || '',
        dataSource: c.dataSource || '',
      }));

      const existing = await PerfTemplate.findOne({ department: t.department, nameAr: t.nameAr });
      if (existing) {
        existing.set({ name: t.name, tier: t.tier, criteria, active: true });
        await existing.save();
        updated++;
        console.log(`  updated  ${t.department} → ${t.nameAr} (${criteria.length} criteria)`);
      } else {
        await PerfTemplate.create({
          nameAr: t.nameAr, name: t.name, department: t.department,
          tier: t.tier, jobTitles: t.jobTitles || [], active: true, criteria,
        });
        created++;
        console.log(`  created  ${t.department} → ${t.nameAr} (${criteria.length} criteria)`);
      }
    }
    console.log(`\nDone — ${created} created, ${updated} updated.`);
    process.exit(0);
  } catch (e) {
    console.error('Seed error:', e.message);
    process.exit(1);
  }
})();
