/**
 * أطرافُ التخليص الجمركيّ — العملاءُ ووكلاءُ الشحن.
 *
 * ── لماذا سجلٌّ لا نصٌّ في المعاملة ─────────────────────────────────────────
 * كان اسمُ العميل ووكيلِ الشحن نصًّا حرًّا يُكتب في كلّ معاملة. فالاسمُ الواحد
 * يُكتب بصيغتين فيصير طرفين في التحليل، ولا يُعرف كم عاملنا هذا العميلَ ولا كم
 * حقّقنا معه — لأنّ صفوفَه ليست مجموعةً بشيء.
 *
 * وبريدُ الوكيل كان يُكتب في كلّ معاملةٍ من الذاكرة: بريدٌ واحدٌ يُخطئ فيُرسَل
 * الطلبُ إلى لا أحد. صار في ملفّ الوكيل، ويُملأ وحدَه حين يُختار.
 *
 * والنوعان في مجموعةٍ واحدةٍ بحقل `kind` لا مجموعتين: البنيةُ واحدة (اسمٌ،
 * تواصلٌ، ملاحظات) والفرقُ دورُ الطرف لا شكلُه. ومجموعتان بحقولٍ متطابقة تعني
 * كتابةَ كلّ شيءٍ مرّتين ثمّ نسيانَ إحداهما.
 */
const mongoose = require('mongoose');

const customsPartySchema = new mongoose.Schema({
  // ── والناقلُ طرفٌ ثالث ─────────────────────────────────────────────────────
  // العميلُ صاحبُ البضاعة، والوكيلُ يخلّصها في الميناء، والناقلُ ينقلها منه إلى
  // الساحة أو إلى العميل. كان يُكتب اسمُه نصًّا في المعاملة فلا يُعرف كم نقل لنا
  // ولا بأيّ عقد. والبنيةُ واحدة، فالفرقُ دورٌ في `kind` لا مجموعةٌ ثالثة.
  kind: { type: String, enum: ['customer', 'agent', 'carrier'], required: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  // الاسمُ مطويًّا: يُطابَق به فلا يصير «الفا سوليوشنز» و«ألفا سوليوشنز» طرفين.
  nameKey: { type: String, index: true },
  email: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  contactPerson: { type: String, trim: true, default: '' },
  // ── جهاتُ التواصل — أكثرُ من واحد (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────────────
  // كلُّ جهةٍ مسؤولٌ ببريده وجوّاله معًا، ووصفٌ اختياريٌّ للبريد («للفواتير»،
  // «لإذن التسليم»). والأولى تُنسَخ في `email`/`phone`/`contactPerson` أعلاه لأنّ
  // قوالبَ البريد وما قبلها تقرؤها — راجع mirrorContacts في المتحكّم.
  contacts: {
    type: [{
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      description: { type: String, trim: true, default: '' },
    }],
    default: [],
  },
  // للناقل: موقعُ ساحته — رابطُ خرائط يُفتح منه المكان (٢٠٢٦/١٠/٢٢).
  yardLocationUrl: { type: String, trim: true, default: '' },
  // للعميل: السجلُّ التجاريّ والرقمُ الضريبيّ يُطلبان في كلّ بيانٍ جمركيّ.
  commercialRegister: { type: String, trim: true, default: '' },
  taxNumber: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  // مرفقاتُ الطرف — سجلُّه التجاريّ وشهادتُه الضريبيّة وعقدُه وتفويضُه. تُرفَق
  // مرّةً في ملفّه وتُقرأ من كلّ معاملةٍ هو طرفٌ فيها، لا تُعاد في كلّ معاملة.
  attachments: {
    type: [{
      title: { type: String, trim: true, default: '' },
      fileUrl: { type: String, required: true },
      fileName: { type: String, default: '' },
      mimeType: { type: String, default: '' },
      size: { type: Number, default: 0 },
      uploadedByName: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const fold = (v) => String(v || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

customsPartySchema.pre('save', function preSave(next) { this.nameKey = fold(this.name); next(); });
customsPartySchema.pre('findOneAndUpdate', function preUpd(next) {
  const u = this.getUpdate() || {};
  const name = (u.$set && u.$set.name) || u.name;
  if (name) { u.$set = u.$set || {}; u.$set.nameKey = fold(name); this.setUpdate(u); }
  next();
});

// طرفٌ واحدٌ بالاسم الواحد لكلّ دور — لا عميلان بالاسم نفسِه.
customsPartySchema.index({ kind: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.models.CustomsParty || mongoose.model('CustomsParty', customsPartySchema);
module.exports.fold = fold;
