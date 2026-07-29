import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مهام التحصيل — مهامي على العملاء (اتصال/زيارة/واتساب…) بحالاتها،
/// مع تبويب «العملاء الأقل زيارة» لاكتشاف من يحتاج متابعة.

const _contactMethods = {
  'call': ('اتصال', 'Call', Icons.call_outlined),
  'whatsapp': ('واتساب', 'WhatsApp', Icons.chat_outlined),
  'visit': ('زيارة', 'Visit', Icons.directions_walk_outlined),
  'email': ('بريد', 'Email', Icons.email_outlined),
  'message': ('رسالة', 'Message', Icons.sms_outlined),
};

const _taskStatus = {
  'pending': ('قيد التنفيذ', 'Pending', T.warn),
  'done': ('منجزة', 'Done', T.success),
  'postponed': ('مؤجلة', 'Postponed', T.info),
  'cancelled': ('ملغاة', 'Cancelled', T.inkFaint),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _customerName(dynamic c) => c is Map ? (c['companyName'] ?? '—').toString() : '—';
String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class FinanceTasksScreen extends StatefulWidget {
  const FinanceTasksScreen({super.key});
  @override
  State<FinanceTasksScreen> createState() => _FinanceTasksScreenState();
}

class _FinanceTasksScreenState extends State<FinanceTasksScreen> {
  List<Map<String, dynamic>> _tasks = [];
  List<Map<String, dynamic>> _lowVisit = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('task:updated', _onLive);
    Live.instance.on('task:created', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('task:updated', _onLive);
    Live.instance.off('task:created', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final results = await Future.wait([
        Api.instance.get('/api/tasks/my-tasks$qs').catchError((_) => Api.instance.get('/api/tasks$qs')),
        Api.instance.get('/api/tasks/low-visit-customers').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _tasks = List<Map<String, dynamic>>.from(results[0]['tasks'] ?? []);
        _lowVisit = List<Map<String, dynamic>>.from(results[1]['customers'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _updateTask(Map<String, dynamic> t, String status) async {
    final collected = TextEditingController();
    final notes = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${tr('تحديث المهمة', 'Update task')} — ${_customerName(t['customer'])}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          if (status == 'done')
            TextField(controller: collected, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ المحصّل', 'Amount collected'))),
          const SizedBox(height: 8),
          TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/tasks/${t['_id']}', {
        'status': status,
        if (status == 'done' && collected.text.trim().isNotEmpty) 'collectedAmount': num.tryParse(collected.text),
        if (notes.text.trim().isNotEmpty) 'actionNotes': notes.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: Text(tr('مهام التحصيل', 'Collection Tasks')),
        appBarBottom: TabBar(
          indicatorColor: T.orange,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: [
            Tab(text: '${tr('مهامي', 'My Tasks')} (${_tasks.length})'),
            Tab(text: '${tr('الأقل زيارة', 'Low-visit')} (${_lowVisit.length})'),
          ],
        ),
        body: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : TabBarView(children: [
                    // ── مهامي ──
                    Column(children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(children: _taskStatus.entries.map((e) {
                            final selected = _status == e.key;
                            return Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: FilterChip(
                                selected: selected,
                                onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                                label: Text(tr(e.value.$1, e.value.$2)),
                                labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                                selectedColor: e.value.$3,
                                backgroundColor: e.value.$3.withValues(alpha: 0.1),
                                checkmarkColor: Colors.white,
                                side: BorderSide.none,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              ),
                            );
                          }).toList()),
                        ),
                      ),
                      Expanded(
                        child: RefreshIndicator(
                          onRefresh: _load,
                          child: _tasks.isEmpty
                              ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد مهام', 'No tasks'))])
                              : ListView.separated(
                                  padding: const EdgeInsets.all(14),
                                  itemCount: _tasks.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                                  itemBuilder: (c, i) {
                                    final t = _tasks[i];
                                    final cm = _contactMethods[t['contactMethod']] ?? ('—', '—', Icons.help_outline);
                                    final st = _taskStatus[t['status']] ?? ('—', '—', T.inkFaint);
                                    return FadeSlideIn(
                                      delayMs: (i * 12).clamp(0, 120),
                                      child: AppCard(
                                        topAccent: st.$3,
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Row(children: [
                                            Icon(cm.$3, size: 17, color: T.navy),
                                            const SizedBox(width: 6),
                                            Expanded(child: Text(_customerName(t['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                            Chip2(tr(st.$1, st.$2), st.$3),
                                          ]),
                                          const SizedBox(height: 5),
                                          Wrap(spacing: 6, runSpacing: 6, children: [
                                            Chip2(tr(cm.$1, cm.$2), T.navy),
                                            if (t['customer'] is Map && (t['customer']['currentOutstanding'] ?? 0) != 0)
                                              Chip2('${tr('مستحق', 'Due')}: ${_money(t['customer']['currentOutstanding'])}', T.danger),
                                            if (t['dueDate'] != null) Chip2(_d(t['dueDate']), T.warn, icon: Icons.event),
                                          ]),
                                          if (t['status'] == 'pending') ...[
                                            const SizedBox(height: 6),
                                            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                              TextButton(onPressed: () => _updateTask(t, 'postponed'), child: Text(tr('تأجيل', 'Postpone'), style: const TextStyle(fontSize: 12, color: T.info, fontWeight: FontWeight.w700))),
                                              const SizedBox(width: 4),
                                              FilledButton.tonal(
                                                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                                                onPressed: () => _updateTask(t, 'done'),
                                                child: Text(tr('إنجاز', 'Done'), style: const TextStyle(fontSize: 12)),
                                              ),
                                            ]),
                                          ],
                                        ]),
                                      ),
                                    );
                                  },
                                ),
                        ),
                      ),
                    ]),
                    // ── الأقل زيارة ──
                    RefreshIndicator(
                      onRefresh: _load,
                      child: _lowVisit.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.groups_outlined, title: tr('لا يوجد عملاء منخفضو الزيارة', 'None'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _lowVisit.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final cu = _lowVisit[i];
                                final days = cu['daysSinceLastTask'];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: days == null || (days as num) > 30 ? T.danger : T.warn,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((cu['companyName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(days == null ? tr('لم يُزَر', 'Never') : '$days ${tr('يوم', 'd')}', days == null || (days as num) > 30 ? T.danger : T.warn),
                                      ]),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if ((cu['currentOutstanding'] ?? 0) != 0) Chip2('${tr('مستحق', 'Due')}: ${_money(cu['currentOutstanding'])}', T.danger),
                                        if ((cu['riskLevel'] ?? '').toString().isNotEmpty) Chip2(cu['riskLevel'].toString(), T.violet),
                                        if (cu['assignedCollector'] is Map) Chip2('${cu['assignedCollector']['firstName'] ?? ''} ${cu['assignedCollector']['lastName'] ?? ''}'.trim(), T.navy, icon: Icons.person_outline),
                                        Chip2('${tr('المهام', 'Tasks')}: ${cu['totalTasks'] ?? 0}', T.inkFaint),
                                      ]),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ]),
      ),
    );
  }
}
