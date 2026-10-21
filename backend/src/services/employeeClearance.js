/**
 * employeeClearance — إخلاءُ طرفٍ قبل إنهاء الخدمة.
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * أُنهيت خدمةُ موظّفٍ وهو مفوَّضٌ على مركبةٍ من قسم المركبات. فبقيت المركبةُ
 * مقيَّدةً باسم مَن لم يعد موظّفًا: لا مَن يُسأل عنها إن خُولفت، ولا مَن يُطالَب
 * بها إن فُقدت. والقسمُ الذي يملك المركبةَ لم يعلم أصلًا أنّ الرجل غادر.
 *
 * وكان الشرطُ الوحيدُ في `terminateEmployee` هو عهدةُ الأصول. وهي ليست كلَّ ما
 * يحمله موظّف: يحمل تفويضَ مركبة، وحسابَ دخولٍ إلى النظام، وبريدًا مؤسّسيًّا،
 * ومحفظةً فيها نقد. وكلُّ واحدةٍ منها يُصفّيها قسمٌ آخر — فالقائمةُ ليست منعًا
 * تعسّفيًّا بل عنوانُ مَن يُكلَّم قبل الإنهاء.
 *
 * ── وما يمنع وما يُنبِّه ────────────────────────────────────────────────────
 * ما يمنع: ما يبقى بعد الرحيل بلا صاحبٍ — عهدةٌ، تفويضٌ، نقدٌ في محفظة.
 * وما يُنبِّه: ما يُغلَق بضغطة ولا يُفقَد به شيء — حسابُ دخولٍ وبريد. فالمنعُ
 * فيهما يوقف الإنهاء لأجل ما يمكن أن يُعالَج بعده.
 */
const mongoose = require('mongoose');

const fold = (x) => String(x || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '').toLowerCase();

/**
 * مركباتُ السجلّ المقيَّدة باسم هذا الموظّف — بالإقامة أوّلًا ثمّ بالاسم المطويّ.
 *
 * ── ولماذا هذا السجلّ أيضًا ─────────────────────────────────────────────────
 * التفاويضُ عندنا في موضعين: سجلُّ حركةٍ (`VehicleAuthorization`) وورقةٌ مثبتةٌ
 * على المركبة نفسِها (`VehicleMaster.authorizedPerson`). والثانيةُ هي الحجّةُ
 * عند المرور، وكان الفحصُ يقرأ الأولى وحدَها — فمن كان مفوَّضًا بالورقة ولم
 * يُقيَّد في سجلّ الحركة تُنهى خدمتُه والمركبةُ باسمه.
 *
 * والإقامةُ أوثقُ من الاسم: الأسماءُ تتشابه وتُكتب بصيغ، والرقمُ لا.
 */
async function vehiclesHeldBy(employee, VehicleMaster) {
  if (!VehicleMaster || !employee) return [];
  // العمودان معًا: المقيمُ في `iqamaNumber` والسعوديُّ في `nationalId`.
  const ids = [employee.iqamaNumber, employee.nationalId].map((x) => String(x || '').trim()).filter(Boolean);
  const name = fold(`${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.fullName || '');
  const or = [];
  if (ids.length) or.push({ 'authorizedPerson.iqamaNumber': { $in: ids } });
  if (!or.length && !name) return [];
  const rows = await VehicleMaster.find(or.length ? { $or: or } : {})
    .select('plateNumber authorizedPerson fuelCard.cardNumber ownerNameAr').lean();
  if (rows.length || !name) return rows;
  // لا مطابقةَ بالرقم — يُجرَّب الاسمُ مطويًّا، وهو أضعفُ فيُقرأ كتنبيهٍ لا أكثر.
  const all = await VehicleMaster.find({ 'authorizedPerson.name': { $nin: ['', null] } })
    .select('plateNumber authorizedPerson fuelCard.cardNumber ownerNameAr').lean();
  return all.filter((v) => fold(v.authorizedPerson?.name) === name);
}

/** ماذا يحمل هذا الموظّف الآن؟ يُعيد بنودًا موصوفةً بالعربيّة والإنجليزيّة. */
async function checkClearance(employeeId) {
  const id = new mongoose.Types.ObjectId(String(employeeId));
  const M = (n) => { try { return mongoose.model(n); } catch (e) { return null; } };

  const Asset = M('Asset');
  const CompanyEmail = M('CompanyEmail');
  const User = M('User');

  const [assets, emails, logins] = await Promise.all([
    Asset ? Asset.find({ employee: id, status: 'assigned' }).select('name assetTag category').lean() : [],
    CompanyEmail ? CompanyEmail.find({ employee: id, status: 'active' }).select('address').lean() : [],
    User ? User.find({ linkedEmployee: id, isActive: true }).select('email role').lean() : [],
  ]);

  // ── ومركباتُ السجلّ: التفويضُ وشريحةُ الوقود ─────────────────────────────
  const Employee = M('Employee');
  const VehicleMaster = M('VehicleMaster');
  let held = []; let auths = [];
  try {
    const emp = Employee ? await Employee.findById(id).select('firstName lastName fullName arabicName iqamaNumber nationalId').lean() : null;
    held = await vehiclesHeldBy(emp, VehicleMaster);
    // ── التفويضُ من مصدره الواحد ──────────────────────────────────────────
    // كانت هنا قراءتان تمنعان كلٌّ على حدة: الورقةُ على المركبة، وسجلُّ الإسناد
    // القديم. فمن أُلغي تفويضُه من المركبات أو B2C وبقي إسنادُه القديم مفتوحًا
    // («ق أ 4719» و«ق أ 4723») قيل له «أَلغِ التفويضَ أوّلًا» وهو ملغى.
    // والآن يُسأل `currentFor` وحدَه: الورقةُ هي المرجع، والإسنادُ القديم لا
    // يُقرأ إلّا لمركبةٍ لا ورقةَ لها في السجلّ — راجع utils/vehicleAuthorization.
    if (emp) auths = await require('../utils/vehicleAuthorization').currentFor(emp);
  } catch (_) { held = []; auths = []; }

  const blockers = []; const warnings = [];

  if (auths.length) {
    blockers.push({
      kind: 'vehicle_authorization', section: 'المركبات', sectionEn: 'Vehicles',
      ar: `تفويض مركبة ساري (${auths.length})`, en: `${auths.length} active vehicle authorisation(s)`,
      items: auths.map((a) => [a.plateNumber, a.authorizationNumber].filter(Boolean).join(' — ') || 'مركبة'),
      actionAr: 'يُلغى التفويض أو يُنقل لموظّف آخر من قسم المركبات (أو من مركبات B2C) قبل الإنهاء — ومعه تعود شريحة بترو اب إلينا.',
    });
  }

  // ── والشريحةُ تُنزَع ولو كانت المركبةُ مركبتَه ─────────────────────────────
  // يشتري الموظّفُ سيّارتَه وتُركَّب له شريحةُ الشركة هديّةً — فالسيّارةُ سيّارتُه
  // ولا تفويضَ لنا عليها، والشريحةُ شريحتُنا وتصرف من حسابنا. وإنهاءُ خدمته
  // وهي عليه يعني أن يبقى يصرف بها بعد رحيله.
  const chips = held.filter((v) => String(v.fuelCard?.cardNumber || '').trim());
  if (chips.length) {
    blockers.push({
      kind: 'fuel_card', section: 'المركبات', sectionEn: 'Vehicles',
      ar: `شريحة بترو اب في يده (${chips.length})`, en: `${chips.length} Petro App chip(s) still held`,
      items: chips.map((v) => [v.plateNumber, v.fuelCard?.cardNumber].filter(Boolean).join(' — ')),
      actionAr: 'تُنزَع الشريحة من صفحة «بترو اب» أو من سجل المركبات قبل الإنهاء — ولو كانت المركبة ملكه، فالشريحة شريحتنا وتصرف من حسابنا.',
    });
  }

  if (assets.length) {
    blockers.push({
      kind: 'custody', section: 'تقنية المعلومات / الموارد البشرية', sectionEn: 'IT / HR',
      ar: `عهدة لم تُسلَّم (${assets.length})`, en: `${assets.length} custody item(s) not returned`,
      items: assets.map((a) => a.assetTag ? `${a.name} — ${a.assetTag}` : a.name),
      actionAr: 'تُسلَّم العهدة أو تُنقَل من صفحة العهد قبل الإنهاء.',
    });
  }
  if (emails.length) {
    warnings.push({
      kind: 'company_email', section: 'تقنية المعلومات', sectionEn: 'IT',
      ar: `بريد مؤسّسي نشط (${emails.length})`, en: `${emails.length} active company mailbox(es)`,
      items: emails.map((e) => e.address),
      actionAr: 'يُغلق أو يُحوَّل بعد الإنهاء.',
    });
  }
  if (logins.length) {
    warnings.push({
      kind: 'login', section: 'إدارة المستخدمين', sectionEn: 'User admin',
      ar: `حساب دخول نشط (${logins.length})`, en: `${logins.length} active login account(s)`,
      items: logins.map((u) => u.email),
      actionAr: 'يُعطَّل بعد الإنهاء.',
    });
  }

  return { clear: blockers.length === 0, blockers, warnings };
}

module.exports = { checkClearance };
