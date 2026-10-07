import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// النماذجُ والخطاباتُ الرسميّة — مكتبةُ أوراق الموارد البشريّة.
///
/// نظيرةُ `/system/hr/forms`. كانت هذه الأوراقُ في محادثاتِ واتساب فتُوقَّع
/// نسخةٌ قديمةٌ وتُعاد؛ ولكلّ ورقةٍ الآن رقمُ نسخةٍ يرتفع عند استبدالها.
///
/// والرفعُ من الموقع: الملفُّ يُختار من جهازٍ فيه الملفّات، والهاتفُ موضعُ
/// القراءةِ والتنزيل — من يحتاج نموذجًا وهو في الميدان يجده هنا.
class HrFormsScreen extends StatefulWidget {
  const HrFormsScreen({super.key});
  @override
  State<HrFormsScreen> createState() => _HrFormsScreenState();
}

class _HrFormsScreenState extends State<HrFormsScreen> {
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _cats = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  String? _error;
  String _cat = '';
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:forms', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:forms', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = <String>[];
      if (_cat.isNotEmpty) p.add('category=$_cat');
      if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
      final d = await Api.instance.get('/api/hr/forms${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        _cats = List<Map<String, dynamic>>.from((d['categories'] as List? ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _size(dynamic n) {
    final v = (n is num ? n : 0).toInt();
    if (v <= 0) return '—';
    if (v < 1024) return '$v B';
    if (v < 1024 * 1024) return '${(v / 1024).round()} KB';
    return '${(v / 1024 / 1024).toStringAsFixed(1)} MB';
  }

  /// التنزيلُ يُعَدّ — النموذجُ الذي لا يُنزَّل إمّا لا يحتاجه أحدٌ أو لا يعرف
  /// أحدٌ أنّه هنا، والرقمُ يفرّق بينهما مع الزمن.
  Future<void> _download(Map<String, dynamic> it) async {
    Api.instance.post('/api/hr/forms/${it['_id']}/downloaded', const {}).catchError((_) => <String, dynamic>{});
    // الملفُّ يُقدَّم على `/api/uploads/...` من الخادم نفسِه، فيُفتح بمتصفّح
    // الجهاز فينزّله أو يعرضه — كما في مرفقات التخليص.
    final u = (it['fileUrl'] ?? '').toString();
    if (u.isEmpty) return;
    final uri = Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u');
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تعذّر فتح الملف', 'Could not open the file'))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('النماذج والخطابات', 'Forms & Letters')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 50), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    TextField(
                      onChanged: (v) { _q = v; _load(); },
                      decoration: InputDecoration(
                        hintText: tr('ابحث باسم النموذج…', 'Search by name…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: FilterChip(
                            selected: _cat.isEmpty,
                            onSelected: (_) => setState(() { _cat = ''; _loading = true; _load(); }),
                            label: Text('${tr('الكل', 'All')} (${_items.length})'),
                            labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _cat.isEmpty ? Colors.white : T.navy),
                            selectedColor: T.orange,
                            backgroundColor: T.navy.withValues(alpha: 0.08),
                            checkmarkColor: Colors.white,
                            side: BorderSide.none,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                        for (final c in _cats)
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _cat == c['key'],
                              onSelected: (_) => setState(() {
                                _cat = _cat == c['key'] ? '' : c['key'].toString();
                                _loading = true; _load();
                              }),
                              label: Text('${tr(c['ar'].toString(), c['en'].toString())} (${_counts[c['key']] ?? 0})'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _cat == c['key'] ? Colors.white : T.navy),
                              selectedColor: T.orange,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    if (_items.isEmpty)
                      EmptyState(icon: Icons.folder_open_outlined, title: tr('لا أوراقَ هنا بعد', 'Nothing here yet')),
                    for (final it in _items)
                      Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                            child: const Icon(Icons.description_outlined, color: T.orange, size: 20),
                          ),
                          title: Text((it['title'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                          subtitle: Text([
                            '${tr('نسخة', 'v')} ${it['version'] ?? 1}',
                            _size(it['size']),
                            '${it['downloads'] ?? 0} ${tr('تنزيل', 'downloads')}',
                            if ((it['description'] ?? '').toString().isNotEmpty) it['description'].toString(),
                          ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
                          trailing: IconButton(
                            icon: const Icon(Icons.download_outlined),
                            tooltip: tr('تنزيل', 'Download'),
                            onPressed: () => _download(it),
                          ),
                          onTap: () => _download(it),
                        ),
                      ),
                  ]),
                ),
    );
  }
}
