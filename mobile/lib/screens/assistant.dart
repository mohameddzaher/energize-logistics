import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'reports.dart' show ReportBlock;

/// المساعد — سؤالٌ عن أيّ شيءٍ في النظام.
///
/// ── ولماذا لا يعرف شيئًا من عنده ────────────────────────────────────────────
/// مواضيعُه مواضيعُ مركز التقارير، وصلاحيّاتُه صلاحيّاتُه، وجوابُه هو وثيقتُه.
/// فما يُضاف هناك يصل هنا بلا سطرٍ واحد، ولا يستطيع أن يقول ما لا يقوله التقرير
/// ولا أن يُري أحدًا ما لا يملك.
///
/// وطريقان إلى الجواب لأنّ السائلين صنفان: مَن يعرف ما يريد يكتبه — لوحةً أو
/// اسمًا أو رقمَ بوليصة — ومَن لا يعرف أين يسأل يُمشى به: قسمٌ ثمّ موضوعٌ ثمّ
/// واحدٌ منه.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key});
  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  List<Map<String, dynamic>> _sections = [];
  List<Map<String, dynamic>> _periods = [];
  String _period = 'last_12m';

  Map<String, dynamic>? _section;
  Map<String, dynamic>? _topic;
  List<Map<String, dynamic>> _options = [];
  bool _optBusy = false;

  List<Map<String, dynamic>> _groups = [];
  bool _searching = false;
  Timer? _debounce;
  int _seq = 0;

  Map<String, dynamic>? _answer;
  ({String topic, String id})? _asked;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSections();
  }

  @override
  void dispose() { _debounce?.cancel(); super.dispose(); }

  Future<void> _loadSections() async {
    try {
      final d = await Api.instance.get('/api/assistant/sections?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (!mounted) return;
      setState(() {
        _sections = List<Map<String, dynamic>>.from(d['sections'] ?? []);
        _periods = List<Map<String, dynamic>>.from(d['periods'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// البحثُ يُرسَل بعد سكونِ الكتابة، والأحدثُ وحدَه يُقبَل: الشبكةُ لا تحفظ
  /// ترتيبَ الردود، فردُّ «مح» الواصلُ متأخّرًا يمحو نتائجَ «محمد».
  void _onQuery(String v) {
    _debounce?.cancel();
    if (v.trim().length < 2) { setState(() { _groups = []; _searching = false; }); return; }
    setState(() => _searching = true);
    _debounce = Timer(const Duration(milliseconds: 320), () async {
      final mine = ++_seq;
      try {
        final d = await Api.instance.get('/api/assistant/search?q=${Uri.encodeQueryComponent(v.trim())}');
        if (!mounted || mine != _seq) return;
        setState(() { _groups = List<Map<String, dynamic>>.from(d['groups'] ?? []); _searching = false; });
      } catch (_) {
        if (mounted && mine == _seq) setState(() { _groups = []; _searching = false; });
      }
    });
  }

  Future<void> _loadOptions(Map<String, dynamic> topic, [String q = '']) async {
    setState(() => _optBusy = true);
    try {
      final d = await Api.instance.get(
          '/api/assistant/topics/${topic['key']}/options${q.isEmpty ? '' : '?q=${Uri.encodeQueryComponent(q)}'}');
      if (!mounted) return;
      setState(() { _options = List<Map<String, dynamic>>.from(d['items'] ?? []); _optBusy = false; });
    } catch (_) {
      if (mounted) setState(() { _options = []; _optBusy = false; });
    }
  }

  Future<void> _ask(String topic, String id, [String? period]) async {
    setState(() { _loading = true; _error = null; _asked = (topic: topic, id: id); });
    try {
      final d = await Api.instance.get(
          '/api/assistant/topics/$topic/${Uri.encodeComponent(id)}?period=${period ?? _period}&lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (!mounted) return;
      setState(() { _answer = Map<String, dynamic>.from(d); _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); _answer = null; });
    }
  }

  Widget _chip(String label, {required bool active, required VoidCallback onTap, IconData? icon}) => Pressable(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          decoration: BoxDecoration(
            color: active ? T.orange : Colors.white,
            border: Border.all(color: active ? T.orange : T.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 14, color: active ? Colors.white : T.inkSoft), const SizedBox(width: 5)],
            Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: active ? Colors.white : T.ink)),
          ]),
        ),
      );

  Widget _optionTile(Map<String, dynamic> it, String topic) => Pressable(
        onTap: () => _ask(topic, (it['id'] ?? '').toString()),
        child: Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(color: Colors.white, border: Border.all(color: T.line), borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((it['name'] ?? '').toString(), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
            if ((it['detail'] ?? '').toString().isNotEmpty)
              Text((it['detail']).toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final ar = Lang.instance.ar;
    return AppScaffold(
      title: Text(tr('المساعد', 'Assistant')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
        children: [
          // ── اكتبْ ما تعرفه ──────────────────────────────────────────────
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(
                onChanged: _onQuery,
                decoration: InputDecoration(
                  hintText: tr('لوحة أو اسم عميل أو رقم بوليصة أو إقامة…', 'Plate, customer, waybill or iqama…'),
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: _searching
                      ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                      : null,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(spacing: 6, runSpacing: 6, children: [
                Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('الفترة', 'Period'), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
                for (final p in _periods)
                  _chip((ar ? p['ar'] : p['en']).toString(),
                      active: _period == p['key'],
                      onTap: () {
                        setState(() => _period = (p['key'] ?? '').toString());
                        if (_asked != null) _ask(_asked!.topic, _asked!.id, _period);
                      }),
              ]),
            ]),
          ),
          const SizedBox(height: 10),

          if (_groups.isNotEmpty)
            ..._groups.map((g) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: AppCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Text((ar ? g['ar'] : g['en']).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                        const SizedBox(width: 6),
                        Text('(${g['total']})', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ]),
                      const SizedBox(height: 8),
                      ...List<Map<String, dynamic>>.from(g['items'] ?? [])
                          .map((it) => _optionTile(it, (g['topic'] ?? '').toString())),
                    ]),
                  ),
                )),

          // ── أو امشِ بالأقسام ────────────────────────────────────────────
          if (_answer == null) ...[
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Pressable(
                    onTap: () => setState(() { _section = null; _topic = null; _options = []; }),
                    child: Text(tr('الأقسام', 'Sections'),
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: _section == null ? T.ink : T.inkFaint)),
                  ),
                  if (_section != null) ...[
                    const Padding(padding: EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.chevron_left, size: 15, color: T.inkFaint)),
                    Pressable(
                      onTap: () => setState(() { _topic = null; _options = []; }),
                      child: Text((_section!['label'] ?? '').toString(),
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: _topic == null ? T.ink : T.inkFaint)),
                    ),
                  ],
                  if (_topic != null) ...[
                    const Padding(padding: EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.chevron_left, size: 15, color: T.inkFaint)),
                    Expanded(child: Text((ar ? _topic!['ar'] : _topic!['en']).toString(),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13), overflow: TextOverflow.ellipsis)),
                  ],
                ]),
                const SizedBox(height: 10),
                if (_loading && _sections.isEmpty)
                  const Shimmer(height: 60)
                else if (_section == null)
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final s in _sections)
                      _chip('${s['label']} (${(s['topics'] as List).length})',
                          active: false, onTap: () => setState(() => _section = s)),
                  ])
                else if (_topic == null)
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final tp in List<Map<String, dynamic>>.from(_section!['topics'] ?? []))
                      _chip((ar ? tp['ar'] : tp['en']).toString(), active: false, onTap: () {
                        setState(() => _topic = tp);
                        _loadOptions(tp);
                      }),
                  ])
                else ...[
                  if ((_topic!['searchable'] ?? false) == true)
                    TextField(
                      onChanged: (v) => _loadOptions(_topic!, v),
                      decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search, size: 18)),
                    ),
                  const SizedBox(height: 8),
                  if (_optBusy) const Shimmer(height: 40)
                  else if (_options.isEmpty)
                    Text(tr('لا نتائج — جرّب كلمةً أخرى.', 'No matches — try another word.'),
                        style: const TextStyle(fontSize: 12, color: T.inkFaint))
                  else
                    ..._options.map((it) => _optionTile(it, (_topic!['key'] ?? '').toString())),
                ],
              ]),
            ),
          ],

          if (_error != null) ...[
            const SizedBox(height: 10),
            ErrorRetry(message: _error!, onRetry: _loadSections),
          ],

          // ── الجواب: سطورٌ تُقرأ أوّلًا ثمّ الوثيقةُ كاملة ────────────────
          if (_loading && _answer == null && _sections.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Shimmer(height: 120),
          ],
          if (_answer != null) ...[
            const SizedBox(height: 10),
            AppCard(
              topAccent: T.orange,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text((_answer!['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      Text((_answer!['subtitle'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ]),
                  ),
                  TextButton(
                    onPressed: () => setState(() { _answer = null; _asked = null; }),
                    child: Text(tr('سؤال آخر', 'Ask again'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final h in List<Map<String, dynamic>>.from(_answer!['highlights'] ?? []))
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                        Text((h['label'] ?? '').toString(), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                        Text((h['value'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                      ]),
                    ),
                ]),
              ]),
            ),
            const SizedBox(height: 10),
            // الوثيقةُ نفسُها التي يرسمها مركزُ التقارير — لا صياغةٌ ثانية.
            // الوثيقةُ بكتلها — نفسُ مكوّن مركز التقارير حرفًا بحرف.
            ...List<Map<String, dynamic>>.from((_answer!['doc'] ?? {})['blocks'] ?? [])
                .map((b) => ReportBlock(block: b)),
          ],
        ],
      ),
    );
  }
}
