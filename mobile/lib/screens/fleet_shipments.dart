import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../services/auth.dart';
import 'package:provider/provider.dart';
import 'fleet_new_shipment.dart';
import 'fleet_shipment_details.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// Fleet management shipments: native: search, status filter chips, and a detail sheet with the follow-up form (the 3-hour cadence lives on this screen).
/// Many waybills in one file. Same as the web: loads are marked, then their waybills are printed or saved together from one call that renders them on the server. Marking survives search and filter: a marked row is stored whole in a map, not by id alone, so what was marked is not lost when the list narrows. This is exactly what broke on the web and produced a file with two waybills.
class FleetShipmentsScreen extends StatefulWidget {
  const FleetShipmentsScreen({super.key});
  @override
  State<FleetShipmentsScreen> createState() => _FleetShipmentsScreenState();
}

const _statuses = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

/// Column filters, the same fields and server endpoint as the web table (GET /api/fleet/shipments/filters).
const _filterFields = [
  ('branch', 'الفرع', 'Branch'), ('paymentSubtype', 'نوع الدفع', 'Payment type'), ('customerName', 'العميل', 'Customer'),
  ('fromCity', 'من', 'From'), ('toCity', 'إلى', 'To'), ('supervisorName', 'المشرف', 'Supervisor'),
  ('vehiclePlate', 'اللوحة', 'Plate'), ('driverName', 'السائق', 'Driver'), ('customerType', 'نوع العميل', 'Customer type'),
  ('loadType', 'نوع الحمولة', 'Load type'), ('loadDate', 'تاريخ التحميل', 'Load date'), ('trailerType', 'نوع السيارة', 'Truck type'),
  ('driverExpensePaid', 'صُرف المصروف', 'Expense paid'), ('fridayBonus', 'بدل الجمعة', 'Friday bonus'),
  ('blNumber', 'رقم البوليصة', 'B/L No.'), ('containerNumber', 'رقم الحاوية', 'Container No.'),
];
/// Optional fields on a load card; each person hides what they do not need (saved on the account).
const _cardFields = [
  ('branch', 'الفرع', 'Branch'), ('paymentSubtype', 'نوع الدفع', 'Payment type'), ('vehiclePlate', 'اللوحة', 'Plate'),
  ('driverName', 'السائق', 'Driver'), ('price', 'إيجار السيارة', 'Vehicle rent'), ('fullRent', 'الإيجار كامل', 'Full rent'),
  ('driverExpense', 'مصروف السائق', 'Driver expense'), ('customerType', 'نوع العميل', 'Customer type'), ('loadType', 'نوع الحمولة', 'Load type'),
  ('supervisorName', 'المشرف', 'Supervisor'), ('loadDate', 'تاريخ التحميل', 'Load date'), ('expectedArrival', 'الوصول المتوقع', 'Expected arrival'),
  ('trailerType', 'نوع السيارة', 'Truck type'), ('lastContactAt', 'آخر تواصل', 'Last contact'), ('notes', 'ملاحظات', 'Notes'),
  ('blNumber', 'رقم البوليصة', 'B/L No.'), ('containerNumber', 'رقم الحاوية', 'Container No.'),
];
const _payAr = {'deferred_cash': 'آجل - كاش', 'deferred_invoice': 'آجل - فاتورة', 'cash_3pl': 'نقدي - 3PL', 'cash_ht': 'نقدي - HT'};
const _payEn = {'deferred_cash': 'Deferred – cash', 'deferred_invoice': 'Deferred – invoice', 'cash_3pl': 'Cash – 3PL', 'cash_ht': 'Cash – HT'};

class _FleetShipmentsScreenState extends State<FleetShipmentsScreen> {
  static const _hiddenKey = 'fleetLoads.hidden';
  final Map<String, Set<String>> _cf = {};
  Set<String> _hidden = {};
  int _total = 0;
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _loadTypes = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // Switching the status reloads and destroys the field; text kept in a controller survives with the word.
  final _searchCtl = TextEditingController();
  String _status = '';
  bool _excludeCancelled = false;
  late final void Function() _onLive;
  /// Marked: id to the row itself, so it stays known even when off screen.
  final Map<String, Map<String, dynamic>> _picked = {};
  bool _bulkBusy = false;

  String _loadTypeLabel(String? key) {
    if (key == null || key.isEmpty) return '';
    final it = _loadTypes.firstWhere((x) => (x['key'] ?? '').toString() == key, orElse: () => const {});
    if (it.isEmpty) return key;
    return (Lang.instance.ar ? (it['nameAr'] ?? it['nameEn']) : (it['nameEn'] ?? it['nameAr'])).toString();
  }

  @override
  void initState() {
    super.initState();
    _hidden = {
      for (final ch in context.read<AuthProvider>().pref(_hiddenKey).split(''))
        if (int.tryParse(ch, radix: 36) case final i? when i < _cardFields.length) _cardFields[i].$1,
    };
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = '${_status.isEmpty ? '' : '&status=$_status'}${_excludeCancelled ? '&excludeCancelled=1' : ''}${_cfQuery()}';
      final results = await Future.wait([
        Api.instance.get('/api/fleet/shipments?limit=100$qs'),
        if (_loadTypes.isEmpty)
          Api.instance.get('/api/lookups?type=fleet_load_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['shipments'] ?? []);
        _total = (results[0]['total'] as num?)?.toInt() ?? _rows.length;
        if (results.length > 1) _loadTypes = List<Map<String, dynamic>>.from(results[1]['items'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _cfQuery() => [
        for (final e in _cf.entries)
          for (final v in e.value) '&cf_${e.key}=${Uri.encodeQueryComponent(v)}'
      ].join();

  String _valueLabel(String field, String v) {
    if (v.isEmpty) return tr('(فارغ)', '(blank)');
    if (field == 'paymentSubtype') return (Lang.instance.ar ? _payAr : _payEn)[v] ?? v;
    if (field == 'customerType') return v == 'heavy' ? tr('نقل ثقيل', 'Heavy') : v == 'branch' ? tr('فروع', 'Branch') : v;
    if (field == 'loadType') return _loadTypeLabel(v);
    if (field == 'driverExpensePaid' || field == 'fridayBonus') return v == 'true' ? tr('نعم', 'Yes') : tr('لا', 'No');
    return v;
  }

  /// One column's values with counts under every other filter, then the chosen ones go back to the server.
  Future<void> _pickValues(String field, String label) async {
    final others = Map<String, Set<String>>.from(_cf)..remove(field);
    final qs = [
      'field=$field',
      if (_status.isNotEmpty) 'status=$_status',
      if (_excludeCancelled) 'excludeCancelled=1',
      for (final e in others.entries) for (final v in e.value) 'cf_${e.key}=${Uri.encodeQueryComponent(v)}',
    ].join('&');
    List<Map<String, dynamic>> values;
    try {
      final d = await Api.instance.get('/api/fleet/shipments/filters?$qs');
      values = List<Map<String, dynamic>>.from(((d['filters'] as List?)?.firstOrNull?['values'] as List?) ?? const []);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      return;
    }
    if (!mounted) return;
    final chosen = {...?_cf[field]};
    var q = '';
    final out = await showModalBottomSheet<Set<String>>(
      context: context, isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, set) {
        final shown = values.where((v) => q.isEmpty || _valueLabel(field, '${v['value'] ?? ''}').contains(q)).toList();
        return SafeArea(child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.7,
          child: Column(children: [
            ListTile(
              title: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                TextButton(onPressed: () => set(() => chosen.clear()), child: Text(tr('مسح', 'Clear'))),
                FilledButton(onPressed: () => Navigator.pop(c, chosen), child: Text(tr('تطبيق', 'Apply'))),
              ]),
            ),
            Padding(padding: const EdgeInsets.symmetric(horizontal: 14),
                child: TextField(decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search)), onChanged: (v) => set(() => q = v.trim()))),
            Expanded(child: ListView(children: [
              for (final v in shown)
                CheckboxListTile(
                  dense: true,
                  value: chosen.contains('${v['value'] ?? ''}'),
                  onChanged: (on) => set(() => on == true ? chosen.add('${v['value'] ?? ''}') : chosen.remove('${v['value'] ?? ''}')),
                  title: Text(_valueLabel(field, '${v['value'] ?? ''}')),
                  secondary: Text('${v['count'] ?? 0}', style: const TextStyle(color: T.inkFaint, fontWeight: FontWeight.w700)),
                ),
            ])),
          ]),
        ));
      }),
    );
    if (out == null) return;
    setState(() { if (out.isEmpty) { _cf.remove(field); } else { _cf[field] = out; } _loading = true; });
    _load();
  }

  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (c) => SafeArea(child: ListView(shrinkWrap: true, children: [
        ListTile(
          title: Text(tr('فلاتر الأعمدة', 'Column filters'), style: const TextStyle(fontWeight: FontWeight.w800)),
          trailing: _cf.isEmpty ? null : TextButton(onPressed: () { Navigator.pop(c); setState(() { _cf.clear(); _loading = true; }); _load(); }, child: Text(tr('مسح الكل', 'Clear all'))),
        ),
        for (final f in _filterFields)
          ListTile(
            dense: true,
            title: Text(tr(f.$2, f.$3)),
            trailing: _cf[f.$1] == null ? const Icon(Icons.chevron_left) : Chip2('${_cf[f.$1]!.length}', T.orange),
            onTap: () { Navigator.pop(c); _pickValues(f.$1, tr(f.$2, f.$3)); },
          ),
      ])),
    );
  }

  Future<void> _chooseFields() async {
    final hidden = {..._hidden};
    final picked = await showModalBottomSheet<Set<String>>(
      context: context, isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(child: SizedBox(
        height: MediaQuery.of(c).size.height * 0.7,
        child: ListView(children: [
          ListTile(title: Text(tr('الحقول الظاهرة في البطاقة', 'Fields on the card'), style: const TextStyle(fontWeight: FontWeight.w800)),
              trailing: TextButton(onPressed: () => Navigator.pop(c, hidden), child: Text(tr('حفظ', 'Save')))),
          for (final f in _cardFields)
            CheckboxListTile(dense: true, value: !hidden.contains(f.$1), title: Text(tr(f.$2, f.$3)),
                onChanged: (on) => set(() => on == true ? hidden.remove(f.$1) : hidden.add(f.$1))),
        ]),
      ))),
    );
    if (picked == null || !mounted) return;
    setState(() => _hidden = picked);
    final code = [for (var i = 0; i < _cardFields.length; i++) if (picked.contains(_cardFields[i].$1)) i.toRadixString(36)].join();
    final auth = context.read<AuthProvider>();
    try {
      await Api.instance.patch('/api/auth/me/prefs', {'key': _hiddenKey, 'value': code});
      auth.setPref(_hiddenKey, code);
    } catch (_) {}
  }

  bool _on(String k) => !_hidden.contains(k);
  String _day(dynamic v) { final d = DateTime.tryParse('${v ?? ''}')?.toLocal(); return d == null ? '' : '${d.day}/${d.month}/${d.year}'; }
  String _num(dynamic v) { final n = num.tryParse('${v ?? ''}') ?? 0; return n == 0 ? '' : n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2); }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  void _togglePick(Map<String, dynamic> s) {
    final id = s['_id'].toString();
    setState(() { if (_picked.containsKey(id)) { _picked.remove(id); } else { _picked[id] = s; } });
  }

  /// Marked waybills to one file printed or saved from the system dialog.
  /// The batch is sixty: the server limits the call to a hundred and nginx cuts off after a hundred and twenty seconds, so more is sent in successive batches.
  Future<void> _printPicked() async {
    if (_picked.isEmpty) return;
    setState(() => _bulkBusy = true);
    final ids = _picked.keys.toList();
    try {
      for (var i = 0; i < ids.length; i += 60) {
        final part = ids.sublist(i, i + 60 > ids.length ? ids.length : i + 60);
        final bytes = await Api.instance.postBytes('/api/fleet/shipments/waybills.pdf', {'ids': part});
        await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'أوامر نقل-الشحن-${part.length}');
      }
      if (mounted) setState(() => _picked.clear());
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر توليد أوامر النقل', 'Could not generate the waybills')),
        ));
      }
    } finally {
      if (mounted) setState(() => _bulkBusy = false);
    }
  }

  void _open(Map<String, dynamic> s) {
    Navigator.push(context, MaterialPageRoute(
        builder: (c) => FleetShipmentDetailsScreen(shipmentId: s['_id'].toString())));
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((s) {
      if (q.isEmpty) return true;
      return [s['waybillNumber'], s['customerName'], s['vehiclePlate'], s['driverName'], s['fromCity'], s['toCity']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('شحنات الأسطول', 'Fleet Shipments')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF12325C),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: Text(tr('إنشاء حمولة', 'New shipment')),
        onPressed: () async {
          final created = await Navigator.push<bool>(
              context, MaterialPageRoute(builder: (c) => const FleetNewShipmentScreen()));
          if (created == true) _load();
        },
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: SearchField(
                      controller: _searchCtl,
                      onChanged: (v) => setState(() => _q = v),
                      hint: tr('ابحث برقم أمر النقل أو العميل أو اللوحة…', 'Search waybill, customer, plate…'),
                      // How many loads match the filters on the server, not just the ones loaded here.
                      suffixText: '$_total',
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          ActionChip(
                            avatar: const Icon(Icons.filter_alt_outlined, size: 16),
                            label: Text(_cf.isEmpty ? tr('فلاتر', 'Filters') : '${tr('فلاتر', 'Filters')} (${_cf.length})', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                            backgroundColor: _cf.isEmpty ? null : T.orange.withValues(alpha: 0.12),
                            onPressed: _openFilters,
                          ),
                          const SizedBox(width: 6),
                          ActionChip(
                            avatar: const Icon(Icons.view_column_outlined, size: 16),
                            label: Text(tr('الحقول', 'Fields'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                            onPressed: _chooseFields,
                          ),
                          const SizedBox(width: 6),
                          FilterChip(
                            selected: _excludeCancelled,
                            onSelected: (_) {
                              setState(() { _excludeCancelled = !_excludeCancelled; _loading = true; });
                              _load();
                            },
                            label: Text(tr('باستثناء الملغاة', 'Excluding cancelled'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                          ),
                          ..._statuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) {
                                setState(() { _status = selected ? '' : e.key; _loading = true; });
                                _load();
                              },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }),
                        ],
                      ),
                    ),
                  ),
                  // Marked bar: its count, how many are outside the current search results, and the print/save button, so someone searching does not doubt their marking is kept.
                  if (_picked.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: T.orange.withValues(alpha: 0.08),
                        border: Border.all(color: T.orange.withValues(alpha: 0.4)),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('${_picked.length} أمر نقل محدَّدة', '${_picked.length} selected'),
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                            if (_pickedOffScreen(filtered) > 0)
                              Text(
                                tr('منها ${_pickedOffScreen(filtered)} خارج نتائج البحث — محفوظة',
                                   '${_pickedOffScreen(filtered)} outside the current results — kept'),
                                style: const TextStyle(fontSize: 11, color: Colors.black54)),
                          ]),
                        ),
                        IconButton(
                          tooltip: tr('إلغاء التحديد', 'Clear'),
                          onPressed: _bulkBusy ? null : () => setState(_picked.clear),
                          icon: const Icon(Icons.close, size: 20, color: T.danger),
                        ),
                        FilledButton.icon(
                          onPressed: _bulkBusy ? null : _printPicked,
                          icon: _bulkBusy
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.print_outlined, size: 18),
                          label: Text(_bulkBusy ? tr('يجهّز…', 'Preparing…') : tr('طباعة / حفظ', 'Print / save')),
                        ),
                      ]),
                    ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد شحنات مطابقة', 'No matching shipments'))
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final s = filtered[i];
                                final st = _statuses[s['status']] ?? ('—', '—', T.inkFaint);
                                final picked = _picked.containsKey(s['_id'].toString());
                                return FadeSlideIn(
                                  delayMs: (i * 25).clamp(0, 250),
                                  child: Pressable(
                                    // A tap opens and a long press marks; once marking has started a normal tap marks too, so a long press is not needed for each waybill.
                                    onTap: () => _picked.isEmpty ? _open(s) : _togglePick(s),
                                    onLongPress: () => _togglePick(s),
                                    child: AppCard(
                                      topAccent: picked ? T.orange : st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Icon(picked ? Icons.check_box : Icons.check_box_outline_blank,
                                              size: 18, color: picked ? T.orange : Colors.black26),
                                          const SizedBox(width: 6),
                                          Text('${tr('أمر نقل', 'WB')} ${s['waybillNumber'] ?? ''}',
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                          const Spacer(),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 6),
                                        Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}${(s['customerName'] ?? '').toString().isNotEmpty ? ' · ${s['customerName']}' : ''}',
                                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 6),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if (_on('branch') && (s['branch'] ?? '').toString().isNotEmpty)
                                            Chip2(s['branch'].toString(), T.navy, icon: Icons.store_mall_directory_outlined),
                                          if (_on('paymentSubtype') && (s['paymentSubtype'] ?? '').toString().isNotEmpty)
                                            Chip2(_valueLabel('paymentSubtype', s['paymentSubtype'].toString()), T.violet, icon: Icons.credit_card_outlined),
                                          if (_on('vehiclePlate') && (s['vehiclePlate'] ?? '').toString().isNotEmpty)
                                            Chip2(s['vehiclePlate'].toString(), T.navy, icon: Icons.local_shipping_outlined),
                                          if (_on('trailerType') && (s['trailerType'] ?? '').toString().isNotEmpty)
                                            Chip2(s['trailerType'].toString(), T.inkSoft, icon: Icons.rv_hookup_outlined),
                                          if (_on('driverName') && (s['driverName'] ?? '').toString().isNotEmpty)
                                            Chip2(s['driverName'].toString(), T.inkSoft, icon: Icons.person_outline),
                                          if (_on('price') && _num(s['price']).isNotEmpty)
                                            Chip2('${tr('إيجار', 'Rent')} ${_num(s['price'])}', T.success, icon: Icons.payments_outlined),
                                          if (_on('fullRent') && _num(s['fullRent']).isNotEmpty)
                                            Chip2('${tr('الإيجار كامل', 'Full rent')} ${_num(s['fullRent'])}', T.success),
                                          if (_on('driverExpense') && _num(s['driverExpense']).isNotEmpty)
                                            Chip2('${tr('مصروف السائق', 'Driver expense')} ${_num(s['driverExpense'])}', T.warn),
                                          if (_on('customerType') && s['customerType'] == 'heavy')
                                            Chip2(tr('نقل ثقيل', 'Heavy'), T.violet, icon: Icons.workspace_premium_outlined),
                                          if (_on('customerType') && s['customerType'] == 'branch')
                                            Chip2(tr('عميل فروع', 'Branch'), T.info, icon: Icons.store_outlined),
                                          if (_on('loadType') && _loadTypeLabel((s['loadType'] ?? '').toString()).isNotEmpty)
                                            Chip2(_loadTypeLabel((s['loadType'] ?? '').toString()), T.inkSoft, icon: Icons.category_outlined),
                                          if (_on('supervisorName') && (s['supervisorName'] ?? '').toString().isNotEmpty)
                                            Chip2(s['supervisorName'].toString(), T.inkSoft, icon: Icons.badge_outlined),
                                          if (_on('loadDate') && _day(s['loadDate']).isNotEmpty)
                                            Chip2('${tr('التحميل', 'Loaded')} ${_day(s['loadDate'])}', T.inkSoft, icon: Icons.event_outlined),
                                          if (_on('expectedArrival') && _day(s['expectedArrival']).isNotEmpty)
                                            Chip2('${tr('الوصول المتوقع', 'ETA')} ${_day(s['expectedArrival'])}', T.inkSoft, icon: Icons.schedule_outlined),
                                          if (_on('blNumber') && (s['blNumber'] ?? '').toString().isNotEmpty)
                                            Chip2('${tr('البوليصة', 'B/L')} ${s['blNumber']}', T.navy, icon: Icons.description_outlined),
                                          if (_on('containerNumber') && (s['containerNumber'] ?? '').toString().isNotEmpty)
                                            Chip2('${tr('الحاوية', 'Container')} ${s['containerNumber']}', T.navy, icon: Icons.inventory_2_outlined),
                                          if (_on('notes') && (s['notes'] ?? '').toString().isNotEmpty)
                                            Chip2(s['notes'].toString(), T.inkFaint, icon: Icons.notes_outlined),
                                          if ((s['driverPhone'] ?? '').toString().isNotEmpty)
                                            ContactButtons(phone: (s['driverPhone']).toString(), compact: true, size: 17),
                                          if (_on('lastContactAt') && s['lastContactAt'] != null)
                                            Chip2('${tr('آخر تواصل', 'Last contact')}: ${_ago(s['lastContactAt'])}',
                                                _hoursSince(s['lastContactAt']) >= 3 ? T.danger : T.success,
                                                icon: Icons.phone_in_talk_outlined),
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

  /// How many of the marked are absent from the list currently displayed.
  int _pickedOffScreen(List<Map<String, dynamic>> shown) {
    final ids = shown.map((r) => r['_id'].toString()).toSet();
    return _picked.keys.where((id) => !ids.contains(id)).length;
  }

  int _hoursSince(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? 999 : DateTime.now().difference(d).inHours;
  }

  String _ago(String? v) {
    final h = _hoursSince(v);
    if (h >= 999) return '—';
    if (h < 1) return tr('منذ أقل من ساعة', '<1h ago');
    return tr('منذ $h ساعة', '${h}h ago');
  }
}
