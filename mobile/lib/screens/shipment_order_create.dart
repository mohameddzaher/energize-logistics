import 'dart:async';

import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// إنشاء/تعديل طلب شحنة — نفس نموذج الويب: الحقول تُبنى من إعدادات النموذج
/// (/fields)، اختيار العميل يسحب سعر المسار المتفق عليه وقيمه الافتراضية،
/// واختيار الشاحنة يملأ السائق وهاتفه، مع إنشاء عميل أو شاحنة جديدة في المكان.

const _systemKeys = {
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'branch', 'notes',
};

const _fixedKeys = {'customer', 'waybillNumber', 'status', 'agentName', 'vehicleName', 'driverName', 'driverPhone'};

const _groups = [
  ('pickup_delivery', 'الاستلام والتسليم', 'Pickup & delivery', Icons.location_on_outlined),
  ('shipment', 'الشحنة', 'Shipment', Icons.inventory_2_outlined),
  ('pricing_time', 'التسعير والمواعيد', 'Pricing & times', Icons.schedule_outlined),
  ('payment', 'الدفع', 'Payment', Icons.account_balance_wallet_outlined),
];

class ShipmentOrderCreateScreen extends StatefulWidget {
  final Map<String, dynamic>? order;
  const ShipmentOrderCreateScreen({super.key, this.order});
  @override
  State<ShipmentOrderCreateScreen> createState() => _ShipmentOrderCreateScreenState();
}

class _ShipmentOrderCreateScreenState extends State<ShipmentOrderCreateScreen> {
  List<Map<String, dynamic>> _fields = [];
  List<Map<String, dynamic>> _customers = [];
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _suppliers = [];
  bool _loading = true;
  String? _error;
  bool _saving = false;

  Map<String, dynamic>? _customer;
  // ── المورّدُ أوّلًا، ثمّ شاحنتُه ────────────────────────────────────────────
  // كما في الويب: يُعرَف المورّدُ أوّلًا ثمّ أيُّ شاحنةٍ من شاحناته — فتُقصَر
  // القائمةُ على ما يخصّه بدل مئات اللوحات معًا.
  Map<String, dynamic>? _supplier;
  Map<String, dynamic>? _vehicle;
  bool _savingSupplier = false;
  bool _newCustomer = false;
  final _ncName = TextEditingController();
  final _ncPhone = TextEditingController();
  bool _newVehicle = false;
  final _nvPlate = TextEditingController();
  final _nvName = TextEditingController();

  /// ── الحمولةُ الواحدةُ على عدّةِ شاحنات ────────────────────────────────────
  ///
  /// العميلُ يطلب حمولةً تخرج على خمسِ شاحنات: العميلُ والمسارُ والسعرُ والموعدُ
  /// واحد، ويختلف المورّدُ والشاحنةُ والسائق. وكان الموظّفُ يخرج من النموذج
  /// ويعيد كتابةَ العشرين خانةً خمسَ مرّات.
  ///
  /// وكلُّ شاحنةٍ تصير **طلبًا مستقلًّا** برقم بوليصته من العدّاد نفسِه — لا
  /// طلبٌ أبٌ ولا رابطٌ بينها: كلُّ شاحنةٍ تمضي وحدَها وتصل وحدَها وتُحاسَب
  /// وحدَها.
  final List<Map<String, dynamic>> _extraTrucks = [];

  final Map<String, dynamic> _form = {};
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _missing = {};

  bool get _editing => widget.order != null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  TextEditingController _ctrl(String key) =>
      _ctrls.putIfAbsent(key, () => TextEditingController(text: (_form[key] ?? '').toString()));

  /// متحكّمُ جوّالٍ سعوديّ: يُعرَض محليًّا («5XXXXXXXX») ويُخزَّن كاملًا.
  TextEditingController _phoneCtrl(String key) =>
      _ctrls.putIfAbsent(key, () => TextEditingController(text: saLocal((_form[key] ?? '').toString())));

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/shipment-orders/fields'),
        Api.instance.get('/api/shipment-orders/customers').catchError((_) => <String, dynamic>{}),
        // ── ولا تُحمَّل القائمتان كلَّهما ──────────────────────────────────
        // في السجلّ ثلاثةَ عشرَ ألفَ شاحنةٍ وثلاثةُ آلاف مورّد، وكان يُطلَب
        // الكلُّ فيصل حدُّ الخادم (ألفٌ) ثمّ يُبحَث في الواصل — فمن اختار
        // مورّدًا لم تكن شاحناتُه في الألف رأى قائمةً فارغة. فصار البحثُ عند
        // الخادم، وشاحناتُ المورّد تُطلَب بمعرّفه.
        Api.instance.get('/api/shipment-orders/vehicles?limit=80&ownership=supplier').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/shipment-orders/suppliers?limit=60').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _fields = List<Map<String, dynamic>>.from(results[0]['fields'] ?? []);
        _customers = List<Map<String, dynamic>>.from(results[1]['customers'] ?? []);
        _vehicles = List<Map<String, dynamic>>.from(results[2]['vehicles'] ?? []);
        _suppliers = List<Map<String, dynamic>>.from(results[3]['suppliers'] ?? []);
        // ── والاستلامُ والبدايةُ اليومَ حتى يُقال غيرُ ذلك ──────────────────
        // الشحنةُ تُسجَّل ساعةَ تُحجَز، فيومُها هو اليوم في كلّ مرّةٍ تقريبًا.
        if (!_editing) {
          final t = DateTime.now();
          final iso = '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
          _form['pickupTime'] = iso;
          _form['startTime'] = iso;
        }
        if (_editing) {
          final o = widget.order!;
          for (final f in _fields) {
            final k = (f['key'] ?? '').toString();
            _form[k] = o[k] ?? (o['customFields'] is Map ? o['customFields'][k] : null);
          }
          final cid = o['customer'] is Map ? o['customer']['_id'] : o['customer'];
          if (cid != null) {
            for (final c in _customers) {
              if (c['_id'] == cid) _customer = c;
            }
          }
          // الشاحنةُ والمورّدُ يصلان مسمَّيين من `getOrder` — فيُبذران في
          // القائمتين، وإلّا ظهرت خانتان فارغتان وهما مختارتان.
          if (o['vehicle'] is Map) {
            _vehicle = Map<String, dynamic>.from(o['vehicle']);
            if (!_vehicles.any((x) => x['_id'] == _vehicle!['_id'])) _vehicles = [_vehicle!, ..._vehicles];
          }
          if (o['supplier'] is Map) {
            _supplier = Map<String, dynamic>.from(o['supplier']);
            if (!_suppliers.any((x) => x['_id'] == _supplier!['_id'])) _suppliers = [_supplier!, ..._suppliers];
          }
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  // اختيار العميل يسحب الافتراضيات وسعر المسار المتفق عليه فورًا.
  void _applyCustomer(Map<String, dynamic> c) {
    setState(() {
      _customer = c;
      _newCustomer = false;
      final d = c['defaults'] as Map<String, dynamic>? ?? {};
      for (final k in ['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch']) {
        if ((d[k] ?? '').toString().isNotEmpty && (_form[k] ?? '').toString().isEmpty) {
          _form[k] = d[k];
          _ctrls.remove(k);
        }
      }
      _applyRoutePrice();
    });
  }

  void _applyRoutePrice() {
    final c = _customer;
    if (c == null) return;
    final from = (_form['fromCity'] ?? '').toString();
    final to = (_form['toCity'] ?? '').toString();
    if (from.isEmpty || to.isEmpty) return;
    for (final r in List<Map<String, dynamic>>.from(c['routes'] ?? [])) {
      if (r['fromCity'] == from && r['toCity'] == to && r['price'] != null) {
        _form['sellPrice'] = r['price'];
        _ctrls.remove('sellPrice');
      }
    }
  }

  void _applyVehicle(Map<String, dynamic> v) {
    setState(() {
      _vehicle = v;
      _newVehicle = false;
      // ── واختيارُ الشاحنة يُسمّي مالكَها، ولا يُبدّل المورّدَ المختار ────
      // يُملأ المورّدُ من المالك حين لم يُختَر بعد. ومن اختاره أوّلًا فذاك
      // قرارُ صفقة، وكان يُستبدَل صامتًا بمالك الشاحنة — فتُحفَظ الشحنةُ على
      // مورّدٍ لم يتّفق معه أحد.
      final sup = v['supplier'];
      if (sup is Map && _supplier == null) {
        // المورّدُ يصل مع الشاحنة مسمَّى (`populate`)، فلا يُبحَث عنه في صفحةٍ
        // قد لا يكون فيها — وكان يُبحَث فيها فيبقى فارغًا وله مورّدٌ معروف.
        _supplier = Map<String, dynamic>.from(sup);
        if (!_suppliers.any((x) => x['_id'] == _supplier!['_id'])) _suppliers = [_supplier!, ..._suppliers];
      } else if (sup != null && _supplier == null) {
        for (final sp in _suppliers) {
          if (sp['_id'] == sup) _supplier = sp;
        }
      }
      if ((v['defaultDriverName'] ?? '').toString().isNotEmpty) {
        _form['driverName'] = v['defaultDriverName'];
        _ctrls.remove('driverName');
      }
      if ((v['defaultDriverPhone'] ?? '').toString().isNotEmpty) {
        _form['driverPhone'] = v['defaultDriverPhone'];
        _ctrls.remove('driverPhone');
      }
      if ((v['truckType'] ?? '').toString().isNotEmpty && (_form['truckType'] ?? '').toString().isEmpty) {
        _form['truckType'] = v['truckType'];
        _ctrls.remove('truckType');
      }
    });
  }

  /// ── وقائمةٌ لا تُحمَّل كلُّها: البحثُ يُرسَل إلى الخادم ─────────────────────
  ///
  /// `_pickSheet` يبحث في قائمةٍ في اليد، وهو الصوابُ لمئةِ عميل. أمّا ثلاثةَ
  /// عشرَ ألفَ شاحنةٍ وثلاثةُ آلافِ مورّدٍ فلا تُحمَّل، فالبحثُ فيها بحثٌ في
  /// الصفحةِ الواصلة يقول «لا نتائج» عن صفٍّ مسجَّل. فهذا يسأل الخادمَ بعد
  /// سكونِ الكتابة، ويعرض ما ردّه كما هو.
  ///
  /// و`seq` تمنع سباقَ الردود: ردُّ «مح» الواصلُ متأخّرًا لا يمحو نتائجَ «محمد».
  Future<Map<String, dynamic>?> _pickRemote(
    String title,
    Future<List<Map<String, dynamic>>> Function(String q) fetch,
    String Function(Map<String, dynamic>) label, {
    String Function(Map<String, dynamic>)? sub,
    String? hint,
    List<Map<String, dynamic>> initial = const [],
  }) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        var rows = List<Map<String, dynamic>>.from(initial);
        var busy = false;
        var seq = 0;
        Timer? debounce;
        return StatefulBuilder(builder: (c, setS) {
          Future<void> run(String q) async {
            final mine = ++seq;
            setS(() => busy = true);
            try {
              final r = await fetch(q);
              if (mine != seq) return;
              setS(() { rows = r; busy = false; });
            } catch (_) {
              if (mine == seq) setS(() => busy = false);
            }
          }
          if (rows.isEmpty && !busy && seq == 0) run('');
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.72,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      autofocus: true,
                      onChanged: (v) {
                        debounce?.cancel();
                        debounce = Timer(const Duration(milliseconds: 300), () => run(v.trim()));
                      },
                      decoration: InputDecoration(
                        hintText: hint ?? '${tr('ابحث في', 'Search')} $title…',
                        prefixIcon: const Icon(Icons.search),
                        suffixIcon: busy
                            ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                            : null,
                      ),
                    ),
                  ),
                  Expanded(
                    child: rows.isEmpty
                        ? Center(child: Text(busy ? '…' : tr('لا نتائج', 'No matches'), style: const TextStyle(fontSize: 13)))
                        : ListView.builder(
                            itemCount: rows.length,
                            itemBuilder: (c, i) => ListTile(
                              title: Text(label(rows[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                              subtitle: sub == null ? null : Text(sub(rows[i]), style: const TextStyle(fontSize: 12)),
                              onTap: () => Navigator.pop(c, rows[i]),
                            ),
                          ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  /// إضافةُ شاحنةٍ أخرى للحمولة نفسِها: مورّدُها وشاحنتُه وسائقُه.
  ///
  /// السؤالان بالترتيب نفسِه الذي في البطاقة أعلاه — المورّدُ ثمّ شاحنتُه —
  /// والسائقُ يُملأ من الشاحنة المسجَّلة ويبقى قابلًا للتصحيح.
  Future<void> _addExtraTruck() async {
    final sup = await _pickRemote(
      tr('الموردين', 'suppliers'),
      (q) async {
        final d = await Api.instance.get('/api/shipment-orders/suppliers?limit=60${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(d['suppliers'] ?? []);
      },
      (x) => (x['name'] ?? '').toString(),
      hint: tr('الاسم أو الجوّال…', 'Name or phone…'),
    );
    if (sup == null || !mounted) return;
    final veh = await _pickRemote(
      tr('شاحنات المورّد', 'his trucks'),
      (q) async {
        final d = await Api.instance.get(
            '/api/shipment-orders/vehicles?limit=80&supplier=${sup['_id']}${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
      },
      (v) => (v['plate'] ?? '').toString(),
      // مالكُها وسائقُها — كما يُقرآن في بطاقة «مالك السيارة».
      sub: (v) {
        final sup = v['supplier'];
        final owner = sup is Map ? (sup['name'] ?? '').toString() : '';
        return [v['name'], owner, v['defaultDriverName']].where((e) => (e ?? '').toString().isNotEmpty).join(' · ');
      },
      hint: tr('اللوحة أو السائق…', 'Plate or driver…'),
    );
    if (!mounted) return;
    setState(() => _extraTrucks.add({
          'supplier': sup,
          'vehicle': veh,
          'newPlate': '',
          'driverName': (veh?['defaultDriverName'] ?? '').toString(),
          'driverPhone': (veh?['defaultDriverPhone'] ?? '').toString(),
        }));
  }

  Future<P?> _pickSheet<P>(String title, List<P> items, String Function(P) label, {String Function(P)? sub}) {
    return showModalBottomSheet<P>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = items.where((x) => fq.isEmpty || _fold('${label(x)} ${sub?.call(x) ?? ''}').contains(fq)).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.72,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      autofocus: true,
                      onChanged: (v) => setS(() => q = v),
                      decoration: InputDecoration(hintText: '${tr('ابحث في', 'Search')} $title…', prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) => ListTile(
                        title: Text(label(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                        subtitle: sub == null ? null : Text(sub(list[i]), style: const TextStyle(fontSize: 12)),
                        onTap: () => Navigator.pop(c, list[i]),
                      ),
                    ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  /// مورّدٌ جديد يُسجَّل في لحظته — لا عند حفظ الشحنة.
  ///
  /// من أضافه ثمّ ترك النموذج يجب أن يجده في صفحة المورّدين، ويجده زميلُه.
  Future<void> _addSupplier() async {
    final nameC = TextEditingController();
    final phoneC = TextEditingController();
    var type = 'company';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text(tr('مورّد جديد', 'New supplier')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: nameC, autofocus: true, decoration: InputDecoration(labelText: tr('الاسم *', 'Name *'))),
          const SizedBox(height: 8),
          PhoneSA(controller: phoneC, label: tr('الجوال', 'Phone')),
          const SizedBox(height: 10),
          Row(children: [
            for (final t in const [('company', 'شركة', 'Company'), ('freelancer', 'فريلانسر', 'Freelancer')])
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: ChoiceChip(
                  selected: type == t.$1,
                  onSelected: (_) => setS(() => type = t.$1),
                  label: Text(tr(t.$2, t.$3)),
                ),
              ),
          ]),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      )),
    );
    if (ok != true || nameC.text.trim().isEmpty) return;
    setState(() => _savingSupplier = true);
    try {
      final d = await Api.instance.post('/api/shipment-orders/suppliers', {
        'name': nameC.text.trim(), 'phone': saPhone(phoneC.text), 'type': type,
      });
      final sup = Map<String, dynamic>.from(d['supplier'] ?? {});
      if (!mounted) return;
      setState(() {
        _suppliers = [..._suppliers, sup];
        _supplier = sup;
        _vehicle = null;
        _savingSupplier = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingSupplier = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    _missing.clear();
    for (final f in _fields) {
      final k = (f['key'] ?? '').toString();
      if (f['required'] == true && !_fixedKeys.contains(k) && (_form[k] ?? '').toString().trim().isEmpty) {
        _missing.add(k);
      }
    }
    if (_customer == null && !(_newCustomer && _ncName.text.trim().isNotEmpty)) _missing.add('customer');
    if (_missing.isNotEmpty) {
      setState(() {});
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أكمل الحقول المحددة بالأحمر', 'Fill the highlighted fields'))));
      return;
    }
    setState(() => _saving = true);
    final payload = <String, dynamic>{'customFields': <String, dynamic>{}};
    for (final f in _fields) {
      final k = (f['key'] ?? '').toString();
      if (_fixedKeys.contains(k)) continue;
      final v = _form[k];
      if (v == null || v.toString().isEmpty) continue;
      if (_systemKeys.contains(k)) {
        payload[k] = v;
      } else {
        payload['customFields'][k] = v;
      }
    }
    if (_customer != null) payload['customer'] = _customer!['_id'];
    if (_newCustomer && _ncName.text.trim().isNotEmpty) {
      payload['newCustomer'] = {'name': _ncName.text.trim(), 'phone': saPhone(_ncPhone.text)};
    }
    // المورّدُ المختارُ يُرسَل ولو كانت الشاحنةُ مسجّلة: آلافٌ منها مجهولةُ
    // المالك، ومن يحجز الحمولةَ يعرفه — فيكتبه الخادمُ في السجلّ مرّةً.
    if (_supplier != null) payload['supplierChoice'] = _supplier!['_id'];
    if (_vehicle != null) payload['vehicle'] = _vehicle!['_id'];
    if (_newVehicle && _nvPlate.text.trim().isNotEmpty) {
      payload['newVehicle'] = {
        'plate': _nvPlate.text.trim(),
        'name': _nvName.text.trim(),
        'supplierId': _supplier?['_id'],
      };
    }
    // القيم اليدوية للسائق تبقى إن لم تأتِ من شاحنة مسجلة.
    for (final k in ['driverName', 'driverPhone']) {
      if ((_form[k] ?? '').toString().isNotEmpty) payload[k] = _form[k];
    }
    try {
      if (_editing) {
        await Api.instance.put('/api/shipment-orders/orders/${widget.order!['_id']}', payload);
      } else if (_extraTrucks.isNotEmpty) {
        // الصفُّ الأوّلُ شاحنةٌ كالبقيّة فيُرسَل معها في القائمة نفسِها — ولو
        // أُنشئ وحدَه ثمّ أُرسلت البقيّةُ لحُفظ الأوّلُ ورُفضت الثانيةُ ولا
        // يعرف الموظّفُ أين وقف.
        final body = Map<String, dynamic>.from(payload)
          ..remove('vehicle')
          ..remove('newVehicle')
          ..remove('supplierChoice');
        body['trucks'] = [
          {
            if (_vehicle != null) 'vehicle': _vehicle!['_id'],
            if (_newVehicle && _nvPlate.text.trim().isNotEmpty)
              'newVehicle': {'plate': _nvPlate.text.trim(), 'name': _nvName.text.trim(), 'supplierId': _supplier?['_id']},
            if (_supplier != null) 'supplierChoice': _supplier!['_id'],
            if ((_form['driverName'] ?? '').toString().isNotEmpty) 'driverName': _form['driverName'],
            if ((_form['driverPhone'] ?? '').toString().isNotEmpty) 'driverPhone': _form['driverPhone'],
          },
          ..._extraTrucks.map((t) => {
                if (t['vehicle'] != null) 'vehicle': (t['vehicle'] as Map)['_id'],
                if ((t['newPlate'] ?? '').toString().isNotEmpty)
                  'newVehicle': {'plate': t['newPlate'], 'name': '', 'supplierId': (t['supplier'] as Map?)?['_id']},
                if (t['supplier'] != null) 'supplierChoice': (t['supplier'] as Map)['_id'],
                if ((t['driverName'] ?? '').toString().isNotEmpty) 'driverName': t['driverName'],
                if ((t['driverPhone'] ?? '').toString().isNotEmpty) 'driverPhone': t['driverPhone'],
              }),
        ];
        final d = await Api.instance.post('/api/shipment-orders/orders/batch', body);
        final nums = (d['waybills'] as List? ?? const []).join('، ');
        final failedN = (d['failed'] as List? ?? const []).length;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(tr('أُنشئت ${d['created']} شحنة — بوالص $nums${failedN > 0 ? ' · تعذّرت $failedN' : ''}',
                '${d['created']} created — waybills $nums${failedN > 0 ? ' · $failedN failed' : ''}')),
          ));
        }
        if (failedN > 0) { if (mounted) setState(() => _saving = false); return; }
      } else {
        await Api.instance.post('/api/shipment-orders/orders', payload);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Widget _fieldInput(Map<String, dynamic> f) {
    final k = (f['key'] ?? '').toString();
    final label = tr((f['labelAr'] ?? k).toString(), (f['labelEn'] ?? '').toString().isEmpty ? (f['labelAr'] ?? k).toString() : (f['labelEn'] ?? '').toString());
    final miss = _missing.contains(k);
    final deco = InputDecoration(
      labelText: f['required'] == true ? '$label *' : label,
      labelStyle: miss ? const TextStyle(color: T.danger, fontWeight: FontWeight.w700) : null,
      enabledBorder: miss ? OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: T.danger)) : null,
    );
    final type = (f['inputType'] ?? 'text').toString();

    // ── طريقةُ الدفع تُقرأ ولا تُختار ────────────────────────────────────────
    // تتبع «نوع تأجير السائق»: راجعةٌ ⇒ آجل، وقدامٌ ⇒ كاش — والقاعدةُ على
    // الخيار نفسِه في إعدادات القسم (`option.paymentMethod`).
    if (k == 'paymentMethod') {
      final options = List<Map<String, dynamic>>.from(f['options'] ?? []);
      final cur = (_form[k] ?? '').toString();
      final opt = options.firstWhere((o) => o['key'] == cur, orElse: () => const {});
      return InputDecorator(
        decoration: deco,
        child: Text(
          opt.isEmpty ? tr('تُحدَّد من نوع تأجير السائق', 'Set by the rental type')
              : tr('${opt['ar'] ?? opt['key']}', '${opt['en'] ?? opt['ar'] ?? opt['key']}'),
          style: TextStyle(fontWeight: opt.isEmpty ? FontWeight.w400 : FontWeight.w700,
              color: opt.isEmpty ? T.inkFaint : T.ink),
        ),
      );
    }

    if (type == 'select' || type == 'cards') {
      final options = List<Map<String, dynamic>>.from(f['options'] ?? []);
      final current = (_form[k] ?? '').toString();
      return DropdownButtonFormField<String>(
        initialValue: options.any((o) => o['key'] == current) ? current : null,
        isExpanded: true,
        decoration: deco,
        items: options
            .map((o) => DropdownMenuItem(
                value: (o['key'] ?? '').toString(),
                child: Text(tr((o['ar'] ?? o['key'] ?? '').toString(), (o['en'] ?? o['ar'] ?? o['key'] ?? '').toString()), overflow: TextOverflow.ellipsis)))
            .toList(),
        onChanged: (v) => setState(() {
          _form[k] = v;
          if (k == 'fromCity' || k == 'toCity') _applyRoutePrice();
          // نوعُ التأجير يكتب طريقةَ الدفع معه.
          if (k == 'driverRentType') {
            final opt = options.firstWhere((o) => o['key'] == v, orElse: () => const {});
            final pay = (opt['paymentMethod'] ?? '').toString();
            if (pay.isNotEmpty) _form['paymentMethod'] = pay;
          }
        }),
      );
    }

    // ── و«يوم» غيرُ «لحظة» ──────────────────────────────────────────────────
    // مواعيدُ الشحنة تُكتب باليوم: أحدٌ لا يعرف أنّ الاستلام ٧:٤٢، ومن سُئل عن
    // ساعةٍ كتب واحدةً ليمضي.
    if (type == 'date') {
      final current = (_form[k] ?? '').toString();
      final dt = DateTime.tryParse(current)?.toLocal();
      return OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          alignment: AlignmentDirectional.centerStart,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          side: BorderSide(color: miss ? T.danger : Colors.black12),
        ),
        onPressed: () async {
          final d = await showDatePicker(
            context: context,
            initialDate: dt ?? DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (d == null || !mounted) return;
          setState(() => _form[k] = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
        },
        icon: Icon(Icons.event, size: 17, color: miss ? T.danger : T.navy),
        label: Text(
          dt == null ? (f['required'] == true ? '$label *' : label) : '$label: ${dt.day}/${dt.month}/${dt.year}',
          style: TextStyle(fontSize: 13, color: miss ? T.danger : T.ink),
        ),
      );
    }

    if (type == 'datetime') {
      final current = (_form[k] ?? '').toString();
      final dt = DateTime.tryParse(current)?.toLocal();
      return OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          alignment: AlignmentDirectional.centerStart,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          side: BorderSide(color: miss ? T.danger : Colors.black12),
        ),
        onPressed: () async {
          final d = await showDatePicker(
            context: context,
            initialDate: dt ?? DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (d == null || !mounted) return;
          final t = await showTimePicker(context: context, initialTime: dt != null ? TimeOfDay.fromDateTime(dt) : TimeOfDay.now());
          final full = DateTime(d.year, d.month, d.day, t?.hour ?? 0, t?.minute ?? 0);
          setState(() => _form[k] = full.toIso8601String());
        },
        icon: Icon(Icons.event, size: 17, color: miss ? T.danger : T.navy),
        label: Text(
          dt == null ? (f['required'] == true ? '$label *' : label) : '$label: ${dt.day}/${dt.month} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}',
          style: TextStyle(fontSize: 13, color: miss ? T.danger : T.ink),
        ),
      );
    }

    return TextField(
      controller: _ctrl(k),
      maxLines: type == 'textarea' ? 3 : 1,
      keyboardType: type == 'number' ? TextInputType.number : null,
      onChanged: (v) {
        _form[k] = type == 'number' ? (num.tryParse(v) ?? v) : v;
        if (k == 'fromCity' || k == 'toCity') setState(_applyRoutePrice);
      },
      decoration: deco,
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(_editing ? tr('تعديل طلب الشحنة', 'Edit Order') : tr('طلب شحنة جديد', 'New Shipment Order')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 180)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: [
                  // ── العميل ──
                  FadeSlideIn(
                    child: AppCard(
                      topAccent: _missing.contains('customer') ? T.danger : T.navy,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.person_outline, size: 18, color: T.navy),
                          const SizedBox(width: 6),
                          Text(tr('العميل والمورّد', 'Customer & supplier'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          TextButton(
                            onPressed: () => setState(() { _newCustomer = !_newCustomer; if (_newCustomer) _customer = null; }),
                            child: Text(_newCustomer ? tr('اختيار من القائمة', 'Pick existing') : tr('+ عميل جديد', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        if (!_newCustomer)
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                            onPressed: () async {
                              final c = await _pickSheet<Map<String, dynamic>>(tr('العملاء', 'customers'), _customers, (c) => (c['name'] ?? '').toString(), sub: (c) => (c['phone'] ?? '').toString());
                              if (c != null) _applyCustomer(c);
                            },
                            icon: const Icon(Icons.search, size: 17),
                            label: Text(_customer == null ? tr('اختر العميل…', 'Choose customer…') : (_customer!['name'] ?? '').toString(),
                                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                          )
                        else ...[
                          TextField(controller: _ncName, decoration: InputDecoration(labelText: tr('اسم العميل الجديد *', 'New customer name *'))),
                          const SizedBox(height: 8),
                          PhoneSA(controller: _ncPhone, label: tr('الهاتف', 'Phone')),
                        ],
                        const Divider(height: 18),
                        // ── والمورّدُ تحتَه كما في الويب ──────────────────
                        // طرفا الصفقة في بطاقةٍ واحدة: مَن تُحمَل له ومَن
                        // تُحمَل منه. وكان المورّدُ في بطاقة الشاحنة فيُقرأ
                        // وصفًا لها لا طرفًا في العقد.
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                              onPressed: () async {
                                final sp = await _pickRemote(
                                  tr('الموردين', 'suppliers'),
                                  (q) async {
                                    final d = await Api.instance.get(
                                        '/api/shipment-orders/suppliers?limit=60${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
                                    return List<Map<String, dynamic>>.from(d['suppliers'] ?? []);
                                  },
                                  (x) => (x['name'] ?? '').toString(),
                                  sub: (x) => [x['phone'], x['type'] == 'freelancer' ? tr('فريلانسر', 'Freelancer') : tr('شركة', 'Company')]
                                      .where((e) => (e ?? '').toString().isNotEmpty).join(' · '),
                                  hint: tr('الاسم أو الجوّال أو السجل…', 'Name, phone or CR…'),
                                  initial: _suppliers,
                                );
                                if (sp != null) setState(() { _supplier = sp; _vehicle = null; });
                              },
                              icon: const Icon(Icons.storefront_outlined, size: 17),
                              label: Text(_supplier == null ? tr('اختر المورّد…', 'Choose supplier…') : (_supplier!['name'] ?? '').toString(),
                                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                            ),
                          ),
                          IconButton(
                            tooltip: tr('مورّد جديد', 'New supplier'),
                            onPressed: _savingSupplier ? null : _addSupplier,
                            icon: _savingSupplier
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.add_circle_outline, color: T.orange),
                          ),
                        ]),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // ── الشاحنة ──
                  FadeSlideIn(
                    delayMs: 40,
                    child: AppCard(
                      topAccent: T.orange,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.local_shipping_outlined, size: 18, color: T.orange),
                          const SizedBox(width: 6),
                          Text(tr('مالك السيارة', 'Truck owner'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          TextButton(
                            onPressed: () => setState(() { _newVehicle = !_newVehicle; if (_newVehicle) _vehicle = null; }),
                            child: Text(_newVehicle ? tr('اختيار من السجل', 'Pick existing') : tr('+ شاحنة جديدة', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        if (!_newVehicle)
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                            onPressed: () async {
                              // شاحناتُ المورّد المختار تُطلَب بمعرّفه، وبلا
                              // مورّدٍ يُبحَث في كلّ ما ليس من أسطولنا:
                              // أسطولُنا يُدار في «إدارة الأسطول» لا هنا.
                              final sid = _supplier?['_id'];
                              final v = await _pickRemote(
                                tr('الشاحنات', 'vehicles'),
                                (q) async {
                                  final qs = StringBuffer('limit=80');
                                  if (sid != null) { qs.write('&supplier=$sid'); } else { qs.write('&ownership=not_ours'); }
                                  if (q.isNotEmpty) qs.write('&q=${Uri.encodeQueryComponent(q)}');
                                  final d = await Api.instance.get('/api/shipment-orders/vehicles?$qs');
                                  return List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
                                },
                                (v) => (v['plate'] ?? '').toString(),
                                sub: (v) {
                                  final sup = v['supplier'];
                                  final owner = sup is Map
                                      ? (sup['name'] ?? '').toString()
                                      : (v['ownership'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('مالكٌ غير مسجَّل', 'Owner not recorded'));
                                  return [v['name'], owner, v['defaultDriverName']]
                                      .where((e) => (e ?? '').toString().isNotEmpty).join(' · ');
                                },
                                hint: tr('اللوحة أو السائق أو بطاقة التشغيل…', 'Plate, driver or operation card…'),
                              );
                              if (v != null) _applyVehicle(v);
                            },
                            icon: const Icon(Icons.search, size: 17),
                            label: Text(_vehicle == null ? tr('اختر الشاحنة… (اختياري)', 'Choose truck… (optional)') : (_vehicle!['plate'] ?? '').toString(),
                                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                          )
                        else ...[
                          TextField(controller: _nvPlate, decoration: InputDecoration(labelText: tr('اللوحة *', 'Plate *'))),
                          const SizedBox(height: 8),
                          TextField(controller: _nvName, decoration: InputDecoration(labelText: tr('وصف الشاحنة', 'Truck description'))),
                        ],
                        const SizedBox(height: 8),
                        // ── ومالكُها يُقرأ لا يُكتب ───────────────────────
                        // مالكُ الشاحنة في السجلّ خبرٌ عنها، والمورّدُ المتّفقُ
                        // معه قرارٌ في الصفقة — وقد يختلفان (مورّدٌ يُخرجها على
                        // شاحنةِ غيره)، فيُقال ذلك قبل الحفظ لا بعده.
                        if (_vehicle != null) ...[
                          Builder(builder: (_) {
                            final sup = _vehicle!['supplier'];
                            final ownerId = sup is Map ? (sup['_id'] ?? '').toString() : (sup ?? '').toString();
                            final owner = sup is Map
                                ? (sup['name'] ?? '').toString()
                                : (_vehicle!['ownership'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('مالكٌ غير مسجَّل', 'Owner not recorded'));
                            final chosen = (_supplier?['_id'] ?? '').toString();
                            final differs = ownerId.isNotEmpty && chosen.isNotEmpty && ownerId != chosen;
                            return Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: differs ? const Color(0xFFFEF3C7) : const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                differs
                                    ? '${tr('مالك السيارة', 'Owner')}: $owner · ${tr('المتّفقُ معه', 'Agreed with')}: ${(_supplier?['name'] ?? '').toString()}'
                                    : '${tr('مالك السيارة', 'Owner')}: $owner',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: differs ? const Color(0xFF92400E) : T.inkSoft),
                              ),
                            );
                          }),
                          const SizedBox(height: 8),
                        ],
                        Row(children: [
                          Expanded(
                            child: TextField(
                              controller: _ctrl('driverName'),
                              onChanged: (v) => _form['driverName'] = v,
                              decoration: InputDecoration(labelText: tr('اسم السائق', 'Driver name')),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            // ── مفتاحُ الدولة يسارَ الأرقام في كلّ لغة ─────
                            // `PhoneSA` واحدٌ لكلّ جوّالٍ في التطبيق: الحقلُ
                            // `ltr` فيبقى «+966» يسارًا والأرقامُ بعده، تسعُ
                            // خاناتٍ لا أكثر، والمخزَّنُ كاملٌ دائمًا.
                            child: PhoneSA(
                              controller: _phoneCtrl('driverPhone'),
                              label: tr('هاتف السائق', 'Driver phone'),
                              onChanged: (full) => setState(() => _form['driverPhone'] = full),
                            ),
                          ),
                          const SizedBox(width: 4),
                          // اتصال/واتساب على رقم السائق مباشرة.
                          ContactButtons(phone: (_form['driverPhone'] ?? _ctrls['driverPhone']?.text ?? '').toString(), compact: true),
                        ]),
                      ]),
                    ),
                  ),
                  // ── الحقول من الإعدادات، مجموعة مجموعة ──
                  ..._groups.map((g) {
                    final gf = _fields.where((f) => f['group'] == g.$1 && !_fixedKeys.contains(f['key'])).toList();
                    if (gf.isEmpty) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: FadeSlideIn(
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Icon(g.$4, size: 18, color: T.navy),
                              const SizedBox(width: 6),
                              Text(tr(g.$2, g.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            ]),
                            const SizedBox(height: 10),
                            ...gf.map((f) => Padding(padding: const EdgeInsets.only(bottom: 10), child: _fieldInput(f))),
                          ]),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 16),
                  // ── الحمولةُ على عدّةِ شاحنات ──────────────────────────────
                  // تُضاف الشاحنةُ وتُرى قبل الحفظ، وكلٌّ تصير شحنةً مستقلّةً
                  // برقم بوليصتها — نفسُ العميل والمسار والسعر والموعد.
                  if (!_editing) ...[
                    if (_extraTrucks.isNotEmpty)
                      AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('الحمولة على ${_extraTrucks.length + 1} شاحنات', 'This load on ${_extraTrucks.length + 1} trucks'),
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text(tr('كلُّ شاحنةٍ شحنةٌ مستقلّةٌ برقم بوليصةٍ خاصّ — نفسُ بقيّة البيانات',
                                  'each truck becomes its own shipment with its own waybill'),
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          const Divider(height: 18),
                          // الشاحنةُ الأولى تُعرَض للعلم: تُحرَّر في بطاقتها أعلاه.
                          Row(children: [
                            const Text('1 · ', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                            Expanded(child: Text(
                              [(_supplier?['name'] ?? tr('بلا مورّد', 'no supplier')).toString(),
                               (_vehicle?['plate'] ?? (_nvPlate.text.trim().isEmpty ? tr('بلا شاحنة', 'no truck') : _nvPlate.text.trim())).toString()].join(' · '),
                              style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis)),
                          ]),
                          for (var i = 0; i < _extraTrucks.length; i++)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Row(children: [
                                Text('${i + 2} · ', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                                Expanded(child: Text(
                                  [((_extraTrucks[i]['supplier'] as Map?)?['name'] ?? tr('بلا مورّد', 'no supplier')).toString(),
                                   ((_extraTrucks[i]['vehicle'] as Map?)?['plate'] ?? (_extraTrucks[i]['newPlate'] ?? tr('بلا شاحنة', 'no truck'))).toString(),
                                   if ((_extraTrucks[i]['driverName'] ?? '').toString().isNotEmpty) _extraTrucks[i]['driverName'].toString()]
                                      .join(' · '),
                                  style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis)),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: const Icon(Icons.close, size: 16, color: T.inkFaint),
                                  onPressed: () => setState(() => _extraTrucks.removeAt(i)),
                                ),
                              ]),
                            ),
                        ]),
                      ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 46,
                      child: OutlinedButton.icon(
                        onPressed: _saving ? null : _addExtraTruck,
                        icon: const Icon(Icons.local_shipping_outlined, size: 18),
                        label: Text(tr('+ شاحنة أخرى بنفس التفاصيل', '+ Another truck, same details'),
                            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  SizedBox(
                    height: 50,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.check_rounded),
                      label: Text(
                          _editing
                              ? tr('حفظ التعديلات', 'Save changes')
                              : (_extraTrucks.isEmpty
                                  ? tr('إنشاء الطلب', 'Create order')
                                  : tr('إنشاء ${_extraTrucks.length + 1} شحنات', 'Create ${_extraTrucks.length + 1} shipments')),
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                    ),
                  ),
                  const SizedBox(height: 30),
                ]),
    );
  }
}
