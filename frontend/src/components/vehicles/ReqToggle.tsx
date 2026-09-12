'use client';
// ── «مطلوبٌ منّا هذا المستند؟» — سؤالٌ يُطرَح حيث يُعدَّل المستند ─────────────
//
// ليست كلُّ مركبةٍ في السجلّ مركبتَنا: منها ما هو لموظّفٍ لا نركّب له إلّا شريحةَ
// تتبّع. فتأمينُها وبطاقةُ تشغيلها وفحصُها ليست نقصًا عندنا — ولا نملك أوراقَها
// أصلًا. وكان الصمتُ يُقرأ نقصًا: مركبةٌ بلا تاريخِ فحصٍ ولا وضعٍ مسجَّل تُعَدّ
// «مطلوب — ناقص»، فتُظهر شريحةُ العمل عشراتِ الصفوف أكثرُها لا عملَ فيه.
//
// وكان السؤالُ يُطرَح في استمارة سجل المركبات وحدَها. ومَن يراجع الفحصَ الدوريّ
// يفتح صفحةَ الفحص لا صفحةَ السجلّ، فيرى المركبةَ «ناقصة» ولا يجد فيها ما يقول
// إنها لا تُفحص أصلًا — فيخرج من الشاشة إلى شاشةٍ أخرى ليصحّح ما رآه هنا.
// فالسؤالُ صار حيث يُعدَّل المستند: في استمارة كلّ صفحةِ عائلة، وفي السجلّ.
//
// والمكتوبُ واحدٌ في الحالين: `<root>.statusCode` على المركبة — تقرؤه `docNeed`
// و`stateOf` في الخادم، فما يُكتب من صفحة الفحص يُقرأ في السجلّ وفي النظرة
// الشاملة وفي شرائح العمل بلا نسخةٍ ثانية من الحقيقة.
//
// ولا يُكتب شيءٌ إلّا بضغطة: العدمُ اليوم يعني «مطلوب» ضمنًا، فلو كُتبت من
// أنفسنا عند كلّ حفظٍ لتغيّرت مئاتُ الصفوف بلا أن يطلب ذلك أحد.

/** أوضاعٌ مسجَّلةٌ تعني «غير مطلوب» — كما يقرؤها `docNeed` في lib/vehicleRegistry. */
export const isNotRequiredCode = (code?: string | null) =>
  code === 'not_required' || code === 'not_in_use';

/**
 * وضعٌ ثالثٌ محفوظ لا يُداس عليه بزرَّين.
 *
 * «لدى البنك» و«لدى الجبر» و«نشط» أوضاعٌ حقيقيّةٌ سجّلها الاستيراد أو مستخدمٌ
 * قبلنا، وليست «مطلوب» ولا «غير مطلوب». فتُعرَض بوصفها وضعًا قائمًا ولا يمحوها
 * زرٌّ إلّا بقصد.
 */
export const isOtherCode = (code?: string | null) =>
  !!code && !isNotRequiredCode(code) && code !== 'required' && code !== 'none';

export const ReqToggle = ({ label, code, onChange, ar }: {
  label: string;
  code: string;
  onChange: (v: string) => void;
  ar: boolean;
}) => {
  const off = isNotRequiredCode(code);
  const other = isOtherCode(code);
  const pill = (on: boolean, tone: string) =>
    `px-2 py-[3px] rounded-md text-[11px] font-semibold border transition ${
      on ? tone : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-slate-500">{label}</span>
      <button type="button" onClick={() => onChange('required')}
        className={pill(!off && !other, 'bg-emerald-50 border-emerald-300 text-emerald-700')}>
        {ar ? 'مطلوب' : 'Required'}
      </button>
      <button type="button" onClick={() => onChange('not_required')}
        className={pill(off, 'bg-slate-200 border-slate-300 text-slate-700')}>
        {ar ? 'غير مطلوب' : 'Not required'}
      </button>
      {other && <span className="text-[10.5px] text-blue-600">{ar ? 'وضعٌ مسجَّل' : 'recorded state'}</span>}
    </div>
  );
};

export default ReqToggle;
