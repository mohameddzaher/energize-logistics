import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Performance evaluation setup, general manager only (/system/performance/settings).
/// Three things live here: indicator templates (weights sum to 100%), performance bands, and the bonus table per tier with each section's tier.

const _bandColors = ['red', 'amber', 'blue', 'emerald', 'slate'];

Color _bandColor(String c) {
  switch (c) {
    case 'red': return T.danger;
    case 'amber': return T.warn;
    case 'blue': return T.info;
    case 'emerald': return T.success;
    default: return T.inkFaint;
  }
}

const _defaultScale = [
  {'score': 1, 'label': 'Poor', 'labelAr': 'ضعيف'},
  {'score': 2, 'label': 'Below', 'labelAr': 'دون'},
  {'score': 3, 'label': 'Acceptable', 'labelAr': 'مقبول'},
  {'score': 4, 'label': 'Good', 'labelAr': 'جيد'},
  {'score': 5, 'label': 'Excellent', 'labelAr': 'ممتاز'},
];

String _newKey(int i) => 'c${i + 1}_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';

Map<String, dynamic> _blankCriterion(int i) => {
      'key': _newKey(i), 'order': i,
      'title': '', 'titleAr': '', 'description': '', 'descriptionAr': '',
      'dataSource': '', 'dataSourceAr': '', 'weight': 0,
      'scale': _defaultScale.map((s) => Map<String, dynamic>.from(s)).toList(),
    };

Map<String, dynamic> _deepCopy(Map m) => Map<String, dynamic>.from(jsonDecode(jsonEncode(m)) as Map);

num _weightTotal(Map t) => List.from(t['criteria'] ?? []).fold<num>(0, (s, c) => s + ((c['weight'] is num) ? c['weight'] as num : num.tryParse('${c['weight']}') ?? 0));

class PerformanceSettingsScreen extends StatefulWidget {
  const PerformanceSettingsScreen({super.key});
  @override
  State<PerformanceSettingsScreen> createState() => _PerformanceSettingsScreenState();
}

class _PerformanceSettingsScreenState extends State<PerformanceSettingsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  Map<String, dynamic>? _settings;
  List<String> _departments = [];
  List<Map<String, dynamic>> _templates = [];
  bool _loading = true;
  String? _error;
  bool _saving = false;
  final Set<String> _open = {};

  @override
  void initState() {
    super.initState();
    _tabs.addListener(() { if (mounted) setState(() {}); });
    _load();
  }

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/performance/settings'),
        Api.instance.get('/api/performance/templates'),
      ]);
      if (!mounted) return;
      setState(() {
        _settings = Map<String, dynamic>.from(r[0]['settings'] ?? {});
        _departments = List<String>.from((r[0]['departments'] ?? []).map((e) => e.toString()));
        _templates = List<Map<String, dynamic>>.from(r[1]['templates'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  List<Map<String, dynamic>> get _bands => List<Map<String, dynamic>>.from(_settings?['bands'] ?? []);
  List<Map<String, dynamic>> get _tiers => List<Map<String, dynamic>>.from(_settings?['tiers'] ?? []);

  Future<void> _saveSettings() async {
    if (_settings == null) return;
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/performance/settings', _settings);
      _snack(tr('تم حفظ الإعدادات', 'Settings saved'));
      await _load();
    } catch (e) {
      _snack(e is ApiException ? e.message : tr('فشل الحفظ', 'Save failed'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _edit(Map<String, dynamic> t) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => _TemplateEditor(template: t, departments: _departments, tiers: _tiers),
    ));
    if (saved == true) {
      if (mounted) _snack(tr('تم حفظ النموذج', 'Template saved'));
      _load();
    }
  }

  void _startNew() => _edit({
        '_id': '', 'name': '', 'nameAr': '', 'description': '', 'descriptionAr': '',
        'department': _departments.isNotEmpty ? _departments.first : '', 'jobTitles': <String>[], 'tier': 1, 'active': true,
        'criteria': [_blankCriterion(0)],
      });

  void _duplicate(Map<String, dynamic> t) {
    final c = _deepCopy(t);
    c['_id'] = '';
    c['nameAr'] = '${t['nameAr']} (${tr('نسخة', 'copy')})';
    final crit = List<Map<String, dynamic>>.from(c['criteria'] ?? []);
    for (var i = 0; i < crit.length; i++) { crit[i]['key'] = _newKey(i); }
    c['criteria'] = crit;
    _edit(c);
  }

  Future<void> _remove(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف نموذج "${t['nameAr']}"؟', 'Delete template "${t['nameAr']}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final r = await Api.instance.delete('/api/performance/templates/${t['_id']}');
      // A template with evaluations is disabled instead of deleted, and the server says so.
      _snack(r is Map && r['deactivated'] == true ? (r['message'] ?? tr('تم تعطيل النموذج', 'Template deactivated')).toString() : tr('تم الحذف', 'Deleted'));
      _load();
    } catch (e) {
      _snack(e is ApiException ? e.message : tr('فشل الحذف', 'Delete failed'));
    }
  }

  // Export: current tab or all (5 sheets), as on the web
  Future<void> _export() async {
    final k = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(tr('التبويب الحالي', 'Current tab')), onTap: () => Navigator.pop(c, 'tab')),
          ListTile(title: Text(tr('الكل (5 شيتات)', 'All (5 sheets)')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (k == null || !mounted || _settings == null) return;
    final templatesSheet = (tr('النماذج', 'Templates'), [
      ExportCol('اسم النموذج', 'Template', (r) => r['nameAr']),
      ExportCol('بالإنجليزية', 'English name', (r) => r['name']),
      ExportCol('القسم', 'Department', (r) => r['department']),
      ExportCol('المسميات الوظيفية', 'Job titles', (r) => List.from(r['jobTitles'] ?? []).join('، ')),
      ExportCol('الطبقة', 'Tier', (r) => r['tier']),
      ExportCol('عدد المؤشرات', 'Criteria', (r) => List.from(r['criteria'] ?? []).length),
      ExportCol('مجموع الأوزان %', 'Total weight %', (r) => _weightTotal(r)),
      ExportCol('مفعّل', 'Active', (r) => r['active'] == true ? tr('نعم', 'Yes') : tr('لا', 'No')),
      ExportCol('الوصف', 'Description', (r) => r['descriptionAr']),
    ], _templates);
    final criteriaRows = <Map<String, dynamic>>[
      for (final t in _templates)
        for (final e in (List<Map<String, dynamic>>.from(t['criteria'] ?? [])..sort((a, b) => ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num))).asMap().entries)
          {
            'template': t['nameAr'] ?? t['name'], 'department': t['department'], 'tier': t['tier'],
            'index': e.key + 1, 'titleAr': e.value['titleAr'], 'title': e.value['title'], 'weight': e.value['weight'],
            'descriptionAr': e.value['descriptionAr'], 'dataSourceAr': e.value['dataSourceAr'],
            'scale': List.from(e.value['scale'] ?? []).map((sp) => '${sp['score']}: ${(sp['labelAr'] ?? '').toString().isNotEmpty ? sp['labelAr'] : sp['label']}').join(' | '),
          },
    ];
    final criteriaSheet = (tr('المؤشرات', 'Criteria'), [
      ExportCol('النموذج', 'Template', (r) => r['template']),
      ExportCol('القسم', 'Department', (r) => r['department']),
      ExportCol('الطبقة', 'Tier', (r) => r['tier']),
      ExportCol('#', '#', (r) => r['index']),
      ExportCol('المؤشر', 'Criterion', (r) => r['titleAr']),
      ExportCol('بالإنجليزية', 'English', (r) => r['title']),
      ExportCol('الوزن %', 'Weight %', (r) => r['weight']),
      ExportCol('الوصف', 'Description', (r) => r['descriptionAr']),
      ExportCol('مصدر البيانات', 'Data source', (r) => r['dataSourceAr']),
      ExportCol('سلّم التقييم', 'Rating scale', (r) => r['scale']),
    ], criteriaRows);
    final bandsSheet = (tr('الشرائح', 'Bands'), [
      ExportCol('الاسم بالعربية', 'Arabic label', (r) => r['ar']),
      ExportCol('بالإنجليزية', 'English', (r) => r['en']),
      ExportCol('من %', 'From %', (r) => r['min']),
      ExportCol('إلى %', 'To %', (r) => r['max']),
      ExportCol('اللون', 'Colour', (r) => r['color']),
      ExportCol('حدّ الاستحقاق %', 'Eligibility %', (_) => _settings!['eligibilityThreshold']),
    ], _bands);
    final tiersSheet = (tr('الطبقات والبونص', 'Tiers & bonus'), [
      ExportCol('الطبقة', 'Tier', (r) => r['tier']),
      ExportCol('الاسم', 'Name', (r) => r['ar']),
      ExportCol('بالإنجليزية', 'English', (r) => r['en']),
      ExportCol('السقف (رواتب)', 'Cap (salaries)', (r) => r['cap']),
      for (final b in _bands)
        ExportCol('بونص — ${b['ar']}', 'Bonus — ${b['en']}', (r) => (r['bonus'] is Map ? r['bonus'][b['key']] : null) ?? 0),
    ], _tiers);
    final deptTiers = Map<String, dynamic>.from(_settings!['departmentTiers'] ?? {});
    final deptSheet = (tr('طبقة كل قسم', 'Department tiers'), [
      ExportCol('القسم', 'Department', (r) => r['department']),
      ExportCol('الطبقة', 'Tier', (r) => r['tier'] ?? tr('— افتراضي —', '— default —')),
      ExportCol('اسم الطبقة', 'Tier name', (r) {
        final t = _tiers.where((x) => x['tier'] == r['tier']).toList();
        return t.isEmpty ? '—' : tr('${t.first['ar']}', '${t.first['en']}');
      }),
    ], [for (final d in _departments) {'department': d, 'tier': deptTiers[d]}]);
    final byTab = [
      [templatesSheet, criteriaSheet],
      [bandsSheet],
      [tiersSheet, deptSheet],
    ];
    await exportExcel(context, fileName: 'performance-config',
        sheets: k == 'tab' ? byTab[_tabs.index] : [templatesSheet, criteriaSheet, bandsSheet, tiersSheet, deptSheet]);
  }

  @override
  Widget build(BuildContext context) {
    // General manager only, like canConfigurePerf on the web and the server guard.
    if (!const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(context.watch<AuthProvider>().role)) {
      return AppScaffold(
        title: Text(tr('إعداد تقييم الأداء', 'Performance configuration')),
        body: EmptyState(icon: Icons.lock_outline, title: tr('هذه الصفحة للمدير العام فقط.', 'This page is restricted to super admins.')),
      );
    }
    return AppScaffold(
      title: Text(tr('إعداد تقييم الأداء', 'Performance configuration')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        if (_tabs.index != 0)
          IconButton(
            tooltip: tr('حفظ', 'Save'),
            onPressed: _saving ? null : _saveSettings,
            icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          ),
      ],
      appBarBottom: TabBar(
        controller: _tabs,
        isScrollable: true,
        tabAlignment: TabAlignment.start,
        tabs: [
          Tab(text: tr('نماذج المؤشرات', 'Criteria templates')),
          Tab(text: tr('شرائح الأداء', 'Performance bands')),
          Tab(text: tr('الطبقات والبونص', 'Tiers & bonus')),
        ],
      ),
      floatingActionButton: _tabs.index == 0 && !_loading
          ? FloatingActionButton.extended(onPressed: _startNew, icon: const Icon(Icons.add), label: Text(tr('نموذج جديد', 'New template')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : TabBarView(controller: _tabs, children: [_templatesTab(), _bandsTab(), _tiersTab()]),
    );
  }

  Widget _templatesTab() => RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
          if (_templates.isEmpty) EmptyState(icon: Icons.rule_folder_outlined, title: tr('لا توجد نماذج بعد — ابدأ بإضافة نموذج لكل قسم.', 'No templates yet — add one per department.')),
          for (final t in _templates) _templateCard(t),
        ]),
      );

  Widget _templateCard(Map<String, dynamic> t) {
    final total = _weightTotal(t);
    final ok = (total - 100).abs() < 0.01;
    final id = (t['_id'] ?? '').toString();
    final open = _open.contains(id);
    final crit = List<Map<String, dynamic>>.from(t['criteria'] ?? [])..sort((a, b) => ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num));
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: () => setState(() => open ? _open.remove(id) : _open.add(id)),
            child: Row(children: [
              Icon(open ? Icons.expand_more : Icons.chevron_right, size: 18, color: T.inkFaint),
              Expanded(
                child: Text('${t['nameAr'] ?? ''}${t['active'] == false ? ' (${tr('معطّل', 'inactive')})' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
              Chip2('${total % 1 == 0 ? total.toInt() : total}%', ok ? T.success : T.danger),
            ]),
          ),
          const SizedBox(height: 4),
          Text(
            '${t['department'] ?? ''} · ${crit.length} ${tr('مؤشرات', 'criteria')} · ${tr('الطبقة', 'Tier')} ${t['tier'] ?? '—'}'
            '${List.from(t['jobTitles'] ?? []).isNotEmpty ? ' · ${List.from(t['jobTitles']).join('، ')}' : ''}',
            style: const TextStyle(fontSize: 11, color: T.inkFaint),
          ),
          if (open) ...[
            const Divider(height: 16),
            for (var i = 0; i < crit.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(children: [
                  Text('${i + 1}. ', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                  Expanded(child: Text('${(crit[i]['titleAr'] ?? '').toString().isNotEmpty ? crit[i]['titleAr'] : crit[i]['title']}', style: const TextStyle(fontSize: 12.5))),
                  Text('${crit[i]['weight']}%', style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w800)),
                ]),
              ),
          ],
          const SizedBox(height: 6),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            IconButton(tooltip: tr('نسخ', 'Duplicate'), icon: const Icon(Icons.copy_outlined, size: 18), onPressed: () => _duplicate(t)),
            TextButton(onPressed: () => _edit(_deepCopy(t)), child: Text(tr('تعديل', 'Edit'))),
            IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 19, color: T.danger), onPressed: () => _remove(t)),
          ]),
        ]),
      ),
    );
  }

  Widget _num(String label, dynamic value, void Function(num) onChanged, {double width = 90, Key? key}) => SizedBox(
        width: width,
        child: TextFormField(
          key: key,
          initialValue: '${value ?? 0}',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textAlign: TextAlign.center,
          decoration: InputDecoration(labelText: label, isDense: true),
          onChanged: (v) => onChanged(num.tryParse(v) ?? 0),
        ),
      );

  Widget _bandsTab() {
    final bands = _bands;
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text(tr('النسبة المئوية = الدرجة المرجّحة × 20. الشرائح دي بتحدد التقدير والبونص.', 'Percentage = weighted score × 20. These bands drive the rating and the bonus.'),
          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      const SizedBox(height: 10),
      for (var i = 0; i < bands.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: AppCard(
            topAccent: _bandColor((bands[i]['color'] ?? '').toString()),
            padding: const EdgeInsets.all(10),
            child: Column(children: [
              Row(children: [
                Expanded(child: TextFormField(key: ValueKey('bar-${bands[i]['key']}'), initialValue: '${bands[i]['ar'] ?? ''}', decoration: InputDecoration(labelText: tr('الاسم بالعربية', 'Arabic label'), isDense: true), onChanged: (v) => bands[i]['ar'] = v)),
                const SizedBox(width: 8),
                Expanded(child: TextFormField(key: ValueKey('ben-${bands[i]['key']}'), initialValue: '${bands[i]['en'] ?? ''}', decoration: InputDecoration(labelText: tr('بالإنجليزية', 'English'), isDense: true), onChanged: (v) => bands[i]['en'] = v)),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _num(tr('من %', 'From %'), bands[i]['min'], (v) => bands[i]['min'] = v, key: ValueKey('bmin-${bands[i]['key']}')),
                const SizedBox(width: 8),
                _num(tr('إلى %', 'To %'), bands[i]['max'], (v) => bands[i]['max'] = v, key: ValueKey('bmax-${bands[i]['key']}')),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _bandColors.contains(bands[i]['color']) ? bands[i]['color'] as String : null,
                    isDense: true,
                    decoration: InputDecoration(labelText: tr('اللون', 'Colour'), isDense: true),
                    items: [for (final c in _bandColors) DropdownMenuItem(value: c, child: Row(children: [CircleAvatar(radius: 5, backgroundColor: _bandColor(c)), const SizedBox(width: 6), Text(c)]))],
                    onChanged: (v) => setState(() => bands[i]['color'] = v),
                  ),
                ),
              ]),
            ]),
          ),
        ),
      _num(tr('حد الاستحقاق للبونص (%)', 'Bonus eligibility threshold (%)'), _settings?['eligibilityThreshold'], (v) => _settings!['eligibilityThreshold'] = v, width: 220, key: const ValueKey('elig')),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: _saving ? null : _saveSettings, icon: const Icon(Icons.save_outlined), label: Text(tr('حفظ', 'Save'))),
      const SizedBox(height: 30),
    ]);
  }

  Widget _tiersTab() {
    final tiers = _tiers;
    final bands = _bands;
    final deptTiers = (_settings!['departmentTiers'] is Map) ? _settings!['departmentTiers'] as Map : (_settings!['departmentTiers'] = <String, dynamic>{});
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text(tr('البونص بعدد الرواتب الشهرية ويُصرف عن الفترة. لكل طبقة سقف مختلف.', 'Bonus in monthly salaries, paid per period. Each tier has its own cap.'),
          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      const SizedBox(height: 10),
      for (var i = 0; i < tiers.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: AppCard(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: TextFormField(key: ValueKey('tar-${tiers[i]['tier']}'), initialValue: '${tiers[i]['ar'] ?? ''}', decoration: InputDecoration(labelText: '${tr('الطبقة', 'Tier')} ${tiers[i]['tier']}', isDense: true), onChanged: (v) => tiers[i]['ar'] = v)),
                const SizedBox(width: 8),
                _num(tr('السقف', 'Cap'), tiers[i]['cap'], (v) => tiers[i]['cap'] = v, key: ValueKey('tcap-${tiers[i]['tier']}')),
              ]),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final b in bands)
                  _num(tr('${b['ar']}', '${b['en']}'), (tiers[i]['bonus'] is Map ? tiers[i]['bonus'][b['key']] : null) ?? 0, (v) {
                    final bonus = tiers[i]['bonus'] is Map ? Map<String, dynamic>.from(tiers[i]['bonus']) : <String, dynamic>{};
                    bonus[b['key'].toString()] = v;
                    tiers[i]['bonus'] = bonus;
                  }, width: 100, key: ValueKey('tb-${tiers[i]['tier']}-${b['key']}')),
              ]),
            ]),
          ),
        ),
      const SizedBox(height: 6),
      Text(tr('طبقة كل قسم', 'Tier per department'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
      Text(tr('الطبقة الافتراضية للقسم — النموذج يقدر يحدد طبقة مختلفة لو حبيت.', "A department's default tier — a template may override it."), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      const SizedBox(height: 8),
      for (final d in _departments)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            Expanded(child: Text(d, style: const TextStyle(fontSize: 12.5))),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                initialValue: deptTiers[d] == null ? '' : '${deptTiers[d]}',
                isDense: true,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('— افتراضي —', '— default —'))),
                  for (final t in tiers) DropdownMenuItem(value: '${t['tier']}', child: Text(tr('${t['ar']}', '${t['en']}'), overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setState(() {
                  if (v == null || v.isEmpty) { deptTiers.remove(d); } else { deptTiers[d] = num.tryParse(v); }
                }),
              ),
            ),
          ]),
        ),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: _saving ? null : _saveSettings, icon: const Icon(Icons.save_outlined), label: Text(tr('حفظ', 'Save'))),
      const SizedBox(height: 30),
    ]);
  }
}

// Template editor
class _TemplateEditor extends StatefulWidget {
  final Map<String, dynamic> template;
  final List<String> departments;
  final List<Map<String, dynamic>> tiers;
  const _TemplateEditor({required this.template, required this.departments, required this.tiers});
  @override
  State<_TemplateEditor> createState() => _TemplateEditorState();
}

class _TemplateEditorState extends State<_TemplateEditor> {
  late final Map<String, dynamic> t = widget.template;
  bool _saving = false;

  List<Map<String, dynamic>> get _criteria {
    final c = t['criteria'];
    if (c is List<Map<String, dynamic>>) return c;
    final l = List<Map<String, dynamic>>.from((c ?? []).map((e) => Map<String, dynamic>.from(e)));
    t['criteria'] = l;
    return l;
  }

  Future<void> _save() async {
    final total = _weightTotal(t);
    if ((t['nameAr'] ?? '').toString().trim().isEmpty) return _snack(tr('اسم النموذج مطلوب', 'Template name is required'));
    if ((t['department'] ?? '').toString().isEmpty) return _snack(tr('اختر القسم', 'Choose a department'));
    if ((total - 100).abs() >= 0.01) {
      return _snack(tr('مجموع الأوزان لازم يساوي 100٪ (حالياً $total٪)', 'Weights must total 100% (currently $total%)'));
    }
    setState(() => _saving = true);
    try {
      final id = (t['_id'] ?? '').toString();
      if (id.isNotEmpty) {
        await Api.instance.put('/api/performance/templates/$id', t);
      } else {
        await Api.instance.post('/api/performance/templates', t);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _snack(e is ApiException ? e.message : tr('فشل الحفظ', 'Save failed'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final total = _weightTotal(t);
    final ok = (total - 100).abs() < 0.01;
    final crit = _criteria;
    final depts = {...widget.departments, if ((t['department'] ?? '').toString().isNotEmpty) t['department'].toString()}.toList();
    return AppScaffold(
      title: Text((t['_id'] ?? '').toString().isEmpty ? tr('نموذج جديد', 'New template') : tr('تعديل النموذج', 'Edit template')),
      actions: [
        IconButton(
          tooltip: tr('حفظ النموذج', 'Save template'),
          onPressed: _saving || !ok ? null : _save,
          icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
        ),
      ],
      body: ListView(padding: const EdgeInsets.all(14), children: [
        TextFormField(initialValue: '${t['nameAr'] ?? ''}', decoration: InputDecoration(labelText: '${tr('اسم النموذج (عربي)', 'Template name (Arabic)')} *'), onChanged: (v) => t['nameAr'] = v),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: depts.contains(t['department']) ? t['department'] as String : null,
              isExpanded: true,
              decoration: InputDecoration(labelText: '${tr('القسم', 'Department')} *', isDense: true),
              items: [for (final d in depts) DropdownMenuItem(value: d, child: Text(d, overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => t['department'] = v ?? ''),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<num>(
              initialValue: widget.tiers.any((x) => x['tier'] == t['tier']) ? t['tier'] as num : null,
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('الطبقة (البونص)', 'Tier (bonus)'), isDense: true),
              items: [
                for (final x in widget.tiers)
                  DropdownMenuItem(value: x['tier'] as num, child: Text('${tr('${x['ar']}', '${x['en']}')} — ${tr('سقف', 'cap')} ${x['cap']}', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => t['tier'] = v ?? t['tier']),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        TextFormField(
          initialValue: List.from(t['jobTitles'] ?? []).join(', '),
          decoration: InputDecoration(labelText: tr('المسميات الوظيفية (اختياري، مفصولة بفاصلة)', 'Job titles (optional, comma separated)'), hintText: tr('اتركها فارغة لتطبيق النموذج على القسم كله', 'Leave empty to apply to the whole department')),
          onChanged: (v) => t['jobTitles'] = v.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        ),
        const SizedBox(height: 8),
        TextFormField(initialValue: '${t['descriptionAr'] ?? ''}', decoration: InputDecoration(labelText: tr('وصف مختصر', 'Short description')), onChanged: (v) => t['descriptionAr'] = v),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(tr('نموذج مفعّل', 'Active')),
          value: t['active'] != false,
          onChanged: (v) => setState(() => t['active'] = v),
        ),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: (ok ? T.success : T.danger).withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            Expanded(
              child: Text(
                '${tr('مجموع الأوزان', 'Total weight')}: $total%${ok ? '' : tr(' — لازم يساوي ١٠٠٪ قبل الحفظ', ' — must equal 100% before saving')}',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: ok ? T.success : T.danger),
              ),
            ),
            TextButton.icon(
              onPressed: () => setState(() => crit.add(_blankCriterion(crit.length))),
              icon: const Icon(Icons.add, size: 16),
              label: Text(tr('إضافة مؤشر', 'Add criterion'), style: const TextStyle(fontSize: 12)),
            ),
          ]),
        ),
        const SizedBox(height: 10),
        for (var i = 0; i < crit.length; i++) _criterionCard(i, crit[i]),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: _saving || !ok ? null : _save,
          icon: const Icon(Icons.save_outlined),
          label: Text(tr('حفظ النموذج', 'Save template')),
        ),
        const SizedBox(height: 30),
      ]),
    );
  }

  Widget _criterionCard(int i, Map<String, dynamic> c) {
    final k = c['key'].toString();
    final scale = List<Map<String, dynamic>>.from((c['scale'] ?? _defaultScale).map((e) => Map<String, dynamic>.from(e)));
    c['scale'] = scale;
    return Padding(
      key: ValueKey(k),
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(children: [
          Row(children: [
            CircleAvatar(radius: 12, backgroundColor: T.navy, child: Text('${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800))),
            const Spacer(),
            SizedBox(
              width: 90,
              child: TextFormField(
                initialValue: '${c['weight'] ?? 0}',
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                textAlign: TextAlign.center,
                decoration: InputDecoration(labelText: '${tr('الوزن', 'Weight')} %', isDense: true),
                onChanged: (v) => setState(() => c['weight'] = num.tryParse(v) ?? 0),
              ),
            ),
            IconButton(icon: const Icon(Icons.delete_outline, color: T.danger, size: 19), onPressed: () => setState(() => _criteria.removeAt(i))),
          ]),
          const SizedBox(height: 6),
          TextFormField(initialValue: '${c['titleAr'] ?? ''}', decoration: InputDecoration(labelText: '${tr('اسم المؤشر (عربي)', 'Criterion (Arabic)')} *', isDense: true), onChanged: (v) => c['titleAr'] = v),
          const SizedBox(height: 6),
          TextFormField(initialValue: '${c['title'] ?? ''}', decoration: InputDecoration(labelText: tr('الاسم بالإنجليزية', 'English name'), isDense: true), onChanged: (v) => c['title'] = v),
          const SizedBox(height: 6),
          TextFormField(initialValue: '${c['descriptionAr'] ?? ''}', decoration: InputDecoration(labelText: tr('الوصف', 'Description'), isDense: true), onChanged: (v) => c['descriptionAr'] = v),
          const SizedBox(height: 6),
          TextFormField(initialValue: '${c['dataSourceAr'] ?? ''}', decoration: InputDecoration(labelText: tr('مصدر البيانات', 'Data source'), hintText: tr('مثال: تقارير التشغيل', ''), isDense: true), onChanged: (v) => c['dataSourceAr'] = v),
          const SizedBox(height: 8),
          Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('سلّم التقييم (وصف كل درجة)', 'Rating scale (wording per score)'), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
          const SizedBox(height: 4),
          Row(children: [
            for (var si = 0; si < scale.length; si++)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: TextFormField(
                    initialValue: '${scale[si]['labelAr'] ?? ''}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11),
                    decoration: InputDecoration(labelText: '${scale[si]['score']}', isDense: true),
                    onChanged: (v) => scale[si]['labelAr'] = v,
                  ),
                ),
              ),
          ]),
        ]),
      ),
    );
  }
}
