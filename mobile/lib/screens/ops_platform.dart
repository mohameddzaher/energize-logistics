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
  int _page = 1;
  int _lastPage = 1;
  late final void Function() _onLive;

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

  @override
  Widget build(BuildContext context) {
    final cfg = widget.cfg;
    final isShipments = cfg.key == 'shipments';
    return AppScaffold(
      title: Text(tr(cfg.ar, cfg.en)),
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
