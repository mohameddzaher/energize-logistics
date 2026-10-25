import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/search_field.dart';

/// فلاترُ الأعمدة — نظيرُ رأس الجدول في الويب (useColumnFilters):
/// لكلّ عمودٍ قائمةُ قيمه الموجودةِ فعلًا، يُختار منها واحدةٌ أو أكثر،
/// وتُطبَّق آخرًا على ما تركته الشرائحُ والبحث. والفارغُ «(فارغ)».
class ColDef {
  final String key;
  final String ar;
  final String en;
  final String Function(Map<String, dynamic>) get;
  const ColDef(this.key, this.ar, this.en, this.get);
}

List<Map<String, dynamic>> applyColumnFilters(
    List<Map<String, dynamic>> rows, List<ColDef> cols, Map<String, Set<String>> filters) {
  if (filters.isEmpty) return rows;
  final byKey = {for (final c in cols) c.key: c};
  return rows.where((r) => filters.entries.every((e) {
        final c = byKey[e.key];
        return c == null || e.value.contains(c.get(r));
      })).toList();
}

/// يفتح اللوحة ويردّ الفلاتر الجديدة (أو null إن أُغلقت بلا تطبيق).
Future<Map<String, Set<String>>?> showColumnFilters(
  BuildContext context, {
  required List<ColDef> cols,
  required List<Map<String, dynamic>> rows,
  required Map<String, Set<String>> current,
}) =>
    showModalBottomSheet<Map<String, Set<String>>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ColSheet(cols: cols, rows: rows, initial: {for (final e in current.entries) e.key: {...e.value}}),
    );

class _ColSheet extends StatefulWidget {
  final List<ColDef> cols;
  final List<Map<String, dynamic>> rows;
  final Map<String, Set<String>> initial;
  const _ColSheet({required this.cols, required this.rows, required this.initial});
  @override
  State<_ColSheet> createState() => _ColSheetState();
}

class _ColSheetState extends State<_ColSheet> {
  late final Map<String, Set<String>> _f = widget.initial;
  ColDef? _open;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final h = MediaQuery.of(context).size.height * 0.8;
    return SafeArea(
      child: SizedBox(
        height: h,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 16, 6),
            child: Row(children: [
              if (_open != null)
                IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() { _open = null; _q = ''; })),
              const SizedBox(width: 8),
              Expanded(
                child: Text(_open == null ? tr('فلاتر الأعمدة', 'Column filters') : tr(_open!.ar, _open!.en),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              if (_f.isNotEmpty && _open == null)
                TextButton(onPressed: () => setState(_f.clear), child: Text(tr('مسح الكل', 'Clear all'))),
            ]),
          ),
          Expanded(child: _open == null ? _colList() : _valueList(_open!)),
          Padding(
            padding: const EdgeInsets.all(12),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.pop(context, {for (final e in _f.entries) if (e.value.isNotEmpty) e.key: e.value}),
                child: Text(tr('تطبيق', 'Apply')),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _colList() => ListView(children: [
        for (final c in widget.cols)
          ListTile(
            dense: true,
            title: Text(tr(c.ar, c.en)),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              if ((_f[c.key] ?? const {}).isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(color: T.orange, borderRadius: BorderRadius.circular(10)),
                  child: Text('${_f[c.key]!.length}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                ),
              const Icon(Icons.chevron_right, size: 18),
            ]),
            onTap: () => setState(() { _open = c; _q = ''; }),
          ),
      ]);

  Widget _valueList(ColDef c) {
    final counts = <String, int>{};
    for (final r in widget.rows) {
      final v = c.get(r);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    final keys = counts.keys.toList()..sort();
    final shown = _q.isEmpty ? keys : keys.where((k) => k.toLowerCase().contains(_q.toLowerCase())).toList();
    final sel = _f[c.key] ?? <String>{};
    return Column(children: [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: SearchField(
          key: ValueKey('vals-${c.key}'), // كلُّ عمودٍ يبدأ بخانةٍ فارغة كـ_q
          dense: true,
          hint: tr('بحث في القيم', 'Search values'),
          onChanged: (v) => setState(() => _q = v.trim()),
        ),
      ),
      Row(children: [
        TextButton(onPressed: () => setState(() => _f[c.key] = {...sel, ...shown}), child: Text(tr('تحديد الكل', 'Select all'))),
        TextButton(onPressed: () => setState(() => _f.remove(c.key)), child: Text(tr('مسح', 'Clear'))),
      ]),
      Expanded(
        child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          if (shown.isEmpty && _q.isNotEmpty)
            Padding(padding: const EdgeInsets.all(20), child: Text(tr('لا نتائج مطابقة', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
          for (final k in shown)
            CheckboxListTile(
              dense: true,
              value: sel.contains(k),
              title: Text(k.isEmpty ? tr('(فارغ)', '(blank)') : k),
              secondary: Text('${counts[k]}', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
              onChanged: (v) => setState(() {
                final s = _f.putIfAbsent(c.key, () => <String>{});
                v == true ? s.add(k) : s.remove(k);
                if (s.isEmpty) _f.remove(c.key);
              }),
            ),
        ]),
      ),
    ]);
  }
}
