import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// أصول الأسطول (الكاوتشات والتريلات والسطحات) — نفس عمليات الويب:
/// تسجيل، فك إلى المستودع/التجديد/التالف/السكراب مع نسبة الحالة، تركيب/نقل
/// مع مصير القاطن وتركيب بديل، نتيجة التجديد، وسجل الأحداث.
class Ls2FleetAssetsScreen extends StatefulWidget {
  const Ls2FleetAssetsScreen({super.key});
  @override
  State<Ls2FleetAssetsScreen> createState() => _Ls2FleetAssetsScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

const _tireStatuses = {
  'mounted': ('مركّبة', 'Mounted', T.success),
  'spare': ('بالمستودع', 'In store', T.info),
  'in_repair': ('تحت التجديد', 'Renewing', T.warn),
  'scrap': ('سكراب', 'Scrap', T.inkFaint),
  'damaged': ('تالفة', 'Damaged', T.danger),
  'retired': ('خارج الخدمة', 'Retired', T.inkFaint),
};

const _conditions = {
  'new': ('جديد', 'New', T.success),
  'used': ('مستعمل', 'Used', T.info),
  'renewed': ('مجدد', 'Renewed', T.violet),
};

class _Ls2FleetAssetsScreenState extends State<Ls2FleetAssetsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  String _q = '';
  String _filter = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/assets/overview');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  Future<void> _post(String path, Map<String, dynamic> body, String okMsg, {Future<bool> Function(Map<String, dynamic>)? onDisplaced}) async {
    try {
      await Api.instance.post(path, body);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } on ApiException catch (e) {
      // «الموقع مشغول» — نسأل عن مصير القاطن ثم نعيد الطلب نفسه + displacedTo.
      if (e.status == 400 && onDisplaced != null && e.message.contains('مشغول')) {
        final retry = await onDisplaced(body);
        if (retry) return;
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final tires = _l(_d?['tires']);
    final counts = _d?['counts'] is Map ? Map<String, dynamic>.from(_d!['counts']) : {};
    final q = _fold(_q.trim());
    final filtered = tires.where((t) {
      if (_filter.isNotEmpty) {
        if (_filter == 'new' || _filter == 'renewed') {
          if (t['condition'] != _filter) return false;
        } else if (t['status'] != _filter) {
          return false;
        }
      }
      if (q.isEmpty) return true;
      return [t['serial'], t['tireNumber'], t['plate'], t['type'], t['size']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    final filterCards = [
      ('', tr('الكل', 'All'), tires.length, T.navy),
      ('mounted', tr('مركّبة', 'Mounted'), counts['mounted'] ?? 0, T.success),
      ('spare', tr('المستودع', 'Store'), counts['spare'] ?? 0, T.info),
      ('new', tr('الجديد', 'New'), tires.where((t) => t['condition'] == 'new').length, T.success),
      ('in_repair', tr('تحت التجديد', 'Renewing'), counts['inRepair'] ?? 0, T.warn),
      ('renewed', tr('المجدد', 'Renewed'), tires.where((t) => t['condition'] == 'renewed').length, T.violet),
      ('scrap', tr('السكراب', 'Scrap'), tires.where((t) => t['status'] == 'scrap').length, T.inkFaint),
      ('damaged', tr('التالف', 'Damaged'), tires.where((t) => t['status'] == 'damaged').length, T.danger),
    ];

    return AppScaffold(
      title: Text(tr('أصول الأسطول', 'Fleet Assets')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createTire,
        icon: const Icon(Icons.add),
        label: Text(tr('كاوتش جديد', 'New tire')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: filterCards.map((f) {
                          final selected = _filter == f.$1;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) => setState(() => _filter = selected ? '' : f.$1),
                              label: Text('${f.$2} (${f.$3})'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : f.$4),
                              selectedColor: f.$4,
                              backgroundColor: f.$4.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالسيريال أو اللوحة أو النوع…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.circle_outlined, title: tr('لا توجد كاوتشات مطابقة', 'No matches'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final t = filtered[i];
                                final st = _tireStatuses[t['status']] ?? ('—', '—', T.inkFaint);
                                final cond = _conditions[t['condition']];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _tireSheet(t),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(
                                            child: Text(
                                              '${(t['tireNumber'] ?? '').toString().isNotEmpty ? '${t['tireNumber']} · ' : ''}${t['serial'] ?? ''}',
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                                            ),
                                          ),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if (cond != null) Chip2(tr(cond.$1, cond.$2), cond.$3),
                                          if (t['conditionPercent'] != null) Chip2('${t['conditionPercent']}%', T.orange),
                                          if ((t['plate'] ?? '').toString().isNotEmpty)
                                            Chip2('${t['plate']}${t['positionNumber'] != null ? ' · ${tr('موضع', 'pos')} ${t['positionNumber']}' : ''}', T.navy, icon: Icons.local_shipping_outlined),
                                          if ((t['type'] ?? '').toString().isNotEmpty) Chip2('${t['type']} ${t['size'] ?? ''}'.trim(), T.inkFaint),
                                          if (t['sensor'] == 'yes') Chip2(tr('حساس', 'Sensor'), T.cyan, icon: Icons.sensors),
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

  // ── تسجيل كاوتش جديد ──
  Future<void> _createTire() async {
    final serial = TextEditingController();
    final tireNumber = TextEditingController();
    final type = TextEditingController();
    final size = TextEditingController();
    final plate = TextEditingController();
    final position = TextEditingController();
    String sensor = 'unknown';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تسجيل كاوتش جديد', 'Register new tire'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: TextField(controller: serial, decoration: InputDecoration(labelText: tr('السيريال *', 'Serial *')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: tireNumber, decoration: InputDecoration(labelText: tr('رقم الكاوتش', 'Tire #')))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: type, decoration: InputDecoration(labelText: tr('النوع', 'Type')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: size, decoration: InputDecoration(labelText: tr('المقاس', 'Size')))),
              ]),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: sensor,
                decoration: InputDecoration(labelText: tr('حساس؟', 'Sensor?')),
                items: [
                  DropdownMenuItem(value: 'unknown', child: Text(tr('غير معروف', 'Unknown'))),
                  DropdownMenuItem(value: 'yes', child: Text(tr('نعم', 'Yes'))),
                  DropdownMenuItem(value: 'no', child: Text(tr('لا', 'No'))),
                ],
                onChanged: (v) => setS(() => sensor = v ?? sensor),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: plate, decoration: InputDecoration(labelText: tr('لوحة الشاحنة (اختياري)', 'Truck plate (optional)')))),
                const SizedBox(width: 10),
                SizedBox(width: 110, child: TextField(controller: position, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الموضع', 'Position')))),
              ]),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (serial.text.trim().isEmpty) return;
                    try {
                      await Api.instance.post('/api/ls2/assets/tires', {
                        'serial': serial.text.trim(),
                        'tireNumber': tireNumber.text.trim(),
                        'type': type.text.trim(),
                        'size': size.text.trim(),
                        'sensor': sensor,
                        if (plate.text.trim().isNotEmpty) 'plate': plate.text.trim(),
                        if (position.text.trim().isNotEmpty) 'positionNumber': num.tryParse(position.text),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل', 'Register')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  // ── ورقة عمليات الكاوتش ──
  Future<void> _tireSheet(Map<String, dynamic> t) async {
    final status = (t['status'] ?? '').toString();
    await showModalBottomSheet(
      context: context,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${t['tireNumber'] ?? ''} ${t['serial'] ?? ''}'.trim(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text(
              '${_tireStatuses[status] != null ? tr(_tireStatuses[status]!.$1, _tireStatuses[status]!.$2) : status}'
              '${(t['plate'] ?? '').toString().isNotEmpty ? ' · ${t['plate']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (status == 'mounted')
                _chip(sheet, Icons.download_outlined, tr('فك من الشاحنة', 'Dismount'), T.warn, () => _dismount(t)),
              if (status == 'spare' || status == 'mounted')
                _chip(sheet, Icons.local_shipping_outlined, status == 'mounted' ? tr('نقل لشاحنة أخرى', 'Transfer') : tr('تركيب على شاحنة', 'Mount'), T.success, () => _mount(t)),
              if (status == 'in_repair')
                _chip(sheet, Icons.autorenew_rounded, tr('نتيجة التجديد', 'Renewal result'), T.violet, () => _renewalResult(t)),
              if (status != 'scrap' && status != 'damaged' && status != 'retired')
                _chip(sheet, Icons.dangerous_outlined, tr('إتلاف/سكراب مباشرة', 'Retire'), T.danger, () => _retire(t)),
            ]),
            const SizedBox(height: 6),
          ]),
        ),
      ),
    );
  }

  Widget _chip(BuildContext sheet, IconData icon, String label, Color color, Future<void> Function() run) =>
      ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: () { Navigator.pop(sheet); run(); },
      );

  // فك: إلى المستودع (بنسبة حالة) أو التجديد أو التالف أو السكراب مباشرة.
  Future<void> _dismount(Map<String, dynamic> t) async {
    String destination = 'store';
    final percent = TextEditingController();
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text(tr('فك الكاوتش — إلى أين؟', 'Dismount — where to?')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            initialValue: destination,
            items: [
              DropdownMenuItem(value: 'store', child: Text(tr('المستودع (احتياطي)', 'Store (spare)'))),
              DropdownMenuItem(value: 'repair', child: Text(tr('التجديد', 'Renewal'))),
              DropdownMenuItem(value: 'damaged', child: Text(tr('تالف', 'Damaged'))),
              DropdownMenuItem(value: 'scrap', child: Text(tr('سكراب مباشرة', 'Straight to scrap'))),
            ],
            onChanged: (v) => setS(() => destination = v ?? destination),
          ),
          if (destination == 'store') ...[
            const SizedBox(height: 10),
            TextField(controller: percent, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('حالته كم ٪؟', 'Condition %'))),
          ],
          const SizedBox(height: 10),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('فك', 'Dismount'))),
        ],
      )),
    );
    if (ok != true) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/move', {
      'toPlate': null,
      'destination': destination,
      if (destination == 'store' && percent.text.trim().isNotEmpty) 'conditionPercent': num.tryParse(percent.text),
      if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
    }, tr('تم الفك', 'Dismounted'));
  }

  // تركيب/نقل: لوحة + موضع؛ لو الموضع مشغول يسأل عن مصير القاطن ويعيد.
  Future<void> _mount(Map<String, dynamic> t) async {
    final plate = TextEditingController(text: (t['plate'] ?? '').toString());
    final position = TextEditingController(text: (t['positionNumber'] ?? '').toString());
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تركيب/نقل الكاوتش', 'Mount / transfer')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: plate, decoration: InputDecoration(labelText: tr('لوحة الشاحنة *', 'Truck plate *'))),
          const SizedBox(height: 10),
          TextField(controller: position, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('رقم الموضع', 'Position #'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تركيب', 'Mount'))),
        ],
      ),
    );
    if (ok != true || plate.text.trim().isEmpty) return;
    final body = {
      'toPlate': plate.text.trim(),
      if (position.text.trim().isNotEmpty) 'positionNumber': num.tryParse(position.text),
    };
    await _post('/api/ls2/assets/tires/${t['_id']}/move', body, tr('تم التركيب', 'Mounted'), onDisplaced: (b) async {
      final fate = await showDialog<String>(
        context: context,
        builder: (c) => SimpleDialog(
          title: Text(tr('الموضع مشغول — مصير الكاوتش الحالي؟', 'Slot occupied — occupant fate?')),
          children: [
            for (final o in [
              ('store', tr('إلى المستودع', 'To store')),
              ('repair', tr('إلى التجديد', 'To renewal')),
              ('damaged', tr('تالف', 'Damaged')),
              ('scrap', tr('سكراب', 'Scrap')),
            ])
              SimpleDialogOption(onPressed: () => Navigator.pop(c, o.$1), child: Text(o.$2)),
          ],
        ),
      );
      if (fate == null) return false;
      await _post('/api/ls2/assets/tires/${t['_id']}/move', {...b, 'displacedTo': fate}, tr('تم التركيب', 'Mounted'));
      return true;
    });
  }

  Future<void> _renewalResult(Map<String, dynamic> t) async {
    final result = await showDialog<String>(
      context: context,
      builder: (c) => SimpleDialog(
        title: Text(tr('نتيجة التجديد', 'Renewal result')),
        children: [
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'renewed'), child: Text(tr('نجح التجديد — إلى المستودع كمجدد', 'Renewed — back to store'))),
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'scrap'), child: Text(tr('فشل — سكراب', 'Failed — scrap'))),
        ],
      ),
    );
    if (result == null) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/renewal-result', {'result': result},
        result == 'renewed' ? tr('عاد للمستودع كمجدد', 'Back in store as renewed') : tr('سُجّل سكراب', 'Scrapped'));
  }

  Future<void> _retire(Map<String, dynamic> t) async {
    final kind = await showDialog<String>(
      context: context,
      builder: (c) => SimpleDialog(
        title: Text(tr('إخراج الكاوتش', 'Retire tire')),
        children: [
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'damaged'), child: Text(tr('تالف', 'Damaged'))),
          SimpleDialogOption(onPressed: () => Navigator.pop(c, 'scrap'), child: Text(tr('سكراب', 'Scrap'))),
        ],
      ),
    );
    if (kind == null) return;
    await _post('/api/ls2/assets/tires/${t['_id']}/retire', {'kind': kind}, tr('تم التسجيل', 'Recorded'));
  }
}
