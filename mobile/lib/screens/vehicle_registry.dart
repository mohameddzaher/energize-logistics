import 'package:flutter/material.dart';
import '../services/api.dart';
import '../ui/filter_sheet.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/flex_match.dart';

/// سجل المركبات (Vehicle Registry) — قائمة/تفاصيل/تحليلات/تنبيهات/إعدادات،
/// مبنيّة على ماستر Vehicles_2026 (326 مركبة) عبر /api/vehicle-registry.
/// الموبايل بلا رسوم بيانية: بطاقات + أشرطة نسبية + شرائح.

String money(dynamic v) {
  final nn = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = nn < 0;
  final s = nn.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return '${neg ? '-' : ''}$b';
}

const _statusMeta = {
  'expired': ('منتهي', 'Expired', T.danger),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('قريب الانتهاء', 'Expiring soon', Color(0xFFCA8A04)),
  'valid': ('ساري', 'Valid', T.success),
  'none': ('غير مسجّل', 'None', T.inkFaint),
};
Color statusColor(String s) => _statusMeta[s]?.$3 ?? T.inkFaint;
String statusLabel(String s) { final m = _statusMeta[s]; return m == null ? s : tr(m.$1, m.$2); }

const docTypes = [
  ('insurance', 'التأمين', 'Insurance'),
  ('operatingCard', 'بطاقة التشغيل', 'Operating Card'),
  ('vehicleLicense', 'رخصة السير', 'Vehicle License'),
  ('inspection', 'الفحص', 'Inspection'),
  ('gps', 'اشتراك GPS', 'GPS'),
  // التفويض مستندٌ له تاريخ انتهاء كسائر المستندات — الخادم يرسله، وبدونه هنا
  // يرى مستخدم الويب مستندًا لا يراه مستخدم الموبايل على نفس المركبة.
  ('authorization', 'التفويض', 'Authorisation'),
];
String docLabel(String k) { for (final d in docTypes) { if (d.$1 == k) return tr(d.$2, d.$3); } return k; }

String fmtDate(dynamic d) {
  if (d == null || d.toString().isEmpty) return '—';
  return d.toString().split('T').first;
}
String daysText(dynamic n) {
  if (n == null) return '—';
  final v = (n is num) ? n.toInt() : int.tryParse(n.toString()) ?? 0;
  if (v < 0) return tr('انتهى منذ ${-v} يوم', 'expired ${-v}d ago');
  if (v == 0) return tr('ينتهي اليوم', 'expires today');
  if (v == 1) return tr('باقي يوم واحد', '1 day left');
  return tr('باقي $v يوم', '$v days left');
}
/// الطيُّ الموحَّد — راجع services/flex_match. كان هذا يطوي الهمزةَ ولا يطوي
/// المسافة، فاللوحةُ المنسوخة بمسافتين لا تجد نفسَها المخزَّنة بواحدة.
String _fold(String s) => flexFold(s);

// ══════════════════ القائمة ══════════════════
class VehicleRegistryListScreen extends StatefulWidget {
  final String? sector, expiringDoc, expiredDoc;
  final Map<String, String>? filters; // فلاتر إضافية من كروت اللوحة
  final String? filterLabel; // شارة توضّح الفلتر المطبّق
  const VehicleRegistryListScreen({super.key, this.sector, this.expiringDoc, this.expiredDoc, this.filters, this.filterLabel});
  @override
  State<VehicleRegistryListScreen> createState() => _VehicleRegistryListScreenState();
}

class _VehicleRegistryListScreenState extends State<VehicleRegistryListScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _total = 0;
  bool _loading = true;
  String? _error;
  String _q = '';
  // الفلتر الحيّ للشاشة — يبدأ بما جاء من بطاقة اللوحة، ثم يعدّله المستخدم من
  // اللوحة نفسها. مصدر واحد للفلترة بدل ثلاثة حقول منفصلة، فما تراه الشرائح هو
  // ما يُرسل إلى الخادم حرفيًّا.
  late Map<String, String> _filters = {
    ...?widget.filters,
    if (widget.sector != null) 'sector': widget.sector!,
    if (widget.expiringDoc != null) ...{'expiringDoc': widget.expiringDoc!, 'expiringWithin': '60'},
    if (widget.expiredDoc != null) 'expiredDoc': widget.expiredDoc!,
  };
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final p = <String>['limit=2000'];
      if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeComponent(_q.trim())}');
      _filters.forEach((k, v) { if (v.isNotEmpty) p.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/vehicle-registry?${p.join('&')}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []); _total = (d['total'] ?? 0) as int; _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = q.isEmpty ? _rows : _rows.where((v) => [v['plateNumber'], v['chassisNumber'], v['ownerNameAr'], v['brandAr']].any((x) => _fold((x ?? '').toString()).contains(q))).toList();
    return AppScaffold(
      title: Text(tr('سجل المركبات', 'Vehicle Registry')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(
                        child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(hintText: tr('لوحة / هيكل / مالك…', 'plate / chassis / owner…'), prefixIcon: const Icon(Icons.search))),
                      ),
                      const SizedBox(width: 8),
                      // نفس لوحة الموقع: أي عدد من القيم في أي عدد من الحقول،
                      // وأعدادها محسوبة بعد بقيّة الفلاتر.
                      Badge(
                        isLabelVisible: _filters.isNotEmpty,
                        label: Text('${_filters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                          icon: const Icon(Icons.tune),
                          tooltip: tr('التصفية', 'Filter'),
                          onPressed: () async {
                            final r = await showFilterSheet(
                              context: context,
                              optionsUrl: '/api/vehicle-registry/filters',
                              value: _filters,
                              extraLabels: {
                                'missing': tr('ينقصها بيانات', 'Missing data'),
                                'hasGps': tr('التتبّع', 'GPS'),
                                'logistiGaps': tr('نواقص لوجستي', 'Logisti gaps'),
                                'missingDoc': tr('بدون مستند', 'Missing document'),
                                'missingDocDate': tr('بلا تاريخ انتهاء', 'No expiry date'),
                                'expiringDoc': tr('قارب انتهاؤه', 'Expiring'),
                                'expiringWithin': tr('خلال (يوم)', 'Within (days)'),
                                'expiredDoc': tr('منتهٍ', 'Expired'),
                                'expiryDoc': tr('المستند', 'Document'),
                                'expiryFrom': tr('الانتهاء من', 'Expiry from'),
                                'expiryTo': tr('الانتهاء إلى', 'Expiry to'),
                                'yearFrom': tr('سنة الصنع من', 'Year from'),
                                'yearTo': tr('سنة الصنع إلى', 'Year to'),
                              },
                            );
                            if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                          },
                        ),
                      ),
                    ]),
                  ),
                  if (widget.filterLabel != null)
                    Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Align(alignment: AlignmentDirectional.centerStart, child: Chip2(widget.filterLabel!, T.navy))),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? EmptyState(icon: Icons.directions_car_outlined, title: tr('لا توجد مركبات', 'No vehicles'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final st = (v['overallStatus'] ?? 'valid').toString();
                                return Pressable(
                                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: (v['_id'] ?? '').toString(), plate: (v['plateNumber'] ?? '').toString()))),
                                  child: AppCard(
                                    topAccent: statusColor(st),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                        const Spacer(),
                                        Chip2(statusLabel(st) + (v['overallDays'] != null && st != 'valid' ? ' · ${daysText(v['overallDays'])}' : ''), statusColor(st)),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('${v['brandAr'] ?? ''} ${v['modelAr'] ?? ''} · ${v['sectorAr'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                      if ((v['ownerNameAr'] ?? '').toString().isNotEmpty)
                                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(v['ownerNameAr'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                  Padding(padding: const EdgeInsets.all(8), child: Text(tr('$_total مركبة', '$_total vehicles'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                ]),
    );
  }
}

// ══════════════════ التفاصيل ══════════════════
class VehicleRegistryDetailScreen extends StatefulWidget {
  final String id, plate;
  const VehicleRegistryDetailScreen({super.key, required this.id, required this.plate});
  @override
  State<VehicleRegistryDetailScreen> createState() => _VehicleRegistryDetailScreenState();
}

class _VehicleRegistryDetailScreenState extends State<VehicleRegistryDetailScreen> {
  Map<String, dynamic>? _v;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicle-registry/${widget.id}');
      if (!mounted) return;
      setState(() { _v = Map<String, dynamic>.from(d['vehicle'] ?? {}); _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  Widget _row(String label, dynamic value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 2, child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(flex: 3, child: Text((value == null || value.toString().isEmpty) ? '—' : value.toString(), textAlign: TextAlign.end, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
        ]),
      );
  Widget _section(String title, List<Widget> children) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)), const SizedBox(height: 6), ...children]),
      );

  @override
  Widget build(BuildContext context) {
    final v = _v;
    return AppScaffold(
      title: Text(widget.plate),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140)])
          : _error != null || v == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // حالة المستندات
                    GridView.count(
                      crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 2.1, mainAxisSpacing: 8, crossAxisSpacing: 8,
                      children: docTypes.map((d) {
                        final st = (v['docStatuses']?[d.$1]) as Map<String, dynamic>?;
                        final s = (st?['status'] ?? 'none').toString();
                        return AppCard(
                          padding: const EdgeInsets.all(10),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text(tr(d.$2, d.$3), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            const SizedBox(height: 2),
                            Text(statusLabel(s), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: statusColor(s))),
                            if (st?['days'] != null) Text(daysText(st!['days']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                          ]),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 12),
                    _section(tr('الهوية والتصنيف', 'Identity'), [
                      _row(tr('رقم اللوحة', 'Plate'), v['plateNumber']),
                      _row(tr('رقم الهيكل', 'Chassis'), v['chassisNumber']),
                      _row(tr('الرقم التسلسلي', 'Serial'), v['serialNumber']),
                      _row(tr('القطاع', 'Sector'), v['sectorAr']),
                      _row(tr('نوع التسجيل', 'Reg. type'), v['registrationTypeAr']),
                      _row(tr('الماركة/الطراز', 'Brand/model'), '${v['brandAr'] ?? ''} ${v['modelAr'] ?? ''}'),
                      _row(tr('سنة الصنع', 'Year'), v['modelYear']),
                      _row(tr('اللون', 'Color'), v['colorAr']),
                    ]),
                    const SizedBox(height: 10),
                    _section(tr('الملكية', 'Ownership'), [
                      _row(tr('المالك', 'Owner'), v['ownerNameAr']),
                      _row(tr('السجل التجاري', 'Comm. reg.'), v['commercialRegistration']),
                      _row(tr('حالة تم', 'Tam status'), v['tamStatusAr']),
                    ]),
                    const SizedBox(height: 10),
                    _section(tr('التأمين', 'Insurance'), [
                      _row(tr('رقم الوثيقة', 'Policy'), v['insurance']?['policyNumber']),
                      _row(tr('الشركة', 'Company'), v['insurance']?['companyAr']),
                      _row(tr('نوع التغطية', 'Coverage'), v['insurance']?['coverageTypeAr']),
                      _row(tr('تاريخ الانتهاء', 'Expiry'), fmtDate(v['insurance']?['expiryDate'])),
                      _row(tr('القسط', 'Premium'), v['insurance']?['premiumSar'] != null ? money(v['insurance']['premiumSar']) : '—'),
                    ]),
                    const SizedBox(height: 10),
                    _section(tr('شريحة الوقود', 'Fuel card'), [
                      _row(tr('المزوّد', 'Provider'), v['fuelCard']?['provider']),
                      _row(tr('رقم الشريحة', 'Card no.'), v['fuelCard']?['cardNumber']),
                      _row(tr('الحالة', 'Status'), v['fuelCard']?['statusAr']),
                      _row(tr('الحد', 'Limit'), v['fuelCard']?['limitStatus'] == 'open' ? tr('بدون سقف', 'Open') : (v['fuelCard']?['limitSar'] != null ? money(v['fuelCard']['limitSar']) : '—')),
                    ]),
                    const SizedBox(height: 10),
                    _section(tr('المستندات', 'Documents'), [
                      _row(tr('بطاقة التشغيل', 'Operating card'), v['operatingCard']?['cardNumber']),
                      _row(tr('انتهاء بطاقة التشغيل', 'Op. card expiry'), fmtDate(v['operatingCard']?['expiryDate'])),
                      _row(tr('انتهاء رخصة السير', 'License expiry'), fmtDate(v['vehicleLicense']?['expiryDate'])),
                      _row(tr('حالة الفحص', 'Inspection'), v['inspection']?['statusAr']),
                      _row(tr('انتهاء الفحص', 'Inspection expiry'), fmtDate(v['inspection']?['expiryDate'])),
                    ]),
                    if ((v['notesAr'] ?? '').toString().isNotEmpty) ...[
                      const SizedBox(height: 10),
                      _section(tr('ملاحظات', 'Notes'), [Text(v['notesAr'].toString(), style: const TextStyle(fontSize: 13))]),
                    ],
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }
}
