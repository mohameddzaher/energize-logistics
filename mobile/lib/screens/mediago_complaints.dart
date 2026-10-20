import 'dart:async';
import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../services/notifications.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'admin_suite.dart' show NotificationsScreen;

/// شكاوى Media Go — نظيرُ /system/b2c/mediago-complaints.
///
/// بلاغاتُ أعطال الشاشات المركَّبة على دبّاباتنا. قسمُ الأفراد يرفعها بأسئلة
/// نموذج Media Go نفسِها، وحسابُ Media Go (`mediago_account`) لا يرى من النظام
/// غيرَها: يقرؤها باللغتين، ويقول «قيد المعالجة» ثمّ «تمّ الإصلاح»، ويردّ.
/// وحدودُ كلّ طرفٍ يقولها الخادمُ في `can`.
const _api = '/api/b2c/mediago-complaints';
const mediagoRole = 'mediago_account';

/// نصٌّ للطرفين: لغةُ القارئ لنا، واللغتان معًا للشريك.
String _bx(bool partner, String ar, String en) => partner ? '$ar / $en' : tr(ar, en);

String _vocab(Map? meta, String group, String key, bool partner) {
  final list = List<Map>.from((meta?[group] as List?) ?? const []);
  final x = list.where((v) => v['key'] == key).toList();
  if (x.isEmpty) return key;
  return partner ? '${x.first['ar']} / ${x.first['en']}' : tr('${x.first['ar']}', '${x.first['en']}');
}

String _issueOf(Map? meta, Map r, bool partner) =>
    r['issue'] == 'other' && '${r['issueOther'] ?? ''}'.isNotEmpty ? '${r['issueOther']}' : _vocab(meta, 'issue', '${r['issue']}', partner);
String _availOf(Map? meta, Map r, bool partner) =>
    r['availability'] == 'other' && '${r['availabilityOther'] ?? ''}'.isNotEmpty ? '${r['availabilityOther']}' : _vocab(meta, 'availability', '${r['availability']}', partner);

Color _statusColor(String s) => switch (s) {
      'new' => T.info,
      'in_progress' => T.warn,
      'fixed' => T.success,
      _ => T.inkSoft,
    };

String _when(dynamic iso) {
  final d = DateTime.tryParse('${iso ?? ''}');
  if (d == null) return '';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(l.day)}/${two(l.month)}/${l.year} ${two(l.hour)}:${two(l.minute)}';
}

String _url(String u) => u.startsWith('http') ? u : '${AppConfig.apiBase}$u';

class _StatusPill extends StatelessWidget {
  final String status;
  final Map? meta;
  final bool partner;
  const _StatusPill(this.status, this.meta, this.partner);
  @override
  Widget build(BuildContext context) => Chip2(_vocab(meta, 'status', status, partner), _statusColor(status), icon: Icons.circle);
}

// ═════════════════════════════════════════════════════════════════════════
// القائمة
// ═════════════════════════════════════════════════════════════════════════
class MediaGoComplaintsScreen extends StatefulWidget {
  /// حسابُ Media Go يدخل عليها مباشرةً — بلا درجٍ ولا شريطٍ سفليّ يفتحان ما ليس له.
  final bool partnerHome;
  const MediaGoComplaintsScreen({super.key, this.partnerHome = false});
  @override
  State<MediaGoComplaintsScreen> createState() => _MediaGoComplaintsScreenState();
}

class _MediaGoComplaintsScreenState extends State<MediaGoComplaintsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _q = '';
  String _status = '';
  String _issue = '';
  String _location = '';
  Timer? _debounce;
  int _seq = 0;
  late final void Function() _onLive;

  bool get _partner => (_d?['can']?['partner'] == true) || widget.partnerHome;

  @override
  void initState() {
    super.initState();
    if (widget.partnerHome) {
      Live.instance.connect();
      NotificationService.instance.init();
    }
    _load();
    _onLive = () { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 500), _load); };
    Live.instance.on('mediago:complaint', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('mediago:complaint', _onLive);
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final p = <String>[
      if (_q.isNotEmpty) 'q=${Uri.encodeQueryComponent(_q)}',
      if (_status.isNotEmpty) 'status=$_status',
      if (_issue.isNotEmpty) 'issue=$_issue',
      if (_location.isNotEmpty) 'location=$_location',
    ];
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('$_api${p.isEmpty ? '' : '?${p.join('&')}'}') as Map);
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : e.toString());
    }
  }

  void _open(String id) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => MediaGoDetailScreen(id: id, partner: _partner)));
    _load();
  }

  Future<void> _create() async {
    final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => MediaGoCreateScreen(meta: _d?['meta'] as Map?)));
    await _load();
    if (id != null && mounted) _open(id);
  }

  Future<void> _pickFilter(String group) async {
    final meta = _d?['meta'] as Map?;
    final items = List<Map>.from((meta?[group] as List?) ?? const []);
    final counts = Map<String, dynamic>.from((_d?['counts']?[group] as Map?) ?? const {});
    final cur = group == 'issue' ? _issue : _location;
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(_bx(_partner, 'الكل', 'All')), trailing: cur.isEmpty ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, '')),
          for (final o in items)
            ListTile(
              title: Text(_bx(_partner, '${o['ar']}', '${o['en']}')),
              subtitle: Text('${counts['${o['key']}'] ?? 0}'),
              trailing: cur == o['key'] ? const Icon(Icons.check, color: T.orange) : null,
              onTap: () => Navigator.pop(c, '${o['key']}'),
            ),
        ]),
      ),
    );
    if (picked == null) return;
    setState(() { if (group == 'issue') { _issue = picked; } else { _location = picked; } });
    _load();
  }

  Widget _body() {
    if (_d == null && _error == null) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 160)]);
    if (_d == null) return ErrorRetry(message: _error!, onRetry: _load);
    final d = _d!;
    final meta = d['meta'] as Map?;
    final partner = _partner;
    final items = List<Map<String, dynamic>>.from(d['items'] ?? const []);
    final sc = Map<String, dynamic>.from((d['counts']?['status'] as Map?) ?? const {});
    final statuses = List<Map>.from((meta?['status'] as List?) ?? const []);

    Widget statusChip(String key, String label, num n, Color color) {
      final on = _status == key;
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: ChoiceChip(
          selected: on,
          onSelected: (_) { setState(() => _status = on && key.isNotEmpty ? '' : key); _load(); },
          label: Text('$label  $n', style: TextStyle(fontWeight: FontWeight.w700, color: on ? Colors.white : color)),
          selectedColor: color,
          backgroundColor: color.withValues(alpha: 0.08),
          side: BorderSide(color: color.withValues(alpha: 0.3)),
          showCheckmark: false,
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
        children: [
          // اللافتة
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(gradient: T.navyGradient, borderRadius: BorderRadius.circular(18)),
            child: Row(children: [
              Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(14)),
                  child: const Icon(Icons.connected_tv_outlined, color: Colors.white)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (partner) const Text('Energize × Media Go', style: TextStyle(color: Colors.white60, fontSize: 11, letterSpacing: 1.5, fontWeight: FontWeight.w700)),
                Text(partner ? 'بلاغات أعطال الشاشات' : tr('شكاوى Media Go', 'Media Go Complaints'),
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text(partner ? 'Screen fault reports' : tr('${d['grandTotal'] ?? 0} بلاغ', '${d['grandTotal'] ?? 0} complaints'),
                    style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
              ])),
            ]),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 40,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              statusChip('', _bx(partner, 'الكل', 'All'), (d['grandTotal'] ?? 0) as num, T.navy),
              for (final s in statuses)
                statusChip('${s['key']}', partner ? '${s['ar']} / ${s['en']}' : tr('${s['ar']}', '${s['en']}'), (sc['${s['key']}'] ?? 0) as num, _statusColor('${s['key']}')),
            ]),
          ),
          const SizedBox(height: 10),
          TextField(
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search_rounded),
              hintText: _bx(partner, 'ابحث بالمرجع أو الدبّاب أو الشاشة', 'Search ref, motorcycle or screen'),
              filled: true, fillColor: Colors.white, isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: T.line)),
            ),
            onChanged: (v) { _q = v.trim(); _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), _load); },
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: OutlinedButton.icon(
              onPressed: () => _pickFilter('issue'),
              icon: const Icon(Icons.report_problem_outlined, size: 18),
              label: Text(_issue.isEmpty ? _bx(partner, 'المشكلة', 'Issue') : _vocab(meta, 'issue', _issue, partner), overflow: TextOverflow.ellipsis),
            )),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(
              onPressed: () => _pickFilter('location'),
              icon: const Icon(Icons.place_outlined, size: 18),
              label: Text(_location.isEmpty ? _bx(partner, 'الموقع', 'Location') : _vocab(meta, 'location', _location, partner), overflow: TextOverflow.ellipsis),
            )),
          ]),
          const SizedBox(height: 12),
          if (items.isEmpty)
            EmptyState(icon: Icons.connected_tv_outlined, title: _bx(partner, 'لا بلاغات', 'No complaints'))
          else
            for (final r in items) Padding(padding: const EdgeInsets.only(bottom: 12), child: _card(r, meta, partner)),
        ],
      ),
    );
  }

  Widget _card(Map<String, dynamic> r, Map? meta, bool partner) {
    final cover = '${r['cover'] ?? ''}';
    final status = '${r['status']}';
    return Pressable(
      onTap: () => _open('${r['_id']}'),
      child: Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: T.line), boxShadow: T.softShadow),
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            height: 130,
            child: Stack(fit: StackFit.expand, children: [
              cover.isNotEmpty
                  ? Image.network(_url(cover), fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: T.navy))
                  : Container(decoration: const BoxDecoration(gradient: T.navyGradient), child: const Icon(Icons.connected_tv_outlined, color: Colors.white38, size: 40)),
              PositionedDirectional(top: 8, end: 8, child: Container(decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)), child: _StatusPill(status, meta, partner))),
              PositionedDirectional(bottom: 8, start: 10, child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
                child: Text('${r['ref']}', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
              )),
              PositionedDirectional(bottom: 8, end: 10, child: Row(children: [
                if ((r['fileCount'] ?? 0) > 0) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
                  child: Row(children: [const Icon(Icons.photo_outlined, size: 13, color: Colors.white), const SizedBox(width: 3), Text('${r['fileCount']}', style: const TextStyle(color: Colors.white, fontSize: 11))]),
                ),
                if (r['hasVideo'] == true) ...[const SizedBox(width: 4), Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
                  child: const Icon(Icons.videocam_outlined, size: 14, color: Colors.white),
                )],
              ])),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_issueOf(meta, r, partner), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 12, runSpacing: 4, children: [
                _meta(Icons.two_wheeler_outlined, '${r['motorcycleNumber']}'),
                _meta(Icons.connected_tv_outlined, '${(r['screenNumber'] ?? '').toString().isEmpty ? '—' : r['screenNumber']}'),
                _meta(Icons.place_outlined, _vocab(meta, 'location', '${r['location']}', partner)),
                _meta(Icons.schedule_outlined, _availOf(meta, r, partner)),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Text(_when(r['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                const Spacer(),
                if ((r['replyCount'] ?? 0) > 0) Row(children: [const Icon(Icons.chat_bubble_outline, size: 14, color: T.violet), const SizedBox(width: 3), Text('${r['replyCount']}', style: const TextStyle(color: T.violet, fontWeight: FontWeight.w700, fontSize: 12))]),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _meta(IconData i, String t) => Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(i, size: 14, color: T.inkFaint), const SizedBox(width: 3),
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 160), child: Text(t, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
      ]);

  @override
  Widget build(BuildContext context) {
    final canCreate = _d?['can']?['create'] == true;
    final fab = canCreate
        ? FloatingActionButton.extended(onPressed: _create, backgroundColor: T.orange, foregroundColor: Colors.white,
            icon: const Icon(Icons.add), label: Text(tr('بلاغ جديد', 'New complaint')))
        : null;
    if (!widget.partnerHome) {
      return AppScaffold(title: Text(tr('شكاوى Media Go', 'Media Go Complaints')), body: _body(), floatingActionButton: fab);
    }
    // ── بيتُ حساب Media Go ─────────────────────────────────────────────────
    // لا درجَ أقسامٍ ولا «ملفي»: كلُّها نقاطٌ يردّها الخادمُ عليه. له الإشعاراتُ
    // واللغةُ والخروج — وشاشتُه.
    final auth = context.read<AuthProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Media Go'),
        actions: [
          IconButton(
            tooltip: tr('الإشعارات', 'Notifications'),
            icon: ListenableBuilder(
              listenable: NotificationService.instance,
              builder: (_, __) => Badge(
                isLabelVisible: NotificationService.instance.unread > 0,
                label: Text('${NotificationService.instance.unread}'),
                child: const Icon(Icons.notifications_outlined),
              ),
            ),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())),
          ),
          IconButton(tooltip: 'AR / EN', icon: const Icon(Icons.translate_rounded), onPressed: () => Lang.instance.toggle()),
          IconButton(tooltip: tr('خروج', 'Sign out'), icon: const Icon(Icons.logout_rounded), onPressed: () => auth.logout()),
        ],
      ),
      body: _body(),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// التفصيل
// ═════════════════════════════════════════════════════════════════════════
class MediaGoDetailScreen extends StatefulWidget {
  final String id;
  final bool partner;
  const MediaGoDetailScreen({super.key, required this.id, this.partner = false});
  @override
  State<MediaGoDetailScreen> createState() => _MediaGoDetailScreenState();
}

class _MediaGoDetailScreenState extends State<MediaGoDetailScreen> {
  Map<String, dynamic>? _item;
  Map? _meta;
  Map? _can;
  String? _error;
  String _busy = '';
  final _reply = TextEditingController();
  late final void Function() _onLive;

  bool get _partner => _can?['partner'] == true || widget.partner;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = _load;
    Live.instance.on('mediago:complaint', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('mediago:complaint', _onLive);
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('$_api/${widget.id}') as Map);
      if (!mounted) return;
      setState(() { _item = Map<String, dynamic>.from(d['item'] as Map); _meta = d['meta'] as Map?; _can = d['can'] as Map?; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : e.toString());
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _run(String key, Future<dynamic> Function() f) async {
    setState(() => _busy = key);
    try {
      final r = await f();
      if (!mounted) return;
      if (r is Map && r['item'] is Map) setState(() => _item = Map<String, dynamic>.from(r['item'] as Map));
    } catch (e) {
      if (mounted) _snack(e is ApiException ? e.message : e.toString());
    }
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _setStatus(String s) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(_vocab(_meta, 'status', s, _partner)),
        content: TextField(controller: note, maxLines: 3, decoration: InputDecoration(hintText: _bx(_partner, 'ملاحظة (اختياري)', 'Note (optional)'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(_bx(_partner, 'إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 44)), onPressed: () => Navigator.pop(c, true), child: Text(_bx(_partner, 'تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    await _run('s:$s', () => Api.instance.patch('$_api/${widget.id}/status', {'status': s, 'note': note.text.trim()}));
  }

  Future<void> _sendReply() async {
    final t = _reply.text.trim();
    if (t.isEmpty) return;
    await _run('reply', () => Api.instance.post('$_api/${widget.id}/replies', {'text': t}));
    if (mounted && _busy.isEmpty) _reply.clear();
  }

  Future<void> _addFiles() async {
    final room = 5 - ((_item?['files'] as List?)?.length ?? 0);
    final picked = await pickMediaFiles(context, room: room, partner: _partner);
    if (picked.isEmpty) return;
    await _run('files', () => Api.instance.postLong('$_api/${widget.id}/files', {'files': picked.map((f) => f.toJson()).toList()}));
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف البلاغ', 'Delete complaint')),
        content: Text(tr('حذف ${_item?['ref']} نهائيًّا مع مرفقاته؟', 'Delete ${_item?['ref']} and its files permanently?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('$_api/${widget.id}');
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) _snack(e is ApiException ? e.message : e.toString());
    }
  }

  void _viewFile(List files, int i) {
    final f = Map<String, dynamic>.from(files[i] as Map);
    if (f['kind'] == 'video') {
      // لا مشغّلَ فيديو في التطبيق — يُفتَح في مشغّل الهاتف.
      launchUrl(Uri.parse(_url('${f['fileUrl']}')), mode: LaunchMode.externalApplication);
      return;
    }
    final images = files.where((x) => (x as Map)['kind'] != 'video').map((x) => _url('${(x as Map)['fileUrl']}')).toList();
    final start = images.indexOf(_url('${f['fileUrl']}'));
    Navigator.push(context, MaterialPageRoute(builder: (_) => _Gallery(urls: images, start: start < 0 ? 0 : start)));
  }

  Widget _info(IconData icon, String ar, String en, String value) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(icon, size: 14, color: T.inkFaint), const SizedBox(width: 4), Flexible(child: Text(_bx(_partner, ar, en), style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)))]),
          const SizedBox(height: 4),
          Text(value.isEmpty ? '—' : value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final it = _item;
    final partner = _partner;
    Widget body;
    if (it == null) {
      body = _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    } else {
      final files = List.from(it['files'] ?? const []);
      final history = List<Map>.from(it['statusHistory'] ?? const []);
      final replies = List<Map>.from(it['replies'] ?? const []);
      final statuses = List<String>.from((_can?['statuses'] as List?) ?? const [])
          .where((s) => s != it['status'] && !(partner && it['status'] == 'closed')).toList();
      body = Column(children: [
        Expanded(
          child: ListView(padding: const EdgeInsets.all(14), children: [
            Row(children: [
              Text('${it['ref']}', textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: T.navy)),
              const SizedBox(width: 10),
              _StatusPill('${it['status']}', _meta, partner),
            ]),
            Text('${_when(it['createdAt'])}${(it['createdByName'] ?? '').toString().isNotEmpty ? ' · ${it['createdByName']}' : ''}', style: const TextStyle(color: T.inkSoft, fontSize: 12)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: _info(Icons.two_wheeler_outlined, 'رقم الدبّاب', 'Motorcycle', '${it['motorcycleNumber']}')),
              const SizedBox(width: 8),
              Expanded(child: _info(Icons.connected_tv_outlined, 'رقم الشاشة', 'Screen', '${it['screenNumber'] ?? ''}')),
            ]),
            const SizedBox(height: 8),
            _info(Icons.report_problem_outlined, 'المشكلة', 'Issue', _issueOf(_meta, it, partner)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _info(Icons.place_outlined, 'موقع الصيانة', 'Location', _vocab(_meta, 'location', '${it['location']}', partner))),
              const SizedBox(width: 8),
              Expanded(child: _info(Icons.schedule_outlined, 'وقت التوفّر', 'Available', _availOf(_meta, it, partner))),
            ]),
            const SizedBox(height: 14),
            Text(_bx(partner, 'صور العطل (${files.length})', 'Fault media (${files.length})'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (files.isEmpty) Text(_bx(partner, 'لا مرفقات', 'No attachments'), style: const TextStyle(color: T.inkSoft)),
            if (files.isNotEmpty)
              GridView.count(
                crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 6, crossAxisSpacing: 6,
                children: [
                  for (var i = 0; i < files.length; i++)
                    GestureDetector(
                      onTap: () => _viewFile(files, i),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: (files[i] as Map)['kind'] == 'video'
                            ? Container(color: T.navy, child: const Center(child: Icon(Icons.play_circle_fill_rounded, color: Colors.white, size: 40)))
                            : Image.network(_url('${(files[i] as Map)['fileUrl']}'), fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: T.line)),
                      ),
                    ),
                ],
              ),
            if (_can?['create'] == true && files.length < 5) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _busy.isEmpty ? _addFiles : null,
                icon: _busy == 'files' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_photo_alternate_outlined),
                label: Text(tr('إرفاق صور أو فيديو', 'Attach photos or video')),
              ),
            ],
            if (statuses.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(_bx(partner, 'تحديث الحالة', 'Update status'), style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final s in statuses)
                  ActionChip(
                    onPressed: _busy.isEmpty ? () => _setStatus(s) : null,
                    avatar: _busy == 's:$s' ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(s == 'fixed' ? Icons.check_circle : Icons.circle, size: 14, color: _statusColor(s)),
                    label: Text(_vocab(_meta, 'status', s, partner), style: TextStyle(color: _statusColor(s), fontWeight: FontWeight.w800)),
                    backgroundColor: _statusColor(s).withValues(alpha: 0.08),
                    side: BorderSide(color: _statusColor(s).withValues(alpha: 0.3)),
                  ),
              ]),
            ],
            const SizedBox(height: 16),
            Text(_bx(partner, 'مسار البلاغ', 'Timeline'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            for (final h in history)
              ListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.circle, size: 12, color: _statusColor('${h['status']}')),
                title: Text(_vocab(_meta, 'status', '${h['status']}', partner), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${h['side'] == 'mediago' ? 'Media Go' : 'Energize'}${(h['byName'] ?? '').toString().isNotEmpty ? ' · ${h['byName']}' : ''} · ${_when(h['at'])}${(h['note'] ?? '').toString().isNotEmpty ? '\n${h['note']}' : ''}'),
              ),
            const SizedBox(height: 10),
            Text(_bx(partner, 'الردود (${replies.length})', 'Replies (${replies.length})'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            if (replies.isEmpty) Text(_bx(partner, 'لا ردود بعد', 'No replies yet'), style: const TextStyle(color: T.inkSoft)),
            for (final r in replies)
              Align(
                alignment: ((r['side'] == 'mediago') == partner) ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  constraints: const BoxConstraints(maxWidth: 300),
                  decoration: BoxDecoration(
                    color: r['side'] == 'mediago' ? const Color(0xFFF5F3FF) : const Color(0xFFFFF7ED),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: r['side'] == 'mediago' ? const Color(0xFFEDE9FE) : const Color(0xFFFFEDD5)),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${r['side'] == 'mediago' ? 'Media Go' : 'Energize'}${(r['byName'] ?? '').toString().isNotEmpty ? ' · ${r['byName']}' : ''}', style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text('${r['text']}'),
                    const SizedBox(height: 2),
                    Text(_when(r['at']), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                  ]),
                ),
              ),
            if (_can?['delete'] == true)
              TextButton.icon(onPressed: _delete, icon: const Icon(Icons.delete_outline, color: T.danger), label: Text(tr('حذف البلاغ', 'Delete complaint'), style: const TextStyle(color: T.danger))),
          ]),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: T.line))),
            child: Row(children: [
              Expanded(child: TextField(
                controller: _reply, minLines: 1, maxLines: 4,
                decoration: InputDecoration(hintText: _bx(partner, 'اكتب ردًّا…', 'Write a reply…'), isDense: true, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
              )),
              const SizedBox(width: 8),
              IconButton.filled(
                style: IconButton.styleFrom(backgroundColor: T.orange),
                onPressed: _busy.isEmpty ? _sendReply : null,
                icon: _busy == 'reply' ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded, color: Colors.white),
              ),
            ]),
          ),
        ),
      ]);
    }
    return Scaffold(
      appBar: AppBar(title: Text(it == null ? 'Media Go' : '${it['ref']}')),
      body: body,
    );
  }
}

class _Gallery extends StatelessWidget {
  final List<String> urls;
  final int start;
  const _Gallery({required this.urls, required this.start});
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: PageView.builder(
          controller: PageController(initialPage: start),
          itemCount: urls.length,
          itemBuilder: (_, i) => InteractiveViewer(child: Center(child: Image.network(urls[i], fit: BoxFit.contain))),
        ),
      );
}

// ═════════════════════════════════════════════════════════════════════════
// المرفقات — صورٌ ومقاطع، من المعرض أو الكاميرا
// ═════════════════════════════════════════════════════════════════════════
class MgPicked {
  final String dataUrl;
  final String fileName;
  final int size;
  final bool video;
  const MgPicked(this.dataUrl, this.fileName, this.size, this.video);
  Map<String, dynamic> toJson() => {'dataUrl': dataUrl, 'fileName': fileName};
}

const _mb = 1024 * 1024;
const _mime = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif', 'heic': 'image/heic',
  'mp4': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', '3gp': 'video/3gpp', 'm4v': 'video/x-m4v',
};

/// يختار صورًا أو مقاطع ويرجّعها جاهزةً للإرسال — بحدود الخادم نفسِها:
/// صورةٌ حتى ٨ ميغا، مقطعٌ حتى ١٥، والمجموعُ ١٨ في المرّة الواحدة.
Future<List<MgPicked>> pickMediaFiles(BuildContext context, {int room = 5, bool partner = false, int already = 0}) async {
  if (room <= 0) return const [];
  final src = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(tr('التقاط صورة', 'Take a photo')), onTap: () => Navigator.pop(c, 'photo')),
      ListTile(leading: const Icon(Icons.videocam_outlined), title: Text(tr('تصوير فيديو قصير', 'Record a short video')), onTap: () => Navigator.pop(c, 'video')),
      ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(tr('من المعرض', 'From gallery')), onTap: () => Navigator.pop(c, 'gallery')),
    ])),
  );
  if (src == null) return const [];
  final out = <MgPicked>[];
  String? problem;
  void add(List<int> bytes, String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    final mime = _mime[ext];
    if (mime == null) { problem = tr('نوع غير مدعوم: $name', 'Unsupported file: $name'); return; }
    final video = mime.startsWith('video/');
    final cap = video ? 15 : 8;
    if (bytes.length > cap * _mb) { problem = tr('«$name» أكبر من $cap ميغا', '“$name” is larger than $cap MB'); return; }
    final total = already + out.fold<int>(0, (n, f) => n + f.size) + bytes.length;
    if (total > 18 * _mb) { problem = tr('المجموع يتجاوز 18 ميغا — أرفق الباقي بعد الحفظ', 'Over 18 MB — add the rest after saving'); return; }
    if (out.length >= room) { problem = tr('الحدّ $room ملفّات', 'At most $room files'); return; }
    out.add(MgPicked('data:$mime;base64,${base64Encode(bytes)}', name, bytes.length, video));
  }

  try {
    if (src == 'photo') {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, maxHeight: 1600, imageQuality: 82);
      if (x != null) add(await x.readAsBytes(), x.name.toLowerCase().endsWith('.jpg') || x.name.toLowerCase().endsWith('.jpeg') ? x.name : '${x.name}.jpg');
    } else if (src == 'video') {
      final x = await ImagePicker().pickVideo(source: ImageSource.camera, maxDuration: const Duration(seconds: 20));
      if (x != null) add(await x.readAsBytes(), x.name.contains('.') ? x.name : '${x.name}.mp4');
    } else {
      final res = await FilePicker.platform.pickFiles(withData: true, allowMultiple: true, type: FileType.media);
      for (final f in res?.files ?? const <PlatformFile>[]) {
        if (f.bytes != null) add(f.bytes!, f.name);
      }
    }
  } catch (e) {
    problem = e.toString();
  }
  if (problem != null && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem!)));
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// رفعُ بلاغ — أسئلةُ نموذج Media Go نفسُها
// ═════════════════════════════════════════════════════════════════════════
class MediaGoCreateScreen extends StatefulWidget {
  final Map? meta;
  const MediaGoCreateScreen({super.key, this.meta});
  @override
  State<MediaGoCreateScreen> createState() => _MediaGoCreateScreenState();
}

class _MediaGoCreateScreenState extends State<MediaGoCreateScreen> {
  Map? _meta;
  final _moto = TextEditingController();
  final _screen = TextEditingController();
  final _issueOther = TextEditingController();
  final _availOther = TextEditingController();
  String _vehicle = '';
  String _vehicleHint = '';
  String _issue = '';
  String _location = '';
  String _availability = '';
  final List<MgPicked> _files = [];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _meta = widget.meta;
    if (_meta == null) {
      Api.instance.get('$_api/meta').then((d) { if (mounted) setState(() => _meta = (d as Map)['meta'] as Map?); }).catchError((_) {});
    }
  }

  @override
  void dispose() {
    _moto.dispose(); _screen.dispose(); _issueOther.dispose(); _availOther.dispose();
    super.dispose();
  }

  Future<void> _pickMoto() async {
    final picked = await showModalBottomSheet<Map>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (c) => const _MotoSheet(),
    );
    if (picked == null) return;
    setState(() {
      _vehicle = '${picked['_id']}';
      _moto.text = '${(picked['plateNumber'] ?? '').toString().isNotEmpty ? picked['plateNumber'] : picked['serialNumber']}';
      _vehicleHint = [if ('${picked['serialNumber'] ?? ''}'.isNotEmpty) '#${picked['serialNumber']}', '${picked['project'] ?? ''}', '${picked['driverName'] ?? ''}'].where((x) => x.isNotEmpty).join(' · ');
    });
  }

  List<String> get _missing => [
        if (_moto.text.trim().isEmpty) tr('رقم الدبّاب', 'Motorcycle number'),
        if (_issue.isEmpty) tr('المشكلة', 'Issue'),
        if (_issue == 'other' && _issueOther.text.trim().isEmpty) tr('وصف المشكلة', 'Issue description'),
        if (_location.isEmpty) tr('موقع الصيانة', 'Maintenance location'),
        if (_availability.isEmpty) tr('وقت التوفّر', 'Availability'),
        if (_availability == 'other' && _availOther.text.trim().isEmpty) tr('الوقت المناسب', 'Preferred time'),
      ];

  Future<void> _submit() async {
    final miss = _missing;
    if (miss.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${tr('أكمل', 'Complete')}: ${miss.join('، ')}')));
      return;
    }
    setState(() => _saving = true);
    try {
      final r = await Api.instance.postLong(_api, {
        if (_vehicle.isNotEmpty) 'vehicle': _vehicle,
        'motorcycleNumber': _moto.text.trim(),
        'screenNumber': _screen.text.trim(),
        'issue': _issue, 'issueOther': _issueOther.text.trim(),
        'location': _location,
        'availability': _availability, 'availabilityOther': _availOther.text.trim(),
        'files': _files.map((f) => f.toJson()).toList(),
      });
      if (!mounted) return;
      final item = (r as Map)['item'] as Map;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('رُفع البلاغ ${item['ref']}', 'Complaint ${item['ref']} submitted'))));
      Navigator.pop(context, '${item['_id']}');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
    if (mounted) setState(() => _saving = false);
  }

  Widget _q(String ar, String en, {bool required = false, required Widget child}) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text.rich(TextSpan(children: [
            TextSpan(text: ar, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
            if (required) const TextSpan(text: ' *', style: TextStyle(color: T.danger, fontWeight: FontWeight.w800)),
            TextSpan(text: '   $en', style: const TextStyle(color: T.inkFaint, fontSize: 11.5)),
          ])),
          const SizedBox(height: 8),
          child,
        ]),
      );

  Widget _choices(String group, String value, void Function(String) onPick) {
    final items = List<Map>.from((_meta?[group] as List?) ?? const []);
    return Column(children: [
      for (final o in items)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => setState(() => onPick('${o['key']}')),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: value == o['key'] ? T.orange.withValues(alpha: 0.08) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: value == o['key'] ? T.orange : T.line, width: value == o['key'] ? 1.5 : 1),
              ),
              child: Row(children: [
                Icon(value == o['key'] ? Icons.radio_button_checked : Icons.radio_button_off, size: 20, color: value == o['key'] ? T.orange : T.inkFaint),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${o['ar']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('${o['en']}', textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                ])),
              ]),
            ),
          ),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final dec = InputDecoration(filled: true, fillColor: Colors.white, isDense: true, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)));
    return Scaffold(
      appBar: AppBar(title: Text(tr('بلاغ عطل شاشة', 'Screen fault report'))),
      body: _meta == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 100), children: [
              _q('رقم الدبّاب', 'Motorcycle Number', required: true, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                TextField(
                  controller: _moto,
                  onChanged: (_) => setState(() { _vehicle = ''; _vehicleHint = ''; }),
                  decoration: dec.copyWith(
                    prefixIcon: const Icon(Icons.two_wheeler_outlined),
                    hintText: tr('اكتب الرقم أو اختر من السجلّ', 'Type the number or pick from the register'),
                    suffixIcon: IconButton(icon: const Icon(Icons.search_rounded), tooltip: tr('من سجلّ المركبات', 'From the register'), onPressed: _pickMoto),
                  ),
                ),
                const SizedBox(height: 4),
                if (_vehicle.isNotEmpty) Text('✓ ${tr('من سجلّ المركبات', 'From the vehicle register')}${_vehicleHint.isNotEmpty ? ' — $_vehicleHint' : ''}', style: const TextStyle(color: T.success, fontSize: 11.5, fontWeight: FontWeight.w700))
                else if (_moto.text.trim().isNotEmpty) Text(tr('سيُحفظ كما كُتب (غير مربوط بالسجلّ)', 'Saved as typed (not linked)'), style: const TextStyle(color: T.inkSoft, fontSize: 11.5)),
              ])),
              _q('رقم الشاشة', 'Screen Number', child: TextField(controller: _screen, decoration: dec)),
              _q('صورة العطل', 'Photo of the Fault', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (var i = 0; i < _files.length; i++)
                    Stack(children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: _files[i].video
                            ? Container(width: 80, height: 80, color: T.navy, child: const Icon(Icons.videocam, color: Colors.white))
                            : Image.memory(base64Decode(_files[i].dataUrl.split(',').last), width: 80, height: 80, fit: BoxFit.cover),
                      ),
                      PositionedDirectional(top: 2, end: 2, child: InkWell(
                        onTap: () => setState(() => _files.removeAt(i)),
                        child: Container(padding: const EdgeInsets.all(2), decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle), child: const Icon(Icons.close, size: 14, color: Colors.white)),
                      )),
                    ]),
                  if (_files.length < 5)
                    InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () async {
                        final more = await pickMediaFiles(context, room: 5 - _files.length, already: _files.fold(0, (n, f) => n + f.size));
                        if (more.isNotEmpty) setState(() => _files.addAll(more));
                      },
                      child: Container(
                        width: 80, height: 80,
                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: T.inkFaint)),
                        child: const Icon(Icons.add_a_photo_outlined, color: T.inkSoft),
                      ),
                    ),
                ]),
                const SizedBox(height: 6),
                Text(tr('حتى 5 ملفات — صورة حتى 8 ميغا، فيديو قصير حتى 15 ميغا، والمجموع 18 ميغا', 'Up to 5 files — image ≤ 8 MB, short video ≤ 15 MB, 18 MB in total'), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              ])),
              _q('المشكلة', 'Issue', required: true, child: Column(children: [
                _choices('issue', _issue, (k) => _issue = k),
                if (_issue == 'other') TextField(controller: _issueOther, onChanged: (_) => setState(() {}), decoration: dec.copyWith(hintText: tr('صف المشكلة', 'Describe the issue'))),
              ])),
              _q('موقع الصيانة', 'Maintenance Location', required: true, child: _choices('location', _location, (k) => _location = k)),
              _q('وقت توفّر الدبّاب في المقر', 'Time the Motorcycle Will Be Available', required: true, child: Column(children: [
                _choices('availability', _availability, (k) => _availability = k),
                if (_availability == 'other') TextField(controller: _availOther, onChanged: (_) => setState(() {}), decoration: dec.copyWith(hintText: tr('اكتب الوقت المناسب', 'Write the preferred time'))),
              ])),
            ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.orange),
            onPressed: _saving ? null : _submit,
            icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded),
            label: Text(_saving ? tr('جارٍ الرفع…', 'Uploading…') : tr('رفع البلاغ', 'Submit')),
          ),
        ),
      ),
    );
  }
}

/// بحثٌ في دبّابات النقل الخفيف من سجلّ المركبات.
class _MotoSheet extends StatefulWidget {
  const _MotoSheet();
  @override
  State<_MotoSheet> createState() => _MotoSheetState();
}

class _MotoSheetState extends State<_MotoSheet> {
  List<Map> _items = [];
  bool _busy = true;
  Timer? _t;
  int _seq = 0;

  @override
  void initState() { super.initState(); _search(''); }
  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _search(String q) async {
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.get('$_api/motorcycles?q=${Uri.encodeQueryComponent(q)}');
      if (!mounted || mine != _seq) return;
      setState(() { _items = List<Map>.from((d as Map)['items'] ?? const []); _busy = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() { _items = []; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
            child: TextField(
              autofocus: true,
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: tr('اللوحة أو التسلسلي أو السائق', 'Plate, serial or rider'), isDense: true, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
              onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 300), () => _search(v.trim())); },
            ),
          ),
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: _items.isEmpty && !_busy
                ? Center(child: Text(tr('لا نتائج — اكتب الرقم يدويًّا', 'No match — type the number manually'), style: const TextStyle(color: T.inkSoft)))
                : ListView.separated(
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final o = _items[i];
                      return ListTile(
                        leading: const Icon(Icons.two_wheeler_outlined, color: T.navy),
                        title: Text('${(o['plateNumber'] ?? '').toString().isEmpty ? '—' : o['plateNumber']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Text([if ('${o['serialNumber'] ?? ''}'.isNotEmpty) '#${o['serialNumber']}', '${o['project'] ?? ''}', '${o['driverName'] ?? ''}'].where((x) => x.isNotEmpty).join(' · ')),
                        onTap: () => Navigator.pop(context, o),
                      );
                    },
                  ),
          ),
        ]),
      ),
    );
  }
}
