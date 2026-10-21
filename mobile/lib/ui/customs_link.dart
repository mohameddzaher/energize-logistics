import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import 'clearance_quick_view.dart';
import 'theme.dart';
import 'widgets.dart';

/// ربطُ كشوف التشغيل بمعاملات التخليص — نفسُ الموقع:
///   • شارةُ «التخليص» على الكشف (components/customs/CustomsLinkBadge)،
///   • ربطُه يدويًّا بالبحث (components/operations/WorkflowCustomsPanel)،
///   • «كشوف التشغيل المرتبطة» في صفحة المعاملة (components/customs/LinkedOpsReports).
/// والربطُ يكتبه الخادم وحدَه — راجع backend/src/services/customsOpsLink.

String customsIdOf(dynamic l) {
  if (l is! Map) return '';
  final id = l['clearanceId'] ?? l['clearance'];
  if (id is Map) return '${id['_id'] ?? ''}';
  return '${id ?? ''}';
}

String customsViaLabel(dynamic via) => switch ('${via ?? ''}') {
      'move' => tr('رقمُ الكشف مكتوبٌ في خانة النقل بالمعاملة', 'Written in the clearance transport entry'),
      'bl' => tr('رقمُ السند يطابق رقمَ البوليصة', 'Document number matches the B/L'),
      'container' => tr('رقمُ السند يطابق رقمَ الحاوية', 'Document number matches a container'),
      'manual' => tr('رُبط يدويًّا', 'Linked by hand'),
      _ => '',
    };

String _units(int n) => n == 0
    ? ''
    : Lang.instance.ar
        ? '$n ${n == 1 ? 'حاوية' : n == 2 ? 'حاويتان' : n <= 10 ? 'حاويات' : 'حاوية'}'
        : '$n unit${n == 1 ? '' : 's'}';

/// الشارة: رقمُ المعاملة · البوليصة · عددُ الحاويات — تُضغط فتفتح نافذةَ المعاملة.
class CustomsLinkChip extends StatelessWidget {
  final dynamic link;
  final bool compact;
  const CustomsLinkChip(this.link, {super.key, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final id = customsIdOf(link);
    if (id.isEmpty) return const SizedBox.shrink();
    final l = link as Map;
    final n = (l['containers'] is List) ? (l['containers'] as List).length : 0;
    final parts = [
      '${l['refNumber'] ?? ''}',
      if (!compact && '${l['blNumber'] ?? ''}'.isNotEmpty) '${l['blNumber']}',
      if (n > 0) _units(n),
    ];
    return Pressable(
      onTap: () => showClearanceQuickView(context, id),
      child: Chip2(parts.join(' · '), T.cyan, icon: Icons.directions_boat_outlined),
    );
  }
}

/// أكثرُ من معاملةٍ على صفٍّ واحد (فاتورةٌ تضمّ كشوفًا) — الأولى والباقي عدد.
class CustomsLinkChips extends StatelessWidget {
  final dynamic links;
  const CustomsLinkChips(this.links, {super.key});
  @override
  Widget build(BuildContext context) {
    final list = (links is List ? links as List : const []).where((l) => customsIdOf(l).isNotEmpty).toList();
    if (list.isEmpty) return const SizedBox.shrink();
    return Row(mainAxisSize: MainAxisSize.min, children: [
      CustomsLinkChip(list.first, compact: true),
      if (list.length > 1) Padding(
        padding: const EdgeInsetsDirectional.only(start: 4),
        child: Text('+${list.length - 1}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
      ),
    ]);
  }
}

/// تفاصيلُ الربط في ورقة الكشف، وزرّا الربط وفكّه لمن يملكهما.
/// يُرجع الكشفَ بعد التعديل (أو null إن لم يتغيّر شيء).
class WorkflowCustomsSection extends StatelessWidget {
  final Map<String, dynamic> workflow;
  final bool canLink;
  final void Function(Map<String, dynamic> wf) onChanged;
  const WorkflowCustomsSection({super.key, required this.workflow, required this.canLink, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final l = workflow['customsLink'];
    final linked = customsIdOf(l).isNotEmpty;
    final m = linked ? Map<String, dynamic>.from(l as Map) : const <String, dynamic>{};
    final containers = (m['containers'] is List) ? List<String>.from((m['containers'] as List).map((e) => '$e')) : const <String>[];
    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.directions_boat_outlined, size: 16, color: T.cyan),
          const SizedBox(width: 6),
          Text(tr('التخليص الجمركي', 'Customs clearance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
        ]),
        const SizedBox(height: 8),
        if (!linked)
          Text(tr('الكشفُ غيرُ مرتبطٍ بمعاملة تخليص.', 'Not linked to a customs clearance.'), style: const TextStyle(fontSize: 12, color: T.inkSoft))
        else ...[
          Align(alignment: AlignmentDirectional.centerStart, child: CustomsLinkChip(m, compact: true)),
          const SizedBox(height: 6),
          _kv(tr('رقم البوليصة', 'Bill of lading'), '${m['blNumber'] ?? ''}'),
          _kv(tr('عميل التخليص', 'Clearance customer'), '${m['customerName'] ?? ''}'),
          _kv(tr('مصدر الربط', 'Linked by'),
              '${customsViaLabel(m['via'])}${m['via'] == 'manual' && '${m['byName'] ?? ''}'.isNotEmpty ? ' — ${m['byName']}' : ''}'),
          if (containers.isNotEmpty) _kv(tr('الحاويات', 'Containers'), containers.join(', ')),
          if (m['via'] == 'move')
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(tr('رقمُ هذا الكشف مكتوبٌ في خانة النقل بالمعاملة، فيُصحَّح الربطُ من صفحة المعاملة.', 'Written in the clearance transport entry — correct it from the clearance.'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ),
        ],
        if (canLink) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            OutlinedButton.icon(
              onPressed: () async {
                final wf = await showCustomsLinkPicker(context, '${workflow['_id']}');
                if (wf != null) onChanged(wf);
              },
              icon: const Icon(Icons.link, size: 16),
              label: Text(linked ? tr('تغيير المعاملة', 'Change clearance') : tr('ربط بمعاملة تخليص', 'Link to a clearance')),
            ),
            if (linked && m['via'] != 'move')
              TextButton.icon(
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(
                      title: Text(tr('فكّ الربط', 'Unlink')),
                      content: Text(tr('يُفكّ ربطُ الكشف بالمعاملة ${m['refNumber'] ?? ''}، ولا يُعاد آليًّا من رقم السند.', 'Unlink from ${m['refNumber'] ?? ''}.')),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('فكّ الربط', 'Unlink'))),
                      ],
                    ),
                  );
                  if (ok != true) return;
                  try {
                    final wf = await Api.instance.delete('/api/workflows/${workflow['_id']}/customs-link');
                    if (wf is Map) onChanged(Map<String, dynamic>.from(wf));
                  } catch (e) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                icon: const Icon(Icons.link_off, size: 16),
                label: Text(tr('فكّ الربط', 'Unlink')),
              ),
          ]),
        ],
      ]),
    );
  }

  Widget _kv(String k, String v) => v.isEmpty
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 110, child: Text(k, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
            Expanded(child: Text(v, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
          ]),
        );
}

/// البحثُ عن معاملةٍ بالرقم أو البوليصة أو الحاوية ثمّ الربط — يُرجع الكشفَ المحدَّث.
Future<Map<String, dynamic>?> showCustomsLinkPicker(BuildContext context, String workflowId) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => FractionallySizedBox(heightFactor: 0.85, child: _Picker(workflowId: workflowId)),
  );
}

class _Picker extends StatefulWidget {
  final String workflowId;
  const _Picker({required this.workflowId});
  @override
  State<_Picker> createState() => _PickerState();
}

class _PickerState extends State<_Picker> {
  List<Map<String, dynamic>> _hits = [];
  Map<String, dynamic>? _chosen;
  final Set<String> _units = {};
  bool _busy = false;
  bool _saving = false;
  int _seq = 0;
  Timer? _t;

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _search(String q) async {
    final mine = ++_seq;
    if (q.trim().length < 2) { setState(() { _hits = []; _busy = false; }); return; }
    setState(() => _busy = true);
    try {
      final d = await Api.instance.get('/api/workflows/customs-search?q=${Uri.encodeQueryComponent(q.trim())}');
      if (!mounted || mine != _seq) return;
      setState(() { _hits = List<Map<String, dynamic>>.from(d['clearances'] ?? []); _busy = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() { _hits = []; _busy = false; });
    }
  }

  Future<void> _save() async {
    final c = _chosen;
    if (c == null) return;
    setState(() => _saving = true);
    try {
      final wf = await Api.instance.put('/api/workflows/${widget.workflowId}/customs-link', {'clearanceId': c['_id'], 'containers': _units.toList()});
      if (!mounted) return;
      Navigator.pop(context, wf is Map ? Map<String, dynamic>.from(wf) : null);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _chosen;
    final units = c == null ? const <String>[] : List<String>.from((c['containers'] as List? ?? const []).map((e) => '$e'));
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('ربط بمعاملة تخليص', 'Link to a customs clearance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 10),
        TextField(
          autofocus: true,
          onChanged: (v) { _t?.cancel(); _chosen = null; _units.clear(); _t = Timer(const Duration(milliseconds: 300), () => _search(v)); },
          decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('رقم المعاملة أو البوليصة أو الحاوية أو العميل', 'Clearance, B/L, container or customer')),
        ),
        const SizedBox(height: 8),
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        Expanded(
          child: ListView(children: [
            for (final h in _hits)
              ListTile(
                dense: true,
                selected: c?['_id'] == h['_id'],
                selectedTileColor: T.cyan.withValues(alpha: 0.08),
                onTap: () => setState(() { _chosen = h; _units.clear(); }),
                title: Text('${h['refNumber']} · ${h['blNumber'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: Text('${h['customerName'] ?? '—'} · ${h['containerCount'] ?? 0} ${tr('وحدة', 'units')}', style: const TextStyle(fontSize: 11.5)),
              ),
            if (c != null && units.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(tr('الحاوياتُ التي نقلها هذا الكشف (اختياريّ)', 'Containers carried by this report (optional)'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final u in units)
                  FilterChip(
                    label: Text(u, style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace')),
                    selected: _units.contains(u),
                    onSelected: (on) => setState(() { if (on) { _units.add(u); } else { _units.remove(u); } }),
                  ),
              ]),
            ],
          ]),
        ),
        FilledButton.icon(
          onPressed: c == null || _saving ? null : _save,
          icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.link),
          label: Text(c == null ? tr('اختر معاملة', 'Pick a clearance') : tr('ربط بالمعاملة ${c['refNumber']}', 'Link to ${c['refNumber']}')),
        ),
      ]),
    );
  }
}

/// «كشوف التشغيل المرتبطة» في صفحة المعاملة — بفوترتها وتحصيلها.
class CustomsLinkedReports extends StatefulWidget {
  final String clearanceId;
  const CustomsLinkedReports({super.key, required this.clearanceId});
  @override
  State<CustomsLinkedReports> createState() => _CustomsLinkedReportsState();
}

const _billing = {
  'collected': ('محصَّل', 'Collected', T.success),
  'invoiced': ('مفوتر — لم يُحصَّل', 'Invoiced — open', T.warn),
  'cash_pending': ('نقديّ — لم يُحصَّل', 'Cash — open', T.warn),
  'not_invoiced': ('لم يُفوتَر', 'Not invoiced', T.inkFaint),
};

class _CustomsLinkedReportsState extends State<CustomsLinkedReports> {
  Map<String, dynamic>? _d;
  String? _error;
  int _seq = 0;
  late final void Function(dynamic) _onLinks;
  late final void Function() _onChanged;

  @override
  void initState() {
    super.initState();
    _load();
    _onLinks = (p) {
      final ids = (p is Map && p['clearanceIds'] is List) ? (p['clearanceIds'] as List).map((e) => '$e').toList() : null;
      if (ids == null || ids.contains(widget.clearanceId)) _load();
    };
    _onChanged = () => _load();
    Live.instance.onData('customs:opsLinks', _onLinks);
    Live.instance.on('collections:changed', _onChanged);
  }

  @override
  void dispose() {
    Live.instance.offData('customs:opsLinks', _onLinks);
    Live.instance.off('collections:changed', _onChanged);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}/ops-reports');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  String _date(dynamic v) {
    final d = v != null ? DateTime.tryParse('$v')?.toLocal() : null;
    return d == null ? '' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final reports = List<Map<String, dynamic>>.from(_d?['reports'] ?? const []);
    final pending = List<Map<String, dynamic>>.from(_d?['pendingRefs'] ?? const []);
    final s = (_d?['summary'] as Map?) ?? const {};
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.local_shipping_outlined, size: 16, color: T.inkSoft),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('كشوف التشغيل المرتبطة', 'Linked operations reports'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (_d != null) Text('${reports.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
        if (reports.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            if ((s['collected'] ?? 0) > 0) Chip2('${tr('محصَّل', 'Collected')} ${s['collected']}', T.success),
            if (((s['invoiced'] ?? 0) + (s['cashPending'] ?? 0)) > 0) Chip2('${tr('لم يُحصَّل', 'Open')} ${(s['invoiced'] ?? 0) + (s['cashPending'] ?? 0)}', T.warn),
            if ((s['notInvoiced'] ?? 0) > 0) Chip2('${tr('لم يُفوتَر', 'Not invoiced')} ${s['notInvoiced']}', T.inkFaint),
          ]),
        ],
        const SizedBox(height: 6),
        if (_error != null) Text(_error!, style: const TextStyle(fontSize: 12, color: T.danger))
        else if (_d == null) const LinearProgressIndicator(minHeight: 2)
        else if (reports.isEmpty && pending.isEmpty)
          Text(tr('لا كشوفَ تشغيلٍ مرتبطة. يُربط الكشفُ حين يُكتب رقمُه في خانة نقل الحاوية بسيّارة الشركة، أو حين يكون «رقم السند» فيه رقمَ البوليصة.',
              'No linked reports yet.'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        for (final r in reports)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${r['reportNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                Builder(builder: (_) {
                  final b = _billing['${r['billing']}'] ?? _billing['not_invoiced']!;
                  return Chip2(tr(b.$1, b.$2), b.$3);
                }),
              ]),
              const SizedBox(height: 3),
              Text([
                _date(r['reportDate']),
                '${r['route'] ?? ''}',
                '${r['carNumber'] ?? ''}',
                r['paymentType'] == 'cash' ? tr('نقديّ', 'Cash') : '${r['invoiceNumber'] ?? ''}'.isNotEmpty ? '${tr('فاتورة', 'Invoice')} ${r['invoiceNumber']}' : '',
              ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              if ((r['containers'] as List? ?? const []).isNotEmpty)
                Text((r['containers'] as List).join(', '), style: const TextStyle(fontSize: 11, fontFamily: 'monospace', color: T.ink)),
              if (r['sellingValue'] != null)
                Text('${tr('قيمة البيع', 'Selling')}: ${r['sellingValue']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              Text(customsViaLabel(r['via']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ),
        for (final p in pending)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '${p['reportNumber']} — ${p['state'] == 'not_arrived' ? tr('مكتوبٌ في خانة النقل ولم يصل كشفُه من منصّة التشغيل بعد؛ يُربط حين يصل.', 'Not arrived from the platform yet.') : tr('ربطه التشغيلُ يدويًّا بالمعاملة ${p['otherRef'] ?? ''}.', 'Linked by hand to ${p['otherRef'] ?? ''}.')}',
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
            ),
          ),
      ]),
    );
  }
}
