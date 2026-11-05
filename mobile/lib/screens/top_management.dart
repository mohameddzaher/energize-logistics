// Leave desks, twin of the web's LeaveDesk: finance, top management and the chairman each see every leave and decide their own stage (backend routes/leaveDesk). Also the staff requests to HR and the company's live activity.
import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/leave_chain.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_leave_pdf.dart';

String _name(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';


/// One stage's leave desk: the awaiting tab first; approve or reject at this stage.
class TopLeavesScreen extends StatefulWidget {
  const TopLeavesScreen({super.key, this.base = '/api/top-management', this.stage = 'executive', this.canDecide = true, this.title = const ('طلبات الإجازات', 'Leave Requests')});
  final String base;
  final String stage;
  final bool canDecide;
  final (String, String) title;
  @override
  State<TopLeavesScreen> createState() => _TopLeavesScreenState();
}

class _TopLeavesScreenState extends State<TopLeavesScreen> {
  static const _tabs = [('awaiting', 'تنتظر قرارك', 'Awaiting you'), ('in_chain', 'قيد المسار', 'In the chain'), ('approved', 'معتمدة', 'Approved'), ('rejected', 'مرفوضة', 'Rejected'), ('all', 'الكل', 'All')];
  String _tab = 'awaiting';
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _busy;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on('hr:leave', _onLive); }
  @override
  void dispose() { Live.instance.off('hr:leave', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('${widget.base}/leaves?tab=$_tab');
      if (mounted) setState(() { _rows = List<Map<String, dynamic>>.from(d['leaves'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted) { setState(() => _loading = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  Future<void> _decide(Map<String, dynamic> l, String decision) async {
    var note = '';
    if (decision == 'rejected') {
      final c = TextEditingController();
      final ok = await showDialog<bool>(context: context, builder: (dc) => AlertDialog(
        title: Text(tr('سبب الرفض', 'Reason for rejection')),
        content: TextField(controller: c, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dc), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dc, true), child: Text(tr('رفض', 'Reject'))),
        ],
      ));
      if (ok != true) return;
      note = c.text.trim();
    }
    setState(() => _busy = '${l['_id']}');
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {'decision': decision, 'note': note});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = null);
  }

  Widget _decision(String label, dynamic d) {
    if (d is! Map || d['at'] == null) return const SizedBox.shrink();
    final rejected = d['decision'] == 'rejected';
    return Text('$label: ${rejected ? tr('رفض', 'rejected') : tr('وافق', 'approved')} · ${_name(d['by'])}',
        style: TextStyle(fontSize: 11.5, color: rejected ? T.danger : T.success, fontWeight: FontWeight.w600));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr(widget.title.$1, widget.title.$2)),
      body: Column(children: [
        SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), children: [
          for (final t in _tabs) Padding(padding: const EdgeInsets.only(left: 6), child: ChoiceChip(
            selected: _tab == t.$1, label: Text(tr(t.$2, t.$3)),
            onSelected: (_) { setState(() { _tab = t.$1; _loading = true; }); _load(); },
          )),
        ])),
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
          onRefresh: _load,
          child: _rows.isEmpty
              ? ListView(children: [EmptyState(icon: Icons.event_available_outlined, title: tr('لا توجد طلبات هنا', 'Nothing here'))])
              : ListView(padding: const EdgeInsets.all(12), children: [
                  for (final l in _rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${(l['employee'] as Map?)?['arabicName'] ?? _name(l['employee'])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))),
                      Chip2(tr(leaveStatusOf(l['status']).$1, leaveStatusOf(l['status']).$2), leaveStatusOf(l['status']).$3),
                    ]),
                    const SizedBox(height: 4),
                    Text('${tr((l['leaveType'] as Map?)?['nameAr'] ?? '', (l['leaveType'] as Map?)?['nameEn'] ?? '')} · ${l['days'] ?? ''} ${tr('يوم', 'days')} · ${(l['employee'] as Map?)?['department'] ?? ''}',
                        style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                    Text('${bothDates(l['startDate'], ar: Lang.instance.ar)}  →  ${bothDates(l['endDate'], ar: Lang.instance.ar)}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    if ('${l['reason'] ?? ''}'.isNotEmpty) Text('${l['reason']}', style: const TextStyle(fontSize: 12)),
                    const SizedBox(height: 4),
                    for (final st in leaveStages) _decision(tr(st.ar, st.en), l[st.decision]),
                    LeaveDeductionBadge(leave: l),
                    Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
                      onPressed: () => downloadLeaveSheet(context, '${l['_id']}'),
                      icon: const Icon(Icons.picture_as_pdf_outlined, size: 16), label: Text(tr('ورقة الإجازة PDF', 'Leave sheet PDF')))),
                    if (!(widget.canDecide && l['status'] == 'pending_${widget.stage}') && leaveIsOpen(l['status']))
                      Padding(padding: const EdgeInsets.only(top: 4), child: Text(leaveWaitNote(l), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                    if (widget.canDecide && l['status'] == 'pending_${widget.stage}') Padding(padding: const EdgeInsets.only(top: 8), child: Row(children: [
                      Expanded(child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: T.success),
                        onPressed: _busy == '${l['_id']}' ? null : () => _decide(l, 'approved'),
                        icon: const Icon(Icons.check, size: 18), label: Text(tr('موافقة', 'Approve')))),
                      const SizedBox(width: 8),
                      Expanded(child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                        onPressed: _busy == '${l['_id']}' ? null : () => _decide(l, 'rejected'),
                        icon: const Icon(Icons.close, size: 18), label: Text(tr('رفض', 'Reject')))),
                    ])),
                  ]))),
                ]),
        )),
      ]),
    );
  }
}

const _reqStatus = {
  'open': ('جديد', 'Open', Color(0xFFEA580C)),
  'in_progress': ('قيد التنفيذ', 'In progress', Color(0xFF2563EB)),
  'received': ('تم الاستلام', 'Received', Color(0xFF0891B2)),
  'resolved': ('مُنجز', 'Resolved', Color(0xFF059669)),
  'closed': ('مغلق', 'Closed', Color(0xFF94A3B8)),
};
const _reqCategory = {
  'salary_certificate': ('تعريف بالراتب', 'Salary certificate'), 'letter': ('خطاب', 'Letter'), 'document': ('مستند', 'Document'),
  'data_update': ('تحديث بيانات', 'Data update'), 'complaint': ('شكوى', 'Complaint'), 'other': ('أخرى', 'Other'),
};

/// Every staff request to HR, open first.
class TopRequestsScreen extends StatefulWidget {
  const TopRequestsScreen({super.key, this.base = '/api/top-management'});
  final String base;
  @override
  State<TopRequestsScreen> createState() => _TopRequestsScreenState();
}

class _TopRequestsScreenState extends State<TopRequestsScreen> {
  static const _tabs = [('open', 'مفتوحة', 'Open'), ('resolved', 'منجزة', 'Resolved'), ('closed', 'مغلقة', 'Closed'), ('', 'الكل', 'All')];
  String _tab = 'open';
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on('hr:request', _onLive); }
  @override
  void dispose() { Live.instance.off('hr:request', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('${widget.base}/requests${_tab.isEmpty ? '' : '?status=$_tab'}');
      if (mounted) setState(() { _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات الموظفين', 'Staff Requests')),
      body: Column(children: [
        SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), children: [
          for (final t in _tabs) Padding(padding: const EdgeInsets.only(left: 6), child: ChoiceChip(
            selected: _tab == t.$1, label: Text(tr(t.$2, t.$3)),
            onSelected: (_) { setState(() { _tab = t.$1; _loading = true; }); _load(); },
          )),
        ])),
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
          onRefresh: _load,
          child: _rows.isEmpty
              ? ListView(children: [EmptyState(icon: Icons.mark_email_read_outlined, title: tr('لا توجد طلبات هنا', 'Nothing here'))])
              : ListView(padding: const EdgeInsets.all(12), children: [
                  for (final r in _rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text(_name(r['requester']), style: const TextStyle(fontWeight: FontWeight.w800))),
                      Chip2(tr(_reqStatus[r['status']]?.$1 ?? '${r['status']}', _reqStatus[r['status']]?.$2 ?? '${r['status']}'), _reqStatus[r['status']]?.$3 ?? T.inkSoft),
                    ]),
                    const SizedBox(height: 4),
                    Text('${r['subject'] ?? ''}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    Text('${tr(_reqCategory[r['category']]?.$1 ?? '', _reqCategory[r['category']]?.$2 ?? '')} · ${gregDay(r['createdAt'])}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                  ]))),
                ]),
        )),
      ]),
    );
  }
}

/// The company's latest actions as readable lines; refreshes every 20 seconds.
class TopActivityScreen extends StatefulWidget {
  const TopActivityScreen({super.key});
  @override
  State<TopActivityScreen> createState() => _TopActivityScreenState();
}

class _TopActivityScreenState extends State<TopActivityScreen> {
  List<Map<String, dynamic>> _logs = [];
  bool _loading = true;
  Timer? _timer;

  @override
  void initState() { super.initState(); _load(); _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load()); }
  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/top-management/activity?limit=150&lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (mounted) setState(() { _logs = List<Map<String, dynamic>>.from(d['logs'] ?? []); _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _ago(dynamic iso) {
    final d = DateTime.tryParse('${iso ?? ''}');
    if (d == null) return '';
    final m = DateTime.now().difference(d).inMinutes;
    if (m < 1) return tr('الآن', 'now');
    if (m < 60) return tr('منذ $m د', '${m}m ago');
    if (m < 1440) return tr('منذ ${m ~/ 60} س', '${m ~/ 60}h ago');
    return gregDay(iso);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('نشاط الشركة المباشر', 'Live Company Activity')),
      body: _loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
        onRefresh: _load,
        child: ListView.separated(
          padding: const EdgeInsets.all(12),
          itemCount: _logs.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final l = _logs[i];
            // The server's full sentence, as on the web; it starts with the actor, who is shown in bold.
            final actor = '${l['userName'] ?? ''}';
            final full = '${l['sentence'] ?? ''}'.isNotEmpty ? '${l['sentence']}' : [l['actionLabel'], l['entityLabel'], l['subject'], l['summary']].where((x) => '${x ?? ''}'.isNotEmpty).join(' — ');
            final text = full.startsWith(actor) ? full.substring(actor.length).trim() : full;
            return ListTile(
              dense: true,
              leading: const Icon(Icons.circle, size: 9, color: T.orange),
              title: Text.rich(TextSpan(children: [
                TextSpan(text: '${l['userName'] ?? ''} ', style: const TextStyle(fontWeight: FontWeight.w800)),
                TextSpan(text: text),
              ]), style: const TextStyle(fontSize: 13)),
              subtitle: Text([l['branchName'], l['sectionLabel'], _ago(l['createdAt'])].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11)),
            );
          },
        ),
      ),
    );
  }
}
