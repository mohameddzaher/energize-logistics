import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import '../ui/stat_grid.dart';
import 'ops_common.dart' show opsLoc, opsMoney, opsYmd, opsDate, opsErr;
import 'ops_platform_extra.dart';

/// منصة العمليات (UPL) — المرآة الحية: لوحة، الشحنات (ops_platform_extra.dart)،
/// و١٢ جدول مرجعي ببحث الخادم وترقيم الصفحات، كما على الويب.

enum OpsKind { text, badge, rel, money, phone, boolean, date }

class OpsCol {
  final String key, ar, en;
  final OpsKind kind;
  const OpsCol(this.key, this.ar, this.en, [this.kind = OpsKind.text]);
}

class OpsCfg {
  final String key, ar, en;
  final IconData icon;
  final List<OpsCol> cols;
  const OpsCfg(this.key, this.ar, this.en, this.icon, this.cols);
}

const opsShipmentStatuses = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On Way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond Sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond Received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

const opsResources = [
  OpsCfg('shipments', 'الشحنات', 'Shipments', Icons.local_shipping_outlined, [
    OpsCol('reference_num', 'المرجع', 'Ref #'),
    OpsCol('status', 'الحالة', 'Status', OpsKind.badge),
    OpsCol('address_from', 'من', 'From'),
    OpsCol('address_to', 'إلى', 'To'),
    OpsCol('driver', 'السائق', 'Driver', OpsKind.rel),
    OpsCol('selling_price', 'البيع', 'Selling', OpsKind.money),
    OpsCol('created_at', 'الإنشاء', 'Created', OpsKind.date),
  ]),
  OpsCfg('drivers', 'السائقون', 'Drivers', Icons.badge_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('phone', 'الهاتف', 'Phone', OpsKind.phone),
    OpsCol('nationality', 'الجنسية', 'Nationality'),
    OpsCol('driver_card_number', 'رقم البطاقة', 'Card #'),
    OpsCol('company_name', 'الشركة', 'Company'),
    OpsCol('created_at', 'الإنشاء', 'Created', OpsKind.date),
  ]),
  OpsCfg('cars', 'المركبات', 'Cars', Icons.directions_car_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('plate_number', 'اللوحة', 'Plate'),
    OpsCol('car_number', 'رقم المركبة', 'Car #'),
    OpsCol('car_model_year', 'الموديل', 'Year'),
    OpsCol('owner', 'المالك', 'Owner', OpsKind.rel),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('car-owners', 'أصحاب المركبات', 'Car Owners', Icons.person_pin_outlined, [
    OpsCol('owner_name', 'المالك', 'Owner'),
    OpsCol('owner_phone', 'الهاتف', 'Phone', OpsKind.phone),
    OpsCol('car_owner_number', 'رقم المالك', 'Owner #'),
    OpsCol('manager_name', 'المدير', 'Manager'),
    OpsCol('created_at', 'الإنشاء', 'Created', OpsKind.date),
  ]),
  OpsCfg('users', 'العملاء', 'Customers', Icons.people_outline, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('phone', 'الهاتف', 'Phone', OpsKind.phone),
    OpsCol('email', 'البريد', 'Email'),
    OpsCol('user_type', 'النوع', 'Type'),
    OpsCol('verified', 'موثّق', 'Verified', OpsKind.boolean),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('branches', 'الفروع', 'Branches', Icons.store_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('country', 'الدولة', 'Country', OpsKind.rel),
    OpsCol('city', 'المدينة', 'City', OpsKind.rel),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('cities', 'المدن', 'Cities', Icons.location_city_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('country', 'الدولة', 'Country', OpsKind.rel),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('countries', 'الدول', 'Countries', Icons.public_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('truck-types', 'أنواع الشاحنات', 'Truck Types', Icons.fire_truck_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('truck-sizes', 'أحجام الشاحنات', 'Truck Sizes', Icons.straighten_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('truck_type', 'نوع الشاحنة', 'Truck Type', OpsKind.rel),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('load-types', 'أنواع الحمولة', 'Load Types', Icons.inventory_2_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('car-brands', 'ماركات المركبات', 'Car Brands', Icons.sell_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
  OpsCfg('car-colors', 'ألوان المركبات', 'Car Colors', Icons.palette_outlined, [
    OpsCol('name', 'الاسم', 'Name'),
    OpsCol('color_code', 'الكود', 'Color'),
    OpsCol('active', 'مُفعّل', 'Active', OpsKind.boolean),
  ]),
];

// حقول الإنشاء/التعديل لكل مورد — مطابقة لـ frontend/src/lib/ops.ts.
// النوع: text | number | date | bool | ref | localized | image(URL).
class OpsField {
  final String key, ar, en, type;
  final bool required;
  final String? ref; // اسم المورد للعلاقة (ref)
  const OpsField(this.key, this.ar, this.en, {this.type = 'text', this.required = false, this.ref});
}

const _active = OpsField('active', 'مُفعّل', 'Active', type: 'bool');

const opsFields = <String, List<OpsField>>{
  'drivers': [
    OpsField('name', 'الاسم', 'Name', required: true),
    OpsField('phone', 'الهاتف', 'Phone', required: true),
    OpsField('email', 'البريد', 'Email'),
    OpsField('nationality', 'الجنسية', 'Nationality', required: true),
    OpsField('residence_number', 'رقم الإقامة', 'Residence #'),
    OpsField('driver_card_number', 'رقم بطاقة السائق', 'Driver card #', required: true),
    OpsField('driver_card_expiry', 'انتهاء البطاقة', 'Card expiry', type: 'date'),
    OpsField('company_name', 'الشركة', 'Company'),
    OpsField('sponsor_name', 'الكفيل', 'Sponsor'),
    OpsField('car_owner_id', 'صاحب السيارة', 'Car owner', type: 'ref', ref: 'car-owners', required: true),
    OpsField('car_id', 'السيارة', 'Car', type: 'ref', ref: 'cars', required: true),
  ],
  'cars': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('car_number', 'رقم المركبة', 'Car number', required: true),
    OpsField('plate_number', 'رقم اللوحة', 'Plate number', required: true),
    OpsField('car_model_year', 'سنة الموديل', 'Model year', type: 'number', required: true),
    OpsField('car_record_number', 'رقم السجل', 'Record #'),
    OpsField('insurance_details', 'التأمين', 'Insurance'),
    OpsField('operation_card_number', 'رقم كرت التشغيل', 'Operation card #'),
    OpsField('operation_card_expiry', 'انتهاء كرت التشغيل', 'Op. card expiry', type: 'date'),
    OpsField('truck_type_id', 'نوع الشاحنة', 'Truck type', type: 'ref', ref: 'truck-types', required: true),
    OpsField('country_id', 'الدولة', 'Country', type: 'ref', ref: 'countries', required: true),
    OpsField('car_brand_id', 'الماركة', 'Brand', type: 'ref', ref: 'car-brands', required: true),
    OpsField('car_color_id', 'اللون', 'Color', type: 'ref', ref: 'car-colors', required: true),
    OpsField('owner_id', 'المالك', 'Owner', type: 'ref', ref: 'car-owners', required: true),
    _active,
  ],
  'car-owners': [
    OpsField('owner_name', 'اسم المالك', 'Owner name'),
    OpsField('owner_phone', 'هاتف المالك', 'Owner phone'),
    OpsField('car_owner_number', 'رقم المالك', 'Owner number'),
    OpsField('commercial_register', 'السجل التجاري', 'Commercial register'),
    OpsField('tax_card', 'البطاقة الضريبية', 'Tax card'),
    OpsField('national_address', 'العنوان الوطني', 'National address'),
    OpsField('bank_name', 'البنك', 'Bank'),
    OpsField('iban', 'الآيبان', 'IBAN'),
    OpsField('manager_name', 'اسم المدير', 'Manager name'),
    OpsField('manager_phone', 'هاتف المدير', 'Manager phone'),
    OpsField('accountant_name', 'المحاسب', 'Accountant'),
    OpsField('accountant_phone', 'هاتف المحاسب', 'Accountant phone'),
    OpsField('payment_terms', 'شروط الدفع', 'Payment terms', required: true),
    OpsField('agreed_price_statement', 'السعر المتفق', 'Agreed price', required: true),
    OpsField('owner_id', 'المستخدم (المالك)', 'User (owner)', type: 'ref', ref: 'users', required: true),
    OpsField('delegate_id', 'المندوب', 'Delegate', type: 'ref', ref: 'admins', required: true),
  ],
  'users': [
    OpsField('name', 'الاسم', 'Name'),
    OpsField('phone', 'الهاتف', 'Phone', required: true),
    OpsField('email', 'البريد', 'Email'),
    OpsField('user_type', 'نوع المستخدم (fleet / 3pl)', 'User type (fleet / 3pl)', required: true),
    OpsField('address', 'العنوان', 'Address'),
    OpsField('zip_code', 'الرمز البريدي', 'Zip', type: 'number'),
    OpsField('city_id', 'المدينة', 'City', type: 'ref', ref: 'cities'),
    OpsField('verified', 'موثّق', 'Verified', type: 'bool'),
    _active,
  ],
  'branches': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('country_id', 'الدولة', 'Country', type: 'ref', ref: 'countries', required: true),
    OpsField('city_id', 'المدينة', 'City', type: 'ref', ref: 'cities', required: true),
    _active,
  ],
  'cities': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('country_id', 'الدولة', 'Country', type: 'ref', ref: 'countries', required: true),
    OpsField('lat', 'خط العرض', 'Latitude', type: 'number'),
    OpsField('lng', 'خط الطول', 'Longitude', type: 'number'),
    _active,
  ],
  'countries': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('flag', 'العلم (رابط)', 'Flag (URL)', type: 'image', required: true),
    _active,
  ],
  'truck-types': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('image', 'الصورة (رابط)', 'Image (URL)', type: 'image'),
    _active,
  ],
  'truck-sizes': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('truck_type_id', 'نوع الشاحنة', 'Truck type', type: 'ref', ref: 'truck-types', required: true),
    OpsField('image', 'الصورة (رابط)', 'Image (URL)', type: 'image'),
    _active,
  ],
  'load-types': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('image', 'الصورة (رابط)', 'Image (URL)', type: 'image'),
    _active,
  ],
  'car-brands': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('image', 'الشعار (رابط)', 'Logo (URL)', type: 'image'),
    _active,
  ],
  'car-colors': [
    OpsField('name', 'الاسم', 'Name', type: 'localized', required: true),
    OpsField('color_code', 'كود اللون', 'Color code (hex)', required: true),
    _active,
  ],
};

String opsCell(Map<String, dynamic> r, OpsCol c) {
  final v = r[c.key];
  if (v == null) return '';
  switch (c.kind) {
    case OpsKind.rel:
      if (v is Map) {
        final n = v['name'];
        if (n is Map) return (Lang.instance.ar ? n['ar'] : n['en'])?.toString() ?? n['en']?.toString() ?? '';
        return (n ?? '').toString();
      }
      return v.toString();
    case OpsKind.boolean:
      return v == true || v == 1 ? tr('نعم', 'Yes') : tr('لا', 'No');
    case OpsKind.date:
      final d = DateTime.tryParse(v.toString())?.toLocal();
      return d == null ? v.toString() : '${d.day}/${d.month}/${d.year}';
    case OpsKind.money:
      final n = v is num ? v : num.tryParse(v.toString());
      return n == null ? v.toString() : '${n.toStringAsFixed(0)} ${tr('ر.س', 'SAR')}';
    default:
      if (v is Map) {
        return (Lang.instance.ar ? v['ar'] : v['en'])?.toString() ?? v['en']?.toString() ?? '';
      }
      return v.toString();
  }
}

// ── القائمة العامة ──────────────────────────────────────────────────────────
/// فلاترُ كلّ مورد — نفسُ `filters` في lib/ops.ts (القيمُ 'true'/'false' كما يرسلها الويب).
const _activeFilter = ('active', 'الحالة', 'Status', [('true', 'مُفعّل', 'Active'), ('false', 'غير مُفعّل', 'Inactive')]);
const opsResourceFilters = <String, List<(String, String, String, List<(String, String, String)>)>>{
  'cars': [_activeFilter],
  'users': [
    _activeFilter,
    ('verified', 'التوثيق', 'Verified', [('true', 'موثّق', 'Verified'), ('false', 'غير موثّق', 'Unverified')]),
    ('user_type', 'النوع', 'Type', [('individual', 'فرد', 'Individual'), ('business', 'شركة', 'Business')]),
  ],
  'branches': [_activeFilter],
  'cities': [_activeFilter],
  'countries': [_activeFilter],
  'truck-types': [_activeFilter],
  'truck-sizes': [_activeFilter],
  'load-types': [_activeFilter],
  'car-brands': [_activeFilter],
  'car-colors': [_activeFilter],
};

/// الصفوفُ التي تفتح ملفًّا كاملًا بدل نافذة التفاصيل (`profile: true`).
const _profileResources = {'drivers', 'users'};

/// الشحناتُ لها صفحتُها (فلاتر غنيّة وسير حالات)؛ وبقيّةُ الموارد جدولٌ عامّ.
class OpsResourceScreen extends StatelessWidget {
  final OpsCfg cfg;
  const OpsResourceScreen({super.key, required this.cfg});
  @override
  Widget build(BuildContext context) =>
      cfg.key == 'shipments' ? const OpsShipmentsScreen() : _OpsGenericResourceScreen(cfg: cfg);
}

class _OpsGenericResourceScreen extends StatefulWidget {
  final OpsCfg cfg;
  const _OpsGenericResourceScreen({required this.cfg});
  @override
  State<_OpsGenericResourceScreen> createState() => _OpsResourceScreenState();
}

class _OpsResourceScreenState extends State<_OpsGenericResourceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  bool _stale = false;
  String? _error;
  String _q = '';
  // البحثُ أثناء الكتابة بتأخيرٍ قصير؛ والمتحكِّمُ عند الشاشة كي يمسحه «مسح الكل» أيضًا.
  final _searchCtl = TextEditingController();
  Timer? _debounce;
  final Map<String, String> _filters = {};
  int _page = 1;
  int _lastPage = 1;
  int? _totalItems;
  int _seq = 0;
  late final void Function() _onLive;

  List<OpsField> get _fields => opsFields[widget.cfg.key] ?? const [];
  bool get _admin => isOpsAdmin(context.read<AuthProvider>());
  bool get _writable => _admin && _fields.isNotEmpty;
  List<(String, String, String, List<(String, String, String)>)> get _filterDefs => opsResourceFilters[widget.cfg.key] ?? const [];

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load(silent: true);
    // الخادمُ يعلن `ops:<المورد>:changed`، و`ops:stats` يلتقط ما أُضيف أو حُذف في المنصّة نفسِها.
    Live.instance.on('ops:${widget.cfg.key}:changed', _onLive);
    Live.instance.on('ops:stats', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ops:${widget.cfg.key}:changed', _onLive);
    Live.instance.off('ops:stats', _onLive);
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    final mine = ++_seq;
    try {
      final params = [
        'page=$_page', 'limit=25', 'lang=${Lang.instance.ar ? 'ar' : 'en'}',
        if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}',
        for (final e in _filters.entries) if (e.value.isNotEmpty) '${e.key}=${Uri.encodeQueryComponent(e.value)}',
      ];
      final d = await Api.instance.get('/api/ops/${widget.cfg.key}?${params.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from((d['items'] ?? d['data'] ?? []) as List);
        final meta = d['meta'];
        _lastPage = meta is Map ? ((meta['totalPages'] ?? meta['last_page'] ?? 1) as num).toInt() : 1;
        _totalItems = meta is Map && meta['totalItems'] is num ? (meta['totalItems'] as num).toInt() : null;
        _loading = false;
        _stale = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      // تعثُّرُ المنصّة لا يُفرغ ما يُعرض.
      setState(() {
        _loading = false;
        if (_rows.isEmpty && !silent) { _error = _opsErrText(e); } else { _stale = true; }
      });
    }
  }

  void _reload() { setState(() { _page = 1; _loading = _rows.isEmpty; }); _load(); }

  void _open(Map<String, dynamic> r) {
    final id = '${r['id'] ?? ''}';
    if (_profileResources.contains(widget.cfg.key) && id.isNotEmpty) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => widget.cfg.key == 'users'
          ? OpsCustomerProfileScreen(id: id)
          : OpsDriverProfileScreen(id: id)));
    } else {
      _detailSheet(context, r);
    }
  }

  void _openForm({Map<String, dynamic>? row}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _OpsForm(cfg: widget.cfg, fields: _fields, row: row, onDone: _load),
    );
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تأكيد الحذف', 'Confirm delete')),
        content: Text(tr('حذف هذا السجل؟', 'Delete this record?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/ops/${widget.cfg.key}/${row['id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final cfg = widget.cfg;
    final admin = isOpsAdmin(context.watch<AuthProvider>());
    final anyFilter = _q.isNotEmpty || _filters.values.any((v) => v.isNotEmpty);
    return AppScaffold(
      title: Text(tr(cfg.ar, cfg.en)),
      actions: [IconButton(tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: _load)],
      floatingActionButton: _writable
          ? FloatingActionButton.extended(
              backgroundColor: T.navy, foregroundColor: Colors.white,
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add), label: Text(tr('إضافة', 'Add')),
            )
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: SearchField(
            controller: _searchCtl, dense: true,
            hint: tr('ابحث…', 'Search…'),
            onChanged: (v) {
              _q = v;
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () { if (mounted) _reload(); });
            },
          ),
        ),
        if (_filterDefs.isNotEmpty || anyFilter)
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(14, 2, 14, 6),
              children: [
                for (final f in _filterDefs)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 6),
                    child: PopupMenuButton<String>(
                      onSelected: (v) { setState(() => _filters[f.$1] = v); _reload(); },
                      itemBuilder: (_) => [
                        PopupMenuItem(value: '', child: Text('${tr(f.$2, f.$3)} · ${tr('الكل', 'All')}')),
                        for (final o in f.$4) PopupMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3))),
                      ],
                      child: Chip(
                        visualDensity: VisualDensity.compact,
                        backgroundColor: (_filters[f.$1] ?? '').isNotEmpty ? T.navy : T.navy.withValues(alpha: 0.08),
                        side: BorderSide.none,
                        label: Text(
                          (_filters[f.$1] ?? '').isEmpty
                              ? '${tr(f.$2, f.$3)} · ${tr('الكل', 'All')}'
                              : () { final o = f.$4.firstWhere((x) => x.$1 == _filters[f.$1]); return '${tr(f.$2, f.$3)}: ${tr(o.$2, o.$3)}'; }(),
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: (_filters[f.$1] ?? '').isNotEmpty ? Colors.white : T.navy),
                        ),
                      ),
                    ),
                  ),
                if (anyFilter)
                  TextButton.icon(
                    onPressed: () { _debounce?.cancel(); _searchCtl.clear(); setState(_filters.clear); _q = ''; _reload(); },
                    icon: const Icon(Icons.close, size: 16),
                    label: Text(tr('مسح الكل', 'Reset all')),
                  ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Row(children: [
            Text('${_totalItems ?? _rows.length} ${tr('الإجمالي', 'Total')} · ${tr('مباشر', 'Live')}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
            if (_stale) ...[
              const SizedBox(width: 8),
              Expanded(child: Text(tr('تعذّر التحديث — آخر نسخة محفوظة', 'Could not refresh — last known data'), style: const TextStyle(fontSize: 11, color: T.warn), overflow: TextOverflow.ellipsis)),
            ],
          ]),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: cfg.icon, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد سجلات', 'No records'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = _rows[i];
                                final title = opsCell(r, cfg.cols.first);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _open(r),
                                    child: AppCard(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text(title.isEmpty ? '—' : title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                          if (_profileResources.contains(cfg.key)) const Icon(Icons.chevron_left, size: 18, color: T.inkFaint),
                                          if (admin)
                                            PopupMenuButton<int>(
                                              icon: const Icon(Icons.more_vert, size: 20, color: T.inkFaint),
                                              onSelected: (v) => v == 0 ? _openForm(row: r) : v == 1 ? _delete(r) : _detailSheet(context, r),
                                              itemBuilder: (c2) => [
                                                PopupMenuItem(value: 2, child: Row(children: [const Icon(Icons.visibility_outlined, size: 18, color: T.inkSoft), const SizedBox(width: 10), Text(tr('التفاصيل', 'Details'))])),
                                                if (_writable) PopupMenuItem(value: 0, child: Row(children: [const Icon(Icons.edit_outlined, size: 18, color: T.navy), const SizedBox(width: 10), Text(tr('تعديل', 'Edit'))])),
                                                PopupMenuItem(value: 1, child: Row(children: [const Icon(Icons.delete_outline, size: 18, color: T.danger), const SizedBox(width: 10), Text(tr('حذف', 'Delete'))])),
                                              ],
                                            ),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          for (final col in cfg.cols.skip(1).where((x) => x.kind != OpsKind.badge))
                                            if (opsCell(r, col).isNotEmpty)
                                              Chip2('${tr(col.ar, col.en)}: ${opsCell(r, col)}',
                                                  col.kind == OpsKind.boolean
                                                      ? (r[col.key] == true || r[col.key] == 1 ? T.success : T.inkFaint)
                                                      : T.navy),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
        ),
        if (_lastPage > 1)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                IconButton(
                  onPressed: _page > 1 ? () { setState(() => _page--); _load(); } : null,
                  icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left),
                ),
                Text('$_page / $_lastPage', style: const TextStyle(fontWeight: FontWeight.w800)),
                IconButton(
                  onPressed: _page < _lastPage ? () { setState(() => _page++); _load(); } : null,
                  icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right),
                ),
              ]),
            ),
          ),
      ]),
    );
  }

  void _detailSheet(BuildContext context, Map<String, dynamic> r) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.7,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text('${tr(widget.cfg.ar, widget.cfg.en)} · ${tr('التفاصيل', 'Details')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            ...r.entries.map((e) {
              final raw = e.value;
              String v;
              if (raw == null || raw == '') {
                v = '—';
              } else if (raw is bool) {
                v = raw ? '✓' : '✗';
              } else if (raw is Map || raw is List) {
                final ln = opsLoc(raw);
                v = ln.isNotEmpty ? ln : raw.toString();
              } else if (raw is String && RegExp(r'\d{4}-\d{2}-\d{2}T').hasMatch(raw)) {
                final d = DateTime.tryParse(raw)?.toLocal();
                v = d == null ? raw : '${opsDate(opsYmd(d))} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
              } else {
                v = raw.toString();
              }
              return Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 140, child: Text(e.key, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                  Expanded(child: Text(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                ]),
              );
            }),
          ]),
        ),
      ),
    );
  }
}

// ── نموذج إنشاء/تعديل مورد المنصة ───────────────────────────────────────────
// يطابق عقد الويب: bool → 'true'/'false' نصًا، localized → {en,ar}، ref → id.
class _OpsForm extends StatefulWidget {
  final OpsCfg cfg;
  final List<OpsField> fields;
  final Map<String, dynamic>? row;
  final Future<void> Function() onDone;
  const _OpsForm({required this.cfg, required this.fields, this.row, required this.onDone});
  @override
  State<_OpsForm> createState() => _OpsFormState();
}

class _OpsFormState extends State<_OpsForm> {
  final Map<String, dynamic> _v = {};
  final Map<String, String> _refLabels = {};
  bool _busy = false;
  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      final raw = widget.row?[f.key];
      switch (f.type) {
        case 'bool':
          _v[f.key] = raw == true || raw == 'true' || raw == 1;
        case 'localized':
          _v[f.key] = {'en': (raw is Map ? raw['en'] : (raw is String ? raw : '')) ?? '', 'ar': (raw is Map ? raw['ar'] : '') ?? ''};
        case 'ref':
          _v[f.key] = (raw is Map ? (raw['id'] ?? '') : (raw ?? '')).toString();
          if (raw is Map) _refLabels[f.key] = _opsName(raw);
        default:
          _v[f.key] = (raw ?? '').toString();
      }
    }
  }

  Map<String, dynamic> _payload() {
    final out = <String, dynamic>{};
    for (final f in widget.fields) {
      final v = _v[f.key];
      switch (f.type) {
        case 'localized':
          final o = v as Map;
          final en = (o['en'] ?? '').toString(), ar = (o['ar'] ?? '').toString();
          if (en.isNotEmpty || ar.isNotEmpty) out[f.key] = {'en': en.isNotEmpty ? en : ar, 'ar': ar.isNotEmpty ? ar : en};
        case 'bool':
          out[f.key] = v == true ? 'true' : 'false';
        case 'number':
          final s = (v ?? '').toString().trim();
          if (s.isNotEmpty) out[f.key] = num.tryParse(s);
        default:
          final s = (v ?? '').toString().trim();
          if (s.isNotEmpty) out[f.key] = s;
      }
    }
    return out;
  }

  bool _valid() => widget.fields.every((f) {
        if (!f.required) return true;
        final v = _v[f.key];
        if (f.type == 'localized') return ((v as Map)['en'] ?? '').toString().isNotEmpty || (v['ar'] ?? '').toString().isNotEmpty;
        if (f.type == 'bool') return true;
        return (v ?? '').toString().trim().isNotEmpty;
      });

  Future<void> _save() async {
    if (!_valid()) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أكمل الحقول المطلوبة (*)', 'Fill the required fields (*)'))));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = _payload();
      if (isEdit) {
        await Api.instance.patch('/api/ops/${widget.cfg.key}/${widget.row!['id']}', body);
      } else {
        await Api.instance.post('/api/ops/${widget.cfg.key}', body);
      }
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(18),
          children: [
            Text(isEdit ? tr('تعديل', 'Edit') : '${tr('إضافة', 'Add')} ${tr(widget.cfg.ar, widget.cfg.en)}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            ...widget.fields.map(_field),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(isEdit ? tr('حفظ التعديلات', 'Save changes') : tr('إضافة', 'Add')),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _field(OpsField f) {
    const pad = EdgeInsets.only(bottom: 10);
    final label = tr(f.ar, f.en) + (f.required ? ' *' : '');
    switch (f.type) {
      case 'bool':
        return Padding(
          padding: pad,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(tr(f.ar, f.en), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            value: _v[f.key] == true,
            activeTrackColor: T.success,
            onChanged: (x) => setState(() => _v[f.key] = x),
          ),
        );
      case 'localized':
        final o = _v[f.key] as Map;
        return Padding(
          padding: pad,
          child: Row(children: [
            Expanded(child: TextField(
              controller: TextEditingController(text: (o['ar'] ?? '').toString())..selection = TextSelection.collapsed(offset: (o['ar'] ?? '').toString().length),
              decoration: InputDecoration(labelText: '$label (ع)', isDense: true),
              onChanged: (v) => o['ar'] = v,
            )),
            const SizedBox(width: 8),
            Expanded(child: TextField(
              controller: TextEditingController(text: (o['en'] ?? '').toString())..selection = TextSelection.collapsed(offset: (o['en'] ?? '').toString().length),
              decoration: InputDecoration(labelText: '$label (EN)', isDense: true),
              onChanged: (v) => o['en'] = v,
            )),
          ]),
        );
      case 'ref':
        final id = (_v[f.key] ?? '').toString();
        final lbl = _refLabels[f.key] ?? (id.isEmpty ? '' : id);
        return Padding(
          padding: pad,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.link_rounded, size: 18),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
            label: Text('$label: ${lbl.isEmpty ? tr('اختر…', 'Choose…') : lbl}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
            onPressed: () async {
              final picked = await showModalBottomSheet<(String, String)?>(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.white,
                shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
                builder: (c) => _OpsRefPicker(resource: f.ref!, currentId: id),
              );
              if (picked != null) setState(() { _v[f.key] = picked.$1; _refLabels[f.key] = picked.$2; });
            },
          ),
        );
      case 'date':
        final s = (_v[f.key] ?? '').toString();
        return Padding(
          padding: pad,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
            label: Text('$label: ${s.isEmpty ? tr('اختر', 'Pick') : s.split('T').first}', style: const TextStyle(fontSize: 14)),
            onPressed: () async {
              final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(s) ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2040));
              if (d != null) setState(() => _v[f.key] = d.toIso8601String().split('T').first);
            },
          ),
        );
      default:
        return Padding(
          padding: pad,
          child: TextField(
            controller: TextEditingController(text: (_v[f.key] ?? '').toString())..selection = TextSelection.collapsed(offset: (_v[f.key] ?? '').toString().length),
            keyboardType: f.type == 'number' ? TextInputType.number : TextInputType.text,
            decoration: InputDecoration(labelText: label),
            onChanged: (v) => _v[f.key] = v,
          ),
        );
    }
  }
}

// اسم مورد المنصة للعرض: يدعم name كـ {ar,en} أو نص.
String _opsName(Map row) {
  final n = row['name'];
  if (n is Map) return (Lang.instance.ar ? n['ar'] : n['en'])?.toString() ?? n['en']?.toString() ?? n['ar']?.toString() ?? '';
  return (n ?? row['owner_name'] ?? row['name'] ?? row['id'] ?? '').toString();
}

// منتقي علاقة من موارد المنصة: يجلب /api/ops/:resource ويرجع (id, label).
class _OpsRefPicker extends StatefulWidget {
  final String resource;
  final String currentId;
  const _OpsRefPicker({required this.resource, required this.currentId});
  @override
  State<_OpsRefPicker> createState() => _OpsRefPickerState();
}

class _OpsRefPickerState extends State<_OpsRefPicker> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // آخرُ بحثٍ وحدَه يُكتب — ردٌّ أقدمُ يصل متأخّرًا لا يمحو الأحدث.
  int _seq = 0;
  Timer? _debounce;

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _debounce?.cancel(); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/ops/${widget.resource}?page=1&limit=200&lang=${Lang.instance.ar ? 'ar' : 'en'}${_q.trim().isEmpty ? '' : '&search=${Uri.encodeQueryComponent(_q.trim())}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from((d['items'] ?? d['data'] ?? []) as List); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = _opsErrText(e); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (c, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
            child: SearchField(
              autofocus: true,
              hint: tr('ابحث ثم إدخال…', 'Search then enter…'),
              onChanged: (v) {
                _q = v;
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), () { if (mounted) { setState(() => _loading = true); _load(); } });
              },
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                    : _rows.isEmpty
                        ? EmptyState(icon: Icons.link_off_rounded, title: tr('لا نتائج', 'No results'))
                        : ListView.builder(
                            controller: scroll,
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            padding: const EdgeInsets.fromLTRB(8, 6, 8, 20),
                            itemCount: _rows.length,
                            itemBuilder: (c2, i) {
                              final r = _rows[i];
                              final id = (r['id'] ?? '').toString();
                              final on = id == widget.currentId;
                              return ListTile(
                                leading: Icon(on ? Icons.radio_button_checked : Icons.radio_button_off, color: on ? T.navy : T.inkFaint, size: 20),
                                title: Text(_opsName(r), style: const TextStyle(fontSize: 14)),
                                onTap: () => Navigator.pop(c, (id, _opsName(r))),
                              );
                            },
                          ),
          ),
        ]),
      ),
    );
  }
}

// ── لوحة المنصة ─────────────────────────────────────────────────────────────
/// نظيرُ /system/ops: بطاقاتُ الأعداد (تُضغط فتفتح الجدول)، وتوزيعُ الحالات
/// (يُضغط فيفتح الشحنات مصفّاةً)، والإيراداتُ الشهريّة، وأحدثُ الشحنات،
/// ولوحتا الصدارة — مع فلتر الفرع وفترةٍ جاهزة (اليوم/أمس/٧ أيام/الشهر/الكل)
/// أو يومٍ بعينه أو مدى.
const _countCards = [
  ('shipments', 'shipments', 'الشحنات', 'Shipments', Icons.local_shipping_outlined, T.orange),
  ('drivers', 'drivers', 'السائقون', 'Drivers', Icons.badge_outlined, T.info),
  ('cars', 'cars', 'المركبات', 'Cars', Icons.directions_car_outlined, T.success),
  ('carOwners', 'car-owners', 'أصحاب المركبات', 'Car Owners', Icons.person_pin_outlined, T.violet),
  ('users', 'users', 'العملاء', 'Customers', Icons.people_outline, T.cyan),
  ('branches', 'branches', 'الفروع', 'Branches', Icons.store_outlined, T.warn),
];

class OpsDashboardScreen extends StatefulWidget {
  const OpsDashboardScreen({super.key});
  @override
  State<OpsDashboardScreen> createState() => _OpsDashboardScreenState();
}

class _OpsDashboardScreenState extends State<OpsDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String _from = '';
  String _to = '';
  String _branch = '';
  List<Map<String, dynamic>> _branches = [];
  int _seq = 0;
  bool _retried = false;
  late final void Function() _onChanged;
  late final void Function(dynamic) _onStats;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/ops/branches?limit=100&lang=${Lang.instance.ar ? 'ar' : 'en'}').then((d) {
      if (mounted) setState(() => _branches = List<Map<String, dynamic>>.from((d['items'] ?? const []) as List));
    }).catchError((_) {});
    _onChanged = () => _load();
    // دفعُ الإحصاءات الحيّة غيرُ مفلتر — يُهمَل حين يكون هناك فلتر.
    _onStats = (stats) {
      if (_from.isNotEmpty || _to.isNotEmpty || _branch.isNotEmpty || stats is! Map || !mounted) return;
      setState(() => _d = {...?_d, 'stats': stats});
    };
    Live.instance.onData('ops:stats', _onStats);
    Live.instance.on('ops:shipments:changed', _onChanged);
  }

  @override
  void dispose() {
    Live.instance.offData('ops:stats', _onStats);
    Live.instance.off('ops:shipments:changed', _onChanged);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = [
        'lang=${Lang.instance.ar ? 'ar' : 'en'}',
        if (_from.isNotEmpty) 'date_from=$_from',
        if (_to.isNotEmpty) 'date_to=$_to',
        if (_branch.isNotEmpty) 'branches=$_branch',
      ];
      final d = await Api.instance.get('/api/ops/dashboard?${qs.join('&')}');
      if (!mounted || mine != _seq) return;
      // ردٌّ فارغٌ من منصّةٍ متعثّرة لا يمسح ما يُعرض.
      if (d is Map && d['upstreamUnavailable'] != true && (d['stats'] != null || d['home'] != null)) {
        setState(() => _d = Map<String, dynamic>.from(d));
      }
      if (d is Map && d['stale'] == true && !_retried) {
        _retried = true;
        Future.delayed(const Duration(milliseconds: 2500), () { if (mounted) _load(); });
      } else if (d is Map && d['stale'] != true) {
        _retried = false;
      }
    } catch (_) {/* يبقى ما سبق */}
    if (mounted && mine == _seq) setState(() => _loading = false);
  }

  void _setRange(String from, String to) { setState(() { _from = from; _to = to; }); _load(); }

  void _go(String route, {String? status}) {
    final widget = route == 'shipments'
        ? OpsShipmentsScreen(initialStatus: status)
        : OpsResourceScreen(cfg: opsResources.firstWhere((c) => c.key == route));
    Navigator.push(context, MaterialPageRoute(builder: (_) => widget));
  }

  Widget _leaderboard(String title, Color color, List rows, String valueKey, String route) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [Icon(Icons.emoji_events_outlined, size: 18, color: color), const SizedBox(width: 6), Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)))]),
          const SizedBox(height: 6),
          if (rows.isEmpty) const Text('—', style: TextStyle(color: T.inkFaint)),
          for (var i = 0; i < rows.length; i++)
            Pressable(
              onTap: () => _go(route),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  CircleAvatar(radius: 11, backgroundColor: T.canvas, child: Text('${i + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.inkSoft))),
                  const SizedBox(width: 8),
                  Expanded(child: Text(opsLoc((rows[i] as Map)['name']), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text(opsMoney((rows[i] as Map)[valueKey]), style: const TextStyle(fontWeight: FontWeight.w800)),
                ]),
              ),
            ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final today = opsYmd(now);
    final presets = [
      ('اليوم', 'Today', today, today),
      ('أمس', 'Yesterday', opsYmd(now.subtract(const Duration(days: 1))), opsYmd(now.subtract(const Duration(days: 1)))),
      ('آخر 7 أيام', 'Last 7 days', opsYmd(now.subtract(const Duration(days: 6))), today),
      ('هذا الشهر', 'This month', opsYmd(DateTime(now.year, now.month, 1)), today),
      ('الكل', 'All', '', ''),
    ];
    final stats = _d?['stats'] is Map ? Map<String, dynamic>.from(_d!['stats']) : <String, dynamic>{};
    final counts = stats['counts'] is Map ? Map<String, dynamic>.from(stats['counts']) : <String, dynamic>{};
    final chart = stats['statusesShipmentsChart'] is List ? stats['statusesShipmentsChart'] as List : const [];
    final homeStats = _d?['home'] is Map && _d!['home']['stats'] is List ? _d!['home']['stats'] as List : const [];
    final statusStats = chart.isNotEmpty ? chart : homeStats.where((s) => s is Map && s['status'] != 'all').toList();
    final charts = _d?['charts'] is Map ? Map<String, dynamic>.from(_d!['charts']) : <String, dynamic>{};
    final revenue = charts['monthlyRevenueBarChart'] is List ? charts['monthlyRevenueBarChart'] as List : const [];
    final latest = charts['latestShipments'] is List ? charts['latestShipments'] as List : const [];
    final topDrivers = charts['topDrivers'] is List ? charts['topDrivers'] as List : const [];
    final topOwners = charts['topCarOwners'] is List ? charts['topCarOwners'] as List : const [];
    final maxRev = revenue.fold<num>(0, (a, r) => r is Map && (r['revenue'] ?? 0) is num && (r['revenue'] as num) > a ? r['revenue'] as num : a);
    final singleDay = _from.isNotEmpty && _from == _to;
    return AppScaffold(
      title: Text(tr('لوحة الأوبريشن', 'Operations Dashboard')),
      actions: [IconButton(tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: _load)],
      body: _loading && _d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer()])
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), children: [
                Text(tr('مرآة حيّة لنظام عمليات الميدان · مباشر', 'Live mirror of the field operations system · Live'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                const SizedBox(height: 8),
                // ── الفلاتر: الفرع، والفترات الجاهزة، ويومٌ بعينه، ومدى ──────────
                AppCard(
                  padding: const EdgeInsets.all(10),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    DropdownButtonFormField<String>(
                      initialValue: _branch,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('الفرع', 'Branch'), isDense: true),
                      items: [
                        DropdownMenuItem(value: '', child: Text(tr('كل الفروع', 'All branches'))),
                        for (final b in _branches) DropdownMenuItem(value: '${b['id']}', child: Text(opsLoc(b['name']), overflow: TextOverflow.ellipsis)),
                      ],
                      onChanged: (v) { setState(() => _branch = v ?? ''); _load(); },
                    ),
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final p in presets)
                        ChoiceChip(
                          visualDensity: VisualDensity.compact,
                          label: Text(tr(p.$1, p.$2)),
                          selected: _from == p.$3 && _to == p.$4,
                          selectedColor: T.orange,
                          labelStyle: TextStyle(fontSize: 12, color: _from == p.$3 && _to == p.$4 ? Colors.white : T.ink),
                          onSelected: (_) => _setRange(p.$3, p.$4),
                        ),
                    ]),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.today, size: 16),
                          label: Text(singleDay ? opsDate(_from) : tr('يوم محدد', 'Specific day'), style: const TextStyle(fontSize: 12)),
                          onPressed: () async {
                            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_from) ?? now, firstDate: DateTime(2018), lastDate: DateTime(now.year + 1));
                            if (d != null) _setRange(opsYmd(d), opsYmd(d));
                          },
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.date_range, size: 16),
                          label: Text(_from.isNotEmpty && !singleDay ? '${opsDate(_from)} → ${_to.isEmpty ? '…' : opsDate(_to)}' : tr('من — إلى', 'From — To'), style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
                          onPressed: () async {
                            final r = await showDateRangePicker(context: context, firstDate: DateTime(2018), lastDate: DateTime(now.year + 1),
                                initialDateRange: _from.isNotEmpty && _to.isNotEmpty ? DateTimeRange(start: DateTime.parse(_from), end: DateTime.parse(_to)) : null);
                            if (r != null) _setRange(opsYmd(r.start), opsYmd(r.end));
                          },
                        ),
                      ),
                      if (_from.isNotEmpty || _to.isNotEmpty || _branch.isNotEmpty)
                        IconButton(tooltip: tr('مسح', 'Clear'), icon: const Icon(Icons.close, size: 18), onPressed: () { setState(() { _from = ''; _to = ''; _branch = ''; }); _load(); }),
                    ]),
                  ]),
                ),
                const SizedBox(height: 10),
                // ── بطاقاتُ الأعداد ────────────────────────────────────────
                StatGrid(
                  spacing: 8, minTileWidth: 96, minColumns: 3, maxColumns: 6,
                  children: [
                    for (final c in _countCards)
                      Pressable(
                        onTap: () => _go(c.$2),
                        child: AppCard(
                          padding: const EdgeInsets.all(10),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            Row(children: [Icon(c.$5, size: 18, color: c.$6), const Spacer(), const Icon(Icons.chevron_left, size: 16, color: T.line)]),
                            const SizedBox(height: 6),
                            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                                child: Text(counts[c.$1] == null ? '—' : opsMoney(num.tryParse('${counts[c.$1]}') ?? counts[c.$1]), style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: c.$6))),
                            Text(tr(c.$3, c.$4), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                          ]),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                // ── توزيعُ الحالات ─────────────────────────────────────────
                AppCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(tr('توزيع حالات الشحنات', 'Shipment Status Breakdown'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final s in statusStats.whereType<Map>())
                        Pressable(
                          onTap: () => _go('shipments', status: '${s['status']}'),
                          child: Container(
                            width: 100,
                            padding: const EdgeInsets.all(9),
                            decoration: BoxDecoration(
                              color: (opsShipmentStatuses['${s['status']}']?.$3 ?? T.inkFaint).withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(opsMoney(num.tryParse('${s['count']}') ?? 0), style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: opsShipmentStatuses['${s['status']}']?.$3 ?? T.ink)),
                              Text(() { final st = opsShipmentStatuses['${s['status']}']; return st == null ? '${s['status']}' : tr(st.$1, st.$2); }(),
                                  maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)),
                            ]),
                          ),
                        ),
                    ]),
                  ]),
                ),
                // ── الإيراداتُ الشهريّة ─────────────────────────────────────
                if (revenue.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  AppCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(tr('الإيرادات الشهرية', 'Monthly Revenue'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 10),
                      SizedBox(
                        height: 170,
                        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                          for (final r in revenue.whereType<Map>())
                            Expanded(
                              child: Tooltip(
                                message: '${r['month']}: ${opsMoney(r['revenue'])}',
                                child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                                  Text(((r['revenue'] ?? 0) as num) >= 1000 ? '${(((r['revenue'] ?? 0) as num) / 1000).toStringAsFixed(0)}k' : opsMoney(r['revenue'] ?? 0),
                                      style: const TextStyle(fontSize: 8.5, color: T.inkSoft)),
                                  const SizedBox(height: 2),
                                  Container(
                                    height: maxRev > 0 ? 130 * (((r['revenue'] ?? 0) as num) / maxRev).toDouble() : 0,
                                    margin: const EdgeInsets.symmetric(horizontal: 2),
                                    decoration: const BoxDecoration(color: T.orange, borderRadius: BorderRadius.vertical(top: Radius.circular(5))),
                                  ),
                                  const SizedBox(height: 3),
                                  Text('${r['month'] ?? ''}', maxLines: 1, overflow: TextOverflow.clip, style: const TextStyle(fontSize: 8.5, color: T.inkFaint)),
                                ]),
                              ),
                            ),
                        ]),
                      ),
                    ]),
                  ),
                ],
                const SizedBox(height: 12),
                // ── أحدثُ الشحنات ──────────────────────────────────────────
                AppCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: Text(tr('أحدث الشحنات', 'Latest Shipments'), style: const TextStyle(fontWeight: FontWeight.w800))),
                      TextButton(onPressed: () => _go('shipments'), child: Text(tr('عرض الكل', 'View all'))),
                    ]),
                    if (latest.isEmpty) Text(tr('لا توجد سجلات', 'No records'), style: const TextStyle(color: T.inkFaint)),
                    for (final s in latest.whereType<Map>())
                      Pressable(
                        onTap: () => _go('shipments'),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('#${s['reference_num'] ?? '${s['id']}'.substring(0, '${s['id']}'.length.clamp(0, 6))} · ${s['address_from'] ?? ''} → ${s['address_to'] ?? ''}',
                                    maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                Text(opsLoc(s['user'] is Map ? s['user']['name'] : null), maxLines: 1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              ]),
                            ),
                            if (opsShipmentStatuses['${s['status']}'] != null)
                              Chip2(tr(opsShipmentStatuses['${s['status']}']!.$1, opsShipmentStatuses['${s['status']}']!.$2), opsShipmentStatuses['${s['status']}']!.$3),
                          ]),
                        ),
                      ),
                  ]),
                ),
                const SizedBox(height: 12),
                _leaderboard(tr('أعلى السائقين (شحنات مكتملة)', 'Top Drivers (completed)'), T.info, topDrivers, 'completedShipments', 'drivers'),
                const SizedBox(height: 12),
                _leaderboard(tr('أعلى أصحاب المركبات', 'Top Car Owners'), T.violet, topOwners, 'totalShipments', 'car-owners'),
                const SizedBox(height: 20),
              ]),
            ),
    );
  }
}

/// رسالةُ خطأ المنصّة بلغة الواجهة: انقطاعُ الوصول إلى منصّة التشغيل يأتي من
/// الخادم نصًّا تقنيًّا إنجليزيًّا («fetch failed»)، فيُقال للمستخدم بلغته.
String _opsErrText(Object e) {
  final m = opsErr(e);
  final l = m.toLowerCase();
  if (l.contains('fetch failed') || l.contains('econn') || l.contains('timed out') || l.contains('timeout') || l.contains('socket')) {
    return tr('تعذّر الوصول إلى منصّة التشغيل — حاول مجدّدًا', 'Could not reach the operations platform — try again');
  }
  return m;
}
