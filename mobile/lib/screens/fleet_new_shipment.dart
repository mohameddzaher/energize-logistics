import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/contact.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// Create a load, the same flow the web form runs: pick the customer (or add a new one inline), pick the vehicle from a live-availability list (carrying its drivers with it), route, dates, notes, POST /api/fleet/shipments.
/// With `editId` it is the same edit screen as the web (`/system/fleet/new?id=`): filled from GET /api/fleet/shipments/:id and saved with PUT.
class FleetNewShipmentScreen extends StatefulWidget {
  final String? editId;
  const FleetNewShipmentScreen({super.key, this.editId});
  @override
  State<FleetNewShipmentScreen> createState() => _FleetNewShipmentScreenState();
}

// Load statuses, same as FLEET_STATUSES on the web.
const _statusOptions = [
  ('requesting', 'قيد الطلب', 'Requesting'),
  ('loading', 'جاري التحميل', 'Loading'),
  ('uploaded', 'تم التحميل', 'Uploaded'),
  ('on_way', 'في الطريق', 'On way'),
  ('arrived', 'وصلت', 'Arrived'),
  ('bond_sent', 'أُرسل السند', 'Bond sent'),
  ('bond_received', 'استُلم السند', 'Bond received'),
  ('late', 'متأخرة', 'Late'),
  ('invoiced', 'تمت الفوترة', 'Invoiced'),
  ('cancelled', 'ملغاة', 'Cancelled'),
];

const _cities = ['جدة', 'الرياض', 'الدمام', 'مكة', 'المدينة', 'ينبع', 'الطائف', 'الخبر', 'جازان', 'أبها', 'تبوك', 'حائل'];

class _FleetNewShipmentScreenState extends State<FleetNewShipmentScreen> {
  List<Map<String, dynamic>> _customers = [];
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _drivers = []; // All section drivers, like the web list.
  bool _loading = true;
  bool get _isEdit => (widget.editId ?? '').isNotEmpty;
  String _status = 'requesting';

  Map<String, dynamic>? _customer;
  bool _newCustomer = false;
  final _newCustomerName = TextEditingController();
  final _newCustomerPhone = TextEditingController();

  Map<String, dynamic>? _vehicle;
  String _driverId = '';
  String _secondDriverId = ''; // Second driver (optional, for faster arrival).

  final _fromCity = TextEditingController();
  final _toCity = TextEditingController();
  DateTime _loadDate = DateTime.now();
  DateTime? _expectedArrival;
  final _notes = TextEditingController();
  // Load/pricing fields.
  final _vehicleRent = TextEditingController();   // Vehicle rent = section income.
  final _fullRent = TextEditingController();       // Full rent (optional).
  final _driverExpense = TextEditingController();  // Driver expense.
  Map<String, dynamic>? _rentTypeItem;             // Rent type list item.
  Map<String, dynamic>? _paymentTypeItem;
  Map<String, dynamic>? _loadTypeItem;
  String _customerType = '';                       // heavy / branch
  String? _branch;
  bool _fridayBonus = false;
  List<Map<String, dynamic>> _rentTypes = [], _paymentTypes = [], _loadTypes = [], _branches = [];
  bool get _isFriday => DateTime.now().weekday == DateTime.friday;
  bool _busy = false;
  String? _error;

  String _lkLabel(Map<String, dynamic>? it) => it == null
      ? ''
      : (Lang.instance.ar ? (it['nameAr'] ?? it['nameEn']) : (it['nameEn'] ?? it['nameAr'])).toString();

  // The difference between full rent and vehicle rent goes to the branches section (3PL scenario).
  int get _branchShare {
    final rent = num.tryParse(_vehicleRent.text.trim()) ?? 0;
    final full = num.tryParse(_fullRent.text.trim()) ?? 0;
    final diff = full - rent;
    return diff > 0 ? diff.round() : 0;
  }

  // Chip-style choice button (customer type).
  Widget _segBtn(String label, bool active, VoidCallback onTap) => Pressable(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(vertical: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? T.orange.withValues(alpha: 0.12) : Colors.white,
            border: Border.all(color: active ? T.orange : const Color(0xFFE2E8F0), width: active ? 1.4 : 1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: active ? T.orange : T.inkFaint)),
        ),
      );

  // Searchable reference dropdown (rent/payment/load type) through _pickSheet.
  Widget _lkPicker(String label, Map<String, dynamic>? selected, List<Map<String, dynamic>> items, void Function(Map<String, dynamic>?) onPick) => Pressable(
        onTap: () async {
          final v = await _pickSheet<Map<String, dynamic>>(
            title: label,
            items: items,
            label: (x) => _lkLabel(x),
          );
          if (v != null) onPick(v);
        },
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14)),
          child: Row(children: [
            Expanded(child: Text(_lkLabel(selected).isEmpty ? tr('اختر…', 'Select…') : _lkLabel(selected),
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: _lkLabel(selected).isEmpty ? T.inkFaint : T.ink))),
            const Icon(Icons.expand_more, size: 18, color: T.inkFaint),
          ]),
        ),
      );

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _newCustomerName.dispose();
    _newCustomerPhone.dispose();
    _fromCity.dispose();
    _toCity.dispose();
    _notes.dispose();
    _vehicleRent.dispose();
    _fullRent.dispose();
    _driverExpense.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      _error = null;
      final results = await Future.wait([
        Api.instance.get('/api/fleet/customers'),
        Api.instance.get('/api/fleet/vehicles'),
        Api.instance.get('/api/lookups?type=fleet_rent_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        Api.instance.get('/api/lookups?type=fleet_payment_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        Api.instance.get('/api/lookups?type=fleet_load_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        Api.instance.get('/api/branches?active=true').catchError((_) => <String, dynamic>{'branches': []}),
        Api.instance.get('/api/fleet/drivers').catchError((_) => <String, dynamic>{'drivers': []}),
      ]);
      // Edit: the load itself is applied after the lists, so its items can be matched against them.
      final ship = _isEdit
          ? (await Api.instance.get('/api/fleet/shipments/${widget.editId}'))['shipment'] as Map<String, dynamic>?
          : null;
      if (!mounted) return;
      setState(() {
        _customers = List<Map<String, dynamic>>.from(results[0]['customers'] ?? []);
        _vehicles = List<Map<String, dynamic>>.from(results[1]['vehicles'] ?? []);
        _rentTypes = List<Map<String, dynamic>>.from(results[2]['items'] ?? []);
        _paymentTypes = List<Map<String, dynamic>>.from(results[3]['items'] ?? []);
        _loadTypes = List<Map<String, dynamic>>.from(results[4]['items'] ?? []);
        _branches = List<Map<String, dynamic>>.from(results[5]['branches'] ?? []);
        _drivers = List<Map<String, dynamic>>.from(results[6]['drivers'] ?? []);
        if (ship != null) _prefill(ship);
        _loading = false;
      });
    } catch (e) {
      // Customer and vehicle are essential to the form; if fetching them fails a retry is shown instead of a silent empty form.
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _idOf(dynamic v) => v is Map ? (v['_id'] ?? '').toString() : (v ?? '').toString();

  // A list key stored on the load maps to its item; if it left the active list it stays as is so it is not erased on save.
  Map<String, dynamic>? _lkItem(List<Map<String, dynamic>> items, dynamic key) {
    final k = (key ?? '').toString();
    if (k.isEmpty) return null;
    final hit = items.where((x) => (x['key'] ?? '').toString() == k);
    return hit.isNotEmpty ? hit.first : {'key': k, 'nameAr': k, 'nameEn': k};
  }

  String _numText(dynamic v) {
    if (v == null || v.toString().isEmpty) return '';
    final n = num.tryParse(v.toString());
    if (n == null) return v.toString();
    return n == n.roundToDouble() ? n.round().toString() : n.toString();
  }

  /// Fills the form from the saved load, everything the web fills.
  /// A loaded load's customer is not a "choice": payment type and customer class are read as saved on the load and are not reset to the customer default (that used to save a taxed cash load without anyone touching it). The customer default applies only when the user picks a customer from the list.
  void _prefill(Map<String, dynamic> o) {
    _status = (o['status'] ?? 'requesting').toString();
    _fromCity.text = (o['fromCity'] ?? '').toString();
    _toCity.text = (o['toCity'] ?? '').toString();
    // The day as the web reads it (toISOString().slice(0,10)), a GMT date.
    final ld = DateTime.tryParse((o['loadDate'] ?? '').toString())?.toUtc();
    if (ld != null) _loadDate = DateTime(ld.year, ld.month, ld.day);
    _expectedArrival = DateTime.tryParse((o['expectedArrival'] ?? '').toString())?.toLocal();
    _notes.text = (o['notes'] ?? '').toString();
    _rentTypeItem = _lkItem(_rentTypes, o['rentType']);
    _paymentTypeItem = _lkItem(_paymentTypes, o['paymentType']);
    _loadTypeItem = _lkItem(_loadTypes, o['loadType']);
    _vehicleRent.text = _numText(o['price']);
    _fullRent.text = _numText(o['fullRent']);
    _customerType = (o['customerType'] ?? '').toString();
    // The displayed expense already includes the Friday bonus; the server adds or removes it when the flag flips.
    _driverExpense.text = _numText(o['driverExpense']);
    _fridayBonus = o['fridayBonus'] == true;
    final br = (o['branch'] ?? '').toString();
    _branch = br.isEmpty ? null : br;

    final cid = _idOf(o['customer']);
    if (cid.isNotEmpty) {
      final hit = _customers.where((c) => (c['_id'] ?? '').toString() == cid);
      _customer = hit.isNotEmpty
          ? hit.first
          : {'_id': cid, 'name': (o['customer'] is Map ? o['customer']['name'] : null) ?? o['customerName'] ?? ''};
    }
    final vid = _idOf(o['vehicle']);
    if (vid.isNotEmpty) {
      final hit = _vehicles.where((v) => (v['_id'] ?? '').toString() == vid);
      _vehicle = hit.isNotEmpty
          ? hit.first
          : {'_id': vid, 'plate': (o['vehicle'] is Map ? o['vehicle']['plate'] : null) ?? o['vehiclePlate'] ?? ''};
    }
    // The two drivers as on the load; one outside the list scope is added to it so the name shows.
    for (final key in ['driver', 'secondDriver']) {
      final d = o[key];
      final id = _idOf(d);
      if (id.isEmpty) continue;
      if (d is Map && !_drivers.any((x) => (x['_id'] ?? '').toString() == id)) {
        _drivers.add(Map<String, dynamic>.from(d));
      }
      if (key == 'driver') { _driverId = id; } else { _secondDriverId = id; }
    }
  }

  Map<String, dynamic>? _driverOf(String id) {
    if (id.isEmpty) return null;
    final hit = _drivers.where((d) => (d['_id'] ?? '').toString() == id);
    if (hit.isNotEmpty) return hit.first;
    final seated = List<Map<String, dynamic>>.from(_vehicle?['drivers'] ?? []).where((d) => (d['_id'] ?? '').toString() == id);
    return seated.isNotEmpty ? seated.first : null;
  }

  Map<String, dynamic>? _vehicleOfDriver(Map<String, dynamic> d) {
    final vid = _idOf(d['vehicle']);
    if (vid.isEmpty) return null;
    final hit = _vehicles.where((v) => (v['_id'] ?? '').toString() == vid);
    if (hit.isNotEmpty) return hit.first;
    return d['vehicle'] is Map ? Map<String, dynamic>.from(d['vehicle']) : null;
  }

  /// Choosing the truck seats its two drivers in the two fields; rank comes from the written seat (first/second), not arrival order, like seatsOf on the web.
  void _applyVehicle(Map<String, dynamic> v) {
    _vehicle = v;
    final ds = List<Map<String, dynamic>>.from(v['drivers'] ?? []);
    int seatOf(Map<String, dynamic> d) => int.tryParse((d['seat'] ?? '').toString()) ?? 1;
    final first = ds.where((d) => seatOf(d) == 1);
    final second = ds.where((d) => d['seat'] != null && seatOf(d) == 2);
    if (first.isNotEmpty) _driverId = (first.first['_id'] ?? '').toString();
    _secondDriverId = second.isNotEmpty ? (second.first['_id'] ?? '').toString() : '';
  }

  // Transfer notice: a driver on another truck is moved to this one on save, and is told before.
  String _moveHint(String id) {
    if (id.isEmpty || _vehicle == null) return '';
    final d = _driverOf(id);
    if (d == null) return '';
    final cur = _vehicleOfDriver(d);
    final curId = cur == null ? '' : (cur['_id'] ?? '').toString();
    if (cur != null && curId.isNotEmpty && curId != (_vehicle!['_id'] ?? '').toString()) {
      return tr('سيُنقل ${d['name']} من السيارة ${cur['plate'] ?? ''} إلى ${_vehicle!['plate'] ?? ''} عند الحفظ.',
          '${d['name']} moves from ${cur['plate'] ?? ''} to ${_vehicle!['plate'] ?? ''} on save.');
    }
    return '';
  }

  /// Driver field: list of all drivers (with "none"), status badge, and call.
  Widget _driverSlot(String label, String id, String otherId, void Function(String) onPick) {
    final d = _driverOf(id);
    final hint = _moveHint(id);
    final pool = _drivers.isNotEmpty ? _drivers : List<Map<String, dynamic>>.from(_vehicle?['drivers'] ?? []);
    final none = <String, dynamic>{'_id': '', 'name': tr('— بدون —', '— none —')};
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(
          child: Pressable(
            onTap: () async {
              final p = await _pickSheet<Map<String, dynamic>>(
                title: label,
                items: [none, ...pool.where((x) => (x['_id'] ?? '').toString() != otherId)],
                label: (x) => (x['name'] ?? '').toString(),
                hint: (x) {
                  if ((x['_id'] ?? '').toString().isEmpty) return '';
                  final cur = _vehicleOfDriver(x);
                  return [
                    cur != null ? tr('على ${cur['plate'] ?? ''}', 'on ${cur['plate'] ?? ''}') : tr('بدون سيارة', 'unassigned'),
                    if (x['working'] != null) x['working'] == true ? tr('يعمل', 'working') : tr('لا يعمل', 'off'),
                  ].join(' · ');
                },
              );
              if (p != null) onPick((p['_id'] ?? '').toString());
            },
            child: InputDecorator(
              decoration: InputDecoration(labelText: label, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14)),
              child: Row(children: [
                Expanded(child: Text(d == null ? tr('— بدون —', '— none —') : (d['name'] ?? '').toString(),
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: d == null ? T.inkFaint : T.ink))),
                const Icon(Icons.expand_more, size: 18, color: T.inkFaint),
              ]),
            ),
          ),
        ),
        // Call/WhatsApp directly on the chosen driver's number.
        if (d != null) ContactButtons(phone: (d['phone'] ?? d['mobile'] ?? '').toString(), compact: true),
      ]),
      if (d != null && d['working'] != null) Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2(d['working'] == true ? tr('يعمل', 'Working') : tr('لا يعمل', 'Off duty'), d['working'] == true ? T.success : T.danger),
          if (d['onSponsorship'] != null)
            Chip2(d['onSponsorship'] == true ? tr('على الكفالة', 'Sponsored') : tr('خارج الكفالة', 'Not sponsored'),
                d['onSponsorship'] == true ? T.info : T.inkFaint),
        ]),
      ),
      if (hint.isNotEmpty) Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10),
              border: Border.all(color: T.warn.withValues(alpha: 0.35))),
          child: Text(hint, style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w600)),
        ),
      ),
    ]);
  }

  /// Vehicle availability line, same as the web line: available in Jeddah / loaded to Riyadh / reached destination area, unloading.
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
                child: SearchField(
                  controller: ctrl,
                  onChanged: (_) => setSheet(() {}),
                  hint: tr('ابحث…', 'Search…'),
                ),
              ),
              const SizedBox(height: 6),
              Expanded(
                child: filtered.isEmpty
                    ? Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                    : ListView.builder(
                  controller: scroll,
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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
    ).whenComplete(ctrl.dispose);
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
    if (_isEdit && _vehicle == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اختر السيارة.', 'Pick the vehicle.'))));
      return;
    }
    setState(() => _busy = true);
    final edit = _isEdit;
    num? n(TextEditingController c) => c.text.trim().isEmpty ? null : (num.tryParse(c.text.trim()) ?? 0);
    try {
      // Edit sends all fields like the web (an empty value clears); create sends only what is filled.
      final body = <String, dynamic>{
        if (_customer != null) 'customer': _customer!['_id'],
        if (_newCustomer)
          'newCustomer': {'name': _newCustomerName.text, 'phone': _newCustomerPhone.text},
        if (_vehicle != null) 'vehicle': _vehicle!['_id'],
        if (edit || _driverId.isNotEmpty) 'driver': _driverId.isEmpty ? null : _driverId,
        if (edit || _secondDriverId.isNotEmpty) 'secondDriver': _secondDriverId.isEmpty ? null : _secondDriverId,
        'status': _status,
        'fromCity': _fromCity.text.trim(),
        'toCity': _toCity.text.trim(),
        // Day only, as on the web: a local time without offset is read on the server as GMT, so a 10:30 PM load was recorded on the next day.
        'loadDate': '${_loadDate.year.toString().padLeft(4, '0')}-${_loadDate.month.toString().padLeft(2, '0')}-${_loadDate.day.toString().padLeft(2, '0')}',
        if (edit || _expectedArrival != null) 'expectedArrival': _expectedArrival?.toUtc().toIso8601String(),
        if (edit || _rentTypeItem != null) 'rentType': _rentTypeItem?['key'] ?? '',
        if (edit || _paymentTypeItem != null) 'paymentType': _paymentTypeItem?['key'] ?? '',
        if (edit || _loadTypeItem != null) 'loadType': _loadTypeItem?['key'] ?? '',
        if (edit || n(_vehicleRent) != null) 'price': n(_vehicleRent) ?? 0,
        if (edit || n(_fullRent) != null) 'fullRent': n(_fullRent) ?? 0,
        if (edit || _customerType.isNotEmpty) 'customerType': _customerType,
        // On edit: the expense as displayed (bonus included) and the flag as is; the server adds or removes the bonus if the flag flips.
        if (edit || n(_driverExpense) != null) 'driverExpense': n(_driverExpense) ?? 0,
        if (edit || _fridayBonus) 'fridayBonus': _fridayBonus,
        if (edit || (_branch != null && _branch!.isNotEmpty)) 'branch': _branch ?? '',
        'notes': _notes.text,
      };
      if (edit) {
        await Api.instance.put('/api/fleet/shipments/${widget.editId}', body);
      } else {
        await Api.instance.post('/api/fleet/shipments', body);
      }
      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (e) {
      // No maintenance block after today: a truck past its maintenance date used to be rejected with 409, showing a panel and raising a request to the maintenance manager. The block was lifted on both sides together: server, web and app.
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
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
    return AppScaffold(
      title: Text(_isEdit ? tr('تعديل حمولة', 'Edit shipment') : tr('إنشاء حمولة', 'New Shipment')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 58), SizedBox(height: 10), Shimmer(height: 58), SizedBox(height: 10), Shimmer(height: 58),
            ])
          : (_error != null && _customers.isEmpty && _vehicles.isEmpty)
          ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Customer.
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
                      if (c != null) { setState(() {
                        _customer = c;
                        final ct = (c['customerType'] ?? '').toString();
                        if (ct.isNotEmpty) { _customerType = ct; }
                        // The agreed payment type is filled in automatically and stays editable here: a taxed customer may pay one load in cash, so the agreement is a default, not a constraint.
                        final pt = (c['paymentType'] ?? '').toString();
                        if (pt.isNotEmpty) {
                          final hit = _paymentTypes.where((x) => (x['key'] ?? '').toString() == pt);
                          if (hit.isNotEmpty) _paymentTypeItem = hit.first;
                        }
                      }); }
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
                        if (_customer != null && (_customer!['paymentType'] ?? '').toString().isNotEmpty)
                          Chip2(
                            (_customer!['paymentType'] == 'tax') ? tr('ضريبي', 'Tax') : tr('كاش', 'Cash'),
                            (_customer!['paymentType'] == 'tax') ? T.violet : T.success,
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

                // Vehicle and driver.
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
                    if (v != null) setState(() => _applyVehicle(v));
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
                                if (_vehicles.any((x) => x['_id'] == _vehicle!['_id']))
                                  Chip2(_availability(_vehicle!).$1, _availability(_vehicle!).$2),
                              ]),
                      ),
                      Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                    ]),
                  ),
                ),
                // The two drivers, first and second (optional, for faster arrival), like the two web fields.
                const SizedBox(height: 8),
                _driverSlot(tr('السائق الأول', 'First driver'), _driverId, _secondDriverId,
                    (id) => setState(() => _driverId = id)),
                const SizedBox(height: 8),
                _driverSlot(tr('السائق الثاني (اختياري — للوصول الأسرع)', 'Second driver (optional)'), _secondDriverId, _driverId,
                    (id) => setState(() => _secondDriverId = id)),
                const Divider(height: 24),

                // Route and appointments.
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
                    // On edit the saved date may precede the seven-day window; the picker does not break.
                    final min = DateTime.now().subtract(const Duration(days: 7));
                    final first = _loadDate.isBefore(min) ? _loadDate : min;
                    final d = await showDatePicker(context: context, initialDate: _loadDate, firstDate: first, lastDate: DateTime.now().add(const Duration(days: 90)));
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
                    final today = DateTime.now();
                    final init = _expectedArrival ?? today;
                    final first = init.isBefore(today) ? init : today;
                    final d = await showDatePicker(context: context, initialDate: init, firstDate: first, lastDate: today.add(const Duration(days: 30)));
                    if (d == null || !context.mounted) return;
                    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_expectedArrival ?? DateTime.now()));
                    setState(() => _expectedArrival = DateTime(d.year, d.month, d.day, t?.hour ?? 12, t?.minute ?? 0));
                  },
                ),
                const SizedBox(height: 10),
                // Status, like the web list in "status and supervisor".
                DropdownButtonFormField<String>(
                  key: ValueKey('status-$_status'),
                  initialValue: _statusOptions.any((x) => x.$1 == _status) ? _status : null,
                  decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
                  items: _statusOptions.map((x) => DropdownMenuItem(value: x.$1, child: Text(tr(x.$2, x.$3)))).toList(),
                  onChanged: (v) => setState(() => _status = v ?? 'requesting'),
                ),
                const SizedBox(height: 16),
                // Load and pricing.
                Text(tr('الحمولة والتسعير', 'Load & pricing'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 8),
                // Customer type: heavy transport customers (section customers) / branch customers.
                Text(tr('نوع العميل', 'Customer type'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(child: _segBtn(tr('نقل ثقيل', 'Heavy'), _customerType == 'heavy', () => setState(() => _customerType = 'heavy'))),
                  const SizedBox(width: 8),
                  Expanded(child: _segBtn(tr('عملاء الفروع', 'Branch'), _customerType == 'branch', () => setState(() => _customerType = 'branch'))),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: TextField(controller: _vehicleRent, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('إيجار السيارة', 'Vehicle rent')))),
                  const SizedBox(width: 10),
                  Expanded(child: TextField(controller: _fullRent, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('الإيجار كامل (اختياري)', 'Full rent (optional)')))),
                ]),
                if (_branchShare > 0) Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(tr('حصة قسم الفروع من الفرق: $_branchShare', 'Branch dept share of difference: $_branchShare'),
                      style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w600)),
                ),
                const SizedBox(height: 10),
                // Rent type / payment type: editable reference lists.
                Row(children: [
                  Expanded(child: _lkPicker(tr('نوع الإيجار', 'Rent type'), _rentTypeItem, _rentTypes, (v) => setState(() => _rentTypeItem = v))),
                  const SizedBox(width: 10),
                  Expanded(child: _lkPicker(tr('نوع الدفع', 'Payment type'), _paymentTypeItem, _paymentTypes, (v) => setState(() => _paymentTypeItem = v))),
                ]),
                const SizedBox(height: 10),
                _lkPicker(tr('نوع الحمولة', 'Load type'), _loadTypeItem, _loadTypes, (v) => setState(() => _loadTypeItem = v)),
                const SizedBox(height: 10),
                // Branch: from the company branches.
                Pressable(
                  onTap: () async {
                    final b = await _pickSheet<Map<String, dynamic>>(
                      title: tr('اختر الفرع', 'Pick branch'),
                      items: _branches,
                      label: (b) => (b['name'] ?? b['nameAr'] ?? b['nameEn'] ?? '').toString(),
                    );
                    if (b != null) setState(() => _branch = (b['name'] ?? b['nameAr'] ?? b['nameEn'] ?? '').toString());
                  },
                  child: AppCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                    child: Row(children: [
                      const Icon(Icons.store_outlined, color: T.navy, size: 20),
                      const SizedBox(width: 10),
                      Expanded(child: Text((_branch == null || _branch!.isEmpty) ? tr('— الفرع —', '— branch —') : _branch!,
                          style: TextStyle(fontWeight: FontWeight.w700, color: (_branch == null || _branch!.isEmpty) ? T.inkFaint : T.ink))),
                      Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                    ]),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(controller: _driverExpense, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('مصروف السائق', 'Driver expense'))),
                const SizedBox(height: 10),
                // Friday bonus: adds an amount to the driver expense on Friday.
                Pressable(
                  onTap: () => setState(() => _fridayBonus = !_fridayBonus),
                  child: AppCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(children: [
                      Icon(_fridayBonus ? Icons.check_circle : Icons.card_giftcard_outlined,
                          color: _fridayBonus ? T.success : (_isFriday ? T.warn : T.inkFaint), size: 20),
                      const SizedBox(width: 10),
                      Expanded(child: Text(tr('بونص الجمعة للسائق', 'Friday bonus for driver'),
                          style: TextStyle(fontWeight: FontWeight.w700, color: _fridayBonus ? T.success : T.ink))),
                      if (_isFriday && !_fridayBonus) Text(tr('اليوم جمعة', "It's Friday"), style: const TextStyle(fontSize: 11.5, color: T.warn, fontWeight: FontWeight.w700)),
                    ]),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
                const SizedBox(height: 16),
                FilledButton.icon(
                  icon: Icon(_isEdit ? Icons.check : Icons.add_task_outlined),
                  onPressed: _busy ? null : _submit,
                  label: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(_isEdit ? tr('حفظ التعديلات', 'Save changes') : tr('إنشاء الحمولة', 'Create shipment')),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
