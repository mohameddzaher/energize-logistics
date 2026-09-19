import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ربط الحسابات — نظيرُ /system/collections-dept/links على الموقع.
///
/// عميلٌ من التشغيل اسمُه قريبٌ من حسابٍ في الدفتر: أهو هو («ربط» — يصير اسمُه
/// صيغةً للحساب فتُقرأ حمولاتُه عليه) أم عميلٌ آخر («مستقلّ» — يأخذ كودَه الآن
/// بنوع حمولاته)؟ قرارُ إنسانٍ لا قياس: كودٌ خاطئٌ يقسم دَينَ عميلٍ على حسابين.
class PartyLinksScreen extends StatefulWidget {
  const PartyLinksScreen({super.key});
  @override
  State<PartyLinksScreen> createState() => _PartyLinksScreenState();
}

class _PartyLinksScreenState extends State<PartyLinksScreen> {
  String _tab = 'pending';
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  String? _error;
  String? _working;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/collections-dept/ledger/link-suggestions?decision=$_tab');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    setState(() => _working = '${r['_id']}');
    try {
      await Api.instance.post('/api/collections-dept/ledger/link-suggestions/${r['_id']}', {'decision': decision});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _working = null);
  }

  Widget _tabChip(String key, String ar, String en) {
    final on = _tab == key;
    final n = _counts[key] ?? 0;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: ChoiceChip(
        label: Text('${tr(ar, en)} ($n)'),
        selected: on,
        selectedColor: T.orange.withValues(alpha: 0.15),
        onSelected: (_) { setState(() { _tab = key; _loading = true; }); _load(); },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('ربط الحسابات', 'Account links')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
          children: [
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
              _tabChip('pending', 'تنتظر قرارًا', 'Pending'),
              _tabChip('linked', 'رُبطت', 'Linked'),
              _tabChip('separate', 'مستقلّة', 'Separate'),
            ])),
            const SizedBox(height: 10),
            if (_loading && _rows.isEmpty) ...[const Shimmer(height: 90), const SizedBox(height: 8), const Shimmer(height: 90)]
            else if (_error != null && _rows.isEmpty) ErrorRetry(message: _error!, onRetry: _load)
            else if (_rows.isEmpty) EmptyState(icon: Icons.link_off, title: tr('لا شيء هنا', 'Nothing here'))
            else ..._rows.map((r) {
              final score = ((r['score'] as num?) ?? 0) * 100;
              final busy = _working == '${r['_id']}';
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text('${r['code']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.navy)),
                    const SizedBox(width: 8),
                    Chip2(r['kind'] == 'cash' ? tr('نقدي', 'Cash') : tr('ضريبي', 'Tax'), r['kind'] == 'cash' ? T.warn : T.info),
                    const Spacer(),
                    Text('${score.round()}%', style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 6),
                  Text(tr('الحساب في الدفتر', 'Ledger account'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  Text('${r['accountName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text(tr('الاسم في التشغيل', 'Name in operations'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  Text('${r['candidateName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (_tab == 'pending') ...[
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: T.success),
                        onPressed: busy ? null : () => _decide(r, 'linked'),
                        icon: const Icon(Icons.link, size: 18),
                        label: Text(tr('نفس العميل — اربط', 'Same — link')),
                      )),
                      const SizedBox(width: 8),
                      Expanded(child: OutlinedButton.icon(
                        onPressed: busy ? null : () => _decide(r, 'separate'),
                        icon: const Icon(Icons.call_split, size: 18),
                        label: Text(tr('عميل مستقل', 'Separate')),
                      )),
                    ]),
                  ],
                ])),
              );
            }),
          ],
        ),
      ),
    );
  }
}
