/**
 * عباراتُ «مستورد من الشيت» — تُزال من العرض ومن البيانات.
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * الشيتاتُ استُوردت مرّةً واحدة كي لا تُكتب البياناتُ باليد، والنظامُ بعدها هو
 * المرجعُ الوحيد (راجع ذاكرة «sheets are one-time import»). لكنّ سكربتاتِ
 * الاستيراد كتبت في خانة الملاحظات عباراتٍ مثل «مستورد من شيت الموارد البشرية»
 * — فتظهر في ملفّ الموظّف وفي سجلّ التفاويض كأنّها معلومةٌ عن التفويض، ويقرؤها
 * صاحبُ الشركة على أنّ السجلّ «من الشيت» لا من النظام.
 *
 * فالعبارةُ وحدَها تُزال، وما بقي من الملاحظة (إن كان فيها كلامٌ حقيقيّ) يبقى.
 * والقراءةُ تُنظّفها فورًا، وسكربتُ المطابقة (`reconcileVehicleAuthorizations
 * --apply`) يمحوها من القاعدة.
 */
const PATTERNS = [
  /^\s*مستورد من شيت الموارد البشرية\s*$/,
  /^\s*أُضيف من شيت المركبات\s*—[^\n]*$/,
  /^\s*أُنشئ من شيت مشروع B2C\s*$/,
  /^\s*أُنشئ من واقع الداتا \(شيت المركبات\)\s*$/,
  /^\s*الحالةُ القائمةُ عند الاستيراد\b[^\n]*$/,
];
// «مَن فعل» في سجلّ الحركة: الاستيرادُ يُقرأ «النظام» لا «استيراد شيت القسم».
const IMPORT_ACTORS = ['استيراد شيت القسم'];
const actorShown = (name) => (IMPORT_ACTORS.includes(String(name || '').trim()) ? 'النظام' : name);
// لاحقةٌ تُقصّ ويبقى ما قبلها: «التفويضُ باسم فلان والقائدُ الفعليُّ فلان — من شيت المركبات».
const SUFFIXES = [/\s*—\s*من شيت المركبات\s*$/];

/** الملاحظةُ بلا عبارة الاستيراد — نصٌّ فارغٌ إن لم يبقَ غيرُها. */
function stripImportNote(text) {
  if (text == null) return text;
  let s = String(text);
  if (PATTERNS.some((rx) => rx.test(s))) return '';
  for (const rx of SUFFIXES) s = s.replace(rx, '');
  return s;
}

const isImportNote = (text) => text != null && stripImportNote(text) !== String(text);

/** سطرُ سجلّ الحركة للعرض — بلا عبارة الاستيراد. */
const cleanHistoryEntry = (h) => (h ? { ...h, note: stripImportNote(h.note), byName: actorShown(h.byName) } : h);

module.exports = {
  stripImportNote, isImportNote, cleanHistoryEntry, actorShown, IMPORT_ACTORS, IMPORT_NOTE_PATTERNS: PATTERNS,
};
