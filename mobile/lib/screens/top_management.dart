// Leave desks, twin of the web's LeaveDesk: finance, top management and the chairman each see every leave and decide their own stage (backend routes/leaveDesk). Also the staff requests to HR and the company's live activity.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/auth.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/leave_chain.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_leave_pdf.dart';

String _name(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';


/// One stage's leave desk, twin of the web LeaveDesk: search, compact cards with a stage progress bar, and a detail sheet where the stage decides.
/// Approving signs with the approver's saved signature on the server; there is nothing to tick.
class TopLeavesScreen extends StatefulWidget {
  const TopLeavesScreen({super.key, this.base = '/api/top-management', this.stage = 'executive', this.canDecide = true, this.title = const ('طلبات الإجازات', 'Leave Requests')});
  final String base;
  final String stage;
  final bool canDecide;
  final (String, String) title;
  @override
  State<TopLeavesScreen> createState() => _TopLeavesScreenState();
}

String _empName(Map l) => '${(l['employee'] as Map?)?['arabicName'] ?? ''}'.trim().isNotEmpty ? '${l['employee']['arabicName']}' : _name(l['employee']);
String _dm(dynamic v) { final s = '${v ?? ''}'; return s.length >= 10 ? '${s.substring(8, 10)}/${s.substring(5, 7)}' : ''; }

/// The five stages as one bar (process viewers only).
class _StageBar extends StatelessWidget {
  const _StageBar({required this.leave});
  final Map<String, dynamic> leave;
  @override
  Widget build(BuildContext context) {
    Color c(String st) => switch (st) { 'done' => T.success, 'rejected' => T.danger, 'asked' => T.warn, 'current' => T.orange, _ => T.line };
    return Row(children: [
      for (final s in leaveStages) ...[
        Expanded(child: Tooltip(message: tr(s.ar, s.en), child: Container(height: 6, decoration: BoxDecoration(color: c(_state(s.key, s.decision)), borderRadius: BorderRadius.circular(4))))),
        if (s != leaveStages.last) const SizedBox(width: 3),
      ],
    ]);
  }
  String _state(String key, String field) {
    final d = leave[field];
    if (d is Map) {
      if (d['decision'] == 'approved') return 'done';
      if (d['decision'] == 'rejected') return 'rejected';
      if (d['decision'] == 'info') return 'asked';
    }
    if (leave['currentStage'] == key) return 'current';
    if (leave['status'] == 'approved') return 'done';
    return 'waiting';
  }
}

class _TopLeavesScreenState extends State<TopLeavesScreen> {
  // Stages are shown to process viewers only (seesLeaveProcess); the finance desk reads «قيد المراجعة».
  bool get _full => seesLeaveProcess(context.read<AuthProvider>().user);
  List<(String, String, String)> get _tabs => [widget.canDecide ? ('awaiting', 'تنتظر قرارك', 'Awaiting you') : ('awaiting', 'عند الإدارة العليا', 'With top management'), _full ? ('in_chain', 'قيد المسار', 'In the chain') : ('in_chain', 'قيد المراجعة', 'Under review'), ('approved', 'معتمدة', 'Approved'), ('rejected', 'مرفوضة', 'Rejected'), ('all', 'الكل', 'All')];
  String _tab = 'awaiting';
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _busy;
  String _q = '';
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

  bool _canAct(Map l) => widget.canDecide && l['status'] == 'pending_${widget.stage}';

  List<Map<String, dynamic>> get _shown {
    final q = _q.trim().toLowerCase();
    if (q.isEmpty) return _rows;
    return _rows.where((l) {
      final e = (l['employee'] as Map?) ?? {};
      return [_empName(l), e['employeeNumber'], e['department'], e['jobTitle'], (l['leaveType'] as Map?)?['nameAr']].any((x) => '${x ?? ''}'.toLowerCase().contains(q));
    }).toList();
  }

  Future<bool> _decide(Map<String, dynamic> l, String decision) async {
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
      if (ok != true) return false;
      note = c.text.trim();
    }
    setState(() => _busy = '${l['_id']}');
    var done = false;
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {'decision': decision, 'note': note});
      done = true;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(decision == 'approved' ? tr('تمت الموافقة ووُضع توقيعك', 'Approved and signed') : tr('رُفضت الإجازة', 'Leave rejected'))));
      }
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = null);
    return done;
  }

  void _openDetail(Map<String, dynamic> l) {
    showModalBottomSheet(
      context: context, isScrollControlled: true, useSafeArea: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => DraggableScrollableSheet(
        expand: false, initialChildSize: 0.88, maxChildSize: 0.96, minChildSize: 0.5,
        builder: (c, sc) => LeaveDetailSheet(
          leave: l, full: _full, canAct: _canAct(l), scroll: sc,
          onDecide: (d) async { final ok = await _decide(l, d); if (ok && c.mounted) Navigator.pop(c); },
        ),
      ),
    );
  }

  Widget _card(Map<String, dynamic> l) {
    final st = leaveStatusFor(l['status'], full: _full, canAct: _canAct(l));
    final e = (l['employee'] as Map?) ?? {};
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _openDetail(l),
        child: AppCard(
          topAccent: _canAct(l) ? T.orange : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_empName(l), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                Text([if ('${e['employeeNumber'] ?? ''}'.isNotEmpty) '#${e['employeeNumber']}', if ('${e['department'] ?? ''}'.isNotEmpty) e['department']].join(' · '),
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ])),
              Chip2(tr(st.$1, st.$2), st.$3),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: Text(tr('${(l['leaveType'] as Map?)?['nameAr'] ?? ''}', '${(l['leaveType'] as Map?)?['nameEn'] ?? ''}'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
              Text('${_dm(l['startDate'])} → ${_dm(l['endDate'])}', textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
              const SizedBox(width: 10),
              Text('${l['days'] ?? ''} ${tr('يوم', 'd')}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
            ]),
            if (_full) ...[const SizedBox(height: 10), _StageBar(leave: l)],
            if (!_canAct(l) && leaveIsOpen(l['status']))
              Padding(padding: const EdgeInsets.only(top: 6), child: Text(leaveWaitNote(l, full: _full), style: const TextStyle(fontSize: 11, color: T.inkSoft))),
            if (_canAct(l)) Padding(padding: const EdgeInsets.only(top: 10), child: Row(children: [
              Expanded(child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.success, visualDensity: VisualDensity.compact),
                onPressed: _busy == '${l['_id']}' ? null : () => _decide(l, 'approved'),
                icon: const Icon(Icons.check, size: 18), label: Text(tr('موافقة', 'Approve')))),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger, visualDensity: VisualDensity.compact),
                onPressed: _busy == '${l['_id']}' ? null : () => _decide(l, 'rejected'),
                icon: const Icon(Icons.close, size: 18), label: Text(tr('رفض', 'Reject')))),
            ])),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final shown = _shown;
    return AppScaffold(
      title: Text(tr(widget.title.$1, widget.title.$2)),
      body: Column(children: [
        SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), children: [
          for (final t in _tabs) Padding(padding: const EdgeInsets.only(left: 6), child: ChoiceChip(
            selected: _tab == t.$1, label: Text(tr(t.$2, t.$3)),
            onSelected: (_) { setState(() { _tab = t.$1; _loading = true; }); _load(); },
          )),
        ])),
        // Outside the loading branch so typing never loses the box (mobile-search-field).
        Padding(padding: const EdgeInsets.fromLTRB(12, 0, 12, 6), child: SearchField(onChanged: (v) => setState(() => _q = v), hint: tr('ابحث بالاسم أو الرقم أو القسم…', 'Search name, number, department…'), dense: true)),
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
          onRefresh: _load,
          child: shown.isEmpty
              ? ListView(children: [EmptyState(icon: Icons.event_available_outlined, title: tr('لا توجد طلبات هنا', 'Nothing here'))])
              : ListView(padding: const EdgeInsets.all(12), children: [for (final l in shown) _card(l)]),
        )),
      ]),
    );
  }
}

/// The whole request: who, what, when, the process, the conversation and the papers; the stage decides at the bottom. Also opened from the HR leaves screen (read-only there; HR decides from the card).
class LeaveDetailSheet extends StatelessWidget {
  const LeaveDetailSheet({super.key, required this.leave, required this.full, required this.canAct, required this.scroll, required this.onDecide});
  final Map<String, dynamic> leave;
  final bool full;
  final bool canAct;
  final ScrollController scroll;
  final Future<void> Function(String decision) onDecide;

  Widget _info(String k, String v) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: const TextStyle(fontSize: 11, color: T.inkFaint, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
        ]),
      );
  Widget _head(String t) => Padding(padding: const EdgeInsets.only(top: 14, bottom: 6), child: Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)));

  @override
  Widget build(BuildContext context) {
    final l = leave;
    final e = (l['employee'] as Map?) ?? {};
    final snap = (l['balanceSnapshot'] as Map?) ?? {};
    final ex = leaveExcludedFridays(l);
    final idNo = e['idType'] == 'national_id' ? (e['nationalId'] ?? e['iqamaNumber']) : (e['iqamaNumber'] ?? e['nationalId']);
    final notes = [for (final s in leaveStages) if (l[s.decision] is Map && '${l[s.decision]['note'] ?? ''}'.isNotEmpty) (s, l[s.decision] as Map)];
    final atts = List<Map<String, dynamic>>.from(((l['attachments'] as List?) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)));
    return Column(children: [
      Container(margin: const EdgeInsets.only(top: 8), width: 40, height: 4, decoration: BoxDecoration(color: T.line, borderRadius: BorderRadius.circular(4))),
      Expanded(child: ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 12, 16, 16), children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: T.navy, borderRadius: BorderRadius.circular(16)),
          child: Row(children: [
            const CircleAvatar(backgroundColor: Colors.white24, child: Icon(Icons.person_outline, color: Colors.white)),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_empName(l), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
              Text([if ('${e['employeeNumber'] ?? ''}'.isNotEmpty) '#${e['employeeNumber']}', e['jobTitle'] ?? '', e['department'] ?? ''].where((x) => '$x'.isNotEmpty).join(' · '),
                  style: const TextStyle(color: Colors.white70, fontSize: 11.5)),
            ])),
            Column(children: [
              Text('${l['days'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
              Text(tr('يوم', 'days'), style: const TextStyle(color: Colors.white70, fontSize: 11)),
            ]),
          ]),
        ),
        _head(tr('بيانات الإجازة', 'Leave')),
        _info(tr('النوع', 'Type'), tr('${(l['leaveType'] as Map?)?['nameAr'] ?? ''}', '${(l['leaveType'] as Map?)?['nameEn'] ?? ''}')),
        _info(tr('من', 'From'), bothDates(l['startDate'], ar: Lang.instance.ar)),
        _info(tr('إلى', 'To'), bothDates(l['endDate'], ar: Lang.instance.ar)),
        _info(tr('تاريخ الطلب', 'Requested on'), bothDates(l['createdAt'], ar: Lang.instance.ar)),
        if (ex.isNotEmpty) _info(tr('أيام جمعة لا تُحسب إجازة', 'Fridays not counted'), ex.map((d) => d.split('-').reversed.join('/')).join('  ·  ')),
        if ('${l['reason'] ?? ''}'.isNotEmpty) _info(tr('السبب', 'Reason'), '${l['reason']}'),
        if (snap['available'] != null) _info(tr('الرصيد المتاح عند الطلب', 'Available at request'), '${snap['available']} ${tr('يوم', 'd')}'),
        if (snap['remainingAfter'] != null) _info(tr('المتبقي بعد الإجازة', 'Remaining after'), '${snap['remainingAfter']} ${tr('يوم', 'd')}'),
        LeaveDeductionBadge(leave: l, full: full),
        _head(tr('بيانات الموظف', 'Employee')),
        _info(e['idType'] == 'national_id' ? tr('رقم الهوية', 'ID no.') : tr('رقم الإقامة', 'Iqama no.'), '${idNo ?? ''}'),
        _info(tr('الجنسية', 'Nationality'), '${e['nationality'] ?? ''}'),
        if (full) ...[_head(tr('مسار الموافقات', 'Approval chain')), LeaveChainBar(leave: l, full: true)],
        if (notes.isNotEmpty) ...[
          _head(tr('ملاحظات القرارات', 'Decision notes')),
          for (final n in notes) _info(full ? '${tr(n.$1.ar, n.$1.en)} · ${_name(n.$2['by'])}' : tr('المراجعة', 'Review'), '${n.$2['note']}'),
        ],
        LeaveThread(leave: l, full: full),
        if (atts.isNotEmpty) ...[
          _head(tr('مرفقات الطلب', 'Attachments')),
          for (final a in atts) ListTile(
            dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.attach_file, size: 18, color: T.orange),
            title: Text('${a['title'] ?? a['fileName'] ?? tr('مرفق', 'Attachment')}', style: const TextStyle(fontSize: 13)),
            onTap: () { final u = '${a['fileUrl'] ?? ''}'; if (u.isNotEmpty) launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication); },
          ),
        ],
      ])),
      SafeArea(top: false, child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: T.line))),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (canAct) ...[
            Row(children: [
              const Icon(Icons.draw_outlined, size: 15, color: T.orange),
              const SizedBox(width: 4),
              Expanded(child: Text(tr('يُوضع توقيعك تلقائيًا عند الموافقة', 'Your signature is applied on approval'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => onDecide('approved'), icon: const Icon(Icons.check), label: Text(tr('موافقة', 'Approve')))),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: T.danger), onPressed: () => onDecide('rejected'), icon: const Icon(Icons.close), label: Text(tr('رفض', 'Reject')))),
            ]),
            const SizedBox(height: 6),
          ] else if (leaveIsOpen(l['status']))
            Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(leaveWaitNote(l, full: full), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
          SizedBox(width: double.infinity, child: TextButton.icon(
            onPressed: () => downloadLeaveSheet(context, '${l['_id']}'),
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18), label: Text(tr('ورقة الإجازة PDF', 'Leave sheet PDF')))),
        ]),
      )),
    ]);
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
