import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// لوحة قسم عامة — spec-driven: كل قسم يعرّف endpoint + بطاقات أرقام +
/// توزيعات (breakdowns) + قوائم مختصرة، والشاشة ترسمها بنفس هوية التطبيق.

num _dig(Map<String, dynamic> d, String path) {
  dynamic cur = d;
  for (final p in path.split('.')) {
    if (cur is Map) {
      cur = cur[p];
    } else {
      return 0;
    }
  }
  return cur is num ? cur : num.tryParse(cur?.toString() ?? '') ?? 0;
}

class DashStat {
  final String ar, en, path;
  final IconData icon;
  final Color color;
  final bool money;
  const DashStat(this.ar, this.en, this.path, this.icon, this.color, {this.money = false});
}

/// توزيع حسب الحالة: قائمة صفوف {_id|key, count} تتحول إلى شرائح ملونة.
class DashBreakdown {
  final String ar, en, path;
  final String idKey, countKey;
  final Map<String, (String, String, Color)>? labels;
  const DashBreakdown(this.ar, this.en, this.path, {this.idKey = '_id', this.countKey = 'count', this.labels});
}

/// قائمة مختصرة (أحدث العناصر): تعرض عنوانًا وسطرًا فرعيًا من كل صف.
class DashList {
  final String ar, en, path;
  final String Function(Map<String, dynamic>) title;
  final String Function(Map<String, dynamic>)? subtitle;
  const DashList(this.ar, this.en, this.path, this.title, {this.subtitle});
}

class DashSpec {
  final String arTitle, enTitle, endpoint;
  final String liveEvent;
  final List<DashStat> stats;
  final List<DashBreakdown> breakdowns;
  final List<DashList> lists;
  const DashSpec({
    required this.arTitle,
    required this.enTitle,
    required this.endpoint,
    this.liveEvent = '',
    required this.stats,
    this.breakdowns = const [],
    this.lists = const [],
  });
}

class SectionDashScreen extends StatefulWidget {
  final DashSpec spec;
  const SectionDashScreen({super.key, required this.spec});
  @override
  State<SectionDashScreen> createState() => _SectionDashScreenState();
}

class _SectionDashScreenState extends State<SectionDashScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  void Function()? _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.spec.liveEvent.isNotEmpty) {
      _onLive = () => _load();
      Live.instance.on(widget.spec.liveEvent, _onLive!);
    }
  }

  @override
  void dispose() {
    if (_onLive != null) Live.instance.off(widget.spec.liveEvent, _onLive!);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(widget.spec.endpoint);
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> _rows(String path) {
    dynamic cur = _data;
    for (final p in path.split('.')) {
      if (cur is Map) {
        cur = cur[p];
      } else {
        return const [];
      }
    }
    if (cur is List) {
      return List<Map<String, dynamic>>.from(cur.whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
    }
    // خرائط عدّ من نمط {status: count} أو {stage: {count, value}} تتحول إلى صفوف.
    if (cur is Map) {
      return cur.entries
          .map((e) => <String, dynamic>{
                '_id': e.key.toString(),
                'count': e.value is Map ? ((e.value as Map)['count'] ?? 0) : e.value,
              })
          .toList();
    }
    return const [];
  }

  String _fmt(num n, bool money) {
    if (money) {
      final s = n.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
      return '$s ${tr('ر.س', 'SAR')}';
    }
    return n.toStringAsFixed(n.truncateToDouble() == n ? 0 : 1);
  }

  String _humanize(String k) =>
      k.replaceAllMapped(RegExp('([A-Z])'), (m) => ' ${m[1]}').replaceAll('_', ' ').trim();
  String _fmtVal(dynamic v) {
    if (v is num) return v.truncateToDouble() == v ? v.toInt().toString() : v.toStringAsFixed(2);
    final s = v.toString();
    if (RegExp(r'^\d{4}-\d{2}-\d{2}T').hasMatch(s)) return s.split('T').first;
    return s;
  }

  // شيت تفاصيل لأي صف/كارت — يعرض كل الحقول القابلة للقراءة مفتاح: قيمة.
  void _openDetails(String title, Map<String, dynamic> row, {String? big}) {
    final entries = row.entries.where((e) {
      final k = e.key;
      if (k.startsWith('_') || k == 'color' || k == '__v' || k == 'id') return false;
      final v = e.value;
      return v != null && v is! Map && v is! List && v.toString().isNotEmpty;
    }).toList();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          // نحبس ارتفاع الشيت ونخليه قابل للتمرير — عشان الصفوف الكتيرة ماتعملش overflow.
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.75),
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 22),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                if (big != null) ...[
                  const SizedBox(height: 6),
                  Text(big, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 30, color: T.navy)),
                ],
                const SizedBox(height: 12),
                ...entries.map((e) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Expanded(flex: 2, child: Text(_humanize(e.key), style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
                        const SizedBox(width: 10),
                        Expanded(flex: 3, child: Text(_fmtVal(e.value), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700), textAlign: TextAlign.end)),
                      ]),
                    )),
                if (entries.isEmpty && big == null)
                  Text(tr('لا توجد تفاصيل إضافية', 'No extra details'), style: const TextStyle(color: T.inkFaint)),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final spec = widget.spec;
    return AppScaffold(
      title: Text(tr(spec.arTitle, spec.enTitle)),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 1.7,
                      children: spec.stats.asMap().entries.map((e) {
                        final s = e.value;
                        final v = _dig(_data!, s.path);
                        return FadeSlideIn(
                          delayMs: e.key * 40,
                          child: Pressable(
                            onTap: () => _openDetails(tr(s.ar, s.en), const <String, dynamic>{}, big: _fmt(v, s.money)),
                            child: AppCard(
                            topAccent: s.color,
                            padding: const EdgeInsets.all(12),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                              Row(children: [
                                Icon(s.icon, size: 17, color: s.color),
                                const SizedBox(width: 6),
                                Expanded(child: Text(tr(s.ar, s.en), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
                              ]),
                              const SizedBox(height: 6),
                              Text(_fmt(v, s.money), style: TextStyle(fontSize: s.money ? 16 : 21, fontWeight: FontWeight.w900, color: T.ink)),
                            ]),
                          ),
                        ),
                        );
                      }).toList(),
                    ),
                    ...spec.breakdowns.map((b) {
                      final rows = _rows(b.path);
                      if (rows.isEmpty) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(top: 14),
                        child: FadeSlideIn(
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(tr(b.ar, b.en), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                              const SizedBox(height: 10),
                              Wrap(spacing: 8, runSpacing: 8, children: rows.map((r) {
                                final id = (r[b.idKey] ?? '—').toString();
                                final label = b.labels?[id];
                                final color = label?.$3 ?? T.navy;
                                final name = label != null ? tr(label.$1, label.$2) : id;
                                return GestureDetector(
                                  onTap: () => _openDetails(name, r),
                                  child: Chip2('$name: ${r[b.countKey] ?? 0}', color),
                                );
                              }).toList()),
                            ]),
                          ),
                        ),
                      );
                    }),
                    ...spec.lists.map((l) {
                      final rows = _rows(l.path);
                      if (rows.isEmpty) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(top: 14),
                        child: FadeSlideIn(
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(tr(l.ar, l.en), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                              const SizedBox(height: 6),
                              ...rows.take(8).map((r) => Pressable(
                                onTap: () => _openDetails(l.title(r), r),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 6),
                                  child: Row(children: [
                                    Expanded(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text(l.title(r), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                        if (l.subtitle != null)
                                          Text(l.subtitle!(r), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                      ]),
                                    ),
                                    Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, size: 17, color: T.inkFaint),
                                  ]),
                                ),
                              )),
                            ]),
                          ),
                        ),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
