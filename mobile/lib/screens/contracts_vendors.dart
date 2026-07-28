import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// سجل موردي 3PL — the contracts vendor register, native: status summary
/// chips, Arabic-folded search, and a detail sheet per vendor with a call
/// button and the contract essentials.
class ContractsVendorsScreen extends StatefulWidget {
  const ContractsVendorsScreen({super.key});
  @override
  State<ContractsVendorsScreen> createState() => _ContractsVendorsScreenState();
}

const _statusMeta = {
  'signed': ('موقّع', 'Signed', T.success),
  'pending': ('قيد التوقيع', 'Pending', T.warn),
  'unsigned': ('غير موقّع', 'Unsigned', T.inkFaint),
};

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replaceAll('ؤ', 'و')
    .replaceAll('ئ', 'ي')
    .toLowerCase();

class _ContractsVendorsScreenState extends State<ContractsVendorsScreen> {
  List<Map<String, dynamic>> _vendors = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
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
      final d = await Api.instance.get('/api/contracts/vendors');
      if (!mounted) return;
      setState(() {
        _vendors = List<Map<String, dynamic>>.from(d['vendors'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _open(Map<String, dynamic> v) {
    final st = _statusMeta[v['status']] ?? _statusMeta['unsigned']!;
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(v['name'] ?? '', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
              Chip2(tr(st.$1, st.$2), st.$3),
            ]),
            const SizedBox(height: 14),
            _row(Icons.person_outline, tr('ممثل المورد', 'Contact'), v['contactPerson']),
            _row(Icons.support_agent_outlined, tr('مندوب التنشيط', 'Rep'), v['energizeRep']),
            _row(Icons.location_city_outlined, tr('المقر', 'HQ'), v['headquarters']),
            _row(Icons.local_shipping_outlined, tr('عدد السيارات', 'Fleet'), '${v['fleetSize'] ?? 0}'),
            _row(Icons.route_outlined, tr('الوجهات', 'Destinations'), v['destinations']),
            if (v['rating'] != null)
              _row(Icons.star_outline, tr('التقييم', 'Rating'), '${v['rating']}/5'),
            const SizedBox(height: 14),
            if ((v['phone'] ?? '').toString().isNotEmpty)
              FilledButton.icon(
                icon: const Icon(Icons.phone_outlined),
                label: Text('${tr('اتصال', 'Call')} — ${v['phone']}', textDirection: TextDirection.ltr),
                onPressed: () {}, // Placeholder: url_launcher later; number visible for manual dial.
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, dynamic value) {
    final text = (value ?? '').toString();
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 16, color: T.inkFaint),
        const SizedBox(width: 8),
        Text('$label: ', style: const TextStyle(fontSize: 13, color: T.inkSoft)),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _vendors.where((v) {
      if (_status.isNotEmpty && v['status'] != _status) return false;
      if (q.isEmpty) return true;
      return [v['name'], v['energizeRep'], v['contactPerson'], v['phone'], v['headquarters']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    int countOf(String s) => _vendors.where((v) => v['status'] == s).length;

    return Scaffold(
      appBar: AppBar(title: Text(tr('سجل موردي 3PL', '3PL Vendor Register'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10),
              Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالاسم أو المندوب أو المقر…', 'Search name, rep, HQ…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _statusMeta.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) => setState(() => _status = selected ? '' : e.key),
                              label: Text('${tr(e.value.$1, e.value.$2)} (${countOf(e.key)})'),
                              labelStyle: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700,
                                color: selected ? Colors.white : e.value.$3,
                              ),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.business_outlined, title: tr('لا توجد نتائج مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = filtered[i];
                                final st = _statusMeta[v['status']] ?? _statusMeta['unsigned']!;
                                return FadeSlideIn(
                                  delayMs: (i * 25).clamp(0, 300),
                                  child: Pressable(
                                    onTap: () => _open(v),
                                    child: AppCard(
                                      child: Row(children: [
                                        Container(
                                          width: 42, height: 42,
                                          decoration: BoxDecoration(
                                            color: st.$3.withValues(alpha: 0.1),
                                            borderRadius: BorderRadius.circular(12),
                                          ),
                                          child: Icon(Icons.business_outlined, color: st.$3, size: 20),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text(v['name'] ?? '',
                                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                                maxLines: 1, overflow: TextOverflow.ellipsis),
                                            const SizedBox(height: 2),
                                            Text(
                                              [v['headquarters'], v['energizeRep']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                              style: const TextStyle(fontSize: 12, color: T.inkSoft),
                                              maxLines: 1, overflow: TextOverflow.ellipsis,
                                            ),
                                          ]),
                                        ),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                          const SizedBox(height: 4),
                                          Text(tr('${v['fleetSize'] ?? 0} سيارة', '${v['fleetSize'] ?? 0} vehicles'),
                                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                        ]),
                                      ]),
                                    ),
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
