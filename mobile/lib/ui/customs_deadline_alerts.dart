import 'dart:async';
import 'package:flutter/material.dart';
import '../screens/customs_detail.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import 'theme.dart';

/// Demurrage and container-return deadlines (GET /api/customs-clearance/deadline-alerts), same as the web
/// «التنبيهات» button and the per-transaction banner. The countdown ticks locally from `deadlineAt`.
class _Feed {
  static final _Feed instance = _Feed._();
  _Feed._() {
    for (final e in const ['customs:updated', 'customs:created', 'customs:deleted']) { Live.instance.on(e, load); }
  }
  final ValueNotifier<List<Map<String, dynamic>>?> items = ValueNotifier(null);
  Future<void> load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/deadline-alerts');
      items.value = List<Map<String, dynamic>>.from((d['items'] as List?) ?? const []);
    } catch (_) { items.value ??= const []; }
  }
}

const _day = Duration(days: 1);

int _msLeft(Map a) => (DateTime.tryParse('${a['deadlineAt']}')?.millisecondsSinceEpoch ?? 0) - DateTime.now().millisecondsSinceEpoch;

String _state(int ms) => ms < 0 ? 'overdue' : ms <= _day.inMilliseconds ? 'today' : ms <= 3 * _day.inMilliseconds ? 'soon' : 'ok';

Color _tone(String st) => switch (st) { 'overdue' => T.danger, 'today' => T.orange, 'soon' => T.warn, _ => T.inkSoft };

String deadlineCountdown(int ms) {
  final a = ms.abs();
  final d = a ~/ _day.inMilliseconds, h = (a % _day.inMilliseconds) ~/ 3600000, m = (a % 3600000) ~/ 60000;
  final isAr = Lang.instance.ar;
  final parts = isAr
      ? [if (d > 0) '$d يوم', if (d > 0 || h > 0) '$h ساعة', '$m دقيقة']
      : [if (d > 0) '${d}d', if (d > 0 || h > 0) '${h}h', '${m}m'];
  final txt = parts.join(isAr ? ' و' : ' ');
  if (ms < 0) return isAr ? 'متأخّرة منذ $txt' : 'Overdue by $txt';
  return isAr ? 'متبقٍّ $txt' : '$txt left';
}

String _typeLabel(Map a) => a['type'] == 'demurrage'
    ? tr('موعد الأرضيات', 'Demurrage date')
    : tr('آخر موعد إرجاع الحاويات', 'Container return deadline');

/// App-bar button with a badge; opens the alerts sheet.
class CustomsAlertsButton extends StatefulWidget {
  const CustomsAlertsButton({super.key});
  @override
  State<CustomsAlertsButton> createState() => _CustomsAlertsButtonState();
}

class _CustomsAlertsButtonState extends State<CustomsAlertsButton> {
  @override
  void initState() { super.initState(); _Feed.instance.load(); }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<List<Map<String, dynamic>>?>(
        valueListenable: _Feed.instance.items,
        builder: (_, items, __) {
          final list = items ?? const [];
          final overdue = list.where((a) => _msLeft(a) < 0).length;
          return IconButton(
            tooltip: tr('التنبيهات', 'Alerts'),
            onPressed: () => showModalBottomSheet(context: context, isScrollControlled: true, builder: (_) => const _AlertsSheet()),
            icon: Badge(
              isLabelVisible: list.isNotEmpty,
              backgroundColor: overdue > 0 ? T.danger : T.orange,
              label: Text('${list.length}'),
              child: Icon(Icons.notifications_active_outlined, color: overdue > 0 ? T.danger : null),
            ),
          );
        },
      );
}

class _AlertsSheet extends StatefulWidget {
  const _AlertsSheet();
  @override
  State<_AlertsSheet> createState() => _AlertsSheetState();
}

class _AlertsSheetState extends State<_AlertsSheet> {
  String _tab = 'all';
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() { _tick?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<List<Map<String, dynamic>>?>(
        valueListenable: _Feed.instance.items,
        builder: (_, items, __) {
          final all = items ?? const <Map<String, dynamic>>[];
          final shown = all.where((a) => _tab == 'all' || a['type'] == _tab).toList();
          final overdue = all.where((a) => _msLeft(a) < 0).length;
          final soon = all.where((a) => _state(_msLeft(a)) != 'ok').length - overdue;
          Widget stat(String l, int n, Color c) => Expanded(child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(color: c.withValues(alpha: 0.09), borderRadius: BorderRadius.circular(12)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: c)),
                  Text('$n', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: c)),
                ]),
              ));
          return SafeArea(child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.8,
            child: Padding(padding: const EdgeInsets.fromLTRB(14, 14, 14, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('تنبيهات الأرضيات وإرجاع الحاويات', 'Demurrage & return alerts'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
              const SizedBox(height: 10),
              Row(children: [stat(tr('متأخّرة', 'Overdue'), overdue, T.danger), const SizedBox(width: 6), stat(tr('خلال 3 أيام', 'Within 3 days'), soon, T.warn), const SizedBox(width: 6), stat(tr('الإجمالي', 'Total'), all.length, T.navy)]),
              const SizedBox(height: 10),
              Wrap(spacing: 6, children: [
                for (final t in [('all', tr('الكل', 'All')), ('demurrage', tr('الأرضيات', 'Demurrage')), ('return', tr('إرجاع الحاويات', 'Returns'))])
                  ChoiceChip(label: Text('${t.$2} ${all.where((a) => t.$1 == 'all' || a['type'] == t.$1).length}'), selected: _tab == t.$1, onSelected: (_) => setState(() => _tab = t.$1)),
              ]),
              const SizedBox(height: 8),
              Expanded(child: items == null
                  ? const Center(child: CircularProgressIndicator())
                  : shown.isEmpty
                      ? Center(child: Text(tr('لا مواعيد مفتوحة.', 'No open deadlines.'), style: const TextStyle(color: T.inkFaint)))
                      : ListView.separated(
                          itemCount: shown.length, separatorBuilder: (_, __) => const SizedBox(height: 6),
                          itemBuilder: (_, i) {
                            final a = shown[i];
                            final ms = _msLeft(a);
                            final c = _tone(_state(ms));
                            return InkWell(
                              borderRadius: BorderRadius.circular(12),
                              onTap: () { Navigator.pop(context); Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: '${a['clearanceId']}', ref: '${a['refNumber'] ?? ''}'))); },
                              child: Container(
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(color: c.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12), border: Border.all(color: c.withValues(alpha: 0.3))),
                                child: Row(children: [
                                  Icon(a['type'] == 'demurrage' ? Icons.anchor : Icons.keyboard_return, color: c, size: 20),
                                  const SizedBox(width: 10),
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${(a['blNumber'] ?? '').toString().isNotEmpty ? a['blNumber'] : a['refNumber']}  ·  ${a['refNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                    Text('${_typeLabel(a)} · ${a['date']}${(a['customerName'] ?? '').toString().isNotEmpty ? ' · ${a['customerName']}' : ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                  ])),
                                  const SizedBox(width: 6),
                                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                    Text(deadlineCountdown(ms), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: c)),
                                    if (a['type'] == 'demurrage' && a['cargoType'] == 'vehicles')
                                      TextButton.icon(
                                        style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
                                        onPressed: () => _editDays(context, a),
                                        icon: const Icon(Icons.edit_calendar_outlined, size: 16),
                                        label: Text('${a['demurrageDays'] ?? 15} ${tr('يومًا', 'days')}', style: const TextStyle(fontSize: 12)),
                                      ),
                                  ]),
                                ]),
                              ),
                            );
                          },
                        )),
              Text(tr('يُغلق تنبيه الأرضيات عند نقل كل الوحدات من الميناء، ويُغلق تنبيه الإرجاع عند إرجاع كل الحاويات.', 'A demurrage alert closes once every unit leaves the port; a return alert once every container is returned.'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ])),
          ));
        },
      );
}

/// Vehicles: change the free days; the server moves the floor date and the feed refreshes on the customs event.
Future<void> _editDays(BuildContext context, Map a) async {
  final ctl = TextEditingController(text: '${a['demurrageDays'] ?? 15}');
  final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
    title: Text(tr('أيام الأرضيات', 'Free days')),
    content: TextField(controller: ctl, keyboardType: TextInputType.number, autofocus: true,
        decoration: InputDecoration(helperText: tr('موعد الأرضيات = موعد التفريغ + هذه الأيام', 'Demurrage date = unloading + these days'))),
    actions: [
      TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
      FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
    ],
  ));
  final n = int.tryParse(ctl.text.trim()) ?? 0;
  ctl.dispose();
  if (ok != true || n <= 0) return;
  try {
    await Api.instance.put('/api/customs-clearance/${a['clearanceId']}', {'demurrageDays': n});
    await _Feed.instance.load();
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
  }
}

/// One transaction's open deadlines, for the top of its detail screen.
class CustomsDeadlineBanner extends StatefulWidget {
  final String clearanceId;
  const CustomsDeadlineBanner({super.key, required this.clearanceId});
  @override
  State<CustomsDeadlineBanner> createState() => _CustomsDeadlineBannerState();
}

class _CustomsDeadlineBannerState extends State<CustomsDeadlineBanner> {
  Timer? _tick;
  @override
  void initState() {
    super.initState();
    _Feed.instance.load();
    _tick = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() { _tick?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<List<Map<String, dynamic>>?>(
        valueListenable: _Feed.instance.items,
        builder: (_, items, __) {
          final mine = (items ?? const <Map<String, dynamic>>[]).where((a) => '${a['clearanceId']}' == widget.clearanceId).toList();
          if (mine.isEmpty) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(children: [
              for (final a in mine)
                Builder(builder: (_) {
                  final ms = _msLeft(a);
                  final c = _tone(_state(ms));
                  return Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                    decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: c.withValues(alpha: 0.35))),
                    child: Row(children: [
                      Icon(ms < 0 ? Icons.warning_amber_rounded : a['type'] == 'demurrage' ? Icons.anchor : Icons.keyboard_return, color: c, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text('${_typeLabel(a)} ${a['date']}', style: TextStyle(fontWeight: FontWeight.w700, color: c, fontSize: 13))),
                      Text(deadlineCountdown(ms), style: TextStyle(fontWeight: FontWeight.w900, color: c, fontSize: 12.5)),
                    ]),
                  );
                }),
            ]),
          );
        },
      );
}
