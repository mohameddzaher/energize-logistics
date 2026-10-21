import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ترتيبُ المناديب في شيت المشروع — نظيرُ «شيتات جوجل ← ترتيب المناديب» في الموقع
/// (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). لمسؤولي القسم وحدَهم (يحسمه الخادم). الترتيبُ واحدٌ
/// للمشروع: يسري على كلّ شهور الشيت وعلى «مدخلات الأوردرات»، والجددُ في الآخر.
class B2cSheetOrderScreen extends StatefulWidget {
  const B2cSheetOrderScreen({super.key});
  @override
  State<B2cSheetOrderScreen> createState() => _B2cSheetOrderScreenState();
}

class _B2cSheetOrderScreenState extends State<B2cSheetOrderScreen> {
  List<String> _projects = [];
  String _project = '';
  List<Map<String, dynamic>> _rows = [];
  bool _dirty = false;
  bool _busy = false;
  bool _loading = true;
  String? _error;
  int _req = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _init();
    _onLive = () { if (!_dirty) _load(); };
    Live.instance.on('b2c:sheet-order', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('b2c:sheet-order', _onLive);
    super.dispose();
  }

  Future<void> _init() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/b2c/order-sheets') as Map);
      if (!mounted) return;
      setState(() {
        _projects = List<String>.from((d['sheetProjects'] ?? []).map((x) => '$x'));
        if (_projects.isNotEmpty) _project = _projects.first;
      });
      await _load();
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _load() async {
    if (_project.isEmpty) { setState(() => _loading = false); return; }
    final n = ++_req;
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/b2c/order-sheets/order?project=${Uri.encodeQueryComponent(_project)}') as Map);
      if (!mounted || n != _req) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from((d['rows'] ?? []).map((x) => Map<String, dynamic>.from(x as Map)));
        _dirty = false; _error = null; _loading = false;
      });
    } catch (e) {
      if (mounted && n == _req) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _move(int from, int to) {
    if (to < 0 || to >= _rows.length || from == to) return;
    setState(() { final x = _rows.removeAt(from); _rows.insert(to, x); _dirty = true; });
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await Api.instance.put('/api/b2c/order-sheets/order', {'project': _project, 'lts': _rows.map((r) => '${r['lt']}').toList()});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ الترتيب — يظهر في الشيت خلال ٥ دقائق', 'Order saved'))));
      _dirty = false;
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('ترتيب المناديب', 'Reps order')),
      actions: [
        if (_dirty) IconButton(tooltip: tr('تراجع', 'Revert'), icon: const Icon(Icons.undo), onPressed: _load),
        IconButton(
          tooltip: tr('حفظ الترتيب', 'Save order'),
          icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          onPressed: _dirty && !_busy ? _save : null,
        ),
      ],
      body: _error != null
          ? ErrorRetry(message: _error!, onRetry: _init)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
                    child: Wrap(spacing: 6, children: [
                      for (final p in _projects)
                        ChoiceChip(label: Text(p), selected: _project == p, onSelected: (_) {
                          setState(() { _project = p; _loading = true; });
                          _load();
                        }),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(tr('اضغط مطوّلًا واسحب، أو استعمل الأسهم، ثمّ احفظ. يسري على كلّ شهور الشيت وعلى «مدخلات الأوردرات».', 'Long-press and drag, or use the arrows, then save.'),
                        style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                  ),
                  Expanded(
                    child: _rows.isEmpty
                        ? EmptyState(icon: Icons.inbox_outlined, title: tr('لا مناديب في هذا المشروع هذا الشهر', 'No reps this month'))
                        : ReorderableListView.builder(
                            padding: const EdgeInsets.all(12),
                            itemCount: _rows.length,
                            onReorderItem: (from, to) => _move(from, to),
                            itemBuilder: (context, i) {
                              final r = _rows[i];
                              return Padding(
                                key: ValueKey('${r['lt']}'),
                                padding: const EdgeInsets.only(bottom: 6),
                                child: AppCard(child: Row(children: [
                                  SizedBox(width: 28, child: Text('${i + 1}', style: const TextStyle(fontSize: 12, color: T.inkFaint))),
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                    Text([r['id'], r['sup']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                  ])),
                                  IconButton(icon: const Icon(Icons.arrow_upward, size: 18), onPressed: i == 0 ? null : () => _move(i, i - 1)),
                                  IconButton(icon: const Icon(Icons.arrow_downward, size: 18), onPressed: i == _rows.length - 1 ? null : () => _move(i, i + 1)),
                                ])),
                              );
                            },
                          ),
                  ),
                ]),
    );
  }
}
