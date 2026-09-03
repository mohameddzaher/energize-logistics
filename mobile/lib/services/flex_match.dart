/// ── مطابقةٌ لا تبالي بالمسافات ولا بفروق الرسم ───────────────────────────────
///
/// توأمُ `backend/src/utils/plateKey.js` و`frontend/src/lib/flexMatch.ts`.
/// القاعدةُ واحدةٌ في الأماكن الثلاثة عمدًا: اختلافُها يعني أن تجد شاشةٌ ما لا
/// تجده أخرى، والمستخدمُ يفتح الشاشتين في اليوم نفسه.
///
/// لوحةُ السعودية ثلاثةُ حروفٍ ورقم، والمقطورات حرفان فيُترك موضعُ الثالث
/// فارغًا: «أ ب  3499» بمسافتين. ونحن نخزّنها بمسافةٍ واحدة، والموظّف ينسخها من
/// أبشر بمسافتين — فكان يبحث عن اللوحة التي أمامه فلا يجدها، فيمسح مسافةً بيده.
///
/// فتُنزع المسافاتُ من الطرفين معًا، وتُطوى معها الهمزةُ والتاءُ المربوطة
/// والواوُ المهموزة والتشكيلُ والأرقامُ العربيّة.
String flexFold(Object? v) => (v ?? '')
    .toString()
    .replaceAllMapped(RegExp('[٠-٩]'), (m) => '٠١٢٣٤٥٦٧٨٩'.indexOf(m[0]!).toString())
    .replaceAll(RegExp('[أإآٱ]'), 'ا')
    .replaceAll(RegExp('[ةه]'), 'ه')
    .replaceAll(RegExp('[ىئي]'), 'ي')
    .replaceAll(RegExp('[ؤو]'), 'و')
    .replaceAll(RegExp('[ً-ْـ]'), '')
    .replaceAll(RegExp(r'\s+'), '')
    .toLowerCase();

/// هل يحوي أيٌّ من الحقول نصَّ البحث بعد الطيّ؟ نصٌّ فارغ يعني «الكلّ».
bool flexContains(Object? needle, List<Object?> fields) {
  final n = flexFold(needle);
  if (n.isEmpty) return true;
  return fields.any((f) => flexFold(f).contains(n));
}
