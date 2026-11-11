import 'dart:convert';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// A section's KPI forms (mobile twin of web SectionKpiSettings): items in Arabic and English, weights totalling 100%, and the employees each form grades.
/// The server decides who may edit: the section manager, top roles and the general manager; a form grading a section head is read-only to that section's manager.
class SectionKpiSettingsScreen extends StatefulWidget {
  final String section;
  final String title;
  const SectionKpiSettingsScreen({super.key, required this.section, required this.title});
  @override
  State<SectionKpiSettingsScreen> createState() => _SectionKpiSettingsScreenState();
}

List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;
double _round(num n) => (n * 10000).roundToDouble() / 10000;
String _pct(num w) => w == w.roundToDouble() ? w.toStringAsFixed(0) : w.toStringAsFixed(2);
String _newKey(int i) => 'c${i + 1}_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';

class _SectionKpiSettingsScreenState extends State<SectionKpiSettingsScreen> {
  List<Map<String, dynamic>> _forms = [];
  List<Map<String, dynamic>> _members = [];
  bool _canCreate = false;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // Another screen changed a form: re-read.
    _onLive = () => _load();
    Live.instance.on('performance:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('performance:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final sec = Uri.encodeQueryComponent(widget.section);
    try {
      final r = await Future.wait([
        Api.instance.get('/api/performance/templates?section=$sec'),
        Api.instance.get('/api/performance/team?section=$sec'),
      ]);
      if (!mounted) return;
      setState(() {
        _forms = _maps(r[0]['templates']).where((t) => t['active'] != false).toList();
        _canCreate = r[0]['canCreate'] == true;
        _members = _maps(r[1]['members']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Future<void> _open(Map<String, dynamic>? t) async {
    final draft = t == null
        ? <String, dynamic>{
            '_id': '', 'name': '', 'nameAr': '', 'section': widget.section, 'employees': <String>[],
            'criteria': [
              {'key': _newKey(0), 'order': 0, 'titleAr': '', 'title': '', 'weight': 100},
            ],
          }
        : Map<String, dynamic>.from(jsonDecode(jsonEncode(t)) as Map);
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => _FormEditor(form: draft, section: widget.section, members: _members),
    ));
    if (saved == true) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تمّ حفظ النموذج', 'Form saved'))));
      _load();
    }
  }

  Future<void> _delete(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(tr('حذف نموذج «${t['nameAr']}»؟ النموذج المستخدم في تقييمات سابقة يُعطَّل ولا يُحذف.',
            'Delete form "${t['name'] ?? t['nameAr']}"? A form used by past evaluations is deactivated instead.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/performance/templates/${t['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('فشل الحذف', 'Delete failed'))));
    }
  }

  Widget _card(Map<String, dynamic> t) {
    final crit = _maps(t['criteria']);
    final canEdit = t['canEdit'] == true;
    final names = {for (final m in _members) (m['_id'] ?? '').toString(): (m['name'] ?? '').toString()};
    final assigned = (t['employees'] as List? ?? []).map((e) => names[e.toString()]).whereType<String>().toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(tr((t['nameAr'] ?? '').toString(), (t['name'] ?? t['nameAr'] ?? '').toString()),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            ),
            if (canEdit) ...[
              IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _open(t)),
              IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 20, color: T.danger), onPressed: () => _delete(t)),
            ] else
              Chip2(tr('للإدارة العليا', 'Top management'), T.inkFaint),
          ]),
          const SizedBox(height: 4),
          for (final c in crit)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(tr((c['titleAr'] ?? '').toString(), (c['title'] ?? c['titleAr'] ?? '').toString()), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                const SizedBox(width: 8),
                Text('${_pct(_num(c['weight']))}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.navy)),
              ]),
            ),
          if (assigned.isNotEmpty) ...[
            const Divider(height: 14),
            Text(assigned.join('، '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ],
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('المؤشرات والأوزان', 'KPIs and weights')),
      floatingActionButton: _canCreate
          ? FloatingActionButton.extended(onPressed: () => _open(null), icon: const Icon(Icons.add), label: Text(tr('نموذج جديد', 'New form')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
                    Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, color: T.navy)),
                    const SizedBox(height: 4),
                    Text(
                      tr('لكل نموذج بنود بأوزان مجموعها 100٪؛ تقييم الموظف = مجموع (الدرجة من 1 إلى 5 × الوزن)، ثم النسبة والشريحة والبونص.',
                          'Each form has items whose weights total 100%; a score = Σ (rating 1-5 × weight), then the percentage, band and bonus.'),
                      style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
                    ),
                    const SizedBox(height: 10),
                    if (_forms.isEmpty)
                      EmptyState(icon: Icons.rule_folder_outlined, title: tr('لا توجد نماذج لهذا القسم بعد', 'No forms for this section yet')),
                    ..._forms.map(_card),
                  ]),
                ),
    );
  }
}

/// Editing one form. Text fields are keyed by the item key so reordering keeps each field's text.
class _FormEditor extends StatefulWidget {
  final Map<String, dynamic> form;
  final String section;
  final List<Map<String, dynamic>> members;
  const _FormEditor({required this.form, required this.section, required this.members});
  @override
  State<_FormEditor> createState() => _FormEditorState();
}

class _FormEditorState extends State<_FormEditor> {
  late final Map<String, dynamic> f = widget.form;
  late final List<Map<String, dynamic>> _items = _maps(f['criteria']);
  late final Set<String> _assigned = {...(f['employees'] as List? ?? []).map((e) => e.toString())};
  bool _saving = false;
  // Bumped when weights are rewritten in bulk, so the weight fields show the new values; typing never changes it.
  int _rev = 0;

  double get _total => _round(_items.fold<num>(0, (s, c) => s + _num(c['weight'])));

  void _equalise() => setState(() {
        _rev++;
        final n = _items.isEmpty ? 1 : _items.length;
        final each = _round(100 / n);
        for (var i = 0; i < _items.length; i++) {
          _items[i]['weight'] = i == _items.length - 1 ? _round(100 - each * (n - 1)) : each;
        }
      });

  void _move(int i, int dir) => setState(() {
        final x = _items.removeAt(i);
        _items.insert(i + dir, x);
      });

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _save() async {
    if ((f['nameAr'] ?? '').toString().trim().isEmpty) return _snack(tr('اسم النموذج بالعربية مطلوب', 'The Arabic form name is required'));
    if (_items.any((c) => (c['titleAr'] ?? '').toString().trim().isEmpty)) return _snack(tr('لكل بند اسم بالعربية', 'Every item needs an Arabic name'));
    if ((_total - 100).abs() >= 0.01) return _snack(tr('مجموع الأوزان يجب أن يساوي 100٪ (حالياً ${_pct(_total)}٪)', 'Weights must total 100% (currently ${_pct(_total)}%)'));
    setState(() => _saving = true);
    final body = {
      'name': f['name'] ?? '', 'nameAr': f['nameAr'], 'section': widget.section,
      'employees': _assigned.toList(),
      'criteria': [for (var i = 0; i < _items.length; i++) {..._items[i], 'order': i}],
    };
    try {
      final id = (f['_id'] ?? '').toString();
      if (id.isNotEmpty) {
        await Api.instance.put('/api/performance/templates/$id', body);
      } else {
        await Api.instance.post('/api/performance/templates', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _snack(e is ApiException ? e.message : tr('فشل الحفظ', 'Save failed'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(Map<String, dynamic> c, String key, String labelAr, String labelEn, {bool ltr = false}) => TextFormField(
        key: ValueKey('${c['key']}-$key'),
        initialValue: (c[key] ?? '').toString(),
        textDirection: ltr ? TextDirection.ltr : TextDirection.rtl,
        decoration: InputDecoration(labelText: tr(labelAr, labelEn), isDense: true),
        onChanged: (v) => c[key] = v,
      );

  Widget _item(int i) {
    final c = _items[i];
    return Padding(
      key: ValueKey(c['key']),
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: Column(children: [
          Row(children: [
            CircleAvatar(radius: 12, backgroundColor: T.navy, child: Text('${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800))),
            const SizedBox(width: 8),
            SizedBox(
              width: 90,
              child: TextFormField(
                key: ValueKey('${c['key']}-weight-$_rev'),
                initialValue: _pct(_num(c['weight'])),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(labelText: tr('الوزن %', 'Weight %'), isDense: true),
                onChanged: (v) => setState(() => c['weight'] = num.tryParse(v) ?? 0),
              ),
            ),
            const Spacer(),
            IconButton(icon: const Icon(Icons.arrow_upward, size: 18), onPressed: i == 0 ? null : () => _move(i, -1)),
            IconButton(icon: const Icon(Icons.arrow_downward, size: 18), onPressed: i == _items.length - 1 ? null : () => _move(i, 1)),
            IconButton(icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => setState(() => _items.removeAt(i))),
          ]),
          _field(c, 'titleAr', 'البند (عربي)', 'Item (Arabic)'),
          _field(c, 'title', 'البند (إنجليزي)', 'Item (English)', ltr: true),
          Row(children: [
            Expanded(child: _field(c, 'groupAr', 'المجموعة (عربي)', 'Group (Arabic)')),
            const SizedBox(width: 8),
            Expanded(child: _field(c, 'group', 'المجموعة (إنجليزي)', 'Group (English)', ltr: true)),
          ]),
          _field(c, 'descriptionAr', 'المستهدف (عربي)', 'Target (Arabic)'),
          _field(c, 'description', 'المستهدف (إنجليزي)', 'Target (English)', ltr: true),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ok = (_total - 100).abs() < 0.01;
    return AppScaffold(
      title: Text((f['_id'] ?? '').toString().isEmpty ? tr('نموذج جديد', 'New form') : tr('تعديل النموذج', 'Edit form')),
      actions: [
        IconButton(
          tooltip: tr('حفظ', 'Save'),
          onPressed: _saving || !ok ? null : _save,
          icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
        ),
      ],
      body: ListView(padding: const EdgeInsets.all(14), children: [
        TextFormField(
          initialValue: (f['nameAr'] ?? '').toString(),
          decoration: InputDecoration(labelText: '${tr('اسم النموذج (عربي)', 'Form name (Arabic)')} *'),
          onChanged: (v) => f['nameAr'] = v,
        ),
        TextFormField(
          initialValue: (f['name'] ?? '').toString(),
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(labelText: tr('اسم النموذج (إنجليزي)', 'Form name (English)')),
          onChanged: (v) => f['name'] = v,
        ),
        const SizedBox(height: 12),
        Row(children: [
          Chip2('${tr('مجموع الأوزان', 'Total weight')}: ${_pct(_total)}%', ok ? T.success : T.danger),
          const Spacer(),
          TextButton.icon(onPressed: _equalise, icon: const Icon(Icons.balance, size: 18), label: Text(tr('توزيع بالتساوي', 'Split equally'))),
        ]),
        const SizedBox(height: 8),
        for (var i = 0; i < _items.length; i++) _item(i),
        OutlinedButton.icon(
          onPressed: () => setState(() => _items.add({'key': _newKey(_items.length), 'titleAr': '', 'title': '', 'weight': 0})),
          icon: const Icon(Icons.add),
          label: Text(tr('إضافة بند', 'Add item')),
        ),
        if (widget.members.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(tr('الموظفون الذين يُقيَّمون بهذا النموذج', 'Employees graded with this form'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final m in widget.members)
              FilterChip(
                label: Text((m['name'] ?? '').toString(), style: const TextStyle(fontSize: 12)),
                selected: _assigned.contains((m['_id'] ?? '').toString()),
                onSelected: (on) => setState(() {
                  final id = (m['_id'] ?? '').toString();
                  if (on) { _assigned.add(id); } else { _assigned.remove(id); }
                }),
              ),
          ]),
          const SizedBox(height: 4),
          Text(tr('من لم يُحدَّد له نموذج يُطابَق بمسمّاه الوظيفي ثم بدوره في النظام.', 'Employees not chosen here are matched by job title, then by account role.'),
              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ],
      ]),
    );
  }
}
