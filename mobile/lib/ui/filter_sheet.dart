// لوحة فلترة واحدة تصلح لأي شاشة — نظير FilterPanel في الويب.
//
// نفس القواعد الثلاث:
//
// ١) قائمة الحقول وقيمها تأتي من الخادم (`optionsUrl`)، لا تُكتب هنا. فالجنسيات
//    المعروضة هي الموجودة في البيانات فعلًا، وأي عمود جديد يظهر وحده — ولا
//    يفترق التطبيق عن الموقع لأن كليهما يقرأ من المصدر نفسه.
//
// ٢) العدد بجانب كل قيمة محسوب بعد بقيّة الفلاتر، فما تراه هو ما ستحصل عليه.
//
// ٣) الفلتر النشط يبقى مرئيًّا كشرائح فوق الشاشة؛ الفلتر المخفيّ الذي تنساه
//    مفعَّلًا يجعل الأرقام تبدو خاطئة بلا سبب ظاهر.
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';
import 'widgets.dart';

class FilterField {
  final String key;
  final String ar;
  final String en;
  final String groupAr;
  final String groupEn;
  final List<MapEntry<String, int>> values;
  FilterField(this.key, this.ar, this.en, this.groupAr, this.groupEn, this.values);

  static FilterField from(Map j) => FilterField(
        '${j['key']}', '${j['ar'] ?? j['key']}', '${j['en'] ?? j['key']}',
        '${j['groupAr'] ?? ''}', '${j['groupEn'] ?? ''}',
        ((j['values'] as List?) ?? [])
            .map((v) => MapEntry('${v['value']}', (v['count'] as num?)?.toInt() ?? 0))
            .toList(),
      );
}

/// ضمّ/إزالة قيمة من حقل متعدّد القيم (القيم مفصولة بفواصل في نص الاستعلام).
String toggleValue(String? cur, String v) {
  final list = (cur ?? '').split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
  list.contains(v) ? list.remove(v) : list.add(v);
  return list.join(',');
}

/// يفتح اللوحة ويُرجع الفلتر بعد الإغلاق (أو null إن لم يتغيّر شيء).
Future<Map<String, String>?> showFilterSheet({
  required BuildContext context,
  required String optionsUrl,
  required Map<String, String> value,
  Map<String, String> extraLabels = const {},
}) =>
    showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _FilterSheet(optionsUrl: optionsUrl, initial: Map.of(value), extraLabels: extraLabels),
    );

class _FilterSheet extends StatefulWidget {
  final String optionsUrl;
  final Map<String, String> initial;
  final Map<String, String> extraLabels;
  const _FilterSheet({required this.optionsUrl, required this.initial, required this.extraLabels});
  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late Map<String, String> _v = Map.of(widget.initial);
  List<FilterField> _fields = [];
  bool _loading = true;
  String? _expanded;
  final Map<String, String> _search = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  // تُعاد قراءة القيم مع كل تغيير — بعد اختيار «جدة» يصير عدد كل جنسية عددها
  // في جدة لا في الشركة كلها.
  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final q = _v.entries.where((e) => e.value.isNotEmpty)
          .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&');
      final r = await Api.instance.get('${widget.optionsUrl}${q.isEmpty ? '' : '?$q'}');
      final list = ((r['filters'] as List?) ?? []).map((f) => FilterField.from(f as Map)).toList();
      if (mounted) setState(() { _fields = list; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _set(String k, String val) {
    setState(() { val.isEmpty ? _v.remove(k) : _v[k] = val; });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final groups = <String, List<FilterField>>{};
    for (final f in _fields) {
      final g = (Lang.instance.ar ? f.groupAr : f.groupEn);
      groups.putIfAbsent(g.isEmpty ? tr('عام', 'General') : g, () => []).add(f);
    }
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      expand: false,
      builder: (_, controller) => Container(
        decoration: const BoxDecoration(
          color: T.canvas,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
            child: Row(children: [
              const Icon(Icons.tune, size: 20, color: T.navy),
              const SizedBox(width: 8),
              Expanded(child: Text(tr('التصفية', 'Filter'),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: T.ink))),
              if (_v.isNotEmpty)
                TextButton.icon(
                  onPressed: () { setState(() => _v = {}); _load(); },
                  icon: const Icon(Icons.refresh, size: 16),
                  label: Text(tr('مسح الكل', 'Clear all'), style: const TextStyle(fontSize: 12)),
                ),
              IconButton(onPressed: () => Navigator.pop(context, _v), icon: const Icon(Icons.close)),
            ]),
          ),
          if (_v.isNotEmpty)
            SizedBox(
              height: 38,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                children: _chips().map((c) => Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: InputChip(
                    label: Text(c.$3, style: const TextStyle(fontSize: 11, color: Colors.white)),
                    backgroundColor: T.navy,
                    onDeleted: () => _set(c.$1, c.$2.isEmpty ? '' : toggleValue(_v[c.$1], c.$2)),
                    deleteIconColor: Colors.white70,
                  ),
                )).toList(),
              ),
            ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: ListView(
              controller: controller,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
              children: [
                for (final g in groups.entries) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
                    child: Text(g.key,
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.inkFaint)),
                  ),
                  ...g.value.map(_fieldTile),
                ],
                if (!_loading && _fields.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(child: Text(tr('لا توجد فلاتر متاحة', 'No filters available'),
                        style: const TextStyle(color: T.inkFaint))),
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: T.orange),
                  onPressed: () => Navigator.pop(context, _v),
                  child: Text(tr('عرض النتائج', 'Show results')),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  // (المفتاح، القيمة، النص) — القيمة الفارغة تعني شريحةً تُرفع بالكامل.
  List<(String, String, String)> _chips() {
    final out = <(String, String, String)>[];
    for (final e in _v.entries) {
      if (e.value.isEmpty) continue;
      final label = widget.extraLabels[e.key];
      if (label != null) { out.add((e.key, '', '$label: ${e.value}')); continue; }
      final f = _fields.where((x) => x.key == e.key).firstOrNull;
      if (f == null) { out.add((e.key, '', '${e.key}: ${e.value}')); continue; }
      for (final v in e.value.split(',').where((x) => x.isNotEmpty)) {
        out.add((e.key, v, '${Lang.instance.ar ? f.ar : f.en}: $v'));
      }
    }
    return out;
  }

  Widget _fieldTile(FilterField f) {
    final sel = (_v[f.key] ?? '').split(',').where((x) => x.isNotEmpty).toList();
    final open = _expanded == f.key;
    final q = (_search[f.key] ?? '').trim().toLowerCase();
    final vals = q.isEmpty ? f.values : f.values.where((v) => v.key.toLowerCase().contains(q)).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: AppCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        ListTile(
          dense: true,
          title: Text(Lang.instance.ar ? f.ar : f.en,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: T.ink)),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            if (sel.isNotEmpty) Chip2('${sel.length}', T.orange),
            const SizedBox(width: 6),
            Text('${f.values.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            Icon(open ? Icons.expand_less : Icons.expand_more, color: T.inkFaint),
          ]),
          onTap: () => setState(() => _expanded = open ? null : f.key),
        ),
        if (open) ...[
          if (f.values.length > 8)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
              child: TextField(
                decoration: InputDecoration(
                  isDense: true,
                  hintText: tr('بحث…', 'Search…'),
                  prefixIcon: const Icon(Icons.search, size: 16),
                  border: const OutlineInputBorder(),
                ),
                style: const TextStyle(fontSize: 12),
                onChanged: (v) => setState(() => _search[f.key] = v),
              ),
            ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 240),
            child: ListView(
              shrinkWrap: true,
              children: vals.map((v) {
                final on = sel.contains(v.key);
                return InkWell(
                  onTap: () => _set(f.key, toggleValue(_v[f.key], v.key)),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                    child: Row(children: [
                      Icon(on ? Icons.check_box : Icons.check_box_outline_blank,
                          size: 17, color: on ? T.orange : T.inkFaint),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(v.key == '—' ? tr('(بلا قيمة)', '(blank)') : v.key,
                            maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12.5,
                                fontWeight: on ? FontWeight.w700 : FontWeight.w400,
                                color: on ? T.navy : T.inkSoft)),
                      ),
                      Text('${v.value}',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkFaint)),
                    ]),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 6),
        ],
      ]),
      ),
    );
  }
}
