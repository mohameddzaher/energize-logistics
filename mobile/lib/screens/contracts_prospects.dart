import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تنشيط الموردين الجدد — native: the outreach log with interest states and
/// the one-tap «تحويل إلى مورد».
class ContractsProspectsScreen extends StatefulWidget {
  const ContractsProspectsScreen({super.key});
  @override
  State<ContractsProspectsScreen> createState() => _ContractsProspectsScreenState();
}

class _ContractsProspectsScreenState extends State<ContractsProspectsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/contracts/prospects');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['prospects'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _convert(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تحويل إلى مورد', 'Convert to vendor')),
        content: Text(tr('تحويل «${p['companyName']}» إلى مورد في السجل الرسمي؟', 'Convert "${p['companyName']}" to a vendor?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تحويل', 'Convert'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/contracts/prospects/${p['_id']}/convert');
      _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التحويل — الشركة الآن في سجل الموردين', 'Converted to the vendor register'))));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((p) {
      if (q.isEmpty) return true;
      return [p['companyName'], p['contactPerson'], p['phone'], p['headquarters']].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('تنشيط الموردين الجدد', 'Prospect Outreach')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالاسم أو المقر…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.phone_in_talk_outlined, title: tr('لا توجد شركات في سجل التنشيط', 'No prospects'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final p = filtered[i];
                                final converted = p['convertedVendor'] != null;
                                final interested = p['isInterested'] == true;
                                final notInterested = p['isInterested'] == false;
                                final color = converted ? T.cyan : interested ? T.success : notInterested ? T.danger : T.inkFaint;
                                final label = converted
                                    ? tr('تحوّلت إلى مورد', 'Converted')
                                    : interested
                                        ? tr('مهتم', 'Interested')
                                        : notInterested
                                            ? tr('غير مهتم', 'Not interested')
                                            : tr('قيد المتابعة', 'Following up');
                                return FadeSlideIn(
                                  delayMs: (i * 25).clamp(0, 250),
                                  child: AppCard(
                                    topAccent: color,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(p['companyName'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(label, color),
                                      ]),
                                      const SizedBox(height: 6),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if ((p['contactPerson'] ?? '').toString().isNotEmpty) Chip2(p['contactPerson'], T.inkSoft, icon: Icons.person_outline),
                                        if ((p['phone'] ?? '').toString().isNotEmpty) Chip2(p['phone'], T.navy, icon: Icons.phone_outlined),
                                        if ((p['headquarters'] ?? '').toString().isNotEmpty) Chip2(p['headquarters'], T.cyan, icon: Icons.location_on_outlined),
                                      ]),
                                      if ((p['notes'] ?? '').toString().isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        Text(p['notes'], style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
                                      ],
                                      if (!converted) ...[
                                        const SizedBox(height: 8),
                                        Align(
                                          alignment: AlignmentDirectional.centerEnd,
                                          child: TextButton.icon(
                                            onPressed: () => _convert(p),
                                            icon: const Icon(Icons.upgrade_rounded, size: 18),
                                            label: Text(tr('تحويل إلى مورد', 'Convert to vendor')),
                                          ),
                                        ),
                                      ],
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
