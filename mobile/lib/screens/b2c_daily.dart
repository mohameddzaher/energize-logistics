import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الإدخال اليومي B2C — يوم واحد × كل المناديب: أدخل عدد الطلبات لكل مندوب
/// واحفظ صفًا صفًا (صفر = لم يعمل، فارغ = لا بيانات)، كما في صفحة الويب.
class B2cDailyEntryScreen extends StatefulWidget {
  const B2cDailyEntryScreen({super.key});
  @override
  State<B2cDailyEntryScreen> createState() => _B2cDailyEntryScreenState();
}

class _B2cDailyEntryScreenState extends State<B2cDailyEntryScreen> {
  List<Map<String, dynamic>> _reps = [];
  final Map<String, Map<String, dynamic>> _entries = {}; // repId → daily order
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _saving = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  DateTime _date = DateTime.now();

  String get _dateKey =>
      '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/b2c/reps').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/b2c/daily-orders?dateFrom=$_dateKey&dateTo=$_dateKey'),
      ]);
      if (!mounted) return;
      setState(() {
        _reps = List<Map<String, dynamic>>.from(results[0]['reps'] ?? []);
        _entries.clear();
        _ctrls.clear();
        for (final o in List<Map<String, dynamic>>.from(results[1]['orders'] ?? [])) {
          final rid = (o['rep'] is Map ? o['rep']['_id'] : o['rep'])?.toString();
          if (rid != null) _entries[rid] = o;
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  String _repName(Map<String, dynamic> r) {
    final ar = (r['arabicName'] ?? '').toString();
    return ar.isNotEmpty ? ar : (r['englishName'] ?? '—').toString();
  }

  TextEditingController _ctrl(Map<String, dynamic> rep) {
    final id = (rep['_id'] ?? '').toString();
    return _ctrls.putIfAbsent(id, () {
      final v = _entries[id]?['orders'];
      return TextEditingController(text: v == null ? '' : v.toString());
    });
  }

  Future<void> _save(Map<String, dynamic> rep) async {
    final id = (rep['_id'] ?? '').toString();
    final text = _ctrl(rep).text.trim();
    setState(() => _saving.add(id));
    try {
      await Api.instance.post('/api/b2c/daily-orders', {
        'rep': id,
        'dateKey': _dateKey,
        'orders': text.isEmpty ? null : num.tryParse(text),
      });
      final d = await Api.instance.get('/api/b2c/daily-orders?dateFrom=$_dateKey&dateTo=$_dateKey&rep=$id');
      if (mounted) {
        final rows = List<Map<String, dynamic>>.from(d['orders'] ?? []);
        setState(() { if (rows.isNotEmpty) _entries[id] = rows.first; });
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _reps.where((r) {
      if (q.isEmpty) return true;
      return _fold('${_repName(r)} ${r['repId'] ?? ''}').contains(q);
    }).toList();
    final entered = _entries.values.where((e) => e['orders'] != null).length;

    return AppScaffold(
      title: Text(tr('الإدخال اليومي', 'Daily Entry')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final v = await showDatePicker(
                              context: context,
                              initialDate: _date,
                              firstDate: DateTime(2024),
                              lastDate: DateTime.now(),
                            );
                            if (v != null) { setState(() { _date = v; _loading = true; }); _load(); }
                          },
                          icon: const Icon(Icons.event, size: 17),
                          label: Text(_dateKey, style: const TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Chip2('$entered / ${_reps.length} ${tr('مُدخل', 'entered')}', entered == _reps.length && _reps.isNotEmpty ? T.success : T.warn),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن المندوب…', 'Search rep…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.groups_outlined, title: tr('لا يوجد مناديب', 'No reps'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final rep = filtered[i];
                                final id = (rep['_id'] ?? '').toString();
                                final entry = _entries[id];
                                final has = entry?['orders'] != null;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: has ? T.success : null,
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                    child: Row(children: [
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text(_repName(rep), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                          Text(
                                            '${rep['repId'] ?? ''}'
                                            '${entry?['project'] is Map ? ' · ${entry!['project']['name']}' : ''}',
                                            style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                                          ),
                                        ]),
                                      ),
                                      SizedBox(
                                        width: 78,
                                        child: TextField(
                                          controller: _ctrl(rep),
                                          keyboardType: TextInputType.number,
                                          textAlign: TextAlign.center,
                                          decoration: const InputDecoration(
                                            hintText: '—',
                                            isDense: true,
                                            contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                                          ),
                                          onSubmitted: (_) => _save(rep),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      _saving.contains(id)
                                          ? const SizedBox(width: 34, height: 34, child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)))
                                          : IconButton(
                                              icon: Icon(has ? Icons.check_circle : Icons.save_outlined, size: 21, color: has ? T.success : T.navy),
                                              onPressed: () => _save(rep),
                                            ),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
