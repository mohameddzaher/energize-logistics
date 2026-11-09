import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Shared pieces of the analytics screens (shipment insights, vendors overview and daily): number helpers,
/// tiles, simple bar charts drawn without a chart package, and a multi-select filter sheet.

num inum(dynamic v) => num.tryParse('${v ?? 0}') ?? 0;
bool has(Map? m, String k) => m != null && m.containsKey(k) && m[k] != null;

String fmtNum(dynamic n, {int digits = 0}) {
  if (n == null || '$n'.isEmpty) return '—';
  final v = num.tryParse('$n');
  if (v == null) return '$n';
  final s = digits == 0 || v == v.roundToDouble() ? v.round().toString() : v.toStringAsFixed(digits);
  final parts = s.split('.');
  final head = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return parts.length > 1 ? '$head.${parts[1]}' : head;
}

String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Change against the previous span, as a small coloured line.
Widget deltaText(dynamic cur, dynamic prev, {bool lowerIsBetter = false}) {
  final c = inum(cur);
  final p = inum(prev);
  if (p == 0) return const SizedBox.shrink();
  final ch = ((c - p) / p) * 100;
  final up = ch >= 0;
  final good = lowerIsBetter ? !up : up;
  return Text('${up ? '▲' : '▼'} ${ch.abs().toStringAsFixed(1)}%',
      style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: good ? T.success : T.danger));
}

class KpiTile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final Widget? foot;
  const KpiTile(this.label, this.value, {super.key, this.color = T.ink, this.foot});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color), maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis),
          if (foot != null) foot!,
        ]),
      );
}

/// Tiles laid two or three per row without fixed heights.
class TileWrap extends StatelessWidget {
  final List<Widget> children;
  final int columns;
  const TileWrap(this.children, {super.key, this.columns = 3});
  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += columns) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (var j = 0; j < columns; j++) ...[
            if (j > 0) const SizedBox(width: 6),
            Expanded(child: i + j < children.length ? children[i + j] : const SizedBox.shrink()),
          ],
        ])),
      ));
    }
    return Column(children: rows);
  }
}

class SectionCard extends StatelessWidget {
  final String title;
  final String? note;
  final Widget child;
  final Widget? trailing;
  final Color? accent;
  const SectionCard({super.key, required this.title, required this.child, this.note, this.trailing, this.accent});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: AppCard(topAccent: accent, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            if (trailing != null) trailing!,
          ]),
          if (note != null) Text(note!, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          const SizedBox(height: 6),
          child,
        ])),
      );
}

/// A horizontal bar per row: label, value and a bar scaled to the largest value.
class BarList extends StatelessWidget {
  final List<(String label, num value, String text)> rows;
  final Color color;
  final void Function(int index)? onTap;
  const BarList(this.rows, {super.key, this.color = T.orange, this.onTap});
  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return Padding(padding: const EdgeInsets.all(10), child: Text(tr('لا بيانات', 'No data'), style: const TextStyle(color: T.inkFaint, fontSize: 12)));
    final max = rows.fold<num>(0, (a, r) => r.$2 > a ? r.$2 : a);
    return Column(children: [
      for (var i = 0; i < rows.length; i++)
        InkWell(
          onTap: onTap == null ? null : () => onTap!(i),
          child: Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(rows[i].$1, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
              Text(rows[i].$3, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ]),
            const SizedBox(height: 3),
            ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(
              value: max > 0 ? (rows[i].$2 / max).clamp(0, 1).toDouble() : 0, minHeight: 6, color: color, backgroundColor: T.line.withValues(alpha: 0.35))),
          ])),
        ),
    ]);
  }
}

/// Vertical columns for a trend (days or months); one or two stacked series.
class ColumnChart extends StatelessWidget {
  final List<String> labels;
  final List<num> a;
  final List<num>? b;
  final Color colorA;
  final Color colorB;
  final double height;
  const ColumnChart({super.key, required this.labels, required this.a, this.b, this.colorA = T.orange, this.colorB = T.danger, this.height = 120});
  @override
  Widget build(BuildContext context) {
    if (labels.isEmpty) return const SizedBox.shrink();
    num max = 0;
    for (var i = 0; i < a.length; i++) {
      final t = a[i] + (b != null && i < b!.length ? b![i] : 0);
      if (t > max) max = t;
    }
    final w = labels.length > 20 ? 9.0 : 18.0;
    return SizedBox(
      height: height + 22,
      child: SingleChildScrollView(scrollDirection: Axis.horizontal, reverse: Lang.instance.ar, child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        for (var i = 0; i < labels.length; i++)
          Tooltip(
            message: '${labels[i]}: ${fmtNum(a[i])}${b != null && i < b!.length ? ' / ${fmtNum(b![i])}' : ''}',
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
              if (b != null && i < b!.length) Container(width: w, height: max > 0 ? height * (b![i] / max) : 0, color: colorB.withValues(alpha: 0.8)),
              Container(width: w, height: max > 0 ? height * (a[i] / max) : 0, decoration: BoxDecoration(color: colorA, borderRadius: const BorderRadius.vertical(top: Radius.circular(3)))),
              const SizedBox(height: 3),
              SizedBox(width: w + 14, child: Text(labels[i], textAlign: TextAlign.center, style: const TextStyle(fontSize: 8.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.clip)),
            ])),
          ),
      ])),
    );
  }
}

/// Multi-select of one filter's values with counts and a search; returns the chosen values or null when dismissed.
Future<List<String>?> pickValues(BuildContext context, {required String title, required List<Map<String, dynamic>> options, required List<String> selected, String Function(String)? labelOf}) {
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _ValuesSheet(title: title, options: options, selected: selected, labelOf: labelOf),
  );
}

String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

class _ValuesSheet extends StatefulWidget {
  final String title;
  final List<Map<String, dynamic>> options;
  final List<String> selected;
  final String Function(String)? labelOf;
  const _ValuesSheet({required this.title, required this.options, required this.selected, this.labelOf});
  @override
  State<_ValuesSheet> createState() => _ValuesSheetState();
}

class _ValuesSheetState extends State<_ValuesSheet> {
  late final Set<String> _sel = {...widget.selected};
  String _q = '';
  String _label(String v) => v == '__blank__' ? tr('(فارغ)', '(blank)') : (widget.labelOf?.call(v) ?? v);
  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = widget.options.where((o) => q.isEmpty || _fold(_label('${o['value']}')).contains(q)).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 8, 4), child: Row(children: [
            Expanded(child: Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            if (_sel.isNotEmpty) TextButton(onPressed: () => setState(_sel.clear), child: Text(tr('مسح', 'Clear'))),
            FilledButton(onPressed: () => Navigator.pop(context, _sel.toList()), child: Text(tr('تطبيق', 'Apply'))),
          ])),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: SearchField(hint: tr('بحث…', 'Search…'), onChanged: (v) => setState(() => _q = v))),
          Expanded(child: ListView.builder(
            itemCount: rows.length,
            itemBuilder: (_, i) {
              final v = '${rows[i]['value']}';
              return CheckboxListTile(
                dense: true,
                value: _sel.contains(v),
                onChanged: (on) => setState(() => on == true ? _sel.add(v) : _sel.remove(v)),
                title: Text(_label(v), style: const TextStyle(fontSize: 13)),
                secondary: Text(fmtNum(rows[i]['count']), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              );
            },
          )),
        ]),
      ),
    );
  }
}

/// Grade badge (A–D) with its colour.
Widget gradeBadge(dynamic grade, {dynamic score}) {
  final g = '${grade ?? ''}';
  final c = g == 'A' ? T.success : g == 'B' ? T.info : g == 'C' ? T.warn : T.danger;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
    child: Text(score == null ? g : '$g · $score', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900, color: c)),
  );
}

const trendLabels = {
  'up': ('متزايد', 'Growing', T.success),
  'down': ('متراجع', 'Declining', T.warn),
  'steady': ('مستمر', 'Steady', T.info),
  'new': ('جديد', 'New', T.violet),
  'stopped': ('متوقف', 'Stopped', T.danger),
  'never': ('لم يعمل', 'Not worked', T.inkFaint),
};
Widget trendChip(dynamic t) {
  final x = trendLabels['$t'];
  if (x == null) return const SizedBox.shrink();
  return Chip2(tr(x.$1, x.$2), x.$3);
}
