import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// Shared by the three custody screens (daily custody, its dashboard and the branch dashboard): amount format, day key and month picker, so each is not written three times.

String walletMoney(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = n < 0;
  final s = n.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '${neg ? '-' : ''}$b';
}

num walletNum(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

String walletDayKey(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String walletMonthKey(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

/// Last day of the month as YYYY-MM-DD.
String walletMonthEnd(DateTime m) => walletDayKey(DateTime(m.year, m.month + 1, 0));

/// Movement time as HH:mm, as web writes it (en-GB).
String walletTime(dynamic iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '';
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Date in the web format (dd/mm/yyyy).
String walletDateGb(dynamic iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '';
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

String walletUserName(dynamic u) =>
    u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';

const walletMonthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const walletMonthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String walletMonthLabel(DateTime m) => '${tr(walletMonthsAr[m.month - 1], walletMonthsEn[m.month - 1])} ${m.year}';

/// Month picker, twin of MonthPicker on web: a year then twelve months.
Future<DateTime?> pickWalletMonth(BuildContext context, DateTime initial, {int fromYear = 2023, int? toYear}) {
  final last = toYear ?? DateTime.now().year + 1;
  int year = initial.year.clamp(fromYear, last);
  return showDialog<DateTime>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
      title: Row(children: [
        IconButton(onPressed: year > fromYear ? () => setS(() => year--) : null, icon: const Icon(Icons.chevron_left)),
        Expanded(child: Text('$year', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800))),
        IconButton(onPressed: year < last ? () => setS(() => year++) : null, icon: const Icon(Icons.chevron_right)),
      ]),
      content: SizedBox(
        width: 300,
        child: Wrap(spacing: 6, runSpacing: 6, children: List.generate(12, (i) {
          final sel = year == initial.year && i + 1 == initial.month;
          return ChoiceChip(
            label: SizedBox(width: 62, child: Text(tr(walletMonthsAr[i], walletMonthsEn[i]), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12))),
            selected: sel,
            selectedColor: T.orange.withValues(alpha: .25),
            onSelected: (_) => Navigator.pop(c, DateTime(year, i + 1)),
          );
        })),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel')))],
    )),
  );
}
