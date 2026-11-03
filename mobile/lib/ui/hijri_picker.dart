// Hijri (Umm al-Qura) date picker: a calendar to pick from, twin of HijriDateInput on the web. Returns the Gregorian "yyyy-mm-dd", the only stored value.
import 'package:flutter/material.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import 'theme.dart';

Future<String?> showHijriDatePicker(BuildContext context, {String initialGregorian = ''}) {
  final now = hijriParts(DateTime.now())!;
  final cur = initialGregorian.isEmpty ? null : hijriParts(initialGregorian);
  return showDialog<String>(context: context, builder: (c) => _HijriPicker(y: cur?.$1 ?? now.$1, m: cur?.$2 ?? now.$2, selected: cur, today: now));
}

class _HijriPicker extends StatefulWidget {
  final int y, m;
  final (int, int, int)? selected;
  final (int, int, int) today;
  const _HijriPicker({required this.y, required this.m, required this.selected, required this.today});
  @override
  State<_HijriPicker> createState() => _HijriPickerState();
}

class _HijriPickerState extends State<_HijriPicker> {
  late int _y = widget.y;
  late int _m = widget.m;

  void _step(int k) => setState(() {
        _m += k;
        if (_m < 1) { _m = 12; _y--; }
        if (_m > 12) { _m = 1; _y++; }
      });

  @override
  Widget build(BuildContext context) {
    final len = hijriMonthLength(_y, _m);
    final first = gregorianOfHijri(_y, _m, 1);
    // Sunday first, as in the Saudi week.
    final lead = first.isEmpty ? 0 : DateTime.parse(first).weekday % 7;
    final days = Lang.instance.ar ? const ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : const ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    final months = Lang.instance.ar ? hijriMonthsAr : hijriMonthsEn;
    return AlertDialog(
      contentPadding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      content: SizedBox(
        width: 320,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: () => _step(-1)),
            Expanded(child: DropdownButton<int>(
              isExpanded: true, value: _m,
              items: [for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(months[i - 1], style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)))],
              onChanged: (v) => setState(() => _m = v ?? _m),
            )),
            const SizedBox(width: 6),
            DropdownButton<int>(
              value: _y,
              items: [for (var y = widget.today.$1 - 100; y <= widget.today.$1 + 40; y++) DropdownMenuItem(value: y, child: Text('$y', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)))],
              onChanged: (v) => setState(() => _y = v ?? _y),
            ),
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: () => _step(1)),
          ]),
          GridView.count(
            crossAxisCount: 7, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), childAspectRatio: 1.15,
            children: [
              for (final d in days) Center(child: Text(d, style: const TextStyle(fontSize: 10.5, color: T.inkFaint))),
              for (var i = 0; i < lead; i++) const SizedBox(),
              for (var d = 1; d <= len; d++)
                Builder(builder: (_) {
                  final on = widget.selected != null && widget.selected!.$1 == _y && widget.selected!.$2 == _m && widget.selected!.$3 == d;
                  final today = widget.today.$1 == _y && widget.today.$2 == _m && widget.today.$3 == d;
                  return InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => Navigator.pop(context, gregorianOfHijri(_y, _m, d)),
                    child: Container(
                      margin: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        color: on ? T.orange : null,
                        borderRadius: BorderRadius.circular(8),
                        border: today && !on ? Border.all(color: T.orange) : null,
                      ),
                      alignment: Alignment.center,
                      child: Text('$d', style: TextStyle(fontSize: 13, fontWeight: on ? FontWeight.w800 : FontWeight.w600, color: on ? Colors.white : T.ink)),
                    ),
                  );
                }),
            ],
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, ''), child: Text(tr('مسح', 'Clear'))),
        TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))),
      ],
    );
  }
}

/// A date field's picker: choose the Gregorian or the Hijri calendar, both return the Gregorian "yyyy-mm-dd" ('' clears, null cancels).
Future<String?> pickDateEitherCalendar(BuildContext context, {String current = '', int firstYear = 1940}) async {
  final which = await showModalBottomSheet<String>(
    context: context,
    builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.calendar_month_outlined), title: Text(tr('بالتقويم الميلادي', 'Gregorian calendar')), onTap: () => Navigator.pop(c, 'g')),
      ListTile(leading: const Icon(Icons.nightlight_outlined), title: Text(tr('بالتقويم الهجري', 'Hijri calendar')), onTap: () => Navigator.pop(c, 'h')),
    ])),
  );
  if (which == null || !context.mounted) return null;
  if (which == 'h') return showHijriDatePicker(context, initialGregorian: current);
  final now = DateTime.now();
  final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(current) ?? now, firstDate: DateTime(firstYear), lastDate: DateTime(now.year + 20));
  return picked?.toIso8601String().substring(0, 10);
}
