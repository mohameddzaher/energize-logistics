/// Whitespace- and spelling-insensitive matching. Twin of backend/src/utils/plateKey.js and frontend/src/lib/flexMatch.ts; the rule is identical in all three so screens never disagree. Saudi plates have three letters and a number; trailers have two letters with a blank third slot, giving a double space. We store a single space while Absher copies show two, so spaces are stripped on both sides, and hamza, ta marbuta, hamza-on-waw, diacritics and Arabic-Indic digits are folded.
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

/// True if any field contains the search text after folding; empty text matches everything.
bool flexContains(Object? needle, List<Object?> fields) {
  final n = flexFold(needle);
  if (n.isEmpty) return true;
  return fields.any((f) => flexFold(f).contains(n));
}
