import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تفاصيل الفرصة (تطوير الأعمال) — بيانات الفرصة ومرحلتها في القمع،
/// وسجل الأنشطة (اجتماعات/مكالمات/زيارات) مع إمكانية تسجيل نشاط جديد.
class BdOpportunityDetailScreen extends StatefulWidget {
  final String opportunityId;
  final String name;
  const BdOpportunityDetailScreen({super.key, required this.opportunityId, required this.name});
  @override
  State<BdOpportunityDetailScreen> createState() => _BdOpportunityDetailScreenState();
}

const _funnelStages = {
  'identified': ('محددة', 'Identified', T.info),
  'researching': ('قيد البحث', 'Researching', T.cyan),
  'qualified': ('مؤهلة', 'Qualified', T.violet),
  'proposal': ('عرض', 'Proposal', T.warn),
  'negotiation': ('تفاوض', 'Negotiation', T.orange),
  'won': ('مكسوبة', 'Won', T.success),
  'lost': ('خاسرة', 'Lost', T.danger),
  'on_hold': ('معلّقة', 'On Hold', T.inkFaint),
};

const _activityTypes = {
  'meeting': ('اجتماع', 'Meeting'),
  'call': ('مكالمة', 'Call'),
  'email': ('بريد', 'Email'),
  'visit': ('زيارة', 'Visit'),
  'proposal': ('عرض', 'Proposal'),
  'research': ('بحث', 'Research'),
  'followup': ('متابعة', 'Follow-up'),
  'other': ('أخرى', 'Other'),
};

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _userName(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';

class _BdOpportunityDetailScreenState extends State<BdOpportunityDetailScreen> {
  Map<String, dynamic>? _opp;
  List<Map<String, dynamic>> _activities = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('bd:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('bd:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/business-development/opportunities/${widget.opportunityId}');
      if (!mounted) return;
      setState(() {
        _opp = d['opportunity'] is Map ? Map<String, dynamic>.from(d['opportunity']) : {};
        _activities = _l(d['activities']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _money(dynamic v) {
    final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
    return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  }

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
  }

  Future<void> _advanceStage() async {
    final stage = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.all(14), child: Text(tr('نقل إلى مرحلة', 'Move to stage'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          ..._funnelStages.entries.map((e) => ListTile(
            leading: CircleAvatar(radius: 9, backgroundColor: e.value.$3),
            title: Text(tr(e.value.$1, e.value.$2)),
            onTap: () => Navigator.pop(c, e.key),
          )),
        ]),
      ),
    );
    if (stage == null) return;
    try {
      await Api.instance.put('/api/business-development/opportunities/${widget.opportunityId}', {'stage': stage});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _logActivity() async {
    final title = TextEditingController();
    final summary = TextEditingController();
    final nextStep = TextEditingController();
    String type = 'meeting';
    DateTime date = DateTime.now();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تسجيل نشاط', 'Log activity'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: type, isExpanded: true,
                    decoration: InputDecoration(labelText: tr('النوع', 'Type')),
                    items: _activityTypes.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                    onChanged: (v) => setS(() => type = v ?? type),
                  ),
                ),
                const SizedBox(width: 10),
                OutlinedButton.icon(
                  onPressed: () async {
                    final v = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 30)));
                    if (v != null) setS(() => date = v);
                  },
                  icon: const Icon(Icons.event, size: 16),
                  label: Text('${date.day}/${date.month}', style: const TextStyle(fontSize: 12)),
                ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: title, decoration: InputDecoration(labelText: tr('العنوان *', 'Title *'))),
              const SizedBox(height: 10),
              TextField(controller: summary, maxLines: 2, decoration: InputDecoration(labelText: tr('الملخص', 'Summary'))),
              const SizedBox(height: 10),
              TextField(controller: nextStep, decoration: InputDecoration(labelText: tr('الخطوة التالية', 'Next step'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (title.text.trim().isEmpty) return;
                    try {
                      await Api.instance.post('/api/business-development/activities', {
                        'entityType': 'opportunity', 'refId': widget.opportunityId,
                        'title': title.text.trim(), 'type': type,
                        'date': '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
                        if (summary.text.trim().isNotEmpty) 'summary': summary.text.trim(),
                        if (nextStep.text.trim().isNotEmpty) 'nextStep': nextStep.text.trim(),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل', 'Log')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final o = _opp ?? {};
    final st = _funnelStages[o['stage']] ?? ('—', '—', T.inkFaint);

    return AppScaffold(
      title: Text(widget.name),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _logActivity,
        icon: const Icon(Icons.add_comment_outlined),
        label: Text(tr('نشاط', 'Log')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: st.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((o['name'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                            Pressable(onTap: _advanceStage, child: Chip2(tr(st.$1, st.$2), st.$3, icon: Icons.edit_outlined)),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((o['estimatedValue'] ?? 0) != 0) Chip2('${_money(o['estimatedValue'])} ${tr('ر.س', 'SAR')}', T.navy, icon: Icons.payments_outlined),
                            if (o['probability'] != null) Chip2('${o['probability']}%', T.violet),
                            if ((o['priority'] ?? '') == 'high') Chip2(tr('أولوية عالية', 'High priority'), T.danger),
                            if (o['crmCompany'] is Map) Chip2((o['crmCompany']['name'] ?? '').toString(), T.cyan, icon: Icons.business_outlined),
                            if ((o['partnerName'] ?? '').toString().isNotEmpty) Chip2(o['partnerName'].toString(), T.info),
                            if (o['expectedCloseDate'] != null) Chip2('${tr('إغلاق متوقع', 'Close')}: ${_d(o['expectedCloseDate'])}', T.warn, icon: Icons.event),
                          ]),
                          if ((o['description'] ?? '').toString().isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text(o['description'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ],
                          if ((o['nextStep'] ?? '').toString().isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Row(children: [
                              const Icon(Icons.arrow_forward, size: 15, color: T.orange),
                              const SizedBox(width: 6),
                              Expanded(child: Text('${tr('التالي', 'Next')}: ${o['nextStep']}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.orange))),
                            ]),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text('${tr('سجل الأنشطة', 'Activity log')} (${_activities.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_activities.isEmpty)
                      EmptyState(icon: Icons.history_outlined, title: tr('لا توجد أنشطة بعد — سجّل أول نشاط', 'No activities yet')),
                    ..._activities.map((a) {
                      final ty = _activityTypes[a['type']] ?? ('—', '—');
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Column(children: [
                            Container(width: 12, height: 12, decoration: const BoxDecoration(color: T.violet, shape: BoxShape.circle)),
                            Container(width: 2, height: 46, color: T.navy.withValues(alpha: 0.1)),
                          ]),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Chip2(tr(ty.$1, ty.$2), T.violet),
                                const SizedBox(width: 6),
                                Expanded(child: Text((a['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                              ]),
                              if ((a['summary'] ?? '').toString().isNotEmpty)
                                Padding(padding: const EdgeInsets.only(top: 2), child: Text(a['summary'].toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                              Text('${_d(a['date'])}${_userName(a['performedBy']).isNotEmpty ? ' · ${_userName(a['performedBy'])}' : ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            ]),
                          ),
                        ]),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
