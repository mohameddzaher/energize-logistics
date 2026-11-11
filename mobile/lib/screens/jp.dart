import '../ui/lookup_field.dart';
import '../ui/name_sound.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'customs_detail.dart';

/// Work plan (JP), counterpart of `JpBoard` and `JpDashboard` on the web.
/// One screen for the section and for the management plan. Permission comes from the server: each task carries `can` and `/me` says manager or member, so no role list is repeated here except what the drawer uses to hide a page the server would refuse (the two maps below, generated from backend/src/config/jpSections.js).
const jpManagerRoles = <String, List<String>>{
  'operations': ['operations_manager', 'operations_team_leader'],
  'collections': ['collections_manager'],
  'ops': ['ops_platform_manager'],
  'shipment-orders': ['shipment_orders_manager'],
  'vendors': ['vendors_manager'],
  'fleet': ['fleet_manager'],
  'customs': ['customs_manager'],
  'vehicles': ['vehicles_manager'],
  'ls2': ['location_manager'],
  'marketing': ['marketing_manager'],
  'bd': ['bd_manager'],
  'it': ['it_manager'],
  'administration': ['administration_manager'],
  'contracts': ['contracts_manager'],
  'b2c': ['b2c_manager', 'b2c_deputy'],
  'remote': ['remote_manager'],
  'hr': ['hr_manager'],
  'crm': ['crm_manager'],
  'sales': ['sales_manager'],
  'accounting': ['accounting_manager', 'cfo'],
  'procurement': ['procurement_manager'],
};
const jpStaffRoles = <String, List<String>>{
  'operations': ['operations_staff', 'operations_trainee'],
  'collections': ['collections_staff', 'collections_trainee'],
  'ops': ['ops_platform_staff', 'ops_platform_trainee'],
  'shipment-orders': ['shipment_orders_staff', 'shipment_orders_followup', 'shipment_orders_trainee'],
  'vendors': ['vendors_team_leader', 'vendors_staff', 'vendors_trainee'],
  'fleet': ['fleet_supervisor', 'fleet_trainee'],
  'customs': ['customs_officer', 'customs_trainee'],
  'vehicles': ['vehicles_staff', 'vehicles_trainee'],
  'ls2': ['location_staff', 'location_trainee'],
  'marketing': ['marketing_specialist', 'marketing_trainee'],
  'bd': ['bd_specialist', 'bd_trainee'],
  'it': ['it_specialist', 'it_trainee'],
  'administration': ['administration_staff', 'administration_trainee'],
  'contracts': ['contracts_staff', 'contracts_trainee'],
  'b2c': ['b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor', 'b2c_trainee'],
  'remote': ['remote_employee', 'remote_trainee'],
  'hr': ['hr_specialist', 'hr_trainee'],
  'crm': ['crm_specialist', 'crm_trainee'],
  'sales': ['sales_rep', 'sales_trainee'],
  'accounting': ['accountant', 'accounting_trainee'],
  'procurement': ['procurement_staff', 'procurement_trainee'],
};

bool jpManager(String role, String section) =>
    const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(role) || role == 'admin' || (jpManagerRoles[section] ?? const []).contains(role);
bool jpMember(String role, String section) =>
    jpManager(role, section) || (jpStaffRoles[section] ?? const []).contains(role);

const _actions = {
  'call': ('اتصال هاتفي', 'Phone call', Icons.call_outlined),
  'whatsapp': ('واتساب', 'WhatsApp', Icons.chat_outlined),
  'visit': ('زيارة', 'Visit', Icons.place_outlined),
  'email': ('بريد إلكتروني', 'Email', Icons.mail_outline),
  'meeting': ('اجتماع', 'Meeting', Icons.groups_outlined),
  'other': ('أخرى', 'Other', Icons.more_horiz),
};

/// What a task can be linked to; each section has its kinds (`linkKinds`, backend/config/jpLinks.js): transaction, shipment, employee, vehicle, ... The server validates and captures the name.
const _linkKinds = {
  'clearance': ('معاملة', 'Transaction', Icons.directions_boat_outlined),
  'customer': ('عميل', 'Customer', Icons.people_outline),
  'agent': ('وكيل شحن', 'Shipping agent', Icons.anchor_outlined),
  'carrier': ('ناقل', 'Carrier', Icons.local_shipping_outlined),
  'workflow': ('تقرير تشغيل', 'Ops report', Icons.description_outlined),
  'shipment': ('شحنة', 'Shipment', Icons.inventory_2_outlined),
  'fleetShipment': ('رحلة أسطول', 'Fleet trip', Icons.route_outlined),
  'employee': ('موظّف', 'Employee', Icons.badge_outlined),
  'vehicle': ('مركبة', 'Vehicle', Icons.directions_car_outlined),
  'truck': ('شاحنة', 'Truck', Icons.local_shipping_outlined),
  'rep': ('مندوب', 'Rider', Icons.delivery_dining_outlined),
  'company': ('شركة', 'Company', Icons.business_outlined),
  'collParty': ('عميل تحصيل', 'Collections party', Icons.account_balance_wallet_outlined),
  'vendor': ('مورّد', 'Vendor', Icons.storefront_outlined),
  'ticket': ('تذكرة', 'Ticket', Icons.confirmation_number_outlined),
  'opportunity': ('فرصة', 'Opportunity', Icons.lightbulb_outline),
  'campaign': ('حملة', 'Campaign', Icons.campaign_outlined),
};

String _span(Duration d) {
  final m = d.inMinutes.abs();
  if (m < 60) return tr('$m د', '${m}m');
  final h = m ~/ 60, r = m % 60;
  if (h < 24) return tr('$h س${r > 0 ? ' و$r د' : ''}', '${h}h${r > 0 ? ' ${r}m' : ''}');
  final days = h ~/ 24, hr = h % 24;
  return tr('$days ي${hr > 0 ? ' و$hr س' : ''}', '${days}d${hr > 0 ? ' ${hr}h' : ''}');
}

String _two(int n) => n.toString().padLeft(2, '0');
String _ymd(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';

/// Deadline line and its colour, as on the web: "due before 3:00 PM, one hour left".
(String, Color) jpDeadline(Map<String, dynamic> t) {
  final raw = t['deadlineAt'];
  if (raw == null) return (tr('بلا موعد', 'No deadline'), T.inkFaint);
  final due = DateTime.parse(raw.toString()).toLocal();
  final now = DateTime.now();
  final h12 = due.hour % 12 == 0 ? 12 : due.hour % 12;
  final clock = '$h12:${_two(due.minute)} ${due.hour < 12 ? tr('ص', 'AM') : tr('م', 'PM')}';
  final day = '${due.day}/${due.month}';
  final when = t['deadlineKind'] == 'hours' ? (_ymd(due) == _ymd(now) ? clock : '$clock · $day') : day;
  if (t['status'] == 'done') {
    final late = t['doneAt'] != null && DateTime.parse(t['doneAt'].toString()).isAfter(due);
    return (tr('الموعد $when — ${late ? 'سُلِّمت بعده' : 'سُلِّمت في موعدها'}', 'Due $when — ${late ? 'late' : 'on time'}'), T.success);
  }
  final left = due.difference(now);
  if (left.isNegative) return (tr('الموعد $when — تأخّرت ${_span(left)}', 'Due $when — ${_span(left)} late'), T.danger);
  return (tr('تُسلَّم قبل $when — بقي ${_span(left)}', 'Due by $when — ${_span(left)} left'), left.inHours < 2 ? T.warn : T.inkSoft);
}

String _qs(String scope, String? section) => 'scope=$scope${scope == 'section' ? '&section=$section' : ''}';
String _id(dynamic v) => v is Map ? (v['_id'] ?? '').toString() : (v ?? '').toString();

class JpScreen extends StatefulWidget {
  final String scope;       // 'section' | 'management'
  final String? section;    // 'fleet', 'collections', …
  const JpScreen({super.key, this.scope = 'section', this.section});
  @override
  State<JpScreen> createState() => _JpScreenState();
}

class _JpScreenState extends State<JpScreen> {
  /// Manager correction: minutes added or subtracted on a specific day.
  Future<void> _adjust(Map<String, dynamic> t) async {
    final mins = TextEditingController(), note = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تصحيح الوقت', 'Adjust time')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: mins, keyboardType: const TextInputType.numberWithOptions(signed: true), decoration: InputDecoration(labelText: tr('الدقائق (+ تُزاد، − تُنقَص) — اليوم', 'Minutes (+/−) — today'))),
        TextField(controller: note, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    if (ok != true) return;
    await _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/time', {'minutes': num.tryParse(mins.text.trim()) ?? 0, 'note': note.text.trim()}));
  }

  Map<String, dynamic>? _me;
  List<Map<String, dynamic>> _tasks = [];
  List<Map<String, dynamic>> _projects = [];
  Map<String, dynamic> _counts = {};
  String _box = 'mine', _status = 'open', _project = '', _mySection = '';
  bool _loading = true;
  String? _error;
  Timer? _tick;
  late final void Function() _onLive;

  String get _q => _qs(widget.scope, widget.section);
  bool get _canManage => _me?['canManage'] == true;
  bool get _management => widget.scope == 'management';

  @override
  void initState() {
    super.initState();
    _init();
    _onLive = () => _load();
    Live.instance.on('jp:changed', _onLive);
    // The countdown ticks without a reload.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() {
    Live.instance.off('jp:changed', _onLive);
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _init() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/jp/me?$_q'));
      if (!mounted) return;
      setState(() { _me = d; _box = d['canManage'] == true ? 'all' : 'mine'; });
      await _load();
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _load() async {
    if (_me == null) return;
    try {
      final f = '&box=$_box${_status.isEmpty ? '' : '&status=$_status'}${_project.isEmpty ? '' : '&project=$_project'}';
      final res = await Future.wait([Api.instance.get('/api/jp/tasks?$_q$f'), Api.instance.get('/api/jp/projects?$_q')]);
      if (!mounted) return;
      setState(() {
        _tasks = List<Map<String, dynamic>>.from(res[0]['tasks'] ?? []);
        _counts = Map<String, dynamic>.from(res[0]['counts'] ?? {});
        _mySection = (res[0]['mySection'] ?? '').toString();
        _projects = List<Map<String, dynamic>>.from(res[1]['projects'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _say(Object e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }

  Future<void> _run(Future<dynamic> Function() f) async {
    try { await f(); await _load(); } catch (e) { _say(e); }
  }

  void _openForm({Map<String, dynamic>? task}) {
    showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _JpForm(
        scope: widget.scope, section: widget.section, me: _me!, projects: _projects,
        task: task, presetProject: _project, onDone: _load,
      ),
    );
  }

  Future<void> _complete(Map<String, dynamic> t) async {
    final note = TextEditingController();
    PickedFile? file;
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('إتمام المهمّة', 'Complete task'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 6),
          Text((t['title'] ?? '').toString(), style: const TextStyle(color: T.inkSoft)),
          const SizedBox(height: 12),
          TextField(controller: note, maxLines: 3, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async { final p = await pickFileAsDataUrl(); if (p != null) set(() => file = p); },
            icon: const Icon(Icons.attach_file),
            label: Text(file?.fileName ?? tr('ملفٌّ يثبت الإتمام (اختياري)', 'Proof file (optional)'), overflow: TextOverflow.ellipsis),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.success),
            onPressed: () => Navigator.pop(c, true), icon: const Icon(Icons.check), label: Text(tr('تمّت', 'Done')),
          ),
        ]),
      )),
    );
    if (ok != true) return;
    await _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/done', {
      'done': true, 'note': note.text,
      if (file != null) 'file': {'dataUrl': file!.dataUrl, 'fileName': file!.fileName},
    }));
  }

  /// Task comments: readable and writable by the assignee, the assigner and the section manager.
  Future<void> _comments(Map<String, dynamic> t) async {
    final text = TextEditingController();
    var list = List<Map<String, dynamic>>.from(t['comments'] ?? []);
    final canWrite = (t['can'] ?? {})['comment'] == true;
    await showModalBottomSheet<void>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
        padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('التعليقات', 'Comments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          Text((t['title'] ?? '').toString(), style: const TextStyle(color: T.inkSoft, fontSize: 12.5)),
          const SizedBox(height: 10),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.4),
            child: list.isEmpty
                ? Padding(padding: const EdgeInsets.all(16), child: Text(tr('لا تعليقات بعد', 'No comments yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))
                : ListView(shrinkWrap: true, children: [
                    for (final m in list) Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text((m['byName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                        Text((m['text'] ?? '').toString(), style: const TextStyle(fontSize: 13)),
                      ]),
                    ),
                  ]),
          ),
          if (canWrite) Row(children: [
            Expanded(child: TextField(controller: text, decoration: InputDecoration(isDense: true, hintText: tr('اكتب تعليقًا…', 'Write a comment…'), border: const OutlineInputBorder()))),
            const SizedBox(width: 8),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.navy),
              onPressed: () async {
                final v = text.text.trim(); if (v.isEmpty) return;
                try {
                  final r = await Api.instance.post('/api/jp/tasks/${t['_id']}/comments', {'text': v});
                  text.clear();
                  set(() => list = List<Map<String, dynamic>>.from(r['task']?['comments'] ?? list));
                } catch (e) { _say(e); }
              },
              child: Text(tr('إرسال', 'Send')),
            ),
          ]),
        ]),
      )),
    );
    _load();
  }

  Future<void> _delete(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تأكيد الحذف', 'Confirm delete')),
      content: Text((t['title'] ?? '').toString()),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok == true) await _run(() => Api.instance.delete('/api/jp/tasks/${t['_id']}'));
  }

  /// The section manager hands what he was assigned down to an employee under him; the employee sees it as from his manager.
  Future<void> _handDown({Map<String, dynamic>? task, Map<String, dynamic>? project}) async {
    if (_mySection.isEmpty) return;
    List<Map<String, dynamic>> team;
    try {
      final d = await Api.instance.get('/api/jp/me?scope=section&section=$_mySection');
      team = List<Map<String, dynamic>>.from(d['team'] ?? []).where((m) => m['isManager'] != true && m['_id'] != d['me']).toList();
    } catch (e) { _say(e); return; }
    if (!mounted) return;
    final who = await showModalBottomSheet<String>(
      context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(14), children: [
        Text(tr('إسنادٌ إلى موظّفٍ في قسمي', 'Assign to someone on my team'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 4),
        Text(tr('تُنشأ مهمّةٌ في خطّة قسمك باسمك. الموظّفُ يراها مهمّةً منك.', 'A task is created in your section plan under your name.'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
        const SizedBox(height: 8),
        for (final m in team) ListTile(
          leading: const Icon(Icons.person_outline), title: Text((m['name'] ?? '').toString()),
          subtitle: Text(tr((m['roleAr'] ?? '').toString(), (m['roleEn'] ?? '').toString())),
          onTap: () => Navigator.pop(c, m['_id'].toString()),
        ),
        if (team.isEmpty) Padding(padding: const EdgeInsets.all(20), child: Text(tr('لا موظّفين في قسمك', 'No staff in your section'), textAlign: TextAlign.center)),
      ])),
    );
    if (who == null) return;
    await _run(() => task != null
        ? Api.instance.post('/api/jp/tasks/${task['_id']}/hand-down', {'assignedTo': who})
        : Api.instance.post('/api/jp/projects/${project!['_id']}/hand-down', {'assignedTo': who}));
  }

  /// New project or edit of an existing one: name, description and end date, like the web.
  Future<void> _projectForm([Map<String, dynamic>? p]) async {
    final name = TextEditingController(text: (p?['name'] ?? '').toString());
    final desc = TextEditingController(text: (p?['description'] ?? '').toString());
    var end = (p?['endDate'] ?? '').toString();
    if (end.length >= 10) end = end.substring(0, 10);
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Text(p == null ? tr('مشروع جديد', 'New project') : tr('تعديل المشروع', 'Edit project')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: name, autofocus: true, decoration: InputDecoration(labelText: tr('الاسم', 'Name'), hintText: tr('مثال: حملة رمضان', 'e.g. Ramadan campaign'))),
        TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('الوصف (اختياري)', 'Description (optional)'))),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: OutlinedButton.icon(
            icon: const Icon(Icons.event, size: 16),
            label: Text(end.isEmpty ? tr('تاريخ الانتهاء (اختياري)', 'End date (optional)') : end),
            onPressed: () async {
              final d = await showDatePicker(context: c, initialDate: DateTime.tryParse(end) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2035));
              if (d != null) set(() => end = _ymd(d));
            },
          )),
          if (end.isNotEmpty) IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => set(() => end = '')),
        ]),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    )));
    if (ok != true || name.text.trim().isEmpty) return;
    final body = {'name': name.text.trim(), 'description': desc.text.trim(), 'endDate': end};
    await _run(() => p != null
        ? Api.instance.patch('/api/jp/projects/${p['_id']}', body)
        : Api.instance.post('/api/jp/projects', {'scope': widget.scope, if (widget.section != null) 'section': widget.section, ...body}));
  }

  Future<void> _projectMenu(Map<String, dynamic> p) async {
    final active = p['status'] == 'active';
    final canHand = _management && !_canManage && _mySection.isNotEmpty;
    final pick = await showModalBottomSheet<String>(
      context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(title: Text((p['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text(tr('${p['done'] ?? 0} من ${p['total'] ?? 0} تمّت', '${p['done'] ?? 0} of ${p['total'] ?? 0} done'))),
        if (_canManage) ...[
          ListTile(leading: const Icon(Icons.edit_outlined), title: Text(tr('تعديل', 'Edit')), onTap: () => Navigator.pop(c, 'edit')),
          ListTile(leading: Icon(active ? Icons.lock_outline : Icons.lock_open_outlined), title: Text(active ? tr('إغلاق', 'Close') : tr('إعادة فتح', 'Reopen')), onTap: () => Navigator.pop(c, 'toggle')),
          ListTile(leading: const Icon(Icons.delete_outline, color: T.danger), title: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger)), onTap: () => Navigator.pop(c, 'delete')),
        ],
        if (canHand) ListTile(leading: const Icon(Icons.subdirectory_arrow_left, color: T.orange), title: Text(tr('إسنادُ مهامّي فيه إلى موظّف', 'Assign my tasks to staff')), onTap: () => Navigator.pop(c, 'hand')),
      ])),
    );
    if (!mounted || pick == null) return;
    switch (pick) {
      case 'edit': await _projectForm(p);
      case 'toggle': await _run(() => Api.instance.patch('/api/jp/projects/${p['_id']}', {'status': active ? 'closed' : 'active'}));
      case 'hand': await _handDown(project: p);
      case 'delete':
        final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
          title: Text(tr('حذف المشروع؟', 'Delete project?')),
          content: Text(tr('حذفُ مشروع «${p['name']}»؟ مهامُّه تبقى بلا مشروع.', 'Delete project “${p['name']}”? Its tasks stay, without a project.')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
          ],
        ));
        if (ok != true) return;
        if (_project == p['_id']) _project = '';
        await _run(() => Api.instance.delete('/api/jp/projects/${p['_id']}'));
    }
  }

  /// Delete a task attachment: by whoever can edit the task or whoever uploaded it, like the web.
  Future<void> _removeFile(Map<String, dynamic> t, Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف المرفق؟', 'Remove file?')),
      content: Text((a['fileName'] ?? '').toString()),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok == true) await _run(() => Api.instance.delete('/api/jp/tasks/${t['_id']}/attachments/${a['_id']}'));
  }

  Widget _chip(String label, bool on, VoidCallback tap, {Color color = T.navy, int? n}) => Padding(
    padding: const EdgeInsetsDirectional.only(end: 6),
    child: FilterChip(
      selected: on, onSelected: (_) => tap(), showCheckmark: false,
      label: Text(n != null && n > 0 ? '$label  $n' : label),
      labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : color),
      selectedColor: color, backgroundColor: color.withValues(alpha: 0.08), side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
  );

  void _set(VoidCallback f) { setState(() { f(); _loading = true; }); _load(); }

  @override
  Widget build(BuildContext context) {
    final title = _management ? tr('خطّة الإدارة', 'Management plan') : tr('خطّة العمل (JP)', 'Work plan (JP)');
    return AppScaffold(
      title: Text(title),
      actions: [
        if (_canManage) IconButton(tooltip: tr('مشروع جديد', 'New project'), icon: const Icon(Icons.create_new_folder_outlined), onPressed: () => _projectForm()),
      ],
      floatingActionButton: _me == null ? null : FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white, onPressed: () => _openForm(),
        icon: const Icon(Icons.add), label: Text(_canManage ? tr('مهمّة جديدة', 'New task') : tr('طلب جديد', 'New request')),
      ),
      body: _error != null && _me == null
          ? ErrorRetry(message: _error!, onRetry: () { setState(() { _loading = true; _error = null; }); _init(); })
          : Column(children: [
              SizedBox(height: 46, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 8, 14, 0), children: [
                _chip(tr('المُسنَدة إليّ', 'To me'), _box == 'mine', () => _set(() => _box = 'mine'), n: (_counts['mine'] as num?)?.toInt()),
                _chip(tr('ما أسندتُه', 'By me'), _box == 'sent', () => _set(() => _box = 'sent'), n: (_counts['sent'] as num?)?.toInt()),
                if (_canManage) _chip(_management ? tr('كلُّ المديرين', 'All managers') : tr('كلُّ الفريق', 'Whole team'), _box == 'all', () => _set(() => _box = 'all')),
              ])),
              SizedBox(height: 46, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 6, 14, 2), children: [
                _chip(tr('القائمة', 'Open'), _status == 'open', () => _set(() => _status = 'open'), color: T.info),
                _chip(tr('المتأخّرة', 'Late'), _status == 'overdue', () => _set(() => _status = 'overdue'), color: T.danger, n: (_counts['overdue'] as num?)?.toInt()),
                _chip(tr('التي تمّت', 'Done'), _status == 'done', () => _set(() => _status = 'done'), color: T.success),
                _chip(tr('الكلّ', 'All'), _status.isEmpty, () => _set(() => _status = ''), color: T.inkSoft),
              ])),
              if (_projects.isNotEmpty) SizedBox(height: 46, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 6, 14, 2), children: [
                // Tap opens the project; long press offers edit, close and delete (or assign).
                for (final p in _projects) Opacity(
                  opacity: p['status'] == 'closed' ? 0.55 : 1,
                  child: GestureDetector(
                    onLongPress: (_canManage || (_management && _mySection.isNotEmpty)) ? () => _projectMenu(p) : null,
                    child: _chip('${p['name']} · ${p['done'] ?? 0}/${p['total'] ?? 0}', _project == p['_id'], () => _set(() => _project = _project == p['_id'] ? '' : p['_id'].toString()), color: T.orange),
                  ),
                ),
              ])),
              Expanded(child: _loading
                  ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
                  : RefreshIndicator(onRefresh: _load, child: _tasks.isEmpty
                      ? ListView(children: [SizedBox(height: 320, child: EmptyState(icon: Icons.event_available_outlined, title: tr('لا شيء هنا', 'Nothing here')))])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 96), itemCount: _tasks.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) => _card(_tasks[i]),
                        ))),
            ]),
    );
  }

  Widget _card(Map<String, dynamic> t) {
    final can = Map<String, dynamic>.from(t['can'] ?? {});
    final done = t['status'] == 'done';
    final dl = jpDeadline(t);
    final mine = _id(t['assignedTo']) == (_me?['me'] ?? '').toString();
    final act = _actions[t['action']];
    final contact = (t['contact'] ?? '').toString();
    final files = List<Map<String, dynamic>>.from(t['attachments'] ?? []);
    final handed = List<Map<String, dynamic>>.from(t['handedTo'] ?? []);
    final links = List.from(_me?['linkKinds'] ?? const []).isEmpty
        ? const <Map<String, dynamic>>[]
        : List<Map<String, dynamic>>.from((t['links'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
    return AppCard(
      topAccent: t['state'] == 'overdue' ? T.danger : done ? T.success : null,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        IconButton(
          padding: EdgeInsets.zero, constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          icon: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? T.success : T.inkFaint, size: 28),
          onPressed: can['complete'] != true ? null : () => done
              ? _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/done', {'done': false}))
              : _complete(t),
        ),
        const SizedBox(width: 6),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((t['title'] ?? '').toString(), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, decoration: done ? TextDecoration.lineThrough : null, color: done ? T.inkSoft : T.ink)),
          if ((t['details'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(t['details'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
          const SizedBox(height: 6),
          Row(children: [Icon(Icons.schedule, size: 14, color: dl.$2), const SizedBox(width: 4), Expanded(child: Text(dl.$1, style: TextStyle(fontSize: 12, color: dl.$2, fontWeight: FontWeight.w700)))]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2(t['kind'] == 'task' ? tr('مهمّة', 'Task') : tr('طلب', 'Request'), t['kind'] == 'task' ? T.navy : T.cyan),
            Chip2(mine ? tr('من ${t['createdByName']}', 'From ${t['createdByName']}') : tr('إلى ${t['assignedToName']}', 'To ${t['assignedToName']}'), T.inkSoft, icon: Icons.person_outline),
            if (t['project'] is Map) Chip2((t['project']['name'] ?? '').toString(), T.orange, icon: Icons.folder_outlined),
            if (t['fromManagement'] == true) Chip2(tr('من خطّة الإدارة', 'From management'), T.violet),
            if (act != null) Chip2(tr(act.$1, act.$2), T.info, icon: act.$3),
          ]),
          // Time: expected and actual, and a timer for whoever works on it.
          if (can['track'] == true || t['expectedMinutes'] != null || ((t['spentNow'] ?? 0) as num) > 0)
            Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Chip2('${_fmtMin(t['spentNow'])}${t['expectedMinutes'] != null ? ' / ${_fmtMin(t['expectedMinutes'])}' : ''}',
                  t['timerStartedAt'] != null ? T.success : (t['expectedMinutes'] != null && ((t['spentNow'] ?? 0) as num) > (t['expectedMinutes'] as num)) ? T.danger : T.inkSoft,
                  icon: t['timerStartedAt'] != null ? Icons.timer : Icons.timer_outlined),
              if (can['track'] == true && !done)
                t['timerStartedAt'] != null
                    ? OutlinedButton(onPressed: () => _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/progress', {'action': 'pause'})), child: Text(tr('إيقاف مؤقّت', 'Pause'), style: const TextStyle(fontSize: 12)))
                    : FilledButton(onPressed: () => _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/progress', {'action': 'start'})), child: Text(t['progress'] == 'paused' ? tr('استئناف', 'Resume') : tr('بدأتُ العمل', 'Start'), style: const TextStyle(fontSize: 12))),
              if (can['adjust'] == true)
                TextButton(onPressed: () => _adjust(t), child: Text(tr('تصحيح الوقت', 'Adjust time'), style: const TextStyle(fontSize: 11.5))),
            ])),
          if (links.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final l in links) () {
              final k = _linkKinds[l['kind']];
              final label = (l['label'] ?? '').toString();
              final chip = Chip2('${k == null ? '' : '${tr(k.$1, k.$2)}: '}$label', T.navy, icon: k?.$3);
              // The transaction chip opens the transaction itself.
              return l['kind'] != 'clearance' ? chip : InkWell(
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: _id(l['ref']), ref: label.split(' · ').first))),
                child: chip,
              );
            }(),
          ])),
          if (contact.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: InkWell(
            onTap: () {
              final digits = contact.replaceAll(RegExp(r'[^\d+]'), '');
              if (digits.replaceAll('+', '').length < 8) return;
              var n = digits.replaceAll('+', '');
              if (n.startsWith('05')) n = '966${n.substring(1)}';
              launchUrl(Uri.parse(t['action'] == 'whatsapp' ? 'https://wa.me/$n' : 'tel:$digits'), mode: LaunchMode.externalApplication);
            },
            child: Text(contact, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 13, color: T.orange, fontWeight: FontWeight.w700)),
          )),
          if (handed.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(
            '${tr('أُسنِدت في القسم إلى', 'Assigned in section to')}: ${handed.map((h) => '${h['name']} (${h['state'] == 'done' ? tr('تمّت', 'done') : h['state'] == 'overdue' ? tr('متأخّرة', 'late') : tr('قائمة', 'open')})').join('، ')}',
            style: const TextStyle(fontSize: 12, color: T.inkSoft))),
          if (done && (t['doneNote'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t['doneNote'].toString(), style: const TextStyle(fontSize: 12.5, color: T.success))),
          if (files.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final a in files) Row(mainAxisSize: MainAxisSize.min, children: [
              InkWell(
                onTap: () => launchUrl(Uri.parse('${AppConfig.apiBase}${a['fileUrl']}'), mode: LaunchMode.externalApplication),
                child: Chip2((a['fileName'] ?? tr('ملف', 'File')).toString(), a['phase'] == 'done' ? T.success : T.inkSoft, icon: Icons.attach_file),
              ),
              if (can['edit'] == true || _id(a['uploadedBy']) == (_me?['me'] ?? '').toString())
                InkWell(onTap: () => _removeFile(t, a), child: const Padding(padding: EdgeInsets.all(3), child: Icon(Icons.close, size: 15, color: T.inkFaint))),
            ]),
          ])),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            if (can['comment'] == true || List.from(t['comments'] ?? []).isNotEmpty) TextButton.icon(
              onPressed: () => _comments(t),
              icon: const Icon(Icons.mode_comment_outlined, size: 18, color: T.inkSoft),
              label: Text('${List.from(t['comments'] ?? []).length}', style: const TextStyle(color: T.inkSoft)),
            ),
            if (can['attach'] == true) IconButton(tooltip: tr('إرفاق', 'Attach'), icon: const Icon(Icons.attach_file, size: 20, color: T.inkSoft), onPressed: () async {
              final p = await pickFileAsDataUrl(); if (p == null) return;
              await _run(() => Api.instance.post('/api/jp/tasks/${t['_id']}/attachments', {'dataUrl': p.dataUrl, 'fileName': p.fileName}));
            }),
            if (t['canHandDown'] == true && !done) IconButton(tooltip: tr('إسنادها إلى موظّفٍ في قسمي', 'Assign to my team'), icon: const Icon(Icons.subdirectory_arrow_left, size: 20, color: T.orange), onPressed: () => _handDown(task: t)),
            if (can['edit'] == true) IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 20, color: T.inkSoft), onPressed: () => _openForm(task: t)),
            if (can['remove'] == true) IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 20, color: T.danger), onPressed: () => _delete(t)),
          ]),
        ])),
      ]),
    );
  }
}

/// Task form: what is needed, for whom and when; the rest is optional and collapsed.
String _fmtMin(dynamic v) {
  final m = ((v ?? 0) as num).round();
  final h = m ~/ 60, r = m % 60;
  return h == 0 ? tr('$r د', '${r}m') : tr('$h س${r > 0 ? ' $r د' : ''}', '${h}h${r > 0 ? ' ${r}m' : ''}');
}

class _JpForm extends StatefulWidget {
  final String scope; final String? section; final Map<String, dynamic> me;
  final List<Map<String, dynamic>> projects; final Map<String, dynamic>? task;
  final String presetProject; final Future<void> Function() onDone;
  /// What the dialog was opened from (transaction, shipment, ...) is pre-linked.
  final List<Map<String, dynamic>> presetLinks;
  const _JpForm({required this.scope, required this.section, required this.me, required this.projects, required this.task, required this.presetProject, required this.onDone, this.presetLinks = const []});
  @override
  State<_JpForm> createState() => _JpFormState();
}

class _JpFormState extends State<_JpForm> {
  final _title = TextEditingController(), _details = TextEditingController(), _contact = TextEditingController(), _hours = TextEditingController();
  // Work day and expected time.
  final _expH = TextEditingController(), _expM = TextEditingController();
  String _workDate = '';
  String _assignee = '', _action = '', _project = '', _dueKind = '', _dueDate = '';
  bool _more = false, _saving = false, _dueTouched = false;
  PickedFile? _file;
  // Task links: {kind, ref, label}; the name is for display and the server captures its own.
  final List<Map<String, dynamic>> _links = [];

  bool get _editing => widget.task != null;
  List<String> get _kinds => List.from(widget.me['linkKinds'] ?? const []).map((e) => e.toString()).toList();
  bool get _canManage => widget.me['canManage'] == true;

  @override
  void initState() {
    super.initState();
    final t = widget.task;
    _project = widget.presetProject;
    if (!_canManage) _assignee = (widget.me['me'] ?? '').toString();
    _links.addAll(widget.presetLinks.map((l) => Map<String, dynamic>.from(l)));
    // From the item's own page: assigned to himself by default, and the manager changes it from the list.
    if (widget.presetLinks.isNotEmpty && _assignee.isEmpty) _assignee = (widget.me['me'] ?? '').toString();
    if (t != null) {
      _title.text = (t['title'] ?? '').toString(); _details.text = (t['details'] ?? '').toString();
      _contact.text = (t['contact'] ?? '').toString(); _action = (t['action'] ?? '').toString();
      _assignee = _id(t['assignedTo']); _project = t['project'] is Map ? t['project']['_id'].toString() : '';
      if (t['workDate'] != null) _workDate = _ymd(DateTime.parse(t['workDate'].toString()).toLocal());
      if (t['expectedMinutes'] is num) { final m = (t['expectedMinutes'] as num).round(); _expH.text = '${m ~/ 60}'; _expM.text = '${m % 60}'; }
      if (t['deadlineKind'] == 'date' && t['deadlineAt'] != null) { _dueKind = 'date'; _dueDate = _ymd(DateTime.parse(t['deadlineAt'].toString()).toLocal()); }
      _more = _details.text.isNotEmpty || _action.isNotEmpty || _contact.text.isNotEmpty;
      for (final l in List.from(t['links'] ?? const [])) {
        _links.add({'kind': l['kind'], 'ref': _id(l['ref']), 'label': l['label'] ?? ''});
      }
    }
  }

  Future<void> _addLink(String kind) async {
    final k = _linkKinds[kind]!;
    // Search runs on the server (q) like the web: transactions number in the thousands and the latest 200 are not enough.
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _LinkSearch(section: widget.section ?? '', kind: kind, title: tr(k.$1, k.$2)),
    );
    if (picked == null || !mounted) return;
    final ref = (picked['value'] ?? '').toString();
    if (ref.isEmpty || _links.any((l) => l['kind'] == kind && l['ref'] == ref)) return;
    setState(() => _links.add({'kind': kind, 'ref': ref, 'label': (picked['label'] ?? '').toString()}));
  }

  Map<String, dynamic> _dueBody() => _dueKind == 'date' ? {'deadlineKind': 'date', 'deadlineDate': _dueDate}
      : _dueKind == 'hours' ? {'deadlineKind': 'hours', 'deadlineHours': num.tryParse(_hours.text) ?? 0} : {'deadlineKind': ''};

  Future<void> _save() async {
    if (_title.text.trim().isEmpty || _assignee.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب المطلوب واختر من يُسنَد إليه', 'Write what is needed and choose who it is for'))));
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'title': _title.text.trim(), 'assignedTo': _assignee, 'details': _details.text.trim(),
        'action': _action, 'contact': _contact.text.trim(), 'project': _project.isEmpty ? null : _project,
        // A deadline in hours is not recounted on edit unless it was changed.
        if (!_editing || _dueTouched) ..._dueBody(),
        if (_kinds.isNotEmpty) 'links': [for (final l in _links) {'kind': l['kind'], 'ref': l['ref']}],
        'workDate': _workDate,
        'expectedMinutes': _expH.text.trim().isEmpty && _expM.text.trim().isEmpty ? null
            : (int.tryParse(_expH.text.trim()) ?? 0) * 60 + (int.tryParse(_expM.text.trim()) ?? 0),
      };
      if (_editing) {
        await Api.instance.patch('/api/jp/tasks/${widget.task!['_id']}', body);
      } else {
        await Api.instance.post('/api/jp/tasks', {
          ...body, 'scope': widget.scope, if (widget.section != null) 'section': widget.section,
          if (_file != null) 'files': [{'dataUrl': _file!.dataUrl, 'fileName': _file!.fileName}],
        });
      }
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) { setState(() => _saving = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  Widget _due(String label, bool on, VoidCallback tap) => Padding(
    padding: const EdgeInsetsDirectional.only(end: 6, bottom: 6),
    child: ChoiceChip(label: Text(label, style: const TextStyle(fontSize: 12)), selected: on, onSelected: (_) => setState(() { tap(); _dueTouched = true; })),
  );

  @override
  Widget build(BuildContext context) {
    final team = List<Map<String, dynamic>>.from(widget.me['team'] ?? []);
    final meId = (widget.me['me'] ?? '').toString();
    final today = _ymd(DateTime.now()), tomorrow = _ymd(DateTime.now().add(const Duration(days: 1)));
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_editing ? tr('تعديل', 'Edit') : _canManage ? tr('مهمّة جديدة', 'New task') : tr('طلب جديد', 'New request'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 12),
        // The task comes from the section list (what is missing is added from it); the management plan is free text.
        if (widget.scope == 'section' && widget.section != null)
          LookupField(type: 'jp_task_${widget.section}', controller: _title, label: tr('المهمّة', 'Task'))
        else
          TextField(controller: _title, autofocus: !_editing, decoration: InputDecoration(labelText: tr('ما المطلوب؟', 'What is needed?'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: OutlinedButton.icon(
            icon: const Icon(Icons.event, size: 16),
            label: Text(_workDate.isEmpty ? tr('يوم العمل (اختياري)', 'Work day (optional)') : _workDate, style: const TextStyle(fontSize: 12.5)),
            onPressed: () async {
              final d = await showDatePicker(context: context, firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now());
              if (d != null) setState(() => _workDate = _ymd(d));
            },
          )),
          const SizedBox(width: 8),
          SizedBox(width: 70, child: TextField(controller: _expH, keyboardType: TextInputType.number, decoration: InputDecoration(isDense: true, labelText: tr('ساعات', 'Hours'), border: const OutlineInputBorder()))),
          const SizedBox(width: 6),
          SizedBox(width: 70, child: TextField(controller: _expM, keyboardType: TextInputType.number, decoration: InputDecoration(isDense: true, labelText: tr('دقائق', 'Min'), border: const OutlineInputBorder()))),
        ]),
        Padding(padding: const EdgeInsets.only(top: 3), child: Text(tr('الوقت المتوقّع (اختياري)', 'Expected time (optional)'), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
        const SizedBox(height: 10),
        // Searchable: a top role picks from every employee, the section's team first.
        JpPersonField(
          label: _canManage ? tr('إلى مَن؟', 'For whom?') : tr('لي أو لزميل', 'Me or a colleague'),
          value: _assignee,
          people: [
            if (!team.any((m) => m['_id'] == meId) && !_canManage) {'_id': meId, 'name': tr('لنفسي', 'Myself'), 'inSection': true},
            for (final m in team) {...m, if (m['_id'] == meId) 'name': '${m['name']} (${tr('أنا', 'me')})'},
            if (_assignee.isNotEmpty && _assignee != meId && !team.any((m) => m['_id'] == _assignee)) {'_id': _assignee, 'name': (widget.task?['assignedToName'] ?? '').toString()},
          ],
          onChanged: (v) => setState(() => _assignee = v),
        ),
        const SizedBox(height: 12),
        Text(tr('الموعد (اختياري)', 'Deadline (optional)'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 6),
        Wrap(children: [
          _due(tr('بلا موعد', 'None'), _dueKind.isEmpty, () { _dueKind = ''; }),
          for (final h in const ['1', '2', '4', '8']) _due(tr(h == '1' ? 'خلال ساعة' : h == '2' ? 'خلال ساعتين' : 'خلال $h ساعات', 'In ${h}h'), _dueKind == 'hours' && _hours.text == h, () { _dueKind = 'hours'; _hours.text = h; }),
          _due(tr('اليوم', 'Today'), _dueKind == 'date' && _dueDate == today, () { _dueKind = 'date'; _dueDate = today; }),
          _due(tr('غدًا', 'Tomorrow'), _dueKind == 'date' && _dueDate == tomorrow, () { _dueKind = 'date'; _dueDate = tomorrow; }),
          Padding(padding: const EdgeInsetsDirectional.only(end: 6, bottom: 6), child: ActionChip(
            avatar: const Icon(Icons.event, size: 16),
            label: Text(_dueKind == 'date' && _dueDate != today && _dueDate != tomorrow ? _dueDate : tr('تاريخ…', 'Date…'), style: const TextStyle(fontSize: 12)),
            onPressed: () async {
              final d = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 730)), initialDate: DateTime.now());
              if (d != null) setState(() { _dueKind = 'date'; _dueDate = _ymd(d); _dueTouched = true; });
            },
          )),
          SizedBox(width: 110, child: TextField(
            controller: _hours, keyboardType: TextInputType.number,
            decoration: InputDecoration(isDense: true, labelText: tr('ساعات…', 'Hours…'), border: const OutlineInputBorder()),
            onChanged: (v) => setState(() { _dueKind = v.trim().isEmpty ? '' : 'hours'; _dueTouched = true; }),
          )),
        ]),
        if (_kinds.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(tr('مرتبطةٌ بـ (اختياري)', 'Linked to (optional)'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final l in _links) InputChip(
              avatar: Icon(_linkKinds[l['kind']]?.$3 ?? Icons.link, size: 16),
              label: Text('${l['label']}', style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
              onDeleted: () => setState(() => _links.remove(l)),
            ),
            for (final kind in _kinds) if (_linkKinds[kind] != null && _links.length < 8) ActionChip(
              avatar: const Icon(Icons.add, size: 16),
              label: Text(tr(_linkKinds[kind]!.$1, _linkKinds[kind]!.$2), style: const TextStyle(fontSize: 12)),
              onPressed: () => _addLink(kind),
            ),
          ]),
        ],
        TextButton.icon(
          onPressed: () => setState(() => _more = !_more),
          icon: Icon(_more ? Icons.expand_less : Icons.expand_more),
          label: Text(_more ? tr('إخفاء التفاصيل', 'Hide details') : tr('تفاصيل أكثر: طريقة التواصل، مشروع، مرفق', 'More: contact method, project, attachment')),
        ),
        if (_more) ...[
          TextField(controller: _details, maxLines: 3, decoration: InputDecoration(labelText: tr('تفاصيل', 'Details'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          Text(tr('طريقة التواصل', 'Contact method'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          Wrap(children: [
            for (final e in _actions.entries) Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(
              avatar: Icon(e.value.$3, size: 16), label: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontSize: 12)),
              selected: _action == e.key, onSelected: (_) => setState(() => _action = _action == e.key ? '' : e.key),
            )),
          ]),
          const SizedBox(height: 8),
          TextField(controller: _contact, decoration: InputDecoration(labelText: tr('مع مَن؟ اسمٌ أو رقم', 'With whom? name or number'), border: const OutlineInputBorder())),
          if (widget.projects.isNotEmpty) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: widget.projects.any((p) => p['_id'] == _project) ? _project : '', isExpanded: true,
              decoration: InputDecoration(labelText: tr('المشروع', 'Project'), border: const OutlineInputBorder()),
              items: [DropdownMenuItem(value: '', child: Text(tr('بلا مشروع', 'No project'))), for (final p in widget.projects) DropdownMenuItem(value: p['_id'].toString(), child: Text((p['name'] ?? '').toString(), overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _project = v ?? ''),
            ),
          ],
          if (!_editing) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async { final p = await pickFileAsDataUrl(); if (p != null) setState(() => _file = p); },
              icon: const Icon(Icons.attach_file), label: Text(_file?.fileName ?? tr('أرفِق ملفًّا', 'Attach a file'), overflow: TextOverflow.ellipsis),
            ),
          ],
        ],
        const SizedBox(height: 12),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: T.navy, padding: const EdgeInsets.symmetric(vertical: 14)),
          onPressed: _saving ? null : _save,
          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
          label: Text(_editing ? tr('حفظ', 'Save') : _canManage ? tr('إسناد', 'Assign') : tr('إرسال', 'Send')),
        ),
      ])),
    );
  }
}

/// Plan dashboard: manager only; the server refuses others and the screen says so.
class JpDashScreen extends StatefulWidget {
  final String scope; final String? section;
  const JpDashScreen({super.key, this.scope = 'section', this.section});
  @override
  State<JpDashScreen> createState() => _JpDashScreenState();
}

class _JpDashScreenState extends State<JpDashScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _assignee = '';
  // Dashboard filters as on the web: range, project, type and contact method, all on the server.
  String _from = '', _to = '', _project = '', _kind = '', _action = '';
  // Section-specific filters: task type (the section's own titles) and what the task is linked to.
  String _title = '', _link = '';
  int _seq = 0;
  // Daily view: who worked on what on a given day and how long it took.
  Map<String, dynamic>? _daily;
  String _day = '';
  late final void Function() _onLive;

  @override
  void initState() { super.initState(); _load(); _onLive = () => _load(); Live.instance.on('jp:changed', _onLive); }
  @override
  void dispose() { Live.instance.off('jp:changed', _onLive); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final f = [
        if (_assignee.isNotEmpty) 'assignee=$_assignee',
        if (_from.isNotEmpty) 'from=$_from',
        if (_to.isNotEmpty) 'to=$_to',
        if (_project.isNotEmpty) 'project=$_project',
        if (_kind.isNotEmpty) 'kind=$_kind',
        if (_action.isNotEmpty) 'action=$_action',
        if (_title.isNotEmpty) 'title=${Uri.encodeQueryComponent(_title)}',
        if (_link.isNotEmpty) 'link=$_link',
      ].map((x) => '&$x').join();
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/jp/dashboard?${_qs(widget.scope, widget.section)}$f'));
      if (mounted && mine == _seq) setState(() { _d = d; _error = null; });
    } catch (e) { if (mounted && mine == _seq) setState(() => _error = e.toString()); }
    _loadDaily();
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context, firstDate: DateTime(2024), lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: _from.isEmpty || _to.isEmpty ? null : DateTimeRange(start: DateTime.parse(_from), end: DateTime.parse(_to)),
    );
    if (r == null) return;
    setState(() { _from = _ymd(r.start); _to = _ymd(r.end); });
    _load();
  }

  Widget _filters(Map<String, dynamic> d, bool management) {
    final projects = List<Map<String, dynamic>>.from(d['projectOptions'] ?? const []);
    final active = [_from, _to, _project, _kind, _action, _assignee, _title, _link].any((x) => x.isNotEmpty);
    final titles = List<String>.from((d['titleOptions'] as List? ?? const []).map((x) => '$x'));
    final links = List<Map<String, dynamic>>.from(d['linkOptions'] ?? const []);
    Widget drop(String label, String value, List<(String, String)> items, void Function(String) on) => DropdownButtonFormField<String>(
      initialValue: items.any((x) => x.$1 == value) ? value : '', isExpanded: true,
      decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder()),
      items: [for (final x in items) DropdownMenuItem(value: x.$1, child: Text(x.$2, overflow: TextOverflow.ellipsis))],
      onChanged: (v) { setState(() => on(v ?? '')); _load(); },
    );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: OutlinedButton.icon(
          icon: const Icon(Icons.date_range, size: 18),
          label: Text(_from.isEmpty ? tr('كلُّ الفترات', 'Any period') : '$_from → $_to', overflow: TextOverflow.ellipsis),
          onPressed: _pickRange,
        )),
        if (active) TextButton.icon(
          icon: const Icon(Icons.close, size: 16), label: Text(tr('إزالة الفلاتر', 'Clear')),
          onPressed: () { setState(() { _from = _to = _project = _kind = _action = _assignee = _title = _link = ''; }); _load(); },
        ),
      ]),
      if (titles.isNotEmpty || links.isNotEmpty) ...[
        const SizedBox(height: 8),
        Row(children: [
          if (titles.isNotEmpty) Expanded(child: drop(tr('نوع المهمّة', 'Task type'), _title, [
            ('', tr('كلُّ أنواع المهامّ', 'All task types')),
            for (final x in titles) (x, x),
            if (_title.isNotEmpty && !titles.contains(_title)) (_title, _title),
          ], (v) => _title = v)),
          if (titles.isNotEmpty && links.isNotEmpty) const SizedBox(width: 8),
          if (links.isNotEmpty) Expanded(child: drop(tr('مرتبطة بـ', 'Linked to'), _link, [
            ('', tr('مرتبطة بأيّ شيء', 'Linked to anything')),
            for (final l in links) ('${l['kind']}', '${tr('مرتبطة بـ ${l['ar']}', 'Linked to ${l['en']}')} (${l['count'] ?? 0})'),
            ('none', tr('بلا ارتباط', 'Not linked')),
          ], (v) => _link = v)),
        ]),
      ],
      const SizedBox(height: 8),
      Row(children: [
        if (projects.isNotEmpty) ...[
          Expanded(child: drop(tr('المشروع', 'Project'), _project, [
            ('', tr('كلُّ المشروعات', 'All projects')),
            for (final p in projects) (p['_id'].toString(), (p['name'] ?? '').toString()),
            ('none', tr('بلا مشروع', 'No project')),
          ], (v) => _project = v)),
          const SizedBox(width: 8),
        ],
        Expanded(child: drop(tr('النوع', 'Kind'), _kind, [
          ('', tr('مهامّ وطلبات', 'Tasks and requests')), ('task', tr('مهامّ فقط', 'Tasks only')), ('request', tr('طلبات فقط', 'Requests only')),
        ], (v) => _kind = v)),
      ]),
      const SizedBox(height: 8),
      drop(tr('طريقة التواصل', 'Contact method'), _action, [
        ('', tr('كلُّ طرق التواصل', 'Any contact method')),
        for (final e in _actions.entries) (e.key, tr(e.value.$1, e.value.$2)),
        ('none', tr('بلا تواصل', 'No contact')),
      ], (v) => _action = v),
    ]);
  }

  Future<void> _loadDaily() async {
    try {
      final day = _day.isEmpty ? _ymd(DateTime.now()) : _day;
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/jp/daily?${_qs(widget.scope, widget.section)}&from=$day&to=$day${_assignee.isEmpty ? '' : '&assignee=$_assignee'}'));
      if (mounted) setState(() => _daily = d);
    } catch (_) {}
  }

  Widget _dailyCard() {
    final d = _daily;
    final rows = List<Map<String, dynamic>>.from(d?['rows'] ?? const []);
    const st = {'todo': ('لم تبدأ', 'Not started'), 'doing': ('جارية', 'In progress'), 'paused': ('متوقّفة', 'Paused'), 'done': ('تمّت', 'Done')};
    const dot = {'todo': T.inkFaint, 'doing': T.success, 'paused': T.warn, 'done': T.info};
    final multiDay = d != null && '${d['from']}' != '${d['to']}';
    // One block per person; identical lines (same day, title, status and kind) merged with a count.
    final groups = <String, Map<String, dynamic>>{};
    for (final r in rows) {
      final key = '${r['assignedTo'] ?? r['assignedToName'] ?? '—'}';
      final g = groups.putIfAbsent(key, () => {'name': '${r['assignedToName'] ?? '—'}', 'tasks': 0, 'done': 0, 'minutes': 0.0, 'running': false, 'lines': <String, Map<String, dynamic>>{}});
      g['tasks'] = (g['tasks'] as int) + 1;
      if (r['status'] == 'done') g['done'] = (g['done'] as int) + 1;
      g['minutes'] = (g['minutes'] as double) + ((r['minutes'] ?? 0) as num).toDouble();
      if (r['running'] == true) g['running'] = true;
      final lk = '${r['day']}|${r['title']}|${r['status']}|${r['kind']}';
      final lines = g['lines'] as Map<String, Map<String, dynamic>>;
      final line = lines[lk];
      if (line == null) {
        lines[lk] = {'day': '${r['day']}', 'title': '${r['title']}', 'status': '${r['status']}', 'count': 1, 'minutes': ((r['minutes'] ?? 0) as num).toDouble(), 'expected': r['expectedMinutes'], 'request': r['kind'] == 'request'};
      } else {
        line['count'] = (line['count'] as int) + 1;
        line['minutes'] = (line['minutes'] as double) + ((r['minutes'] ?? 0) as num).toDouble();
      }
    }
    final ordered = groups.values.toList()..sort((a, b) => (b['minutes'] as double).compareTo(a['minutes'] as double));
    return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(tr('اليوميّة', 'Daily log'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
        TextButton.icon(
          icon: const Icon(Icons.event, size: 16),
          label: Text(_day.isEmpty ? tr('اليوم', 'Today') : _day),
          onPressed: () async {
            final x = await showDatePicker(context: context, firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now(), initialDate: DateTime.now());
            if (x != null) { setState(() => _day = _ymd(x)); _loadDaily(); }
          },
        ),
      ]),
      Text(tr('ما عمل عليه كلُّ موظّف والوقت المسجّل', 'What each person worked on and the time logged'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
      const SizedBox(height: 8),
      if (rows.isEmpty) Padding(padding: const EdgeInsets.all(8), child: Text(tr('لا شيء مسجّل في هذا اليوم', 'Nothing logged for this day'), style: const TextStyle(fontSize: 12, color: T.inkFaint)))
      else for (final g in ordered) Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            color: T.line.withValues(alpha: 0.35),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              Expanded(child: Text.rich(TextSpan(children: [
                TextSpan(text: '${g['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                TextSpan(text: '  ${tr('${g['tasks']} مهمّة · ${g['done']} تمّت', '${g['tasks']} tasks · ${g['done']} done')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ]))),
              if (g['running'] == true) Container(width: 8, height: 8, margin: const EdgeInsetsDirectional.only(end: 6), decoration: const BoxDecoration(color: T.success, shape: BoxShape.circle)),
              (g['minutes'] as double) > 0
                  ? Text(_fmtMin(g['minutes']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))
                  : Text(tr('لم يُسجَّل وقت', 'No time logged'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ]),
          ),
          for (final l in (g['lines'] as Map<String, Map<String, dynamic>>).values) Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Row(children: [
              if (multiDay) SizedBox(width: 74, child: Text('${l['day']}'.split('-').reversed.join('/'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
              Expanded(child: Text.rich(TextSpan(children: [
                TextSpan(text: '${l['title']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
                if ((l['count'] as int) > 1) TextSpan(text: '  ×${l['count']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                if (l['request'] == true) TextSpan(text: '  ${tr('طلب', 'request')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]))),
              Container(width: 8, height: 8, decoration: BoxDecoration(color: dot[l['status']] ?? T.inkFaint, borderRadius: BorderRadius.circular(2))),
              const SizedBox(width: 5),
              Text(tr(st[l['status']]?.$1 ?? '', st[l['status']]?.$2 ?? ''), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
              const SizedBox(width: 10),
              SizedBox(width: 78, child: Text(
                (l['minutes'] as double) > 0
                    ? '${_fmtMin(l['minutes'])}${l['expected'] != null ? ' / ${_fmtMin(l['expected'])}' : ''}'
                    : tr('بلا مؤقّت', 'not timed'),
                textAlign: TextAlign.end,
                style: TextStyle(fontSize: 12, fontWeight: (l['minutes'] as double) > 0 ? FontWeight.w800 : FontWeight.w400, color: (l['minutes'] as double) > 0 ? T.ink : T.inkFaint),
              )),
            ]),
          ),
        ]),
      ),
    ]));
  }

  /// One cell of the numbers strip: label, value and an optional short line.
  Widget _cell(String label, String value, Color c, {String? hint}) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
      const SizedBox(height: 4),
      FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
          child: Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: c))),
      if (hint != null) Text(hint, style: const TextStyle(fontSize: 10.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
    ]),
  );

  /// The numbers as one bordered strip divided into cells, two or four per row.
  Widget _strip(List<Widget> cells) => LayoutBuilder(builder: (c, box) {
    final cols = box.maxWidth >= 560 ? 4 : 2;
    final rows = <Widget>[];
    for (var i = 0; i < cells.length; i += cols) {
      final part = cells.sublist(i, i + cols > cells.length ? cells.length : i + cols);
      rows.add(IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var k = 0; k < cols; k++) ...[
          if (k > 0) const VerticalDivider(width: 1, thickness: 1, color: T.line),
          Expanded(child: k < part.length ? part[k] : const SizedBox()),
        ],
      ])));
      if (i + cols < cells.length) rows.add(const Divider(height: 1, thickness: 1, color: T.line));
    }
    return Container(
      decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: T.line)),
      clipBehavior: Clip.antiAlias,
      child: Column(children: rows),
    );
  });

  Widget _head(String s) => Padding(padding: const EdgeInsets.fromLTRB(2, 18, 2, 8), child: Text(s, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)));
  String _pct(dynamic v) => v == null ? '—' : '$v%';

  @override
  Widget build(BuildContext context) {
    final management = widget.scope == 'management';
    final d = _d;
    return AppScaffold(
      title: Text(management ? tr('لوحة خطّة الإدارة', 'Management plan dashboard') : tr('لوحة JP', 'JP Dashboard')),
      body: _error != null
          ? ErrorRetry(message: _error!, onRetry: _load)
          : d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : RefreshIndicator(onRefresh: _load, child: Builder(builder: (c) {
                  final t = Map<String, dynamic>.from(d['totals'] ?? {});
                  final members = List<Map<String, dynamic>>.from(d['members'] ?? []);
                  final projects = List<Map<String, dynamic>>.from(d['projects'] ?? []);
                  final overdue = List<Map<String, dynamic>>.from(d['overdue'] ?? []);
                  final soon = List<Map<String, dynamic>>.from(d['dueSoon'] ?? []);
                  final idle = List<Map<String, dynamic>>.from(d['idle'] ?? []);
                  Widget line(Map<String, dynamic> r) {
                    final dl = jpDeadline({...r, 'deadlineKind': 'hours', 'status': r['doneAt'] != null ? 'done' : 'open'});
                    const stw = {'open': ('قائمة', 'Open'), 'overdue': ('متأخّرة', 'Late'), 'done': ('تمّت', 'Done')};
                    const stc = {'open': T.info, 'overdue': T.danger, 'done': T.success};
                    final state = '${r['state'] ?? 'open'}';
                    final spent = ((r['spentMinutes'] ?? 0) as num);
                    final lks = List<Map<String, dynamic>>.from(r['links'] ?? const []);
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text((r['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                          // Status as plain text with a small square marker.
                          Container(width: 8, height: 8, decoration: BoxDecoration(color: stc[state] ?? T.inkFaint, borderRadius: BorderRadius.circular(2))),
                          const SizedBox(width: 5),
                          Text(tr(stw[state]?.$1 ?? '', stw[state]?.$2 ?? ''), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
                        ]),
                        if (lks.isNotEmpty) Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(lks.map((l) => '${l['label']}').where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: T.orange)),
                        ),
                        const SizedBox(height: 2),
                        Text('${r['assignedToName']} · ${dl.$1}${spent > 0 ? ' · ${_fmtMin(spent)}${r['expectedMinutes'] != null ? ' / ${_fmtMin(r['expectedMinutes'])}' : ''}' : ''}', style: TextStyle(fontSize: 12, color: dl.$2)),
                      ]),
                    );
                  }
                  final byTitle = List<Map<String, dynamic>>.from(d['byTitle'] ?? []);
                  final t2 = Map<String, dynamic>.from(d['totals2'] ?? {});
                  final team = List<Map<String, dynamic>>.from(d['team'] ?? []);
                  return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
                    // The whole dashboard for one specific employee, as on the web.
                    JpPersonField(
                      label: management ? tr('المدير', 'Manager') : tr('الموظّف', 'Employee'),
                      value: team.any((m) => m['_id'] == _assignee) ? _assignee : '',
                      people: [
                        {'_id': '', 'name': management ? tr('كلُّ المديرين', 'All managers') : tr('كلُّ الموظّفين', 'All employees'), 'inSection': true},
                        ...team,
                      ],
                      onChanged: (v) { setState(() => _assignee = v); _load(); },
                    ),
                    const SizedBox(height: 8),
                    _filters(d, management),
                    const SizedBox(height: 10),
                    _strip([
                      _cell(tr('الإجمالي', 'Total'), '${t['total'] ?? 0}', T.ink, hint: tr('${t['tasks'] ?? 0} مهمّة · ${t['requests'] ?? 0} طلب', '${t['tasks'] ?? 0} tasks · ${t['requests'] ?? 0} requests')),
                      _cell(tr('قائمة', 'Open'), '${((t['open'] ?? 0) as num) - ((t['overdue'] ?? 0) as num)}', T.info),
                      _cell(tr('متأخّرة', 'Late'), '${t['overdue'] ?? 0}', (t['overdue'] ?? 0) > 0 ? T.danger : T.ink),
                      _cell(tr('خلال 24 ساعة', 'Due in 24h'), '${t['dueSoon'] ?? 0}', (t['dueSoon'] ?? 0) > 0 ? T.warn : T.ink),
                      _cell(tr('تمّت', 'Done'), '${t['done'] ?? 0}', T.success, hint: tr('${t['onTime'] ?? 0} في موعدها · ${t['late'] ?? 0} بعده', '${t['onTime'] ?? 0} on time · ${t['late'] ?? 0} late')),
                      _cell(tr('نسبة الإتمام', 'Completion'), _pct(t['completionRate']), T.ink),
                      _cell(tr('في موعدها', 'On time'), _pct(t['onTimeRate']), T.ink),
                      _cell(tr('الوقت المسجّل', 'Time logged'), ((t2['minutes'] ?? 0) as num) > 0 ? _fmtMin(t2['minutes']) : '—', T.ink),
                    ]),
                    if (byTitle.isNotEmpty) ...[
                      _head(tr('حسب نوع المهمّة', 'By task type')),
                      AppCard(padding: EdgeInsets.zero, child: Column(children: [
                        for (var k = 0; k < byTitle.length; k++) ...[
                          if (k > 0) const Divider(height: 1, color: T.line),
                          InkWell(
                            onTap: () { setState(() => _title = _title == '${byTitle[k]['title']}' ? '' : '${byTitle[k]['title']}'); _load(); },
                            child: Container(
                              color: _title == '${byTitle[k]['title']}' ? T.orange.withValues(alpha: 0.06) : null,
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              child: Builder(builder: (_) {
                                final b = byTitle[k];
                                final total = ((b['total'] ?? 0) as num).toInt();
                                final done = ((b['done'] ?? 0) as num).toInt();
                                final late = ((b['overdue'] ?? 0) as num).toInt();
                                final mins = ((b['minutes'] ?? 0) as num);
                                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                                  Row(children: [
                                    Expanded(child: Text('${b['title']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                                    Text(tr('$total · تمّت $done', '$total · $done done'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                    if (late > 0) Text(tr('  · متأخّرة $late', '  · $late late'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.danger)),
                                  ]),
                                  const SizedBox(height: 6),
                                  ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: total > 0 ? done / total : 0, minHeight: 5, backgroundColor: T.line, color: T.success)),
                                  const SizedBox(height: 4),
                                  Text(
                                    mins > 0
                                        ? tr('الوقت ${_fmtMin(mins)}${b['avgMinutes'] != null ? ' · متوسّط المهمّة ${_fmtMin(b['avgMinutes'])}' : ''}', 'Time ${_fmtMin(mins)}${b['avgMinutes'] != null ? ' · avg ${_fmtMin(b['avgMinutes'])}' : ''}')
                                        : tr('لم يُسجَّل وقت', 'No time logged'),
                                    style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                ]);
                              }),
                            ),
                          ),
                        ],
                      ])),
                    ],
                    const SizedBox(height: 12),
                    _dailyCard(),
                    _head(management ? tr('المديرون', 'Managers') : tr('الفريق', 'Team')),
                    for (final m in members) AppCard(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text((m['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800))),
                        if ((m['overdue'] ?? 0) > 0) Chip2(tr('${m['overdue']} متأخّرة', '${m['overdue']} late'), T.danger),
                      ]),
                      Text(tr((m['roleAr'] ?? '').toString(), (m['roleEn'] ?? '').toString()), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                      const SizedBox(height: 6),
                      ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: ((m['completionRate'] ?? 0) as num) / 100, minHeight: 6, backgroundColor: T.line, color: T.success)),
                      const SizedBox(height: 6),
                      Text(tr('أُسنِد ${m['assigned']} · قائمة ${m['open']} · تمّت ${m['done']} · في موعدها ${_pct(m['onTimeRate'])} · طلباتٌ كتبها ${m['requestsMade']}',
                          'Assigned ${m['assigned']} · open ${m['open']} · done ${m['done']} · on time ${_pct(m['onTimeRate'])} · requests ${m['requestsMade']}'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ])),
                    if (idle.isNotEmpty) ...[
                      _head(tr('بلا مهامَّ قائمة', 'Nothing open')),
                      Wrap(spacing: 6, runSpacing: 6, children: [for (final m in idle) Chip2((m['name'] ?? '').toString(), T.inkSoft)]),
                    ],
                    if (projects.isNotEmpty) ...[
                      _head(tr('المشروعات', 'Projects')),
                      for (final p in projects) AppCard(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text((p['name'] ?? '').toString().isEmpty ? tr('مهامُّ بلا مشروع', 'Tasks without a project') : p['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: ((p['progress'] ?? 0) as num) / 100, minHeight: 6, backgroundColor: T.line, color: T.success)),
                        const SizedBox(height: 4),
                        Text(tr('${p['done']} من ${p['total']} تمّت · ${p['people']} مشاركًا${(p['overdue'] ?? 0) > 0 ? ' · ${p['overdue']} متأخّرة' : ''}', '${p['done']} of ${p['total']} done · ${p['people']} people'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                      ])),
                    ],
                    _head(tr('المتأخّرة', 'Late')),
                    if (overdue.isEmpty) Text(tr('لا شيء متأخّر', 'Nothing late'), style: const TextStyle(color: T.inkFaint)),
                    for (final r in overdue) line(r),
                    _head(tr('تستحقّ خلال 24 ساعة', 'Due within 24 hours')),
                    if (soon.isEmpty) Text(tr('لا شيء يستحقّ قريبًا', 'Nothing due soon'), style: const TextStyle(color: T.inkFaint)),
                    for (final r in soon) line(r),
                  ].expand((w) => [w, if (w is AppCard) const SizedBox(height: 8)]).toList());
                })),
    );
  }
}

/// JP tasks for a specific item: read and added from its screen. Like the web (components/jp/JpTaskPanel): placed on the transaction, shipment, employee and vehicle screens, and writes the task in a dialog above it linked to what it was opened from, so it appears in the section plan and dashboard at once. Hidden from anyone outside the section team.
class JpTaskPanel extends StatefulWidget {
  const JpTaskPanel({super.key, required this.section, required this.kind, required this.refId});
  final String section, kind, refId;
  @override
  State<JpTaskPanel> createState() => _JpTaskPanelState();
}

class _JpTaskPanelState extends State<JpTaskPanel> {
  Map<String, dynamic>? _me;
  List<Map<String, dynamic>> _tasks = const [];
  bool _hidden = false, _loaded = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (_me != null) _load(); };
    Live.instance.on('jp:changed', _onLive);
    _init();
  }

  @override
  void dispose() { Live.instance.off('jp:changed', _onLive); super.dispose(); }

  Future<void> _init() async {
    try {
      final me = Map<String, dynamic>.from(await Api.instance.get('/api/jp/me?scope=section&section=${widget.section}'));
      if (!List.from(me['linkKinds'] ?? const []).contains(widget.kind)) { if (mounted) setState(() => _hidden = true); return; }
      _me = me;
      await _load();
    } catch (_) { if (mounted) setState(() => _hidden = true); }
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/jp/tasks?scope=section&section=${widget.section}&box=all&linkKind=${widget.kind}&linkRef=${widget.refId}');
      if (mounted) setState(() { _tasks = List<Map<String, dynamic>>.from((d['tasks'] ?? const []).map((e) => Map<String, dynamic>.from(e))); _loaded = true; });
    } catch (_) { if (mounted) setState(() => _hidden = true); }
  }

  /// Name of what the panel was opened from: the transaction or customs party is read to show in the form as on the web; the server captures the name on save anyway.
  String _label = '';
  Future<void> _lookupLabel() async {
    if (_label.isNotEmpty) return;
    try {
      if (widget.kind == 'clearance') {
        final r = await Api.instance.get('/api/customs-clearance/${widget.refId}');
        final c = Map<String, dynamic>.from(r['clearance'] ?? {});
        _label = [c['blNumber'] ?? c['refNumber'], c['customerName']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
      } else if (const ['customer', 'agent', 'carrier'].contains(widget.kind)) {
        final r = await Api.instance.get('/api/customs-clearance/parties/${widget.refId}');
        _label = (r['party']?['name'] ?? '').toString();
      }
    } catch (_) {}
  }

  Future<void> _add() async {
    await _lookupLabel();
    if (!mounted) return;
    final me = Map<String, dynamic>.from(_me!);
    showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _JpForm(
        scope: 'section', section: widget.section, me: me, projects: const [], task: null, presetProject: '',
        presetLinks: [{'kind': widget.kind, 'ref': widget.refId, 'label': _label.isEmpty ? tr('هذا', 'this') : _label}], onDone: _load,
      ),
    );
  }

  Future<void> _toggle(Map<String, dynamic> t) async {
    try {
      await Api.instance.post('/api/jp/tasks/${t['_id']}/done', {'done': t['status'] != 'done'});
      await _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    if (_hidden || !_loaded) return const SizedBox.shrink();
    final open = _tasks.where((t) => t['status'] != 'done').length;
    return AppCard(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.event_available_outlined, color: T.orange, size: 20),
          const SizedBox(width: 6),
          Expanded(child: Text('${tr('مهامّ خطّة العمل (JP)', 'Work-plan tasks (JP)')}${open > 0 ? ' · ${tr('$open مفتوحة', '$open open')}' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.orange, visualDensity: VisualDensity.compact),
            onPressed: _add, icon: const Icon(Icons.add, size: 16), label: Text(tr('إضافة JP', 'Add JP')),
          ),
        ]),
        if (_tasks.isEmpty)
          Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(tr('لا مهامّ مربوطة بعد — أضِف من هنا.', 'No linked tasks yet — add one here.'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)))
        else
          for (final t in _tasks) () {
            final dl = jpDeadline(t);
            final done = t['status'] == 'done';
            final can = (t['can'] as Map?)?['complete'] == true;
            return ListTile(
              dense: true, contentPadding: EdgeInsets.zero,
              leading: IconButton(
                onPressed: can ? () => _toggle(t) : null,
                icon: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? T.success : (t['state'] == 'overdue' ? T.danger : T.inkFaint)),
              ),
              title: Text('${t['title']}', style: TextStyle(fontWeight: FontWeight.w700, decoration: done ? TextDecoration.lineThrough : null)),
              subtitle: Text('${t['assignedToName'] ?? ''} · ${dl.$1}', style: TextStyle(fontSize: 11.5, color: dl.$2)),
            );
          }(),
      ]),
    );
  }
}

/// Server-side search for what a task links to (/api/jp/link-options&q=), like LinkPicker on the web: type a waybill number or customer name and the whole register is searched.
class _LinkSearch extends StatefulWidget {
  const _LinkSearch({required this.section, required this.kind, required this.title});
  final String section, kind, title;
  @override
  State<_LinkSearch> createState() => _LinkSearchState();
}

class _LinkSearchState extends State<_LinkSearch> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;
  Timer? _debounce;
  int _seq = 0;
  final _searchCtl = TextEditingController();

  @override
  void initState() { super.initState(); _load(''); }
  @override
  void dispose() { _debounce?.cancel(); _searchCtl.dispose(); super.dispose(); }

  Future<void> _load(String q) async {
    final mine = ++_seq;
    setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/jp/link-options?scope=section&section=${Uri.encodeQueryComponent(widget.section)}&kind=${widget.kind}&q=${Uri.encodeQueryComponent(q.trim())}&limit=100');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from((d['options'] ?? const []).map((e) => Map<String, dynamic>.from(e))); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false, initialChildSize: 0.7, maxChildSize: 0.92,
        builder: (c, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
            child: SearchField(
              controller: _searchCtl, autofocus: true,
              onChanged: (v) { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), () => _load(v)); },
              hint: '${widget.title}…',
            ),
          ),
          Expanded(child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () => _load(_searchCtl.text))
                  : _rows.isEmpty
                      ? EmptyState(icon: Icons.search_off_rounded, title: tr('لا نتائج', 'No results'))
                      : ListView.builder(
                          controller: scroll, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(8, 6, 8, 20), itemCount: _rows.length,
                          itemBuilder: (c2, i) => ListTile(
                            title: Text((_rows[i]['label'] ?? '').toString(), style: const TextStyle(fontSize: 14)),
                            onTap: () => Navigator.pop(c, _rows[i]),
                          ),
                        )),
        ]),
      ),
    );
  }
}


/// A person field that opens a searchable list (name or role); the section's team first.
class JpPersonField extends StatelessWidget {
  final String label;
  final String value;
  final List<Map<String, dynamic>> people;
  final ValueChanged<String> onChanged;
  const JpPersonField({super.key, required this.label, required this.value, required this.people, required this.onChanged});

  String _role(Map<String, dynamic> m) => tr('${m['roleAr'] ?? ''}', '${m['roleEn'] ?? ''}');

  Future<void> _open(BuildContext context) async {
    final ctl = TextEditingController();
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) {
        final q = ctl.text.trim().toLowerCase();
        final list = people.where((m) => q.isEmpty || '${m['name']} ${m['nameAr'] ?? ''} ${m['search'] ?? ''} ${_role(m)}'.toLowerCase().contains(q) || soundsLike('${m['name']} ${m['search'] ?? ''}', q)).toList()
          ..sort((a, b) => (b['inSection'] == false ? 0 : 1) - (a['inSection'] == false ? 0 : 1));
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.75,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
                child: TextField(controller: ctl, autofocus: true, onChanged: (_) => setSt(() {}),
                    decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('ابحث بالاسم أو الدور…', 'Search name or role…'), border: const OutlineInputBorder(), isDense: true)),
              ),
              Expanded(child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final m = list[i];
                  final id = '${m['_id'] ?? ''}';
                  return ListTile(
                    dense: true,
                    selected: id == value,
                    title: Text('${m['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: _role(m).isEmpty ? null : Text(_role(m)),
                    trailing: m['inSection'] == false ? Chip2(tr('خارج القسم', 'Other'), T.info) : null,
                    onTap: () => Navigator.pop(c, id),
                  );
                },
              )),
            ]),
          ),
        );
      }),
    );
    ctl.dispose();
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final cur = people.firstWhere((m) => '${m['_id']}' == value, orElse: () => const {});
    return InkWell(
      onTap: () => _open(context),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true, suffixIcon: const Icon(Icons.search)),
        child: Text(cur.isEmpty ? '—' : '${cur['name'] ?? ''}', overflow: TextOverflow.ellipsis),
      ),
    );
  }
}
