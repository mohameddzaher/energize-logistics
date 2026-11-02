// HR pickers for the app, twin of HrQuickFilters and SearchableSelect on the web. (1) `pickFromList`: searchable bottom list returning the choice, used for closed-list fields: department, nationality, city, project (utils/hrLists on the server). (2) `PickField`: form field that opens it. (3) `HrQuickFilters`: department, city, work status, project and nationality chips above the dashboard and employee list. They write into the same filter the full filter sheet and the server (`buildFilter`) read, so every count matches the web.
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'search_field.dart';
import 'theme.dart';

/// Opens a searchable list and returns the choice ('' = clear, null = cancel).
Future<String?> pickFromList(BuildContext context, {required String title, required List<String> options, String current = ''}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _PickSheet(title: title, options: options, current: current),
  );
}

class _PickSheet extends StatefulWidget {
  final String title;
  final List<String> options;
  final String current;
  const _PickSheet({required this.title, required this.options, required this.current});
  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final list = widget.options.where((o) => _q.isEmpty || o.toLowerCase().contains(_q.toLowerCase())).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(children: [
              Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              if (widget.current.isNotEmpty) TextButton(onPressed: () => Navigator.pop(context, ''), child: Text(tr('مسح', 'Clear'))),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SearchField(
              autofocus: widget.options.length > 8,
              dense: true,
              onChanged: (v) => setState(() => _q = v.trim()),
              hint: tr('ابحث…', 'Search…'),
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: list.isEmpty
                ? Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                : ListView.builder(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    itemCount: list.length,
                    itemBuilder: (_, i) {
                      final o = list[i];
                      final on = o == widget.current;
                      return ListTile(
                        dense: true,
                        title: Text(o, style: TextStyle(fontWeight: on ? FontWeight.w800 : FontWeight.w500, color: on ? T.orange : T.ink)),
                        trailing: on ? const Icon(Icons.check, color: T.orange, size: 18) : null,
                        onTap: () => Navigator.pop(context, o),
                      );
                    },
                  ),
          ),
        ]),
      ),
    );
  }
}

/// Form field whose value is picked from a searchable list.
class PickField extends StatelessWidget {
  final String label;
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String? helper;
  const PickField({super.key, required this.label, required this.value, required this.options, required this.onChanged, this.helper});

  @override
  Widget build(BuildContext context) {
    // An old value not in the list stays visible; hiding it would suggest the field is empty.
    final opts = [if (value.isNotEmpty && !options.contains(value)) value, ...options];
    return InkWell(
      onTap: () async {
        final v = await pickFromList(context, title: label, options: opts, current: value);
        if (v != null) onChanged(v);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, helperText: helper, suffixIcon: const Icon(Icons.arrow_drop_down)),
        child: Text(value.isEmpty ? tr('— اختر —', '— choose —') : value, style: TextStyle(color: value.isEmpty ? T.inkFaint : T.ink)),
      ),
    );
  }
}

/// Names of a reference list (`/api/lookups`) in their Arabic text.
Future<List<String>> loadLookupNamesHr(String type) async {
  try {
    final d = await Api.instance.get('/api/lookups?type=${Uri.encodeComponent(type)}&active=true');
    return [for (final x in List<Map<String, dynamic>>.from(d['items'] ?? [])) '${x['nameAr'] ?? ''}'].where((x) => x.isNotEmpty).toList();
  } catch (_) {
    return const [];
  }
}

const hrQuickKeys = [
  ('department', 'القسم', 'Department'),
  ('staffCategory', 'الفئة الوظيفية', 'Staff category'),
  ('registerNumber', 'السجل التجاري', 'Commercial register'),
  ('branchName', 'المدينة', 'City'),
  ('workStatusText', 'حالة العمل', 'Work status'),
  ('project', 'المشروع', 'Project'),
  ('nationality', 'الجنسية', 'Nationality'),
  ('iqamaProfession', 'المهنة في الإقامة', 'Iqama occupation'),
];

/// Quick filter chips: each opens its values with counts, with search and multi-select.
class HrQuickFilters extends StatelessWidget {
  final Map<String, String> value;
  final ValueChanged<Map<String, String>> onChanged;
  /// Scope constants: `scope=all` in the employee list, as on the web.
  final Map<String, String> params;
  /// Options endpoint: screens outside the HR master (residency fees in finance) count values over their own rows, in the same `{ filters: [...] }` shape.
  final String optionsUrl;
  /// Filters of another screen in the same shape (clearance board); the default is the HR filters.
  final List<(String, String, String)> keys;
  /// Options that came with the screen's own response (`filters: [{key, values: [{value,count,label}]}]`), so no second call.
  final List<Map<String, dynamic>>? facets;
  const HrQuickFilters({super.key, required this.value, required this.onChanged, this.params = const {}, this.optionsUrl = '/api/hr/master/filters', this.keys = hrQuickKeys, this.facets});

  String _labelOf(String key, String v) {
    for (final f in facets ?? const <Map<String, dynamic>>[]) {
      if (f['key'] != key) continue;
      for (final x in List<Map<String, dynamic>>.from(f['values'] ?? [])) { if ('${x['value']}' == v && x['label'] != null) return '${x['label']}'; }
    }
    return v;
  }

  List<String> _sel(String k) => (value[k] ?? '').split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

  Future<void> _open(BuildContext context, String key, String title) async {
    final q = <String>[];
    ({...params, ...value}).forEach((k, v) { if (v.isNotEmpty) q.add('$k=${Uri.encodeComponent(v)}'); });
    List<MapEntry<String, int>> opts = [];
    final labels = <String, String>{};
    try {
      final fs = facets ?? List<Map<String, dynamic>>.from((await Api.instance.get('$optionsUrl${q.isEmpty ? '' : '?${q.join('&')}'}'))['filters'] ?? []);
      for (final f in fs) {
        if (f['key'] == key) {
          for (final v in List<Map<String, dynamic>>.from(f['values'] ?? [])) {
            opts.add(MapEntry('${v['value']}', (v['count'] as num?)?.toInt() ?? 0));
            if (v['label'] != null) labels['${v['value']}'] = '${v['label']}';
          }
        }
      }
    } catch (_) {}
    if (!context.mounted) return;
    final picked = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _MultiSheet(title: title, options: opts, initial: _sel(key), labels: labels),
    );
    if (picked == null) return;
    final n = Map<String, String>.from(value);
    if (picked.isEmpty) { n.remove(key); } else { n[key] = picked.join(','); }
    onChanged(n);
  }

  @override
  Widget build(BuildContext context) {
    final any = keys.any((k) => _sel(k.$1).isNotEmpty);
    return Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
      for (final k in keys)
        Builder(builder: (_) {
          final sel = _sel(k.$1);
          final on = sel.isNotEmpty;
          final label = tr(k.$2, k.$3);
          return ActionChip(
            onPressed: () => _open(context, k.$1, label),
            backgroundColor: on ? T.orange : Colors.white,
            side: BorderSide(color: on ? T.orange : T.line),
            label: Text(on ? '$label: ${sel.length == 1 ? (sel.first == '—' ? tr('غير محدد', 'Not set') : _labelOf(k.$1, sel.first)) : tr('${sel.length} مختار', '${sel.length} selected')}' : label,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
            avatar: Icon(on ? Icons.filter_alt : Icons.arrow_drop_down, size: 16, color: on ? Colors.white : T.inkFaint),
          );
        }),
      if (any)
        TextButton(
          onPressed: () { final n = Map<String, String>.from(value); for (final k in keys) { n.remove(k.$1); } onChanged(n); },
          child: Text(tr('مسح الكل', 'Clear all')),
        ),
    ]);
  }
}

class _MultiSheet extends StatefulWidget {
  final String title;
  final List<MapEntry<String, int>> options;
  final List<String> initial;
  final Map<String, String> labels;
  const _MultiSheet({required this.title, required this.options, required this.initial, this.labels = const {}});
  @override
  State<_MultiSheet> createState() => _MultiSheetState();
}

class _MultiSheetState extends State<_MultiSheet> {
  late final Set<String> _sel = {...widget.initial};
  String _q = '';
  @override
  Widget build(BuildContext context) {
    String name(String v) => widget.labels[v] ?? v;
    final list = widget.options.where((o) => _q.isEmpty || name(o.key).toLowerCase().contains(_q.toLowerCase())).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(children: [
              Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              if (_sel.isNotEmpty) TextButton(onPressed: () => setState(_sel.clear), child: Text(tr('مسح', 'Clear'))),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SearchField(
              dense: true,
              onChanged: (v) => setState(() => _q = v.trim()),
              hint: tr('ابحث…', 'Search…'),
            ),
          ),
          Expanded(
            child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
              for (final o in list)
                CheckboxListTile(
                  dense: true,
                  value: _sel.contains(o.key),
                  activeColor: T.orange,
                  onChanged: (v) => setState(() => v == true ? _sel.add(o.key) : _sel.remove(o.key)),
                  title: Text(o.key == '—' ? tr('غير محدد', 'Not set') : name(o.key), style: const TextStyle(fontWeight: FontWeight.w600)),
                  secondary: Text('${o.value}', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
                ),
              if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches')))),
            ]),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: SizedBox(width: double.infinity, child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: T.orange),
                onPressed: () => Navigator.pop(context, _sel.toList()),
                child: Text(tr('تطبيق', 'Apply')),
              )),
            ),
          ),
        ]),
      ),
    );
  }
}
