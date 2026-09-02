const mongoose = require('mongoose');

// An employment contract. Each employee has at most one `active` contract at a
// time. The contract defines the annual leave entitlement that drives the
// progressive leave-balance maths (see utils/leaveBalance.js).
const contractSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    type: { type: String, enum: ['fixed', 'unlimited'], default: 'fixed' },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String }, // YYYY-MM-DD (empty for unlimited)
    durationMonths: { type: Number, default: 12 },

    // Annual leave days granted by this contract (e.g. 30 or 21). This is the
    // entitlement the balance accrues toward.
    annualLeaveDays: { type: Number, required: true, default: 21 },
    // ── ما رُحِّل من العقد السابق ───────────────────────────────────────────
    // الرصيدُ يتراكم من بداية العقد النشط. فلو أُنشئ عقدٌ جديدٌ عند التجديد
    // عاد التراكمُ إلى الصفر، والمأخوذُ يبقى محسوبًا — فيصير رصيدُ الموظّف
    // سالبًا يومَ جُدِّد عقدُه. وأيّامُه غيرُ المستهلَكة حقٌّ له لا تسقط بالتجديد.
    // فتُحسب عند التجديد وتُثبَّت هنا، ويُضاف إليها تراكمُ السنة الجديدة.
    carriedOverDays: { type: Number, default: 0 },
    // العقدُ الذي جُدِّد عنه — يُقرأ به تسلسلُ عقود الموظّف.
    renewedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },

    jobTitle: { type: String, trim: true },
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    probationMonths: { type: Number, default: 3 },

    // «مجدَّد» غيرُ «منتهٍ» وغيرُ «منهًى»: العقدُ لم يُترك ينتهي ولم تُقطَع
    // الخدمةُ به — خلَفه آخر. وخلطُه بـ«منتهٍ» يجعل تقاريرَ العقود المنتهية
    // تعدّ عقودًا جُدِّدت في يومها.
    status: { type: String, enum: ['active', 'expired', 'terminated', 'renewed'], default: 'active' },
    terminatedAt: { type: Date },
    terminationReason: { type: String, trim: true },
    // Set true only once all custody/assets are returned — termination is
    // blocked until then (enforced in the controller).
    custodyReturned: { type: Boolean, default: false },

    // ── ما جاء في ملفّ عقود الموظفين ──────────────────────────────────────
    // العقد ورقةٌ رسميّة لها بياناتٌ لا تعيش في ملفّ الموظّف: رقمُ الهوية كما
    // كُتب في العقد، والمهنةُ **كما في العقد** (تختلف عن المهنة في الإقامة
    // وعن المسمّى الوظيفيّ، وهي التي يُحاسَب عليها عند التفتيش)، والسجلُّ
    // التجاريّ الذي صدر تحته. وكانت الصفحة تعرض ستّة أعمدةٍ من عشرة.
    iqamaNumber: { type: String, trim: true, default: '' },        // الهوية
    employeeNameAr: { type: String, trim: true, default: '' },     // الاسم كما في العقد
    contractProfession: { type: String, trim: true, default: '' }, // المهنة في العقد
    sponsorRegistration: { type: String, trim: true, default: '' },// السجل
    // ── ورقمُ العقد ────────────────────────────────────────────────────────
    // رقمُه في «قوى» — وهو ما يُطلب في التفتيش وفي كلّ مراسلةٍ مع المكتب، لا
    // اسمُ الموظّف. وكان يُبحث عنه في الشيت في كلّ مرّة.
    contractNumber: { type: String, trim: true, default: '', index: true },

    // «غير مطلوب» في خانة الإجازة أو فترة التجربة حالةٌ سليمة لا نقصُ بيانات:
    // العقدُ الموسميّ لا إجازةَ سنويّةً له. ولو حُشرت في الرقم صارت صفرًا،
    // فبدا العقدُ ناقصًا وهو تامّ — فالنصُّ يبقى إلى جانب الرقم.
    annualLeaveText: { type: String, trim: true, default: '' },
    probationText: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

contractSchema.index({ employee: 1, status: 1 });
contractSchema.index({ status: 1 });
contractSchema.index({ endDate: 1 });

module.exports = mongoose.model('Contract', contractSchema);
