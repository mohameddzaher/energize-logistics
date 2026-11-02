// Mirrors frontend/src/lib/nameSound.ts; keep the two in step.
const _arabic = {
  'ب': 'b', 'ت': 't', 'ث': 's', 'ج': 'g', 'ح': 'h', 'خ': 'h', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's',
  'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'h',
};

String _consonants(String word) {
  final String out;
  if (RegExp(r'[؀-ۿ]').hasMatch(word)) {
    out = word.split('').map((c) => _arabic[c] ?? '').join();
  } else {
    out = word.toLowerCase()
        .replaceAll('sh', 's').replaceAll('kh', 'h').replaceAll('gh', 'g').replaceAll('dh', 'd').replaceAll('th', 't')
        .replaceAll('ck', 'k').replaceAll('x', 'ks').replaceAll(RegExp('[qc]'), 'k').replaceAll('j', 'g').replaceAll('p', 'b').replaceAll('v', 'f')
        .replaceAll(RegExp(r'[^a-z]|[aeiouyw]'), '');
  }
  return out.replaceAllMapped(RegExp(r'(.)\1+'), (m) => m[1]!);
}

// The article drops only when a real name is left.
String _skeleton(String word) {
  final bare = _consonants(word.replaceFirst(RegExp(r'^(ال|al|el)', caseSensitive: false), ''));
  return bare.length >= 2 ? bare : _consonants(word);
}

List<String> _skeletons(String text) => text.split(RegExp(r'\s+')).map(_skeleton).where((s) => s.isNotEmpty).toList();

/// Arabic search finds an English name and the reverse: every typed word must start a word of [name].
bool soundsLike(String name, String typed) {
  final wanted = _skeletons(typed);
  if (wanted.isEmpty || wanted.any((w) => w.length < 2)) return false;
  final have = _skeletons(name);
  return wanted.every((w) => have.any((h) => h.startsWith(w)));
}
