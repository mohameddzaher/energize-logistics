import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../resource/configs.dart' show customerEditRoles;
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_customer_presence.dart';
import 'ops_common.dart' show opsPickMonth, opsYmd, opsQs;
import '../ui/portal_account_card.dart';
import '../ui/search_field.dart';

/// Customer profile, matching web /system/{operations,shipment-orders,sales}/customers/[id] (one screen).
/// Identity, then the customer data edited in place, then figures, then one routes list (worked and agreed joined, with the agreed price and tiers), then the trips.
class CustomerRegistryProfileScreen extends StatefulWidget {
  final String customerId;
  const CustomerRegistryProfileScreen({super.key, required this.customerId});
  @override
  State<CustomerRegistryProfileScreen> createState() => _CustomerRegistryProfileScreenState();
}

/// Example: "1-5: 2,200 · 6 and above: 2,400"
String _tiersText(dynamic tiers) => List.from(tiers ?? []).map((t) {
      final a = t['minTrucks'], b = t['maxTrucks'];
      final range = b == null ? tr('$a فأكثر', '$a+') : (a == b ? '$a' : '$a–$b');
      return '$range: ${_money(t['price'])}';
    }).join(' · ');

String _money(dynamic v) {
  if (v == null) return '—';
  final n = (v is num) ? v : num.tryParse(v.toString()) ?? 0;
  final s = n.round().abs().toString();
  final b = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return b.toString();
}

String _day(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month}/${d.year}';
}

String _sourceLabel(String s) {
  switch (s) {
    case 'sheet': return tr('من تقرير الفروع', 'branches report');
    case 'order': return tr('من شحنة أُنشئت', 'created shipment');
    case 'private': return tr('من التشغيل — خاصّ', 'Operations — private');
    case 'platform': return tr('من منصّة التشغيل', 'ops platform');
    case 'manual': return tr('أُدخل يدويًّا', 'entered by hand');
    default: return s;
  }
}

/// Arabic folding for joining a worked route to its agreed price, as the web does (foldAr).
String _fold(dynamic x) => (x ?? '').toString()
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim()
    .toLowerCase()
    .replaceAll(RegExp('[أإآ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replaceAll('ؤ', 'و')
    .replaceAll('ئ', 'ي')
    .replaceAll(RegExp('[ً-ْ]'), '');

String _routeKey(dynamic from, dynamic to) => '${_fold(from)}→${_fold(to)}';

/// Shipment-form preferences autofilled for this customer; same keys as the web.
const _defaultKeys = [
  ('truckType', 'نوع الشاحنة', 'Truck type'),
  ('cargoType', 'نوع الحمولة', 'Cargo type'),
  ('paymentMethod', 'طريقة الدفع', 'Payment method'),
  ('driverRentType', 'نوع تأجير السائق', 'Driver rent type'),
  ('branch', 'الفرع', 'Branch'),
];

class _CustomerRegistryProfileScreenState extends State<CustomerRegistryProfileScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  int _page = 1;
  late final void Function() _onLive;
  // Trip filters, same params as the web: '' | this_month | last_month | month | range, plus search. The server resolves the months on the Riyadh calendar.
  String _mode = '';
  DateTime? _month;
  DateTimeRange? _range;
  String _q = '';
  Timer? _qDebounce;
  // Held here so the typed text survives the list being rebuilt while a page loads.
  final _searchCtl = TextEditingController();
  int _seq = 0;
  bool _busy = false;
  String _routeFilter = 'all';
  List<Map<String, dynamic>> _fields = const [];

  @override
  void initState() {
    super.initState();
    _load();
    _loadOptions();
    // Every write (here, on the web, by another user) emits this event; the file re-reads so all screens agree.
    _onLive = () => _load();
    Live.instance.on('shipmentOrders:customers', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:customers', _onLive);
    _qDebounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  /// Same option lists the shipment form reads: cities for routes, values for the preferences.
  Future<void> _loadOptions() async {
    try {
      final d = await Api.instance.get('/api/customer-registry/options');
      if (!mounted) return;
      setState(() => _fields = List<Map<String, dynamic>>.from((d is Map ? d['fields'] : null) ?? []));
    } catch (_) {/* the pickers fall back to the saved value */}
  }

  List<(String, String)> _optionsOf(String key) {
    final f = _fields.firstWhere((x) => x['key'] == key, orElse: () => const {});
    return List.from(f['options'] ?? []).map((o) {
      final k = (o['key'] ?? '').toString();
      final label = (Lang.instance.ar ? o['ar'] : o['en'])?.toString();
      return (k, (label == null || label.isEmpty) ? k : label);
    }).toList();
  }

  // Read during build only, so it watches the session.
  bool get _canEdit {
    final auth = context.watch<AuthProvider>();
    return customerEditRoles.contains(auth.role) || auth.canEditSection('Shipment Orders');
  }

  /// Partial save; the server keeps every field not sent and emits the live event.
  Future<bool> _put(Map<String, dynamic> patch, {String? ok}) async {
    try {
      await Api.instance.put('/api/customer-registry/${widget.customerId}', patch);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok ?? tr('تم الحفظ', 'Saved'))));
      await _load();
      return true;
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      return false;
    }
  }

  Future<String?> _askText(String title, String initial, {bool multiline = false, bool number = false, bool ltr = false}) async {
    final ctl = TextEditingController(text: initial);
    final v = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        content: TextField(
          controller: ctl, autofocus: true,
          minLines: multiline ? 3 : 1, maxLines: multiline ? 6 : 1,
          keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : (multiline ? TextInputType.multiline : TextInputType.text),
          textDirection: ltr ? TextDirection.ltr : null,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.orange),
            onPressed: () => Navigator.pop(c, ctl.text), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    ctl.dispose();
    return v;
  }

  Future<void> _editField(String key, String label, String current, {bool multiline = false, bool ltr = false, bool required = false}) async {
    final v = await _askText(label, current, multiline: multiline, ltr: ltr);
    if (v == null) return;
    final next = multiline ? v : v.trim();
    if (required && next.trim().isEmpty) return;
    if (next == current) return;
    await _put({key: next});
  }

  Future<void> _pickDefault(Map<String, String> defaults, String key, String label) async {
    final cur = defaults[key] ?? '';
    final opts = _optionsOf(key);
    final picked = await showModalBottomSheet<String>(
      context: context, backgroundColor: Colors.white, isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
          ListTile(title: const Text('—'), trailing: cur.isEmpty ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, '')),
          // A saved value stays listed even if it left the list, so it is not silently wiped.
          if (cur.isNotEmpty && !opts.any((o) => o.$1 == cur))
            ListTile(title: Text(cur), trailing: const Icon(Icons.check, color: T.orange), onTap: () => Navigator.pop(c, cur)),
          for (final o in opts)
            ListTile(title: Text(o.$2), trailing: o.$1 == cur ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, o.$1)),
        ]),
      )),
    );
    if (picked == null || picked == cur) return;
    await _put({'defaults': {...defaults, key: picked}});
  }

  /// The price list is saved whole, as the web does; the server carries tiers over by route key.
  Future<bool> _saveRoutes(List<Map<String, dynamic>> routes, {String? ok}) => _put({
        'routes': routes.where((r) => '${r['fromCity'] ?? ''}'.isNotEmpty && '${r['toCity'] ?? ''}'.isNotEmpty).map((r) => {
              'fromCity': r['fromCity'], 'toCity': r['toCity'], 'price': r['price'],
              if (r['at'] != null) 'at': r['at'],
              if ('${r['source'] ?? ''}'.isNotEmpty) 'source': r['source'],
              if (r['hits'] != null) 'hits': r['hits'],
            }).toList(),
      }, ok: ok);

  Future<bool> _setRoutePrice(String from, String to, num? price) {
    final list = List<Map<String, dynamic>>.from((_data?['customer']?['routes'] ?? []).map((r) => Map<String, dynamic>.from(r)));
    final k = _routeKey(from, to);
    final i = list.indexWhere((r) => _routeKey(r['fromCity'], r['toCity']) == k);
    // A price typed by hand is dated today with source "manual", so it wins as the latest agreed price.
    final stamp = {'price': price, 'at': DateTime.now().toUtc().toIso8601String(), 'source': 'manual'};
    if (i >= 0) {
      list[i] = {...list[i], ...stamp};
    } else {
      list.insert(0, {'fromCity': from, 'toCity': to, 'hits': 1, ...stamp});
    }
    return _saveRoutes(list, ok: tr('حُفظ السعر', 'Price saved'));
  }

  Future<void> _editPrice(Map<String, dynamic> r) async {
    final v = await _askText('${tr('السعر المتّفق', 'Agreed price')} — ${r['from']} ← ${r['to']}',
        r['price'] == null ? '' : '${r['price']}', number: true, ltr: true);
    if (v == null) return;
    final t = v.trim();
    final n = t.isEmpty ? null : num.tryParse(t);
    if (t.isNotEmpty && (n == null || n < 0)) return;
    if (n == r['price']) return;
    await _setRoutePrice(r['from'], r['to'], n);
  }

  Future<void> _removeRoute(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف السعر المتّفق عليه', 'Remove agreed price')),
        content: Text(tr('يُحذف المسار ${r['from']} ← ${r['to']} من قائمة الأسعار المتّفق عليها. لا تتأثّر الرحلات المسجّلة.',
            '${r['from']} → ${r['to']} will be removed from the agreed price list. Recorded trips are not affected.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Remove'))),
        ],
      ),
    );
    if (ok != true) return;
    final list = List<Map<String, dynamic>>.from((_data?['customer']?['routes'] ?? []).map((x) => Map<String, dynamic>.from(x)))
        .where((x) => _routeKey(x['fromCity'], x['toCity']) != r['key']).toList();
    await _saveRoutes(list, ok: tr('حُذف المسار', 'Route removed'));
  }

  /// Adds an agreed route; a route already listed gets the new price instead of a duplicate.
  Future<void> _addRoute() async {
    final cities = _optionsOf('fromCity').map((o) => o.$1).toList();
    TextEditingController? fromCtl, toCtl;
    final priceCtl = TextEditingController();
    Widget cityField(String label, void Function(TextEditingController) keep) => Autocomplete<String>(
          optionsBuilder: (v) {
            final s = _fold(v.text);
            return s.isEmpty ? cities.take(30) : cities.where((c) => _fold(c).contains(s)).take(30);
          },
          fieldViewBuilder: (c, ctl, focus, onSubmit) {
            keep(ctl);
            return TextField(controller: ctl, focusNode: focus,
                decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder()));
          },
        );
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => Padding(
        padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('إضافة مسار', 'Add route'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 12),
          cityField(tr('من', 'From'), (x) => fromCtl = x),
          const SizedBox(height: 10),
          cityField(tr('إلى', 'To'), (x) => toCtl = x),
          const SizedBox(height: 10),
          TextField(controller: priceCtl, keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: tr('السعر', 'Price'), isDense: true, border: const OutlineInputBorder())),
          const SizedBox(height: 14),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.orange, padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: () => Navigator.pop(c, true), child: Text(tr('إضافة', 'Add')),
          ),
        ]),
      ),
    );
    final from = fromCtl?.text.trim() ?? '', to = toCtl?.text.trim() ?? '', p = priceCtl.text.trim();
    priceCtl.dispose();
    if (ok != true || from.isEmpty || to.isEmpty) return;
    final n = p.isEmpty ? null : num.tryParse(p);
    if (p.isNotEmpty && (n == null || n < 0)) return;
    await _setRoutePrice(from, to, n);
  }

  /// Routes worked (sheets) and routes agreed (price list) joined by the folded city pair, as on the web.
  List<Map<String, dynamic>> _unifiedRoutes(Map<String, dynamic> d, bool money) {
    final m = <String, Map<String, dynamic>>{};
    for (final r in List.from(d['routes'] ?? [])) {
      final k = _routeKey(r['from'], r['to']);
      m[k] = {
        'key': k, 'from': r['from'] ?? '', 'to': r['to'] ?? '', 'sheets': r['sheets'] ?? 0, 'purchase': r['purchase'],
        'lastAt': r['lastAt'], 'price': r['price'], 'priceAt': r['priceAt'], 'priceSource': r['priceSource'] ?? '',
        'tiers': List.from(r['tiers'] ?? []), 'agreed': false, 'hits': 0,
      };
    }
    for (final a in List.from(d['customer']?['routes'] ?? [])) {
      final k = _routeKey(a['fromCity'], a['toCity']);
      final ex = m[k];
      if (ex != null) {
        ex.addAll({'agreed': true, 'price': a['price'], 'priceAt': a['at'], 'priceSource': a['source'] ?? '', 'hits': a['hits'] ?? 1});
        if ((ex['tiers'] as List).isEmpty) ex['tiers'] = List.from(a['tiers'] ?? []);
      } else {
        m[k] = {
          'key': k, 'from': a['fromCity'] ?? '', 'to': a['toCity'] ?? '', 'sheets': 0, 'purchase': null, 'lastAt': null,
          'price': a['price'], 'priceAt': a['at'], 'priceSource': a['source'] ?? '', 'tiers': List.from(a['tiers'] ?? []),
          'agreed': true, 'hits': a['hits'] ?? 1,
        };
      }
    }
    final rows = m.values.toList();
    for (final r in rows) {
      r['worked'] = (r['sheets'] as num) > 0;
      r['priced'] = r['price'] != null || (r['tiers'] as List).isNotEmpty;
    }
    rows.sort((x, y) {
      final s = (y['sheets'] as num).compareTo(x['sheets'] as num);
      if (s != 0) return s;
      return '${y['priceAt'] ?? ''}'.compareTo('${x['priceAt'] ?? ''}');
    });
    return rows;
  }

  /// Price tiers by vehicle count, counterpart of `TierEditor` on the web.
  Future<void> _editTiers(Map<String, dynamic> route) async {
    final rows = List.from(route['tiers'] ?? []).map((t) => [
          TextEditingController(text: '${t['minTrucks'] ?? ''}'),
          TextEditingController(text: t['maxTrucks'] == null ? '' : '${t['maxTrucks']}'),
          TextEditingController(text: '${t['price'] ?? ''}'),
        ]).toList();
    if (rows.isEmpty) rows.add([TextEditingController(text: '1'), TextEditingController(), TextEditingController()]);
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        Widget f(TextEditingController t, String label) => Expanded(child: Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: TextField(controller: t, keyboardType: TextInputType.number,
              decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder())),
        ));
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('السعر بعدد السيارات', 'Price by truck count'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text('${route['from'] ?? ''} ← ${route['to'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(tr('السعرُ للسيارة الواحدة، بحسب عدد السيارات التي يطلبها العميل على المسار. اترك «إلى» فارغةً في آخر شريحةٍ لتعني «فما فوق». و«التشغيل — خاصّ» يكتب للأمر نقل أعلى سعرٍ هنا.',
                'Price per truck, by how many trucks the customer orders on the route. Leave “to” empty on the last tier for “and above”. Operations — private applies the highest price.'),
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 12),
            for (var i = 0; i < rows.length; i++) Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                f(rows[i][0], tr('من عدد', 'From')), f(rows[i][1], tr('إلى عدد', 'To')), f(rows[i][2], tr('سعر السيارة', 'Per truck')),
                IconButton(icon: const Icon(Icons.close, size: 18, color: T.inkFaint), onPressed: () => set(() => rows.removeAt(i))),
              ]),
            ),
            Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
              icon: const Icon(Icons.add), label: Text(tr('شريحة أخرى', 'Another tier')),
              onPressed: () => set(() {
                final last = rows.isEmpty ? null : int.tryParse(rows.last[1].text);
                rows.add([TextEditingController(text: last == null ? '' : '${last + 1}'), TextEditingController(), TextEditingController()]);
              }),
            )),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.navy, padding: const EdgeInsets.symmetric(vertical: 14)),
              onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')),
            ),
          ])),
        );
      }),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/customer-registry/${widget.customerId}/route-tiers', {
        'fromCity': route['from'], 'toCity': route['to'],
        'tiers': rows.where((r) => r.any((t) => t.text.trim().isNotEmpty)).map((r) => {
              'minTrucks': int.tryParse(r[0].text.trim()), 'maxTrucks': r[1].text.trim().isEmpty ? null : int.tryParse(r[1].text.trim()),
              'price': num.tryParse(r[2].text.trim()),
            }).toList(),
      });
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  List<(String, String)> get _filterParams => [
        if (_mode == 'this_month' || _mode == 'last_month') ('preset', _mode),
        if (_mode == 'month' && _month != null) ('month', opsYmd(_month!).substring(0, 7)),
        if (_mode == 'range' && _range != null) ...[('from', opsYmd(_range!.start)), ('to', opsYmd(_range!.end))],
        if (_q.isNotEmpty) ('q', _q),
      ];

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = opsQs([..._filterParams, ('page', '$_page'), ('limit', '25')]);
      final d = await Api.instance.get('/api/customer-registry/${widget.customerId}?$qs');
      // A slower reply to an older filter must not overwrite the newer one.
      if (!mounted || mine != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _busy = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _busy = false; _error = e.toString(); });
    }
  }

  /// A filter change reloads in place from page 1, without the skeleton, so the filter bar is not rebuilt under the user's finger.
  void _refilter() {
    setState(() { _page = 1; _busy = true; });
    _load();
  }

  Future<void> _pickMode(String m) async {
    if (m == 'month') {
      final now = DateTime.now();
      final picked = await opsPickMonth(context, _month ?? DateTime(now.year, now.month));
      if (picked == null) return;
      _month = picked;
    } else if (m == 'range') {
      final now = DateTime.now();
      final picked = await showDateRangePicker(
          context: context, initialDateRange: _range, firstDate: DateTime(2018), lastDate: DateTime(now.year + 1, 12, 31));
      if (picked == null) return;
      _range = picked;
    }
    _mode = m;
    _refilter();
  }

  String _modeLabel(String m) {
    switch (m) {
      case 'this_month': return tr('هذا الشهر', 'This month');
      case 'last_month': return tr('الشهر الماضي', 'Last month');
      case 'month':
        return _mode == 'month' && _month != null
            ? '${_month!.month.toString().padLeft(2, '0')}/${_month!.year}'
            : tr('شهر محدّد', 'A month');
      case 'range':
        return _mode == 'range' && _range != null
            ? '${_day(_range!.start.toIso8601String())} – ${_day(_range!.end.toIso8601String())}'
            : tr('من — إلى', 'Custom range');
      default: return tr('كلّ المدّة', 'All time');
    }
  }

  Widget _filterBar(Map<String, dynamic>? d) {
    final period = d?['period'] is Map ? Map<String, dynamic>.from(d!['period']) : null;
    return AppCard(
      padding: const EdgeInsets.all(10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final m in const ['', 'this_month', 'last_month', 'month', 'range'])
            ChoiceChip(
              visualDensity: VisualDensity.compact,
              label: Text(_modeLabel(m), style: const TextStyle(fontSize: 12)),
              selected: _mode == m,
              // Month and range reopen their picker even when already selected, to change the choice.
              onSelected: (_) {
                if (m == 'month' || m == 'range') { _pickMode(m); return; }
                if (_mode == m) return;
                _mode = m;
                _refilter();
              },
            ),
        ]),
        const SizedBox(height: 8),
        SearchField(
          controller: _searchCtl,
          dense: true,
          hint: tr('بحث: رقم، سائق، مركبة، مدينة…', 'Search: number, driver, vehicle, city…'),
          onChanged: (v) {
            _qDebounce?.cancel();
            _qDebounce = Timer(const Duration(milliseconds: 350), () {
              if (!mounted || v.trim() == _q) return;
              _q = v.trim();
              _refilter();
            });
          },
        ),
        if (_busy) const Padding(padding: EdgeInsets.only(top: 6), child: LinearProgressIndicator(minHeight: 2)),
        if (d?['filtered'] == true) ...[
          const SizedBox(height: 6),
          Text(
            '${tr('الأرقام والمسارات والرحلات أدناه بحسب الفلاتر المختارة', 'Figures, routes and trips below follow the chosen filters')}'
            '${period != null ? ' — ${_ymdLabel(period['from'], tr('البداية', 'start'))} ${tr('إلى', 'to')} ${_ymdLabel(period['to'], tr('اليوم', 'today'))}' : ''}',
            style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
          ),
        ],
      ]),
    );
  }

  /// "2026-10-01" as 1/10/2026, read as a calendar day (no zone shift).
  String _ymdLabel(dynamic ymd, String empty) {
    final s = (ymd ?? '').toString();
    final p = s.split('-');
    if (p.length != 3) return empty;
    return '${int.tryParse(p[2]) ?? p[2]}/${int.tryParse(p[1]) ?? p[1]}/${p[0]}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final c = d != null ? Map<String, dynamic>.from(d['customer'] ?? {}) : <String, dynamic>{};
    final a = d != null ? Map<String, dynamic>.from(d['analysis'] ?? {}) : <String, dynamic>{};
    final sheets = d != null ? Map<String, dynamic>.from(d['sheets'] ?? {}) : <String, dynamic>{};
    final trips = List<Map<String, dynamic>>.from(sheets['rows'] ?? []);
    // Money is hidden from those who cannot see it; the server drops the field, so no empty card is drawn.
    final money = a['purchaseTotal'] != null;

    return AppScaffold(
      title: Text(c['name']?.toString() ?? tr('ملف العميل', 'Customer')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 200),
            ])
          : _error != null || d == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      _header(c, a),
                      const SizedBox(height: 10),
                      // "Same customer in" block and portal account, like the web customer profile.
                      CustomerPresence(reg: 'shipment', id: widget.customerId, onChanged: _load),
                      const SizedBox(height: 8),
                      PortalAccountCard(source: 'shipment_order_customer', refId: widget.customerId, name: c['name']?.toString()),
                      const SizedBox(height: 12),
                      _detailsCard(c),
                      const SizedBox(height: 12),
                      // Period and search drive the tiles, routes and trips below (server-side, like the web).
                      _filterBar(d),
                      const SizedBox(height: 10),
                      _tiles(a, money),
                      const SizedBox(height: 12),
                      _routesCard(d, money),
                      const SizedBox(height: 12),
                      _tripsCard(sheets, trips, money),
                    ],
                  ),
                ),
    );
  }

  Widget _cardTitle(String title, IconData icon, {String? count, Widget? trailing}) => Row(children: [
        Icon(icon, size: 18, color: T.orange),
        const SizedBox(width: 6),
        Expanded(child: Text.rich(TextSpan(children: [
          TextSpan(text: title),
          if (count != null) TextSpan(text: '  $count', style: const TextStyle(color: T.inkFaint, fontWeight: FontWeight.w700, fontSize: 13)),
        ]), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: T.ink))),
        if (trailing != null) trailing,
      ]);

  Widget _header(Map<String, dynamic> c, Map<String, dynamic> a) {
    final name = (c['name'] ?? '').toString();
    final code = (c['customerCode'] ?? '').toString();
    final phone = (c['phone'] ?? '').toString();
    final email = (c['email'] ?? '').toString();
    final active = c['isActive'] != false;
    final branches = List.from(a['branches'] ?? []);
    return AppCard(
      topAccent: T.orange,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 48, height: 48, alignment: Alignment.center,
            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
            child: Text(name.isEmpty ? '?' : name.characters.first,
                style: const TextStyle(color: T.orange, fontSize: 22, fontWeight: FontWeight.w900)),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: T.ink, height: 1.2)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2(active ? tr('نشط', 'Active') : tr('موقوف', 'Inactive'), active ? T.success : T.inkFaint),
              if (code.isNotEmpty) Chip2(code, T.navy, icon: Icons.tag),
            ]),
          ])),
        ]),
        if (phone.isNotEmpty) ...[
          const SizedBox(height: 10),
          Row(children: [
            const Icon(Icons.phone_outlined, size: 15, color: T.inkSoft),
            const SizedBox(width: 6),
            Text(phone, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            const Spacer(),
            ContactButtons(phone: phone, compact: true),
          ]),
        ],
        if (email.isNotEmpty) ...[
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.mail_outline, size: 15, color: T.inkSoft),
            const SizedBox(width: 6),
            Expanded(child: Text(email, textDirection: TextDirection.ltr, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
          ]),
        ],
        if (branches.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(tr('الفروع:', 'Branches:'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            ...branches.map((b) => Chip2(b.toString(), T.navy)),
          ]),
        ],
      ]),
    );
  }

  /// One customer field: label over value; tapping it edits in place when the user may edit.
  Widget _fieldRow(String label, String value, {VoidCallback? onTap, bool ltr = false, bool multiline = false}) {
    final empty = value.isEmpty;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(empty ? (onTap != null ? tr('أضف…', 'Add…') : '—') : value,
                textDirection: ltr && !empty ? TextDirection.ltr : null,
                maxLines: multiline ? null : 2,
                style: TextStyle(fontSize: 14, fontWeight: empty ? FontWeight.w500 : FontWeight.w700, color: empty ? T.inkFaint : T.ink)),
          ])),
          if (onTap != null) const Padding(padding: EdgeInsets.only(top: 10), child: Icon(Icons.edit_outlined, size: 16, color: T.inkFaint)),
        ]),
      ),
    );
  }

  Widget _detailsCard(Map<String, dynamic> c) {
    final edit = _canEdit;
    final defaults = <String, String>{
      for (final k in _defaultKeys) k.$1: '',
      ...Map<String, dynamic>.from(c['defaults'] ?? {}).map((k, v) => MapEntry(k, (v ?? '').toString())),
    };
    String optLabel(String key, String v) {
      for (final o in _optionsOf(key)) { if (o.$1 == v) return o.$2; }
      return v;
    }
    const div = Divider(height: 1, color: T.line);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _cardTitle(tr('بيانات العميل', 'Customer details'), Icons.person_outline),
        if (edit)
          Padding(padding: const EdgeInsets.only(top: 4),
              child: Text(tr('اضغط على أيّ حقلٍ لتعديله؛ يُحفظ التعديل فورًا ويظهر في كلّ الأقسام.', 'Tap any field to edit it; changes save at once and show everywhere.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
        const SizedBox(height: 6),
        _fieldRow(tr('الاسم', 'Name'), (c['name'] ?? '').toString(),
            onTap: edit ? () => _editField('name', tr('الاسم', 'Name'), (c['name'] ?? '').toString(), required: true) : null),
        div,
        _fieldRow(tr('الجوال', 'Phone'), (c['phone'] ?? '').toString(), ltr: true,
            onTap: edit ? () => _editField('phone', tr('الجوال', 'Phone'), (c['phone'] ?? '').toString(), ltr: true) : null),
        div,
        _fieldRow(tr('البريد', 'Email'), (c['email'] ?? '').toString(), ltr: true,
            onTap: edit ? () => _editField('email', tr('البريد', 'Email'), (c['email'] ?? '').toString(), ltr: true) : null),
        div,
        _fieldRow(tr('كود العميل', 'Customer code'), (c['customerCode'] ?? '').toString(), ltr: true),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('التفضيلات المعتمدة (تُملأ تلقائيًّا في الشحنة)', 'Usual defaults (autofilled on the shipment form)'),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
            for (final k in _defaultKeys)
              _fieldRow(tr(k.$2, k.$3), optLabel(k.$1, defaults[k.$1] ?? ''),
                  onTap: edit ? () => _pickDefault(defaults, k.$1, tr(k.$2, k.$3)) : null),
          ]),
        ),
        const SizedBox(height: 6),
        _fieldRow(tr('ملاحظات', 'Notes'), (c['notes'] ?? '').toString(), multiline: true,
            onTap: edit ? () => _editField('notes', tr('ملاحظات', 'Notes'), (c['notes'] ?? '').toString(), multiline: true) : null),
      ]),
    );
  }

  Widget _tiles(Map<String, dynamic> a, bool money) => GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        childAspectRatio: 1.7,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        children: [
          _tile(tr('الرحلات (أوامر نقل)', 'Trips (sheets)'), '${a['sheets'] ?? 0}', T.orange, Icons.route_outlined),
          if (money) _tile(tr('قيمة الشراء', 'Purchase total'), _money(a['purchaseTotal']), T.violet, Icons.payments_outlined),
          if (money) _tile(tr('متوسّط الرحلة', 'Avg per trip'), _money(a['avgPerSheet']), T.navy, Icons.trending_up_rounded),
          _tile(tr('مسارات متّفق عليها', 'Agreed routes'), '${a['routesCount'] ?? 0}', T.info, Icons.alt_route_outlined),
          _tile(tr('منها مُسعَّرة', 'Priced'), '${a['pricedRoutes'] ?? 0}',
              (a['pricedRoutes'] ?? 0) < (a['routesCount'] ?? 0) ? T.warn : T.success, Icons.sell_outlined),
          _tile(tr('أوّل عمل', 'First work'), _day(a['firstAt']), T.inkSoft, Icons.event_outlined),
          _tile(tr('آخر عمل', 'Last work'), _day(a['lastAt']), T.cyan, Icons.event_available_outlined),
        ],
      );

  Widget _routesCard(Map<String, dynamic> d, bool money) {
    final filtered = d['filtered'] == true;
    final priceEditor = d['canEditPrices'] == true;
    final tierEditor = d['canEditTiers'] == true;
    final rows = _unifiedRoutes(d, money);
    final counts = {
      'all': rows.length,
      'priced': rows.where((r) => r['worked'] == true && r['priced'] == true).length,
      'no_price': rows.where((r) => r['worked'] == true && r['priced'] != true).length,
      'idle': rows.where((r) => r['worked'] != true).length,
    };
    final shown = rows.where((r) => switch (_routeFilter) {
          'priced' => r['worked'] == true && r['priced'] == true,
          'no_price' => r['worked'] == true && r['priced'] != true,
          'idle' => r['worked'] != true,
          _ => true,
        }).toList();
    final idleLabel = filtered ? tr('لا رحلات في الفترة', 'No trips in period') : tr('لم يُعمل عليه', 'Never worked');
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _cardTitle(tr('المسارات والأسعار', 'Routes & prices'), Icons.alt_route_outlined, count: '${rows.length}',
            trailing: priceEditor
                ? TextButton.icon(
                    style: TextButton.styleFrom(foregroundColor: T.orange, visualDensity: VisualDensity.compact),
                    onPressed: _addRoute, icon: const Icon(Icons.add, size: 18), label: Text(tr('إضافة مسار', 'Add route')))
                : null),
        const SizedBox(height: 4),
        Text(tr('كلّ مسارٍ عمل عليه العميل أو له سعرٌ متّفق عليه، في صفٍّ واحد.', 'Every route the customer ran or has an agreed price for, in one row.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final (k, label) in [
            ('all', tr('الكل', 'All')), ('priced', tr('مُسعَّرة', 'Priced')),
            ('no_price', tr('بلا سعر متّفق', 'No agreed price')), ('idle', idleLabel),
          ])
            ChoiceChip(
              visualDensity: VisualDensity.compact,
              label: Text('$label ${counts[k]}', style: const TextStyle(fontSize: 12)),
              selected: _routeFilter == k,
              onSelected: (_) => setState(() => _routeFilter = k),
            ),
        ]),
        const SizedBox(height: 6),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 18),
            child: Text(rows.isEmpty ? tr('لا توجد مسارات بعد.', 'No routes yet.') : tr('لا توجد مسارات مطابقة.', 'No matching routes.'),
                textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          ),
        for (var i = 0; i < shown.length && i < 40; i++) ...[
          if (i > 0) const Divider(height: 1, color: T.line),
          _routeRow(shown[i], money, priceEditor, tierEditor, idleLabel),
        ],
        if (shown.length > 40)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(tr('و${shown.length - 40} مسارًا آخر — تُقرأ كلُّها على الويب', '${shown.length - 40} more — see the web page'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ),
      ]),
    );
  }

  Widget _routeRow(Map<String, dynamic> r, bool money, bool priceEditor, bool tierEditor, String idleLabel) {
    final worked = r['worked'] == true, priced = r['priced'] == true, agreed = r['agreed'] == true;
    final status = worked && !priced
        ? Chip2(tr('بلا سعر متّفق', 'No agreed price'), T.warn)
        : !worked ? Chip2(idleLabel, T.inkFaint) : Chip2(tr('مُسعَّر', 'Priced'), T.success);
    final meta = <String>[
      '${tr('رحلات', 'trips')}: ${r['sheets']}',
      if (worked) _day(r['lastAt']),
      if (money && worked && r['purchase'] != null) '${tr('شراء', 'purchase')}: ${_money(r['purchase'])}',
    ];
    final tiers = List.from(r['tiers'] ?? []);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['from']} ← ${r['to']}', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: worked ? T.ink : T.inkSoft)),
            const SizedBox(height: 4),
            status,
          ])),
          InkWell(
            onTap: priceEditor ? () => _editPrice(r) : null,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                r['price'] == null
                    ? Text(tr('بلا سعر', 'no price'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: T.warn))
                    : Text(_money(r['price']), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: T.ink)),
                if (priceEditor) const Padding(padding: EdgeInsetsDirectional.only(start: 4), child: Icon(Icons.edit_outlined, size: 15, color: T.inkFaint)),
              ]),
            ),
          ),
        ]),
        const SizedBox(height: 4),
        Text(meta.join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        if (agreed && r['priceAt'] != null)
          Text('${tr('تاريخ السعر', 'Price date')}: ${_day(r['priceAt'])}'
              '${'${r['priceSource'] ?? ''}'.isNotEmpty ? ' · ${_sourceLabel(r['priceSource'].toString())}' : ''}',
              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        if (tiers.isNotEmpty || tierEditor || (priceEditor && agreed))
          Row(children: [
            Expanded(child: tiers.isEmpty
                ? const SizedBox.shrink()
                : Text(_tiersText(tiers), style: const TextStyle(fontSize: 11.5, color: T.success, fontWeight: FontWeight.w700))),
            // Price tiers are editable only by the operations manager and the system admin.
            if (tierEditor)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: tr('السعر بعدد السيارات', 'Price by truck count'),
                icon: const Icon(Icons.stacked_bar_chart_rounded, size: 18, color: T.inkSoft),
                onPressed: () => _editTiers(r),
              ),
            if (priceEditor && agreed)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: tr('حذف من الأسعار المتّفق عليها', 'Remove from agreed prices'),
                icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                onPressed: () => _removeRoute(r),
              ),
          ]),
      ]),
    );
  }

  // Trips page by page: a customer can have thousands of sheets.
  Widget _tripsCard(Map<String, dynamic> sheets, List<Map<String, dynamic>> trips, bool money) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _cardTitle(tr('الرحلات', 'Trips'), Icons.local_shipping_outlined, count: '${sheets['total'] ?? 0}'),
          const SizedBox(height: 8),
          if (trips.isEmpty)
            Text(tr('لا توجد رحلات.', 'No trips.'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          ...trips.map((s) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${s['fromLocation'] ?? ''} ← ${s['toLocation'] ?? ''}',
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                    Text([
                      '#${s['reportNumber'] ?? '—'}',
                      _day(s['reportDate']),
                      if ((s['branch'] ?? '').toString().isNotEmpty) s['branch'].toString(),
                      if ((s['driverName'] ?? '').toString().isNotEmpty) s['driverName'].toString(),
                    ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ])),
                  if (money && s['purchaseValue'] != null)
                    Text(_money(s['purchaseValue']),
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.violet)),
                ]),
              )),
          if (((sheets['pages'] ?? 1) as num) > 1) ...[
            const Divider(height: 20),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(
                onPressed: _page <= 1 ? null : () { setState(() { _page--; _busy = true; }); _load(); },
                icon: const Icon(Icons.chevron_right_rounded)),
              Text('${tr('صفحة', 'Page')} ${sheets['page'] ?? 1} / ${sheets['pages'] ?? 1}',
                  style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
              IconButton(
                onPressed: (sheets['page'] ?? 1) >= (sheets['pages'] ?? 1)
                    ? null
                    : () { setState(() { _page++; _busy = true; }); _load(); },
                icon: const Icon(Icons.chevron_left_rounded)),
            ]),
          ],
        ]),
      );

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 8),
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1)),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}
