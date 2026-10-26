import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// توثيقُ الـ API — مثلُ /system/api-docs في الويب (صاحبُ الشركة، ٢٠٢٦/١٠/٢٥:
/// «كلّ حاجة على كلّ حاجة»). الوثيقةُ نفسُها من الخادم (`/api/docs/internal.json`)،
/// تُبنى من الكود لحظةَ طلبها: المساراتُ وحُرّاسُها وفلاترُها وحقولُها — فلا شيءَ
/// هنا يُكتب بيد. تُعرَض أصليّةً (بحثٌ ومجموعاتٌ تُفتح) لأنّ شاشةَ الهاتف لا تتّسع
/// لعارض Swagger. للإدارة وحدَها، وخريطةُ النظام لا تُرسَل خارج الشركة.
class ApiDocsScreen extends StatefulWidget {
  const ApiDocsScreen({super.key});
  @override
  State<ApiDocsScreen> createState() => _ApiDocsScreenState();
}

class _Ep {
  final String method, path, description, group;
  final List<(String, bool)> query, body;
  _Ep(this.method, this.path, this.description, this.group, this.query, this.body);
}

const _partnerUrl = 'https://api.energize-logistics.com/api/docs';

class _ApiDocsScreenState extends State<ApiDocsScreen> {
  List<_Ep> _all = [];
  Map<String, String> _groupAr = {};
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;
  String _q = '';
  final _searchCtl = TextEditingController(); // النصُّ يبقى مطابقًا لـ_q بعد التحديث

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() { _searchCtl.dispose(); super.dispose(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/docs/internal.json') as Map);
      Map<String, dynamic>? st;
      try { st = Map<String, dynamic>.from(await Api.instance.get('/api/docs/stats') as Map); } catch (_) {}
      final out = <_Ep>[];
      final paths = Map<String, dynamic>.from(d['paths'] ?? {});
      for (final p in paths.entries) {
        final ops = Map<String, dynamic>.from(p.value as Map);
        for (final o in ops.entries) {
          final op = Map<String, dynamic>.from(o.value as Map);
          final params = List<Map<String, dynamic>>.from((op['parameters'] ?? []).map((x) => Map<String, dynamic>.from(x as Map)));
          final schema = Map<String, dynamic>.from(((((op['requestBody'] ?? {})['content'] ?? {})['application/json'] ?? {})['schema']) ?? {});
          final req = List<String>.from(schema['required'] ?? []);
          out.add(_Ep(
            o.key.toUpperCase(), p.key, '${op['description'] ?? ''}',
            ((op['tags'] as List?)?.isNotEmpty ?? false) ? '${(op['tags'] as List).first}' : 'root',
            params.where((x) => x['in'] == 'query').map((x) => ('${x['name']}', x['required'] == true)).toList(),
            Map<String, dynamic>.from(schema['properties'] ?? {}).keys.map((k) => (k, req.contains(k))).toList(),
          ));
        }
      }
      final groups = <String, String>{};
      for (final t in List.from(d['tags'] ?? [])) { groups['${t['name']}'] = '${t['description'] ?? t['name']}'; }
      if (!mounted) return;
      setState(() { _all = out; _groupAr = groups; _stats = st; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _methodColor(String m) => switch (m) {
        'GET' => T.info,
        'POST' => T.success,
        'PUT' || 'PATCH' => T.warn,
        'DELETE' => T.danger,
        _ => T.inkSoft,
      };

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final shown = q.isEmpty
        ? _all
        : _all.where((e) => e.path.toLowerCase().contains(q)
            || e.query.any((f) => f.$1.toLowerCase().contains(q))
            || e.body.any((f) => f.$1.toLowerCase().contains(q))).toList();
    final byGroup = <String, List<_Ep>>{};
    for (final e in shown) { (byGroup[e.group] ??= []).add(e); }
    final groups = byGroup.keys.toList()..sort();

    return AppScaffold(
      title: Text(tr('توثيق الـ API', 'API documentation')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? EmptyState(icon: Icons.error_outline, title: _error!)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('يُبنى من الكود لحظةَ فتحه — أيُّ إضافةٍ أو تعديلٍ أو حذفٍ يظهر هنا مع النشر.',
                            'Built from the code when opened — every change appears with each deploy.'),
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        if (_stats != null) ...[
                          const SizedBox(height: 6),
                          Text(tr('${_stats!['routes']} مسارًا في ${_stats!['groups']} مجموعة · ${_stats!['withFields']} منها بحقولها',
                              '${_stats!['routes']} endpoints in ${_stats!['groups']} groups · ${_stats!['withFields']} with fields'),
                              style: const TextStyle(color: T.inkSoft, fontSize: 12.5)),
                        ],
                        const SizedBox(height: 8),
                        Text(tr('للشركاء (ما يُرسَل لمن يتكامل معنا) — مع مفتاحه ‎?key=…', 'For partners — with their key ?key=…'),
                            style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                        InkWell(
                          onTap: () {
                            Clipboard.setData(const ClipboardData(text: _partnerUrl));
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('نُسخ الرابط', 'Link copied'))));
                          },
                          child: const Padding(
                            padding: EdgeInsets.symmetric(vertical: 4),
                            child: Text(_partnerUrl, style: TextStyle(color: T.orange, fontWeight: FontWeight.w700)),
                          ),
                        ),
                        Text(tr('هذه الشاشة خريطةُ النظام كلِّه — لا تُرسَل خارج الشركة.', 'This maps the whole system — never share it outside.'),
                            style: const TextStyle(fontSize: 12, color: T.danger)),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    SearchField(
                      controller: _searchCtl,
                      hint: tr('ابحث بمسارٍ أو حقل', 'Search a path or field'),
                      onChanged: (v) => setState(() => _q = v),
                    ),
                    const SizedBox(height: 10),
                    if (groups.isEmpty && q.isNotEmpty)
                      EmptyState(icon: Icons.search_off_rounded, title: tr('لا نتائج مطابقة', 'No matches')),
                    for (final g in groups)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: EdgeInsets.zero,
                          // Material شفّاف: ListTile داخل حاويةٍ ملوّنة يحتاج سطحًا خاصًّا يرسم عليه.
                          child: Material(type: MaterialType.transparency, child: ExpansionTile(
                            shape: const Border(), collapsedShape: const Border(),
                            initiallyExpanded: q.isNotEmpty,
                            title: Text(g, style: const TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: Text('${_groupAr[g] ?? g} · ${byGroup[g]!.length}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            children: byGroup[g]!.map(_endpoint).toList(),
                          )),
                        ),
                      ),
                  ]),
                ),
    );
  }

  Widget _endpoint(_Ep e) {
    Widget fields(String label, List<(String, bool)> f) => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text('$label:', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
            ...f.map((x) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: T.line.withValues(alpha: .5), borderRadius: BorderRadius.circular(6)),
                  child: Text(x.$2 ? '${x.$1} *' : x.$1, style: TextStyle(fontSize: 11.5, fontFamily: 'monospace', fontWeight: x.$2 ? FontWeight.w800 : FontWeight.w500)),
                )),
          ]),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Directionality(
          textDirection: TextDirection.ltr,
          child: Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: _methodColor(e.method), borderRadius: BorderRadius.circular(5)),
              child: Text(e.method, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 8),
            Expanded(child: SelectableText(e.path, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, fontWeight: FontWeight.w700))),
          ]),
        ),
        if (e.description.isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(e.description, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
        if (e.query.isNotEmpty) fields(tr('فلاتر', 'Query'), e.query),
        if (e.body.isNotEmpty) fields(tr('الحقول', 'Body'), e.body),
        const Divider(height: 14),
      ]),
    );
  }
}
