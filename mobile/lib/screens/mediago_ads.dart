// المحتوى الإعلانيّ — صفحةٌ مشتركةٌ مع Media Go (كالموقع: /system/b2c/mediago-ads، ٢٠٢٦/١٠/٢٢).
//
// Media Go تطلب تصويرَ إعلانٍ على مركباتنا، ونحن نصوّر لكلّ مركبةٍ تحقّقَها (صورًا أو
// فيديو حتى ١٥ ثانية) ونراجعه ثمّ «تمّ» فيصلها مركبةً مركبة، وتردّ بملاحظة.
// والحسابُ كلُّه في الخادم (backend/controllers/mediagoAdController).
import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

const _api = '/api/b2c/mediago-ads';
String _url(String u) => u.startsWith('http') ? u : '${AppConfig.apiBase}$u';
List<Map<String, dynamic>> _maps(dynamic v) => v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];

String _v(Map? meta, String group, String key) {
  for (final x in _maps(meta?[group])) {
    if (x['key'] == key) return tr('${x['ar']}', '${x['en']}');
  }
  return key;
}

Color _tone(String s) => switch (s) {
      'new' => T.info,
      'in_progress' => T.warn,
      'delivered' => T.success,
      'cancelled' => T.danger,
      _ => T.inkSoft,
    };

class MediaGoAdsScreen extends StatefulWidget {
  const MediaGoAdsScreen({super.key, this.embedded = false});
  /// داخلَ بيتِ حساب Media Go (له شريطُه) — بلا قائمةٍ جانبيّة.
  final bool embedded;
  @override
  State<MediaGoAdsScreen> createState() => _MediaGoAdsScreenState();
}

class _MediaGoAdsScreenState extends State<MediaGoAdsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  final Map<String, String> _f = {};
  final _q = TextEditingController();
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('mediago:ad', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('mediago:ad', _onLive);
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = [for (final e in _f.entries) if (e.value.isNotEmpty) '${e.key}=${Uri.encodeQueryComponent(e.value)}', if (_q.text.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.text.trim())}'];
      final d = Map<String, dynamic>.from(await Api.instance.get('$_api${qs.isEmpty ? '' : '?${qs.join('&')}'}'));
      if (mounted && mine == _seq) setState(() { _d = d; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  void _set(String k, String v) { setState(() => _f[k] = _f[k] == v ? '' : v); _load(); }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final meta = d == null ? null : Map<String, dynamic>.from(d['meta'] ?? {});
    final can = d == null ? const <String, dynamic>{} : Map<String, dynamic>.from(d['can'] ?? {});
    final counts = d == null ? const <String, dynamic>{} : Map<String, dynamic>.from(d['counts'] ?? {});
    int c(String g, String k) => ((counts[g] as Map?)?[k] as num?)?.toInt() ?? 0;
    final items = _maps(d?['items']);
    Widget chip(String label, bool on, VoidCallback tap, {IconData? icon}) => Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: FilterChip(
            selected: on, onSelected: (_) => tap(),
            avatar: icon == null ? null : Icon(icon, size: 15, color: on ? Colors.white : T.inkSoft),
            label: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
            selectedColor: T.navy, side: BorderSide.none, showCheckmark: false,
          ),
        );
    final body = _error != null
        ? ErrorRetry(message: _error!, onRetry: _load)
        : d == null
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)])
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                  TextField(controller: _q, onChanged: (_) => _load(),
                      decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('ابحث بالإعلان أو الطلب أو اللوحة…', 'Search ad, request or plate…'))),
                  const SizedBox(height: 8),
                  SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                    for (final s in _maps(meta?['status']))
                      chip('${tr('${s['ar']}', '${s['en']}')} ${c('status', '${s['key']}')}', _f['status'] == s['key'], () => _set('status', '${s['key']}')),
                  ])),
                  SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                    for (final co in _maps(meta?['companies']))
                      chip('${tr('${co['nameAr']}', '${co['nameEn']}')} ${c('company', '${co['nameAr']}')}', _f['company'] == co['nameAr'], () => _set('company', '${co['nameAr']}'), icon: Icons.business_outlined),
                    for (final m in _maps(meta?['mediaType']))
                      chip('${tr('${m['ar']}', '${m['en']}')} ${c('mediaType', '${m['key']}')}', _f['mediaType'] == m['key'], () => _set('mediaType', '${m['key']}'), icon: m['key'] == 'video' ? Icons.videocam_outlined : Icons.photo_camera_outlined),
                    for (final m in _maps(meta?['location']))
                      chip('${tr('${m['ar']}', '${m['en']}')} ${c('location', '${m['key']}')}', _f['location'] == m['key'], () => _set('location', '${m['key']}'), icon: Icons.place_outlined),
                  ])),
                  const SizedBox(height: 8),
                  if (items.isEmpty) Padding(padding: const EdgeInsets.all(30), child: EmptyState(icon: Icons.movie_outlined, title: tr('لا طلبات هنا', 'No requests here'))),
                  for (final r in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: InkWell(
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MediaGoAdDetailScreen(id: '${r['_id']}'))).then((_) => _load()),
                        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          if ('${r['cover'] ?? ''}'.isNotEmpty)
                            ClipRRect(borderRadius: BorderRadius.circular(10), child: AspectRatio(aspectRatio: 16 / 7, child: Image.network(_url('${r['cover']}'), fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: T.line)))),
                          const SizedBox(height: 6),
                          Row(children: [
                            Expanded(child: Text('${r['adName']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))),
                            Chip2(_v(meta, 'status', '${r['status']}'), _tone('${r['status']}')),
                          ]),
                          Text('${r['ref']} · ${r['company']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                          const SizedBox(height: 6),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2(_v(meta, 'mediaType', '${r['mediaType']}'), T.violet),
                            Chip2(_v(meta, 'location', '${r['location']}'), T.info),
                            if ((r['vehicleCount'] ?? 0) > 0) Chip2('${r['readyCount']}/${r['vehicleCount']} ${tr('جاهزة', 'ready')}', T.success, icon: Icons.directions_car_outlined),
                            if ('${r['neededBy'] ?? ''}'.isNotEmpty) Chip2('${r['neededBy']}', T.warn, icon: Icons.event),
                          ]),
                        ])),
                      ),
                    ),
                ]),
              );
    final fab = can['create'] == true
        ? FloatingActionButton.extended(
            onPressed: () async {
              final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => MediaGoAdCreateScreen(meta: meta)));
              if (ok == true) _load();
            },
            icon: const Icon(Icons.add), label: Text(tr('طلب جديد', 'New request')))
        : null;
    if (widget.embedded) return Scaffold(body: body, floatingActionButton: fab);
    return AppScaffold(title: Text(tr('المحتوى الإعلاني', 'Ad content')), body: body, floatingActionButton: fab);
  }
}

// ── طلبٌ جديد ────────────────────────────────────────────────────────────────
class MediaGoAdCreateScreen extends StatefulWidget {
  const MediaGoAdCreateScreen({super.key, this.meta});
  final Map? meta;
  @override
  State<MediaGoAdCreateScreen> createState() => _MediaGoAdCreateScreenState();
}

class _MediaGoAdCreateScreenState extends State<MediaGoAdCreateScreen> {
  final _name = TextEditingController(), _note = TextEditingController(), _vq = TextEditingController();
  String _company = '', _media = '', _loc = '', _date = '';
  final List<Map<String, dynamic>> _picked = [];
  List<Map<String, dynamic>> _opts = const [];
  bool _busy = false;

  Future<void> _search() async {
    try {
      final d = await Api.instance.get('$_api/vehicles${_vq.text.trim().isEmpty ? '' : '?q=${Uri.encodeQueryComponent(_vq.text.trim())}'}');
      if (mounted) setState(() => _opts = _maps(d['items']));
    } catch (_) {}
  }

  Future<void> _submit() async {
    final miss = [
      if (_name.text.trim().isEmpty) tr('اسم الإعلان', 'Ad name'),
      if (_company.isEmpty) tr('الشركة', 'Company'),
      if (_company == 'energize' && _picked.isEmpty) tr('المركبات', 'Vehicles'),
      if (_media.isEmpty) tr('صور أم فيديو', 'Photo or video'),
      if (_loc.isEmpty) tr('بالإيواء أم بالطريق', 'Shelter or road'),
    ];
    if (miss.isNotEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${tr('أكمل', 'Complete')}: ${miss.join('، ')}'))); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.post(_api, {
        'adName': _name.text.trim(), 'companyKey': _company, 'mediaType': _media, 'location': _loc,
        'note': _note.text.trim(), 'neededBy': _date, 'vehicleIds': _company == 'energize' ? [for (final v in _picked) v['_id']] : [],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  Widget _pick(String label, List<Map<String, dynamic>> opts, String value, ValueChanged<String> on, {String k = 'key', String a = 'ar', String e = 'en'}) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final o in opts) ChoiceChip(label: Text(tr('${o[a]}', '${o[e]}')), selected: value == o[k], onSelected: (_) => on('${o[k]}')),
          ]),
          const SizedBox(height: 12),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final meta = widget.meta;
    return Scaffold(
      appBar: AppBar(title: Text(tr('طلب محتوى إعلاني', 'Ad content request'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _name, decoration: InputDecoration(labelText: tr('اسم الإعلان *', 'Ad name *'))),
        const SizedBox(height: 14),
        _pick(tr('الطلب لأيّ شركة؟ *', 'For which company? *'), _maps(meta?['companies']), _company, (v) { setState(() { _company = v; if (v != 'energize') _picked.clear(); }); if (v == 'energize') _search(); }, a: 'nameAr', e: 'nameEn'),
        if (_company == 'energize') ...[
          Text('${tr('المركبات *', 'Vehicles *')} (${_picked.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          if (_picked.isNotEmpty) Wrap(spacing: 6, children: [for (final v in _picked) InputChip(label: Text('${v['plateNumber']}'), onDeleted: () => setState(() => _picked.remove(v)))]),
          TextField(controller: _vq, onChanged: (_) => _search(), decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('ابحث باللوحة أو التسلسلي…', 'Search plate or serial…'))),
          SizedBox(height: 220, child: ListView(children: [
            for (final v in _opts) CheckboxListTile(
              dense: true, value: _picked.any((x) => x['_id'] == v['_id']),
              onChanged: (on) => setState(() => on == true ? _picked.add(v) : _picked.removeWhere((x) => x['_id'] == v['_id'])),
              title: Text('${v['plateNumber']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([if ('${v['serialNumber']}'.isNotEmpty) '#${v['serialNumber']}', '${v['project'] ?? ''}'].where((x) => x.isNotEmpty).join(' · ')),
            ),
          ])),
          const SizedBox(height: 12),
        ],
        _pick(tr('المطلوب *', 'Needed *'), _maps(meta?['mediaType']), _media, (v) => setState(() => _media = v)),
        _pick(tr('مكان التصوير *', 'Where *'), _maps(meta?['location']), _loc, (v) => setState(() => _loc = v)),
        TextField(controller: _note, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          icon: const Icon(Icons.event),
          label: Text(_date.isEmpty ? tr('التاريخ (اختياري)', 'Date (optional)') : _date),
          onPressed: () async {
            final x = await showDatePicker(context: context, firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now());
            if (x != null) setState(() => _date = '${x.year}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}');
          },
        ),
        const SizedBox(height: 18),
        FilledButton.icon(onPressed: _busy ? null : _submit, icon: const Icon(Icons.send), label: Text(tr('إرسال الطلب', 'Send request'))),
      ]),
    );
  }
}

// ── الطلبُ مفتوحًا ───────────────────────────────────────────────────────────
class MediaGoAdDetailScreen extends StatefulWidget {
  const MediaGoAdDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<MediaGoAdDetailScreen> createState() => _MediaGoAdDetailScreenState();
}

class _MediaGoAdDetailScreenState extends State<MediaGoAdDetailScreen> {
  Map<String, dynamic>? _d, _meta, _can;
  String _busy = '';
  final _reply = TextEditingController();
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('mediago:ad', _onLive);
  }

  @override
  void dispose() { Live.instance.off('mediago:ad', _onLive); _reply.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final r = Map<String, dynamic>.from(await Api.instance.get('$_api/${widget.id}'));
      if (mounted) setState(() { _d = Map<String, dynamic>.from(r['item']); _meta = Map<String, dynamic>.from(r['meta'] ?? {}); _can = Map<String, dynamic>.from(r['can'] ?? {}); });
    } catch (e) {
      if (mounted) Navigator.pop(context);
    }
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _run(String key, Future<dynamic> Function() f) async {
    setState(() => _busy = key);
    try {
      final r = await f();
      if (r is Map && r['item'] is Map && mounted) setState(() => _d = Map<String, dynamic>.from(r['item']));
    } catch (e) { _say(e.toString()); }
    if (mounted) setState(() => _busy = '');
  }

  /// تصويرٌ أو اختيار: صورٌ عدّة، أو فيديو تقطعه الكاميرا عند ١٥ ثانية.
  Future<void> _shoot(String url, String want) async {
    final files = <Map<String, dynamic>>[];
    final src = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: Icon(want == 'video' ? Icons.videocam : Icons.photo_camera), title: Text(want == 'video' ? tr('تصوير فيديو (١٥ ثانية على الأكثر)', 'Record video (max 15s)') : tr('تصوير بالكاميرا', 'Take photos')), onTap: () => Navigator.pop(c, 'camera')),
      ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(tr('من المعرض', 'From gallery')), onTap: () => Navigator.pop(c, 'gallery')),
    ])));
    if (src == null) return;
    try {
      if (want == 'video') {
        if (src == 'camera') {
          final x = await ImagePicker().pickVideo(source: ImageSource.camera, maxDuration: const Duration(seconds: 15));
          if (x != null) files.add({'dataUrl': 'data:video/mp4;base64,${base64Encode(await x.readAsBytes())}', 'fileName': x.name, 'durationSec': 15});
        } else {
          final res = await FilePicker.platform.pickFiles(withData: true, type: FileType.video);
          final f = res?.files.firstOrNull;
          if (f?.bytes != null) files.add({'dataUrl': 'data:video/mp4;base64,${base64Encode(f!.bytes!)}', 'fileName': f.name});
        }
      } else {
        if (src == 'camera') {
          final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1800, maxHeight: 1800, imageQuality: 85);
          if (x != null) files.add({'dataUrl': 'data:image/jpeg;base64,${base64Encode(await x.readAsBytes())}', 'fileName': x.name});
        } else {
          final xs = await ImagePicker().pickMultiImage(maxWidth: 1800, maxHeight: 1800, imageQuality: 85);
          for (final x in xs) { files.add({'dataUrl': 'data:image/jpeg;base64,${base64Encode(await x.readAsBytes())}', 'fileName': x.name}); }
        }
      }
    } catch (e) { _say(e.toString()); return; }
    if (files.isEmpty) return;
    await _run('up', () => Api.instance.post(url, {'files': files}));
  }

  Future<String?> _ask(String title, {bool required = false}) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (x) => AlertDialog(
      title: Text(title), content: TextField(controller: c, maxLines: 2, decoration: InputDecoration(hintText: required ? tr('السبب (مطلوب)', 'Reason (required)') : tr('ملاحظة (اختياري)', 'Note (optional)'))),
      actions: [TextButton(onPressed: () => Navigator.pop(x, false), child: Text(tr('إلغاء', 'Cancel'))), FilledButton(onPressed: () => Navigator.pop(x, true), child: Text(tr('تأكيد', 'Confirm')))],
    ));
    if (ok != true) return null;
    if (required && c.text.trim().isEmpty) { _say(tr('اكتب السبب', 'Write the reason')); return null; }
    return c.text.trim();
  }

  Widget _thumbs(List<Map<String, dynamic>> files, {String? delBase}) => Wrap(spacing: 6, runSpacing: 6, children: [
        for (final f in files)
          GestureDetector(
            onTap: () => launchUrl(Uri.parse(_url('${f['fileUrl']}')), mode: LaunchMode.externalApplication),
            onLongPress: delBase == null ? null : () async {
              final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(content: Text(tr('حذف هذا الملف؟', 'Delete this file?')), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('لا', 'No'))), TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete')))]));
              if (ok == true) await _run('del', () => Api.instance.delete('$delBase/${f['_id']}'));
            },
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(width: 78, height: 78, child: f['kind'] == 'video'
                  ? Container(color: T.ink, child: const Center(child: Icon(Icons.play_circle_fill, color: Colors.white, size: 32)))
                  : Image.network(_url('${f['fileUrl']}'), fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: T.line))),
            ),
          ),
      ]);

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final can = _can ?? const {};
    final editable = ['new', 'in_progress'].contains(d['status']);
    final items = _maps(d['items']);
    final allReady = items.isNotEmpty ? items.every((i) => i['ready'] == true) : _maps(d['files']).isNotEmpty;
    final base = '$_api/${widget.id}';
    return Scaffold(
      appBar: AppBar(title: Text('${d['ref']}')),
      body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(14), children: [
        Text('${d['adName']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2(_v(_meta, 'status', '${d['status']}'), _tone('${d['status']}')),
          Chip2('${d['company']}', T.navy, icon: Icons.business_outlined),
          Chip2(_v(_meta, 'mediaType', '${d['mediaType']}'), T.violet),
          Chip2(_v(_meta, 'location', '${d['location']}'), T.info),
          if ('${d['neededBy'] ?? ''}'.isNotEmpty) Chip2('${d['neededBy']}', T.warn, icon: Icons.event),
        ]),
        if ('${d['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${d['note']}', style: const TextStyle(color: T.inkSoft))),
        const SizedBox(height: 10),
        if (can['deliver'] == true && editable)
          FilledButton.icon(
            onPressed: !allReady || _busy.isNotEmpty ? null : () async { final n = await _ask(tr('تمّ — إرسال إلى Media Go', 'Done — send to Media Go')); if (n != null) await _run('deliver', () => Api.instance.post('$base/deliver', {'note': n})); },
            icon: const Icon(Icons.check_circle), label: Text(allReady ? tr('تمّ — إرسال إلى Media Go', 'Done — send to Media Go') : tr('راجع كل المركبات أوّلًا', 'Review every vehicle first')),
          ),
        Wrap(spacing: 8, children: [
          if (can['close'] == true && d['status'] == 'delivered') OutlinedButton(onPressed: () => _run('s', () => Api.instance.patch('$base/status', {'status': 'closed'})), child: Text(tr('إغلاق', 'Close'))),
          if (can['close'] == true && ['delivered', 'closed'].contains(d['status'])) OutlinedButton(onPressed: () async { final n = await _ask(tr('إعادة فتح', 'Reopen'), required: true); if (n != null) await _run('s', () => Api.instance.patch('$base/status', {'status': 'in_progress', 'note': n})); }, child: Text(tr('إعادة فتح', 'Reopen'))),
          if (can['cancel'] == true && editable) TextButton(onPressed: () => _run('s', () => Api.instance.patch('$base/status', {'status': 'cancelled'})), child: Text(tr('إلغاء الطلب', 'Cancel request'), style: const TextStyle(color: T.danger))),
        ]),
        const SizedBox(height: 8),
        for (final it in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              topAccent: it['ready'] == true ? T.success : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.directions_car_outlined, size: 18, color: T.inkFaint), const SizedBox(width: 6),
                  Expanded(child: Text('${it['plateNumber']}', style: const TextStyle(fontWeight: FontWeight.w800))),
                  Chip2(it['ready'] == true ? tr('جاهزة', 'Ready') : (_maps(it['files']).isEmpty ? tr('لم تُصوَّر', 'Not shot') : tr('بانتظار المراجعة', 'To review')), it['ready'] == true ? T.success : T.inkSoft),
                ]),
                Text([if ('${it['serialNumber']}'.isNotEmpty) '#${it['serialNumber']}', '${it['project'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                const SizedBox(height: 8),
                if (can['shoot'] == true && editable && _maps(it['files']).isEmpty)
                  Wrap(spacing: 6, children: [
                    for (final m in const ['photo', 'video'])
                      ChoiceChip(label: Text(_v(_meta, 'mediaType', m)), selected: it['mediaType'] == m,
                          onSelected: (_) => _run('i', () => Api.instance.patch('$base/items/${it['_id']}', {'mediaType': m}))),
                  ]),
                if (_maps(it['files']).isNotEmpty) _thumbs(_maps(it['files']), delBase: can['shoot'] == true && editable ? '$base/items/${it['_id']}/files' : null)
                else Text(tr('لا ملفات بعد', 'No files yet'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                if (can['shoot'] == true && editable) Row(children: [
                  TextButton.icon(onPressed: _busy.isNotEmpty ? null : () => _shoot('$base/items/${it['_id']}/files', '${it['mediaType']}'),
                      icon: Icon(it['mediaType'] == 'video' ? Icons.videocam : Icons.photo_camera), label: Text(tr('تصوير / رفع', 'Shoot / upload'))),
                  if (_maps(it['files']).isNotEmpty) TextButton.icon(
                      onPressed: () => _run('i', () => Api.instance.patch('$base/items/${it['_id']}', {'ready': it['ready'] != true})),
                      icon: const Icon(Icons.check), label: Text(it['ready'] == true ? tr('إلغاء «جاهزة»', 'Unmark') : tr('راجعتُها — جاهزة', 'Reviewed — ready'))),
                ]),
              ]),
            ),
          ),
        if (items.isEmpty) AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('المحتوى', 'Content'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          _maps(d['files']).isEmpty ? Text(tr('لا ملفات بعد', 'No files yet'), style: const TextStyle(color: T.inkFaint)) : _thumbs(_maps(d['files']), delBase: can['shoot'] == true && editable ? '$base/files' : null),
          if (can['shoot'] == true && editable) TextButton.icon(onPressed: () => _shoot('$base/files', '${d['mediaType']}'), icon: const Icon(Icons.photo_camera), label: Text(tr('تصوير / رفع', 'Shoot / upload'))),
        ])),
        const SizedBox(height: 12),
        Text(tr('الملاحظات', 'Notes'), style: const TextStyle(fontWeight: FontWeight.w800)),
        for (final r in _maps(d['replies']))
          ListTile(dense: true, contentPadding: EdgeInsets.zero,
              title: Text('${r['text']}'),
              subtitle: Text('${r['side'] == 'mediago' ? 'Media Go' : 'Energize'} · ${r['byName'] ?? ''}', style: const TextStyle(fontSize: 11))),
        Row(children: [
          Expanded(child: TextField(controller: _reply, decoration: InputDecoration(isDense: true, hintText: tr('اكتب ملاحظة…', 'Write a note…')))),
          IconButton(icon: const Icon(Icons.send, color: T.orange), onPressed: () async {
            final t = _reply.text.trim(); if (t.isEmpty) return;
            await _run('r', () => Api.instance.post('$base/replies', {'text': t}));
            _reply.clear();
          }),
        ]),
        const SizedBox(height: 20),
      ])),
    );
  }
}

/// بيتُ حساب Media Go — شاشتاه: الشكاوى والمحتوى الإعلانيّ (كالموقع، scopedRoles).
class MediaGoPartnerHome extends StatefulWidget {
  const MediaGoPartnerHome({super.key, required this.complaints});
  final Widget complaints;
  @override
  State<MediaGoPartnerHome> createState() => _MediaGoPartnerHomeState();
}

class _MediaGoPartnerHomeState extends State<MediaGoPartnerHome> {
  int _i = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _i, children: [
          widget.complaints,
          Scaffold(appBar: AppBar(title: Text(tr('المحتوى الإعلاني', 'Ad content'))), body: const MediaGoAdsScreen(embedded: true)),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _i,
          onDestinationSelected: (i) => setState(() => _i = i),
          destinations: [
            NavigationDestination(icon: const Icon(Icons.connected_tv_outlined), label: tr('الشكاوى', 'Complaints')),
            NavigationDestination(icon: const Icon(Icons.movie_outlined), label: tr('المحتوى الإعلاني', 'Ad content')),
          ],
        ),
      );
}
