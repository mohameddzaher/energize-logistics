import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/contact.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// إنشاء حمولة — the same flow the web form runs: pick the customer (or add a
/// new one inline), pick the vehicle from a live-availability list (carrying
/// its drivers with it), route, dates, notes → POST /api/fleet/shipments.
class FleetNewShipmentScreen extends StatefulWidget {
  const FleetNewShipmentScreen({super.key});
  @override
  State<FleetNewShipmentScreen> createState() => _FleetNewShipmentScreenState();
}

const _cities = ['جدة', 'الرياض', 'الدمام', 'مكة', 'المدينة', 'ينبع', 'الطائف', 'الخبر', 'جازان', 'أبها', 'تبوك', 'حائل'];

class _FleetNewShipmentScreenState extends State<FleetNewShipmentScreen> {
  List<Map<String, dynamic>> _customers = [];
  List<Map<String, dynamic>> _vehicles = [];
  bool _loading = true;

  Map<String, dynamic>? _customer;
  bool _newCustomer = false;
  final _newCustomerName = TextEditingController();
  final _newCustomerPhone = TextEditingController();

  Map<String, dynamic>? _vehicle;
  String _driverId = '';

  final _fromCity = TextEditingController();
  final _toCity = TextEditingController();
  DateTime _loadDate = DateTime.now();
  DateTime? _expectedArrival;
  final _notes = TextEditingController();
  // حقول البوليصة الخاصة بالحمولة:
  final _rentType = TextEditingController();
  final _driverAdvance = TextEditingController();
  final _branch = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/fleet/customers'),
        Api.instance.get('/api/fleet/vehicles'),
      ]);
      if (!mounted) return;
      setState(() {
        _customers = List<Map<String, dynamic>>.from(results[0]['customers'] ?? []);
        _vehicles = List<Map<String, dynamic>>.from(results[1]['vehicles'] ?? []);
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// سطر توافر السيارة — مطابق لسطر الويب: «متاحة — في جدة» / «عليها حمولة
  /// إلى الرياض» / «وصلت نطاق الوجهة — تفريغ».
  (String, Color) _availability(Map<String, dynamic> v) {
    final trip = v['trip'] as Map<String, dynamic>?;
    if (trip != null) {
      if (v['atDestination'] == true) {
        return (tr('وصلت نطاق ${trip['toCity']} — تفريغ', 'Reached ${trip['toCity']} — unloading'), T.success);
      }
      return (tr('عليها حمولة إلى ${trip['toCity'] ?? '—'}', 'Carrying to ${trip['toCity'] ?? '—'}'), T.warn);
    }
    final city = (v['live'] as Map<String, dynamic>?)?['city'];
    if (city != null && city.toString().isNotEmpty) {
      return (tr('متاحة — في $city', 'Available — in $city'), T.success);
    }
    return (tr('متاحة', 'Available'), T.success);
  }

  Future<P?> _pickSheet<P>({
    required String title,
    required List<P> items,
    required String Function(P) label,
    (String, Color) Function(P)? chip,
    String Function(P)? hint,
  }) {
    final ctrl = TextEditingController();
    String fold(String s) => s
        .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
    return showModalBottomSheet<P>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) {
          final q = fold(ctrl.text.trim());
          final filtered = items.where((x) => q.isEmpty || fold(label(x)).contains(q) || fold(hint?.call(x) ?? '').contains(q)).toList();
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.75,
            maxChildSize: 0.95,
            builder: (c2, scroll) => Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
                child: Row(children: [
                  Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                  Text('${filtered.length}', style: const TextStyle(color: T.inkFaint, fontSize: 13)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  controller: ctrl,
                  autofocus: false,
                  onChanged: (_) => setSheet(() {}),
                  decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                ),
              ),
              const SizedBox(height: 6),
              Expanded(
                child: ListView.builder(
                  controller: scroll,
                  itemCount: filtered.length,
                  itemBuilder: (c3, i) {
                    final item = filtered[i];
                    final ch = chip?.call(item);
                    return ListTile(
                      title: Text(label(item), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      subtitle: hint != null && hint(item).isNotEmpty
                          ? Text(hint(item), style: const TextStyle(fontSize: 12))
                          : null,
                      trailing: ch != null ? Chip2(ch.$1, ch.$2) : null,
                      onTap: () => Navigator.pop(c, item),
                    );
                  },
                ),
              ),
            ]),
          );
        },
      ),
    );
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_customer == null && !_newCustomer) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اختر العميل أولًا', 'Pick a customer'))));
      return;
    }
    if (_newCustomer && _newCustomerName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب اسم العميل الجديد', 'Enter the new customer name'))));
      return;
    }
    if (_fromCity.text.trim().isEmpty || _toCity.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حدد مدينتي التحميل والتنزيل', 'Set from/to cities'))));
      return;
    }
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/fleet/shipments', {
        if (_customer != null) 'customer': _customer!['_id'],
        if (_newCustomer)
          'newCustomer': {'name': _newCustomerName.text, 'phone': _newCustomerPhone.text},
        if (_vehicle != null) 'vehicle': _vehicle!['_id'],
        if (_driverId.isNotEmpty) 'driver': _driverId,
        'fromCity': _fromCity.text.trim(),
        'toCity': _toCity.text.trim(),
        'loadDate': _loadDate.toIso8601String(),
        if (_expectedArrival != null) 'expectedArrival': _expectedArrival!.toUtc().toIso8601String(),
        if (_rentType.text.trim().isNotEmpty) 'rentType': _rentType.text.trim(),
        if (_driverAdvance.text.trim().isNotEmpty) 'driverAdvance': _driverAdvance.text.trim(),
        if (_branch.text.trim().isNotEmpty) 'branch': _branch.text.trim(),
        'notes': _notes.text,
      });
      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _cityField(TextEditingController ctrl, String label) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      TextField(controller: ctrl, decoration: InputDecoration(labelText: label)),
      const SizedBox(height: 6),
      SizedBox(
        height: 32,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: _cities.map((c) => Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: ActionChip(
                  label: Text(c, style: const TextStyle(fontSize: 11.5)),
                  backgroundColor: T.navy.withValues(alpha: 0.06),
                  side: BorderSide.none,
                  visualDensity: VisualDensity.compact,
                  onPressed: () => setState(() => ctrl.text = c),
                ),
              )).toList(),
        ),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final vehicleDrivers = List<Map<String, dynamic>>.from(_vehicle?['drivers'] ?? []);
    return AppScaffold(
      title: Text(tr('إنشاء حمولة', 'New Shipment')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 58), SizedBox(height: 10), Shimmer(height: 58), SizedBox(height: 10), Shimmer(height: 58),
            ])
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // ── العميل ──
                Text(tr('العميل', 'Customer'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 8),
                if (!_newCustomer)
                  Pressable(
                    onTap: () async {
                      final c = await _pickSheet<Map<String, dynamic>>(
                        title: tr('اختر العميل', 'Pick customer'),
                        items: _customers,
                        label: (c) => (c['name'] ?? '').toString(),
                        hint: (c) => (c['phone'] ?? '').toString(),
                      );
                      if (c != null) setState(() => _customer = c);
                    },
                    child: AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                      child: Row(children: [
                        const Icon(Icons.people_outline, color: T.navy, size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(_customer?['name'] ?? tr('— اختر العميل —', '— pick customer —'),
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: _customer == null ? T.inkFaint : T.ink,
                              )),
                        ),
                        Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                      ]),
                    ),
                  ),
                if (_newCustomer) ...[
                  TextField(controller: _newCustomerName, decoration: InputDecoration(labelText: tr('اسم العميل الجديد *', 'New customer name *'))),
                  const SizedBox(height: 8),
                  TextField(controller: _newCustomerPhone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr,
                      decoration: InputDecoration(labelText: tr('جوال العميل', 'Customer phone'))),
                ],
                TextButton.icon(
                  onPressed: () => setState(() { _newCustomer = !_newCustomer; if (_newCustomer) _customer = null; }),
                  icon: Icon(_newCustomer ? Icons.list : Icons.person_add_alt, size: 18),
                  label: Text(_newCustomer ? tr('اختيار من العملاء الحاليين', 'Pick existing customer') : tr('عميل جديد', 'New customer')),
                ),
                const Divider(height: 24),

                // ── السيارة والسائق ──
                Text(tr('السيارة والسائق', 'Vehicle & driver'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 8),
                Pressable(
                  onTap: () async {
                    final v = await _pickSheet<Map<String, dynamic>>(
                      title: tr('اختر السيارة — التوافر لحظي', 'Pick vehicle — live availability'),
                      items: _vehicles,
                      label: (v) => (v['plate'] ?? '').toString(),
                      hint: (v) => [
                        (v['trailerType'] ?? '').toString(),
                        ...List<Map<String, dynamic>>.from(v['drivers'] ?? []).map((d) => (d['name'] ?? '').toString()),
                      ].where((x) => x.isNotEmpty).join(' · '),
                      chip: _availability,
                    );
                    if (v != null) {
                      setState(() {
                        _vehicle = v;
                        final ds = List<Map<String, dynamic>>.from(v['drivers'] ?? []);
                        _driverId = ds.isNotEmpty ? (ds.first['_id'] ?? '').toString() : '';
                      });
                    }
                  },
                  child: AppCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                    child: Row(children: [
                      const Icon(Icons.local_shipping_outlined, color: T.navy, size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _vehicle == null
                            ? Text(tr('— اختر السيارة —', '— pick vehicle —'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.inkFaint))
                            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(_vehicle!['plate'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800)),
                                Chip2(_availability(_vehicle!).$1, _availability(_vehicle!).$2),
                              ]),
                      ),
                      Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                    ]),
                  ),
                ),
                if (vehicleDrivers.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _driverId.isEmpty ? null : _driverId,
                        decoration: InputDecoration(labelText: tr('السائق', 'Driver')),
                        items: vehicleDrivers
                            .map((d) => DropdownMenuItem(value: (d['_id'] ?? '').toString(), child: Text((d['name'] ?? '').toString())))
                            .toList(),
                        onChanged: (v) => setState(() => _driverId = v ?? ''),
                      ),
                    ),
                    // اتصال/واتساب على رقم السائق المختار مباشرة.
                    Builder(builder: (_) {
                      final d = vehicleDrivers.firstWhere((x) => (x['_id'] ?? '').toString() == _driverId, orElse: () => const {});
                      return ContactButtons(phone: (d['phone'] ?? d['mobile'] ?? '').toString(), compact: true);
                    }),
                  ]),
                ],
                const Divider(height: 24),

                // ── خط السير والمواعيد ──
                Text(tr('خط السير والمواعيد', 'Route & dates'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 8),
                _cityField(_fromCity, tr('مدينة التحميل *', 'From city *')),
                const SizedBox(height: 10),
                _cityField(_toCity, tr('مدينة التنزيل *', 'To city *')),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  icon: const Icon(Icons.calendar_month_outlined, size: 18),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                  label: Text('${tr('تاريخ التحميل', 'Load date')}: ${_loadDate.day}/${_loadDate.month}/${_loadDate.year}'),
                  onPressed: () async {
                    final d = await showDatePicker(context: context, initialDate: _loadDate, firstDate: DateTime.now().subtract(const Duration(days: 7)), lastDate: DateTime.now().add(const Duration(days: 90)));
                    if (d != null) setState(() => _loadDate = d);
                  },
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  icon: const Icon(Icons.schedule_outlined, size: 18),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                  label: Text(_expectedArrival == null
                      ? tr('الوصول المتوقع (اختياري)', 'Expected arrival (optional)')
                      : '${tr('الوصول المتوقع', 'ETA')}: ${_expectedArrival!.day}/${_expectedArrival!.month} ${_expectedArrival!.hour}:${_expectedArrival!.minute.toString().padLeft(2, '0')}'),
                  onPressed: () async {
                    final d = await showDatePicker(context: context, initialDate: _expectedArrival ?? DateTime.now(), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 30)));
                    if (d == null || !context.mounted) return;
                    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_expectedArrival ?? DateTime.now()));
                    setState(() => _expectedArrival = DateTime(d.year, d.month, d.day, t?.hour ?? 12, t?.minute ?? 0));
                  },
                ),
                const SizedBox(height: 16),
                // ── بيانات البوليصة (اختياري) ──
                Text(tr('بيانات البوليصة', 'Waybill data'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: TextField(controller: _rentType, decoration: InputDecoration(labelText: tr('نوع الإيجار', 'Rent type')))),
                  const SizedBox(width: 10),
                  Expanded(child: TextField(controller: _driverAdvance, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سلفة السائق', 'Driver advance')))),
                ]),
                const SizedBox(height: 10),
                TextField(controller: _branch, decoration: InputDecoration(labelText: tr('الفرع', 'Branch'))),
                const SizedBox(height: 10),
                TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
                const SizedBox(height: 16),
                FilledButton.icon(
                  icon: const Icon(Icons.add_task_outlined),
                  onPressed: _busy ? null : _submit,
                  label: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(tr('إنشاء الحمولة', 'Create shipment')),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
