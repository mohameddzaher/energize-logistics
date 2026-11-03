import 'package:flutter/material.dart';
import '../services/hijri.dart';
import '../ui/hijri_picker.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/hr_quick.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// All-fields screen: every HR master field of an employee, mirrors EmployeeMasterFields on the web.
/// Groups come from GET /api/hr/master/employees/:id/fields; edits use the same PATCH .../fields path as the master, so the server broadcasts `hr:master` and `hr:employee` and web and app refresh together.
/// Department, nationality, city and project are searchable pickers (ui/hr_quick.dart).
class HrAllFieldsTab extends StatefulWidget {
  final String employeeId;
  final bool canEdit;
  const HrAllFieldsTab({super.key, required this.employeeId, required this.canEdit});
  @override
  State<HrAllFieldsTab> createState() => _HrAllFieldsTabState();
}

class _HrAllFieldsTabState extends State<HrAllFieldsTab> with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>>? _groups;
  Map<String, List<String>> _choices = {};
  String? _error;
  String _q = '';
  // The field sits in a list that collapses on scroll; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  late final void Function() _onLive;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    for (final e in ['hr:master', 'hr:employee', 'hr:contract', 'lt:updated']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in ['hr:master', 'hr:employee', 'hr:contract', 'lt:updated']) { Live.instance.off(e, _onLive); }
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/master/employees/${widget.employeeId}/fields');
      Map<String, List<String>> ch = _choices;
      try {
        final c = Map<String, dynamic>.from((await Api.instance.get('/api/hr/master/choices'))['choices'] ?? {});
        ch = { for (final e in c.entries) e.key: [for (final x in List<Map<String, dynamic>>.from(e.value)) '${x['value']}'] };
      } catch (_) {}
      if (!mounted) return;
      setState(() { _groups = List<Map<String, dynamic>>.from(d['groups'] ?? []); _choices = ch; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  String _show(Map<String, dynamic> f) {
    final st = '${f['status'] ?? ''}';
    final v = f['value'];
    final has = v != null && '$v'.isNotEmpty;
    if (!has) {
      if (st == 'required') return tr('مطلوب', 'Required');
      if (st == 'not_required') return tr('غير مطلوب', 'Not required');
      if (st == 'none') return tr('لا يوجد', 'None');
      if (st == 'inactive') return tr('غير نشط', 'Inactive');
      return '—';
    }
    if (f['type'] == 'bool') return v == true ? tr('نعم', 'Yes') : tr('لا', 'No');
    if (f['type'] == 'number' && v is num) {
      final s = (v == v.roundToDouble() ? v.toInt() : v).toString();
      return s.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    }
    if (f['type'] == 'date') return '$v'.length >= 10 ? '$v'.substring(0, 10).split('-').reversed.join('/') : '$v';
    if (f['cashPayroll'] == true && '$v'.toLowerCase() == 'cash') return tr('راتب نقدي', 'Cash payroll');
    return '$v';
  }

  bool _editable(Map<String, dynamic> f) =>
      widget.canEdit && f['locked'] != true && !(f['derived'] == true && f['type'] != 'hijri');

  Future<void> _edit(Map<String, dynamic> f) async {
    final key = '${f['key']}';
    final label = Lang.instance.ar ? '${f['ar']}' : '${f['en']}';
    final cur = f['value'] == null ? '' : '${f['value']}';
    String? next;
    if (f['type'] == 'date') {
      final now = DateTime.now();
      final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(cur) ?? now, firstDate: DateTime(1950), lastDate: DateTime(now.year + 20));
      if (picked == null) return;
      next = picked.toIso8601String().substring(0, 10);
    } else if (f['type'] == 'hijri') {
      // Hijri is picked from a calendar, not typed; the server stores its Gregorian date.
      final g = await showHijriDatePicker(context, initialGregorian: cur.isEmpty ? '' : (gregorianOfHijriText(cur)));
      if (g == null) return;
      next = g.isEmpty ? '' : hijriDay(g);
    } else if (f['type'] == 'bool') {
      next = cur == 'true' ? 'false' : 'true';
    } else if (f['choice'] == true) {
      final opts = [...(_choices[key] ?? const <String>[])];
      if (f['cashPayroll'] == true && !opts.contains('cash')) opts.insert(0, 'cash');
      next = await pickFromList(context, title: label, options: opts, current: cur);
      if (next == null) return;
    } else {
      final c = TextEditingController(text: cur);
      next = await showDialog<String>(
        context: context,
        builder: (dc) => AlertDialog(
          title: Text(label),
          content: TextField(controller: c, autofocus: true,
              // Amounts (salary, allowances) are numeric: number keypad, and the server parses Arabic-Indic digits.
              keyboardType: f['type'] == 'number' ? const TextInputType.numberWithOptions(decimal: true) : null,
              decoration: InputDecoration(hintText: f['type'] == 'hijri' ? '1448-05-07' : null)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dc), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(dc, c.text.trim()), child: Text(tr('حفظ', 'Save'))),
          ],
        ),
      );
      if (next == null) return;
    }
    if (next == cur) return;
    try {
      await Api.instance.patch('/api/hr/master/employees/${widget.employeeId}/fields', {'fields': {key: next}});
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_groups == null) {
      return _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    }
    final ar = Lang.instance.ar;
    final groups = [
      for (final g in _groups!)
        {
          ...g,
          'fields': [
            for (final f in List<Map<String, dynamic>>.from(g['fields'] ?? []))
              if (_q.isEmpty || '${ar ? f['ar'] : f['en']}'.contains(_q) || '${f['value'] ?? ''}'.contains(_q)) f,
          ],
        },
    ].where((g) => (g['fields'] as List).isNotEmpty).toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
        SearchField(
          controller: _searchCtl, dense: true,
          onChanged: (v) => setState(() => _q = v.trim()),
          hint: tr('ابحث في البيانات…', 'Search fields…'),
        ),
        const SizedBox(height: 6),
        Text(tr('كل بيانات الماستر — اضغط أي خانة لتعديلها، والتعديل يظهر في كل مكان فورًا.', 'Every master field — tap to edit; it shows everywhere at once.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        const SizedBox(height: 8),
        if (groups.isEmpty && _q.isNotEmpty)
          Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
        for (final g in groups)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(ar ? '${g['ar']}' : '${g['en']}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
                const SizedBox(height: 4),
                for (final f in List<Map<String, dynamic>>.from(g['fields'] as List))
                  InkWell(
                    onTap: _editable(f) ? () => _edit(f) : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Expanded(flex: 4, child: Text(ar ? '${f['ar']}' : '${f['en']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
                        Expanded(
                          flex: 5,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text(_show(f), textAlign: TextAlign.end,
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                                    color: f['status'] == 'required' && (f['value'] == null || '${f['value']}'.isEmpty) ? T.danger : T.ink)),
                            if (f['note'] != null) Text('${f['note']}', style: const TextStyle(fontSize: 10.5, color: T.violet)),
                          ]),
                        ),
                        if (_editable(f)) const Padding(padding: EdgeInsetsDirectional.only(start: 6), child: Icon(Icons.edit_outlined, size: 15, color: T.inkFaint)),
                      ]),
                    ),
                  ),
              ]),
            ),
          ),
      ]),
    );
  }
}
