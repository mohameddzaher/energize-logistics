/**
 * Strips imported-from-sheet phrases from display and data.
 * Sheets were imported once and the system is the only source of truth afterwards. Import scripts wrote phrases like 'imported from the HR sheet' into notes, which then showed on employee files and the authorization log as if they were information about the authorization.
 * Only the phrase is removed; any real note text stays. Reads clean it on the fly, and the reconcile script (`reconcileVehicleAuthorizations --apply`) erases them from the database.
 */
const PATTERNS = [
  /^\s*مستورد من شيت الموارد البشرية\s*$/,
  /^\s*أُضيف من شيت المركبات\s*—[^\n]*$/,
  /^\s*أُنشئ من شيت مشروع B2C\s*$/,
  /^\s*أُنشئ من واقع الداتا \(شيت المركبات\)\s*$/,
  /^\s*الحالةُ القائمةُ عند الاستيراد\b[^\n]*$/,
];
// Actor in the movement log: an import reads as 'System', not 'department sheet import'.
const IMPORT_ACTORS = ['استيراد شيت القسم'];
const actorShown = (name) => (IMPORT_ACTORS.includes(String(name || '').trim()) ? 'النظام' : name);
// Suffix is cut and the part before it is kept: authorization in X's name, actual driver Y, from the vehicles sheet.
const SUFFIXES = [/\s*—\s*من شيت المركبات\s*$/];

/** Note without the import phrase; empty string if nothing else remains. */
function stripImportNote(text) {
  if (text == null) return text;
  let s = String(text);
  if (PATTERNS.some((rx) => rx.test(s))) return '';
  for (const rx of SUFFIXES) s = s.replace(rx, '');
  return s;
}

const isImportNote = (text) => text != null && stripImportNote(text) !== String(text);

/** Movement-log line for display, without the import phrase. */
const cleanHistoryEntry = (h) => (h ? { ...h, note: stripImportNote(h.note), byName: actorShown(h.byName) } : h);

module.exports = {
  stripImportNote, isImportNote, cleanHistoryEntry, actorShown, IMPORT_ACTORS, IMPORT_NOTE_PATTERNS: PATTERNS,
};
