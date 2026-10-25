import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'reference_data.dart';

/// قوائمُ القسم المنسدلة — نظيرُ `<ReferenceDataManager module="fleet" alsoType="jp_task_fleet" embedded />`
/// في إعدادات الأسطول على الويب: نوعُ الإيجار والدفع والحمولة وملاحظاتُ المتابعة
/// الجاهزة، كلُّ قائمةٍ تُفتح فتُضاف قيمُها وتُعدَّل وتُعطَّل من هنا.
class FleetReferenceLists extends StatefulWidget {
  final String module;
  final String? alsoType;
  const FleetReferenceLists({super.key, this.module = 'fleet', this.alsoType = 'jp_task_fleet'});
  @override
  State<FleetReferenceLists> createState() => _FleetReferenceListsState();
}

class _FleetReferenceListsState extends State<FleetReferenceLists> {
  List<Map<String, dynamic>> _types = const [];

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/lookups/types');
      final all = List<Map<String, dynamic>>.from(((d is Map ? d['types'] : d) as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
      if (mounted) {
        setState(() => _types = all.where((t) => t['module'] == widget.module || (widget.alsoType != null && t['type'] == widget.alsoType)).toList());
      }
    } catch (_) {}
  }

  String _name(Map<String, dynamic> t) => (Lang.instance.ar ? t['nameAr'] : t['nameEn'])?.toString() ?? (t['type'] ?? '').toString();

  @override
  Widget build(BuildContext context) {
    if (_types.isEmpty) return const SizedBox.shrink();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.tune_rounded, color: T.orange, size: 20),
          const SizedBox(width: 6),
          Text(tr('قوائم القسم المنسدلة', 'Section dropdown lists'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        ]),
        const SizedBox(height: 6),
        for (final t in _types)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.list_alt_outlined, color: T.navy),
            title: Text(_name(t), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text((t['type'] ?? '').toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            trailing: const Icon(Icons.chevron_left),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                type: (t['type'] ?? '').toString(), title: _name(t), canManage: t['canManage'] == true))),
          ),
      ]),
    );
  }
}
