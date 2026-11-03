/// Hijri (Umm al-Qura) calendar on mobile, twin of frontend/src/lib/hijri.ts and backend/src/utils/hijri.js. Table instead of computation: web and server read the calendar from Intl (islamic-umalqura) which Dart lacks, and a second algorithm would cause one-day mismatches. The table is generated from Intl: month lengths (29 or 30) from 1 Muharram 1318 to the end of 1500 AH (1900 to 2077 CE), verified day by day. Dates outside the range return empty, never guessed. Hijri is a view of the Gregorian date, not a stored field; only the Gregorian value is saved, as on the web.
library;

const int _y0 = 1318;
// Day number (since 1970-01-01) of 1 Muharram 1318 AH.
const int _firstDay = -25448;
// Month lengths in sequence: '1' = thirty days, '0' = twenty-nine.
const String _bits =
    '101101101010010110101101010010101110101001001111010100010111011010001011011010100101101011010101'
    '001011010110100101011011010010011101101001001101110100100110110110010101010110101100100110110110'
    '001010111010101001011011010100101011101010010101011011001010101011101001001011110100100101110110'
    '001010110110100101010110101011001010101110100100101111010010010111011001001011011100100101101101'
    '010101001101101010100101101101010010101110100101010110110100100110110110010101010111001010010111'
    '010101001011011010100011011101010010101101100101010101101010101010101011010100101011110010010101'
    '110101001010110110100101010111001010101011010110100101010111010010101011100101001011101010100101'
    '101101010010101101101010010101110101001001110110100010110111010001011011010101010101010110101001'
    '010110110100100111011010010011011101001001101110100100110110101010101010110101010100110110110010'
    '010111010101001011011010100101011011010010101011101001010101101101001001101101100100101101110001'
    '010110110100101010110101101001010101110100100101111010010010111011001001011011010100101011101001'
    '100101101011010010101011101010010011110101001001110110100100110110110010101010111001010010111010'
    '101001011011010100101011101010010101101100101010101101010101010101011100010010111101001000111101'
    '100100011101101010010101101101001010101101011010010101101101001010110110100100111011010010011011'
    '011001010101011010101001011101010100101101101010010101101100101010101101010101010101101100101001'
    '101110010010101110101001010111010100101011011010010101011010101010101011010110010101011101001001'
    '011101100100101110101010010110110101001010110110101001010110111001001101101100100101101101010010'
    '101101101010010110101101001010101110100100101111010010010111011001001011011010100101011010101100'
    '101011010110010101011101010010011101101001001101110100010110110110010101010110101010010110110101'
    '001011011010100101011011010010101101010110010101011011001010011011100100101011101010010011110101'
    '001010110110100101010110101010101010101101010100101111010010010111011001001011101010100101101101'
    '010010101101101010010101101101001010101110100101010110110010100110110101010011010110101010010111'
    '010101000111011010010011011101001001101101010101010101101010101001101011010100101011';

const List<String> hijriMonthsAr = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const List<String> hijriMonthsEn = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'];

// Month start days are built once on first use.
List<int>? _starts;
List<int> _monthStarts() {
  final cached = _starts;
  if (cached != null) return cached;
  final out = <int>[_firstDay];
  for (var i = 0; i < _bits.length; i++) {
    out.add(out.last + (_bits.codeUnitAt(i) == 49 ? 30 : 29));
  }
  return _starts = out;
}

String _p2(int n) => n.toString().padLeft(2, '0');

/// Gregorian day "yyyy-mm-dd" as displayed, using the company day (Riyadh, +03:00). A date-only string is taken as is; a full timestamp is read in Riyadh time, not device or UTC time, so the day matches the web.
String gregDay(dynamic v) {
  if (v == null) return '';
  if (v is DateTime) {
    // A date picked by the user keeps the day as picked.
    if (!v.isUtc) return '${v.year}-${_p2(v.month)}-${_p2(v.day)}';
    final r = v.add(const Duration(hours: 3));
    return '${r.year}-${_p2(r.month)}-${_p2(r.day)}';
  }
  final s = v.toString().trim();
  if (s.isEmpty) return '';
  final plain = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (plain != null) return s;
  final d = DateTime.tryParse(s);
  if (d == null) return '';
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.year}-${_p2(r.month)}-${_p2(r.day)}';
}

/// Hijri (year, month, day), or null for a non-date or a date outside the table range.
(int, int, int)? hijriParts(dynamic v) {
  final g = gregDay(v);
  // A malformed date (five-digit year, non-date text) is treated as no date; int.parse used to throw and crash the whole screen.
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(g);
  if (m == null) return null;
  final day = DateTime.utc(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!))
      .millisecondsSinceEpoch ~/ 86400000;
  final st = _monthStarts();
  if (day < st.first || day >= st.last) return null;
  // Binary search for the last month starting on or before this day.
  var lo = 0, hi = st.length - 2;
  while (lo < hi) {
    final mid = (lo + hi + 1) ~/ 2;
    if (st[mid] <= day) { lo = mid; } else { hi = mid - 1; }
  }
  return (_y0 + lo ~/ 12, lo % 12 + 1, day - st[lo] + 1);
}

/// Hijri date of "yyyy-mm-dd", or '' if unreadable.
String hijriDay(dynamic v) {
  final h = hijriParts(v);
  return h == null ? '' : '${h.$1}-${_p2(h.$2)}-${_p2(h.$3)}';
}

/// Hijri date with month name, e.g. 1 Jumada al-Awwal 1448.
String hijriLong(dynamic v, {bool ar = true}) {
  final h = hijriParts(v);
  return h == null ? '' : '${h.$3} ${(ar ? hijriMonthsAr : hijriMonthsEn)[h.$2 - 1]} ${h.$1}';
}

/// Both calendars on one line, Gregorian first, e.g. "2026-10-12 · 1448-05-01 AH"; a non-date returns `empty`.
String bothDates(dynamic v, {bool ar = true, String empty = '—'}) {
  final g = gregDay(v);
  if (g.isEmpty) return empty;
  final h = hijriDay(g);
  return h.isEmpty ? g : '$g · $h ${ar ? 'هـ' : 'AH'}';
}

/// "Corresponding to" line under a picker date, e.g. corresponding to 1 Jumada al-Awwal 1448 AH.
String hijriHint(dynamic v, {bool ar = true}) {
  final h = hijriLong(v, ar: ar);
  if (h.isEmpty) return '';
  return ar ? 'الموافق $h هـ' : '= $h AH';
}

/// Days in a Hijri month (29 or 30), or 0 outside the table.
int hijriMonthLength(int y, int m) {
  final i = (y - _y0) * 12 + (m - 1);
  final st = _monthStarts();
  if (i < 0 || i + 1 >= st.length) return 0;
  return st[i + 1] - st[i];
}

/// Gregorian "yyyy-mm-dd" of a Hijri day, or '' outside the table.
String gregorianOfHijri(int y, int m, int d) {
  final i = (y - _y0) * 12 + (m - 1);
  final st = _monthStarts();
  if (i < 0 || i + 1 >= st.length || d < 1 || d > st[i + 1] - st[i]) return '';
  final g = DateTime.utc(1970).add(Duration(days: st[i] + d - 1));
  return '${g.year}-${_p2(g.month)}-${_p2(g.day)}';
}

/// Gregorian "yyyy-mm-dd" of a Hijri "yyyy-mm-dd" text, or ''.
String gregorianOfHijriText(String h) {
  final m = RegExp(r'^(\d{3,4})-(\d{1,2})-(\d{1,2})$').firstMatch(h.trim());
  if (m == null) return '';
  return gregorianOfHijri(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!));
}
