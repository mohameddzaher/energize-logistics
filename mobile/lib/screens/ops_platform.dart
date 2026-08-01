import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// منصة العمليات (UPL) — المرآة الحية: لوحة، الشحنات بجدولها الزمني،
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
class OpsResourceScreen extends StatefulWidget {
  final OpsCfg cfg;
  const OpsResourceScreen({super.key, required this.cfg});
  @override
  State<OpsResourceScreen> createState() => _OpsResourceScreenState();
}

class _OpsResourceScreenState extends State<OpsResourceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _active = ''; // '' الكل · '1' مُفعّل · '0' موقوف
  int _page = 1;
  int _lastPage = 1;
  late final void Function() _onLive;

  List<OpsField> get _fields => opsFields[widget.cfg.key] ?? const [];
  bool get _writable => _fields.isNotEmpty;
  bool get _hasActive => _fields.any((f) => f.key == 'active');

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load(silent: true);
    Live.instance.on('ops:${widget.cfg.key}', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ops:${widget.cfg.key}', _onLive);
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    try {
      final params = [
        'page=$_page', 'limit=50', 'lang=${Lang.instance.ar ? 'ar' : 'en'}',
        if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}',
        if (_active.isNotEmpty) 'active=$_active',
      ];
      final d = await Api.instance.get('/api/ops/${widget.cfg.key}?${params.join('&')}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from((d['items'] ?? d['data'] ?? []) as List);
        final meta = d['meta'];
        _lastPage = meta is Map ? ((meta['totalPages'] ?? meta['last_page'] ?? 1) as num).toInt() : 1;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && !silent) setState(() { _loading = false; _error = e.toString(); });
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
        content: Text(tr('حذف هذا العنصر نهائيًا؟', 'Delete this item?')),
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

  // تغيير حالة الشحنة — نفس عقد الويب: PATCH /admin/shipments/status { status, ids:[id] }.
  Future<void> _changeStatus(Map<String, dynamic> row) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
            child: Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('تغيير حالة الشحنة', 'Change shipment status'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
          ),
          for (final e in opsShipmentStatuses.entries)
            ListTile(
              leading: Container(width: 12, height: 12, decoration: BoxDecoration(color: e.value.$3, shape: BoxShape.circle)),
              title: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontSize: 14)),
              trailing: row['status'] == e.key ? const Icon(Icons.check, color: T.navy) : null,
              onTap: () => Navigator.pop(c, e.key),
            ),
          const SizedBox(height: 6),
        ]),
      ),
    );
    if (picked == null || picked == row['status']) return;
    try {
      await Api.instance.patch('/api/ops/shipments/status', {'status': picked, 'ids': [row['id']]});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cfg = widget.cfg;
    final isShipments = cfg.key == 'shipments';
    return AppScaffold(
      title: Text(tr(cfg.ar, cfg.en)),
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
          child: TextField(
            onSubmitted: (v) { setState(() { _q = v; _page = 1; _loading = true; }); _load(); },
            onChanged: (v) => _q = v,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: tr('ابحث ثم اضغط إدخال…', 'Search then press enter…'),
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(icon: const Icon(Icons.arrow_circle_left_outlined), onPressed: () { setState(() { _page = 1; _loading = true; }); _load(); }),
            ),
          ),
        ),
        if (_hasActive)
          SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
              children: [
                for (final f in [('', 'الكل', 'All'), ('1', 'مُفعّل', 'Active'), ('0', 'موقوف', 'Inactive')])
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: ChoiceChip(
                      selected: _active == f.$1,
                      onSelected: (_) { setState(() { _active = f.$1; _page = 1; _loading = true; }); _load(); },
                      label: Text(tr(f.$2, f.$3)),
                      labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _active == f.$1 ? Colors.white : T.navy),
                      selectedColor: T.navy,
                      backgroundColor: T.navy.withValues(alpha: 0.08),
                      side: BorderSide.none,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    ),
                  ),
              ],
            ),
          ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: cfg.icon, title: tr('لا توجد بيانات', 'No data'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = _rows[i];
                                final title = opsCell(r, cfg.cols.first);
                                final statusKey = (r['status'] ?? '').toString();
                                final st = isShipments ? opsShipmentStatuses[statusKey] : null;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => isShipments
                                        ? Navigator.push(c, MaterialPageRoute(builder: (_) => OpsShipmentTimelineScreen(shipment: r)))
                                        : _detailSheet(c, r),
                                    child: AppCard(
                                      topAccent: st?.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text(title.isEmpty ? '—' : title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                          if (st != null) Chip2(tr(st.$1, st.$2), st.$3),
                                          if (isShipments)
                                            IconButton(
                                              visualDensity: VisualDensity.compact,
                                              icon: const Icon(Icons.swap_horiz_rounded, size: 20, color: T.navy),
                                              tooltip: tr('تغيير الحالة', 'Change status'),
                                              onPressed: () => _changeStatus(r),
                                            )
                                          else if (_writable)
                                            PopupMenuButton<int>(
                                              icon: const Icon(Icons.more_vert, size: 20, color: T.inkFaint),
                                              onSelected: (v) => v == 0 ? _openForm(row: r) : _delete(r),
                                              itemBuilder: (c2) => [
                                                PopupMenuItem(value: 0, child: Row(children: [const Icon(Icons.edit_outlined, size: 18, color: T.navy), const SizedBox(width: 10), Text(tr('تعديل', 'Edit'))])),
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
                  onPressed: _page > 1 ? () { setState(() { _page--; _loading = true; }); _load(); } : null,
                  icon: const Icon(Icons.chevron_right),
                ),
                Text('$_page / $_lastPage', style: const TextStyle(fontWeight: FontWeight.w800)),
                IconButton(
                  onPressed: _page < _lastPage ? () { setState(() { _page++; _loading = true; }); _load(); } : null,
                  icon: const Icon(Icons.chevron_left),
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
            Text(opsCell(r, widget.cfg.cols.first), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            ...r.entries.where((e) => e.value != null && e.value.toString().isNotEmpty && e.value is! List).map((e) {
              String v;
              if (e.value is Map) {
                final m = e.value as Map;
                v = (m['name'] is Map
                        ? (Lang.instance.ar ? m['name']['ar'] : m['name']['en'])
                        : m['name'] ?? m['ar'] ?? m['en'] ?? '')
                    .toString();
                if (v.isEmpty) return const SizedBox.shrink();
              } else {
                v = e.value.toString();
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

// ── الجدول الزمني للشحنة ────────────────────────────────────────────────────
class OpsShipmentTimelineScreen extends StatefulWidget {
  final Map<String, dynamic> shipment;
  const OpsShipmentTimelineScreen({super.key, required this.shipment});
  @override
  State<OpsShipmentTimelineScreen> createState() => _OpsShipmentTimelineScreenState();
}

class _OpsShipmentTimelineScreenState extends State<OpsShipmentTimelineScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final s = widget.shipment;
      final params = [
        'lang=${Lang.instance.ar ? 'ar' : 'en'}',
        if (s['created_at'] != null) 'created_at=${Uri.encodeQueryComponent(s['created_at'].toString())}',
      ];
      final d = await Api.instance.get('/api/ops/shipments/timeline/${s['id']}?${params.join('&')}');
      if (!mounted) return;
      final data = d['items'] ?? d;
      setState(() {
        _items = data is List ? List<Map<String, dynamic>>.from(data.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.shipment;
    return AppScaffold(
      title: Text('${tr('شحنة', 'Shipment')} ${s['reference_num'] ?? s['id'] ?? ''}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: opsShipmentStatuses[(s['status'] ?? '').toString()]?.$3 ?? T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${s['address_from'] ?? '—'} ← ${s['address_to'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if (s['driver'] is Map) Chip2((s['driver']['name'] ?? '').toString(), T.navy, icon: Icons.badge_outlined),
                            if (s['selling_price'] != null) Chip2('${s['selling_price']} ${tr('ر.س', 'SAR')}', T.violet),
                            if (s['payment_method'] != null) Chip2(s['payment_method'].toString(), T.info),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(tr('الجدول الزمني', 'Timeline'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_items.isEmpty) EmptyState(icon: Icons.timeline_outlined, title: tr('لا يوجد جدول زمني', 'No timeline')),
                    ..._items.map((e) {
                      final st = opsShipmentStatuses[(e['status'] ?? '').toString()] ?? ('—', '—', T.inkFaint);
                      final at = DateTime.tryParse((e['created_at'] ?? '').toString())?.toLocal();
                      final admin = e['admin'] is Map ? (e['admin']['name'] ?? '').toString() : '';
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Column(children: [
                            Container(width: 12, height: 12, decoration: BoxDecoration(color: st.$3, shape: BoxShape.circle)),
                            Container(width: 2, height: 42, color: T.navy.withValues(alpha: 0.12)),
                          ]),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(tr(st.$1, st.$2), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: st.$3)),
                              Text(
                                '${at != null ? '${at.day}/${at.month}/${at.year} ${at.hour}:${at.minute.toString().padLeft(2, '0')}' : '—'}'
                                '${admin.isNotEmpty ? ' · $admin' : ''}',
                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                              ),
                            ]),
                          ),
                        ]),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
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

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ops/${widget.resource}?page=1&limit=200&lang=${Lang.instance.ar ? 'ar' : 'en'}${_q.trim().isEmpty ? '' : '&search=${Uri.encodeQueryComponent(_q.trim())}'}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from((d['items'] ?? d['data'] ?? []) as List); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
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
            child: TextField(
              autofocus: true,
              onSubmitted: (v) { setState(() { _q = v; _loading = true; }); _load(); },
              onChanged: (v) => _q = v,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(hintText: tr('ابحث ثم إدخال…', 'Search then enter…'), prefixIcon: const Icon(Icons.search)),
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
class OpsDashboardScreen extends StatefulWidget {
  const OpsDashboardScreen({super.key});
  @override
  State<OpsDashboardScreen> createState() => _OpsDashboardScreenState();
}

class _OpsDashboardScreenState extends State<OpsDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ops:stats', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ops:stats', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ops/dashboard?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // يلتقط كل الأزواج الرقمية (بما فيها المتداخلة مستوى واحد) لعرضها كبطاقات.
  List<(String, num)> _numbers(Map<String, dynamic> m, [String prefix = '']) {
    final out = <(String, num)>[];
    m.forEach((k, v) {
      if (v is num) {
        out.add(('$prefix$k', v));
      } else if (v is Map && prefix.isEmpty) {
        out.addAll(_numbers(Map<String, dynamic>.from(v), '$k · '));
      }
    });
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final home = _d?['home'] is Map ? Map<String, dynamic>.from(_d!['home']) : <String, dynamic>{};
    final stats = _d?['stats'] is Map ? Map<String, dynamic>.from(_d!['stats']) : <String, dynamic>{};
    final numbers = [..._numbers(home), ..._numbers(stats)];
    return AppScaffold(
      title: Text(tr('لوحة منصة العمليات', 'Ops Dashboard')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: numbers.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.query_stats_outlined, title: tr('لا تتوفر بيانات من المنصة الآن', 'No platform data right now'))])
                      : GridView.count(
                          padding: const EdgeInsets.all(14),
                          crossAxisCount: 2,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          childAspectRatio: 1.9,
                          children: numbers.take(24).toList().asMap().entries.map((e) {
                            final colors = [T.navy, T.info, T.success, T.orange, T.violet, T.cyan, T.warn, T.danger];
                            final color = colors[e.key % colors.length];
                            return FadeSlideIn(
                              delayMs: e.key * 25,
                              child: AppCard(
                                topAccent: color,
                                padding: const EdgeInsets.all(12),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                                  Text(e.value.$1, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft)),
                                  const SizedBox(height: 4),
                                  Text(e.value.$2.toStringAsFixed(e.value.$2.truncateToDouble() == e.value.$2 ? 0 : 1),
                                      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
                                ]),
                              ),
                            );
                          }).toList(),
                        ),
                ),
    );
  }
}
