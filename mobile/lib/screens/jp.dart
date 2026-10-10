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

/// خطّةُ العمل (JP) — نظيرُ `JpBoard` و`JpDashboard` في الموقع.
///
/// شاشةٌ واحدةٌ للقسم ولخطّة الإدارة. والصلاحيّةُ من الخادم: كلُّ مهمّةٍ تحمل
/// `can`، و`/me` تقول أهو مديرٌ أم عضو — فلا قائمةَ أدوارٍ تُكرَّر هنا إلّا ما
/// يُخفي به الدرجُ صفحةً يرفض الخادمُ صاحبَها (الخريطتان أدناه، مولَّدتان من
/// backend/src/config/jpSections.js).
const jpManagerRoles = <String, List<String>>{
  'operations': ['operations_manager'],
  'collections': ['collections_manager'],
  'ops': ['ops_platform_manager'],
  'shipment-orders': ['shipment_orders_manager'],
  'fleet': ['fleet_manager'],
  'customs': ['customs_manager'],
  'vehicles': ['vehicles_manager'],
  'ls2': ['location_manager'],
  'marketing': ['marketing_manager'],
  'bd': ['bd_manager'],
  'it': ['it_manager'],
  'administration': ['administration_manager'],
  'contracts': ['contracts_manager'],
  'b2c': ['b2c_manager'],
  'remote': ['remote_manager'],
  'hr': ['hr_manager'],
  'crm': ['crm_manager'],
  'sales': ['sales_manager'],
  'accounting': ['accounting_manager', 'cfo'],
  'procurement': ['procurement_manager'],
};
const jpStaffRoles = <String, List<String>>{
  'operations': ['operations_staff'],
  'collections': ['collections_staff'],
  'ops': ['ops_platform_staff'],
  'shipment-orders': ['shipment_orders_staff'],
  'fleet': ['fleet_supervisor'],
  'customs': ['customs_officer'],
  'vehicles': ['vehicles_staff'],
  'ls2': ['location_staff'],
  'marketing': ['marketing_specialist'],
  'bd': ['bd_specialist'],
  'it': ['it_specialist'],
  'administration': ['administration_staff'],
  'contracts': ['contracts_staff'],
  'b2c': ['b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'],
  'remote': ['remote_employee'],
  'hr': ['hr_specialist'],
  'crm': ['crm_specialist'],
  'sales': ['sales_rep'],
  'accounting': ['accountant'],
  'procurement': ['procurement_staff'],
};
bool jpManager(String role, String section) =>
    role == 'super_admin' || (jpManagerRoles[section] ?? const []).contains(role);
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

/// سطرُ الموعد ولونُه — كما في الموقع: «تُسلَّم قبل ٣:٠٠ م — بقي ساعة».
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
    // العدُّ التنازليُّ يتحرّك بلا إعادة تحميل.
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

  /// مديرُ القسم يُنزل ما كُلِّف به إلى موظّفٍ عنده — الموظّفُ يراها من مديره.
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

  Future<void> _newProject() async {
    final name = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('مشروع جديد', 'New project')),
      content: TextField(controller: name, autofocus: true, decoration: InputDecoration(hintText: tr('مثال: حملة رمضان', 'e.g. Ramadan campaign'))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    if (ok != true || name.text.trim().isEmpty) return;
    await _run(() => Api.instance.post('/api/jp/projects', {
      'scope': widget.scope, if (widget.section != null) 'section': widget.section, 'name': name.text.trim(),
    }));
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
        if (_canManage) IconButton(tooltip: tr('مشروع جديد', 'New project'), icon: const Icon(Icons.create_new_folder_outlined), onPressed: _newProject),
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
                for (final p in _projects) GestureDetector(
                  onLongPress: (_management && !_canManage && _mySection.isNotEmpty) ? () => _handDown(project: p) : null,
                  child: _chip('${p['name']} · ${p['done'] ?? 0}/${p['total'] ?? 0}', _project == p['_id'], () => _set(() => _project = _project == p['_id'] ? '' : p['_id'].toString()), color: T.orange),
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
            for (final a in files) InkWell(
              onTap: () => launchUrl(Uri.parse('${AppConfig.apiBase}${a['fileUrl']}'), mode: LaunchMode.externalApplication),
              child: Chip2((a['fileName'] ?? tr('ملف', 'File')).toString(), a['phase'] == 'done' ? T.success : T.inkSoft, icon: Icons.attach_file),
            ),
          ])),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
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

/// نموذجُ المهمّة: ما المطلوب، ولمن، ومتى — والباقي اختياريٌّ مطويّ.
class _JpForm extends StatefulWidget {
  final String scope; final String? section; final Map<String, dynamic> me;
  final List<Map<String, dynamic>> projects; final Map<String, dynamic>? task;
  final String presetProject; final Future<void> Function() onDone;
  const _JpForm({required this.scope, required this.section, required this.me, required this.projects, required this.task, required this.presetProject, required this.onDone});
  @override
  State<_JpForm> createState() => _JpFormState();
}

class _JpFormState extends State<_JpForm> {
  final _title = TextEditingController(), _details = TextEditingController(), _contact = TextEditingController(), _hours = TextEditingController();
  String _assignee = '', _action = '', _project = '', _dueKind = '', _dueDate = '';
  bool _more = false, _saving = false, _dueTouched = false;
  PickedFile? _file;

  bool get _editing => widget.task != null;
  bool get _canManage => widget.me['canManage'] == true;

  @override
  void initState() {
    super.initState();
    final t = widget.task;
    _project = widget.presetProject;
    if (!_canManage) _assignee = (widget.me['me'] ?? '').toString();
    if (t != null) {
      _title.text = (t['title'] ?? '').toString(); _details.text = (t['details'] ?? '').toString();
      _contact.text = (t['contact'] ?? '').toString(); _action = (t['action'] ?? '').toString();
      _assignee = _id(t['assignedTo']); _project = t['project'] is Map ? t['project']['_id'].toString() : '';
      if (t['deadlineKind'] == 'date' && t['deadlineAt'] != null) { _dueKind = 'date'; _dueDate = _ymd(DateTime.parse(t['deadlineAt'].toString()).toLocal()); }
      _more = _details.text.isNotEmpty || _action.isNotEmpty || _contact.text.isNotEmpty;
    }
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
        // موعدٌ بالساعات لا يُعاد عدُّه عند التعديل ما لم يُغيَّر.
        if (!_editing || _dueTouched) ..._dueBody(),
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
        TextField(controller: _title, autofocus: !_editing, decoration: InputDecoration(labelText: tr('ما المطلوب؟', 'What is needed?'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: _assignee.isEmpty ? null : _assignee, isExpanded: true,
          decoration: InputDecoration(labelText: _canManage ? tr('إلى مَن؟', 'For whom?') : tr('لي أو لزميل', 'Me or a colleague'), border: const OutlineInputBorder()),
          items: [
            if (!team.any((m) => m['_id'] == meId) && !_canManage) DropdownMenuItem(value: meId, child: Text(tr('لنفسي', 'Myself'))),
            for (final m in team) DropdownMenuItem(value: m['_id'].toString(), child: Text(m['_id'] == meId ? '${m['name']} (${tr('أنا', 'me')})' : '${m['name']} — ${tr((m['roleAr'] ?? '').toString(), (m['roleEn'] ?? '').toString())}', overflow: TextOverflow.ellipsis)),
            if (_assignee.isNotEmpty && _assignee != meId && !team.any((m) => m['_id'] == _assignee)) DropdownMenuItem(value: _assignee, child: Text((widget.task?['assignedToName'] ?? '').toString())),
          ],
          onChanged: (v) => setState(() => _assignee = v ?? ''),
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

/// لوحةُ الخطّة — للمدير وحدَه؛ الخادمُ يرفض غيرَه والشاشةُ تقول ذلك.
class JpDashScreen extends StatefulWidget {
  final String scope; final String? section;
  const JpDashScreen({super.key, this.scope = 'section', this.section});
  @override
  State<JpDashScreen> createState() => _JpDashScreenState();
}

class _JpDashScreenState extends State<JpDashScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() { super.initState(); _load(); _onLive = () => _load(); Live.instance.on('jp:changed', _onLive); }
  @override
  void dispose() { Live.instance.off('jp:changed', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/jp/dashboard?${_qs(widget.scope, widget.section)}'));
      if (mounted) setState(() { _d = d; _error = null; });
    } catch (e) { if (mounted) setState(() => _error = e.toString()); }
  }

  Widget _stat(String label, String value, Color c) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: T.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: T.line)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
      Text(label, style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
      const SizedBox(height: 4),
      Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: c)),
    ]),
  );

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
                    return ListTile(
                      dense: true, contentPadding: EdgeInsets.zero,
                      title: Text((r['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                      subtitle: Text('${r['assignedToName']} · ${dl.$1}', style: TextStyle(fontSize: 12, color: dl.$2)),
                    );
                  }
                  return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
                    GridView.count(
                      crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      crossAxisSpacing: 8, mainAxisSpacing: 8, childAspectRatio: 1.45,
                      children: [
                        _stat(tr('القائمة', 'Open'), '${t['open'] ?? 0}', T.ink),
                        _stat(tr('المتأخّرة', 'Late'), '${t['overdue'] ?? 0}', (t['overdue'] ?? 0) > 0 ? T.danger : T.ink),
                        _stat(tr('خلال ٢٤ ساعة', 'Within 24h'), '${t['dueSoon'] ?? 0}', (t['dueSoon'] ?? 0) > 0 ? T.warn : T.ink),
                        _stat(tr('التي تمّت', 'Done'), '${t['done'] ?? 0}', T.success),
                        _stat(tr('نسبة الإتمام', 'Completion'), _pct(t['completionRate']), T.ink),
                        _stat(tr('في موعدها', 'On time'), _pct(t['onTimeRate']), T.ink),
                      ],
                    ),
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
                    _head(tr('تستحقّ خلال ٢٤ ساعة', 'Due within 24 hours')),
                    if (soon.isEmpty) Text(tr('لا شيء يستحقّ قريبًا', 'Nothing due soon'), style: const TextStyle(color: T.inkFaint)),
                    for (final r in soon) line(r),
                  ].expand((w) => [w, if (w is AppCard) const SizedBox(height: 8)]).toList());
                })),
    );
  }
}
