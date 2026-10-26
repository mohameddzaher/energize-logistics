import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/hr_quick.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';
import 'customs_detail.dart' show customsStageLabel;

/// تحليلاتُ قسم التخليص — نظيرُ `/system/customs/analytics` في الموقع.
///
/// الإيراداتُ والتكاليفُ والأرباح، **للإدارة وحدَها** (مديرُ النظام ومديرُ القسم)
/// — والحارسُ في الخادم: من لا يملكها يُردّ بـ403 فتُقال له «لوحة القسم».
/// الفلاترُ كالموقع: السريعةُ متعدّدةُ القيم بأعدادها، وقوائمُ المرحلة والمدينة
/// والعملة ونوع الفاتورة وبلد المنشأ وحالة الفوترة والسنة، والمدّةُ بالشهر.
class CustomsAnalyticsScreen extends StatefulWidget {
  const CustomsAnalyticsScreen({super.key});
  @override
  State<CustomsAnalyticsScreen> createState() => _CustomsAnalyticsScreenState();
}

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];
num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _money(dynamic v) => _n(v).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
String _pct(dynamic v) => '${(_n(v) * 1000).round() / 10}%';

const _quick = [
  ('qState', 'حالة المعاملة', 'State'), ('qCustomer', 'العميل', 'Customer'),
  ('qAgent', 'الوكيل الملاحي', 'Shipping agent'), ('qCarrier', 'الناقل', 'Carrier'),
  ('qPort', 'الميناء', 'Port'), ('qBranch', 'الفرع', 'Branch'),
  ('qCargo', 'النوع', 'Type'), ('qMonth', 'الشهر', 'Month'),
];

const _tabs = [
  ('byCustomer', 'حسب العميل', 'By customer'),
  ('byAgent', 'حسب وكيل الشحن', 'By agent'),
  ('byCarrier', 'حسب الناقل', 'By carrier'),
  ('byMonth', 'حسب الشهر', 'By month'),
  ('byCargo', 'حاويات / سيّارات', 'Containers / vehicles'),
  ('byState', 'مفتوحة / مغلقة', 'Open / closed'),
  ('byPort', 'حسب الميناء', 'By port'),
  ('byStage', 'حسب المرحلة', 'By stage'),
  ('byCity', 'حسب المدينة', 'By city'),
  ('byBranch', 'حسب الفرع', 'By branch'),
];

/// القوائمُ الإضافيّة (مفتاحُ النداء، مفتاحُ الخيارات في /filters، العنوان).
const _selects = [
  ('stage', 'stage', 'كل المراحل', 'All stages'),
  ('city', 'city', 'كل المدن', 'All cities'),
  ('currency', 'currency', 'كل العملات', 'All currencies'),
  ('invoiceType', 'invoiceType', 'كل أنواع الفواتير', 'All invoice types'),
  ('countryOfOrigin', 'countryOfOrigin', 'كل بلدان المنشأ', 'All origins'),
  ('invoiceStatus', 'invoiceStatus', 'كل حالات الفوترة', 'All invoice statuses'),
  ('year', 'years', 'كل السنوات', 'All years'),
];

const _words = {
  'containers': ('حاويات', 'Containers'), 'vehicles': ('سيّارات', 'Vehicles'),
  'open': ('مفتوحة', 'Open'), 'closed': ('مغلقة', 'Closed'),
  'jeddah': ('جدة', 'Jeddah'), 'dammam': ('الدمام', 'Dammam'),
};

const _lines = {
  'deliveryOrder': ('قيمة إذن التسليم', 'Delivery order'), 'customsDuty': ('الرسوم الجمركية', 'Customs duty'),
  'portFees': ('أجور الموانئ', 'Port fees'), 'unloadingFees': ('أجور التفريغ', 'Unloading fees'),
  'inspection': ('أجور الكشف', 'Inspection'), 'transport': ('النقل من الميناء إلى العميل', 'Transport: port → customer'),
  'transportToYard': ('النقل من الميناء إلى الساحة', 'Transport: port → yard'),
  'transportYardToCustomer': ('النقل من الساحة إلى العميل', 'Transport: yard → customer'),
  'labourExpenses': ('مصاريف عمال', 'Labour expenses'), 'appointmentBooking': ('حجز الموعد', 'Appointment booking'),
  'storage': ('التخزين', 'Storage'), 'yardFees': ('أجور الساحة', 'Yard fees'),
  'exitPermit': ('تصريح الخروج (الأرضيّات)', 'Exit permit (demurrage)'), 'demurrage': ('أرضيّات', 'Demurrage'),
  'extension': ('تمديد', 'Extension'), 'consolidator': ('الدامج', 'Consolidator'), 'commissions': ('عمولات', 'Commissions'),
  'extraFees': ('أجور إضافيّة', 'Extra fees'), 'returnInvoice': ('فاتورة الإرجاع', 'Return invoice'),
  'clearanceFee': ('أجور التخليص', 'Clearance fee'), 'labour': ('عمّال', 'Labour'), 'yardNet': ('صافي الساحة', 'Yard net'),
  'storageNet': ('صافي التخزين', 'Storage net'), 'transportToYardNet': ('صافي النقل إلى الساحة', 'Transport-to-yard net'),
  'securityScan': ('فحص أمنيّ', 'Security scan'), 'transportNet': ('صافي النقل', 'Transport net'),
  'yardToCustomerNet': ('صافي النقل من الساحة إلى العميل', 'Yard-to-customer net'),
  'transportSelling': ('سعر النقل من الميناء إلى العميل', 'Price: port → customer'),
  'transportToYardSelling': ('سعر النقل من الميناء إلى الساحة', 'Price: port → yard'),
  'yardToCustomerSelling': ('سعر النقل من الساحة إلى العميل', 'Price: yard → customer'),
};

class _CustomsAnalyticsScreenState extends State<CustomsAnalyticsScreen> {
  Map<String, dynamic>? _d;
  Map<String, dynamic> _opts = const {};
  final Map<String, String> _f = {};
  String _tab = 'byCustomer';
  bool _loading = true;
  bool _denied = false;
  String? _error;
  bool _showFilters = false;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    _load();
    Api.instance.get('/api/customs-clearance/filters').then((r) {
      if (mounted && r is Map && r['options'] is Map) setState(() => _opts = Map<String, dynamic>.from(r['options']));
    }).catchError((_) {});
    // حيّة: كلُّ تعديلٍ في التخليص يُعيد الأرقام — كالموقع.
    for (final e in const ['customs:created', 'customs:updated', 'customs:deleted']) {
      Live.instance.on(e, _onLive);
    }
  }

  @override
  void dispose() {
    for (final e in const ['customs:created', 'customs:updated', 'customs:deleted']) {
      Live.instance.off(e, _onLive);
    }
    super.dispose();
  }

  Future<void> _load() async {
    // كلُّ فلترٍ طلبٌ — والأقدمُ لا يكتب فوق الأحدث.
    final mine = ++_seq;
    final q = _f.entries.where((e) => e.value.isNotEmpty).map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
    try {
      final d = await Api.instance.get('/api/customs-clearance/analytics${q.isEmpty ? '' : '?$q'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() {
        _loading = false;
        if (e is ApiException && (e.status == 403 || '${e.data['code'] ?? ''}' == 'CUSTOMS_ANALYTICS_MANAGERS')) {
          _denied = true;
        } else {
          _error = e.toString();
        }
      });
    }
  }

  void _set(Map<String, String> next) {
    setState(() { _f..clear()..addAll(next); _loading = true; });
    _load();
  }

  String _nameOf(String k) {
    if (_tab == 'byStage') return customsStageLabel(k);
    final w = _words[k];
    return w != null ? tr(w.$1, w.$2) : k;
  }

  List<Map<String, dynamic>> _rows(String tab) {
    final rows = _maps(_d?[tab]);
    rows.sort((a, b) => tab == 'byMonth' ? '${a['key']}'.compareTo('${b['key']}') : _n(b['profit']).compareTo(_n(a['profit'])));
    return rows;
  }

  List<ExportCol> _cols(String Function(String) name) => [
        ExportCol('البند', 'Item', (r) => name('${r['key']}')),
        ExportCol('معاملات', 'Deals', (r) => _n(r['count'])),
        ExportCol('حاويات', 'Containers', (r) => _n(r['containers'])),
        ExportCol('الإيراد', 'Revenue', (r) => _n(r['revenue'])),
        ExportCol('التكلفة', 'Cost', (r) => _n(r['costs'])),
        ExportCol('الربح', 'Profit', (r) => _n(r['profit'])),
      ];

  /// التصدير: الجدولُ المعروض، أو كلُّ التجميعات ورقةً لكلٍّ — كقائمة الموقع.
  Future<void> _export() async {
    final pick = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.table_view_outlined), title: Text(tr('الجدول المعروض', 'Shown table')), onTap: () => Navigator.pop(c, 'view')),
          ListTile(leading: const Icon(Icons.layers_outlined), title: Text(tr('كل التجميعات', 'All groupings')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (pick == null || !mounted) return;
    if (pick == 'view') {
      await exportExcel(context, fileName: 'customs-analytics', sheets: [(tr('تحليل', 'Analysis'), _cols(_nameOf), _rows(_tab))]);
    } else {
      await exportExcel(context, fileName: 'customs-analytics', sheets: [
        for (final t in _tabs) (tr(t.$2, t.$3), _cols((k) => t.$1 == 'byStage' ? customsStageLabel(k) : (_words[k] != null ? tr(_words[k]!.$1, _words[k]!.$2) : k)), _rows(t.$1)),
      ]);
    }
  }

  Widget _stat(String label, String value, {Color? color, String? hint}) => AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: color ?? T.ink)),
          ),
          if (hint != null) Text(hint, style: const TextStyle(fontSize: 10, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );

  Widget _grid(List<Widget> children) => StatGrid(spacing: 8, children: children);

  Widget _head(String s) => Padding(
      padding: const EdgeInsets.fromLTRB(2, 16, 2, 8),
      child: Text(s, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)));

  Widget _filters() {
    final active = _f.values.where((v) => v.isNotEmpty).length;
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(
          onTap: () => setState(() => _showFilters = !_showFilters),
          child: Row(children: [
            const Icon(Icons.filter_list, size: 18, color: T.navy),
            const SizedBox(width: 6),
            Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(width: 6),
            if (active > 0) Chip2('$active', T.orange),
            const Spacer(),
            if (active > 0)
              TextButton(
                style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                onPressed: () => _set({}),
                child: Text(tr('مسح ($active)', 'Clear ($active)')),
              ),
            Icon(_showFilters ? Icons.expand_less : Icons.expand_more, color: T.inkSoft),
          ]),
        ),
        if (_showFilters) ...[
          const SizedBox(height: 6),
          HrQuickFilters(
            keys: _quick,
            facets: _maps(_d?['filters']),
            value: _f,
            onChanged: (v) => _set(v),
          ),
          const SizedBox(height: 8),
          for (final s in _selects)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: DropdownButtonFormField<String>(
                key: ValueKey('${s.$1}-${_f[s.$1] ?? ''}'),
                initialValue: _f[s.$1] ?? '',
                isExpanded: true,
                decoration: InputDecoration(isDense: true, labelText: tr(s.$3, s.$4), border: const OutlineInputBorder()),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr(s.$3, s.$4))),
                  for (final o in _maps(_opts[s.$2]))
                    DropdownMenuItem(
                      value: '${o['value']}',
                      child: Text('${s.$1 == 'stage' ? customsStageLabel('${o['value']}') : (o['label'] ?? o['value'])}${o['count'] != null ? ' (${o['count']})' : ''}',
                          overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (v) => _set({..._f, s.$1: v ?? ''}..removeWhere((_, x) => x.isEmpty)),
              ),
            ),
          // المدّةُ بشهر المعاملة: شهرٌ أو فترةُ أشهر (كالموقع: month / range).
          Row(children: [
            Expanded(child: _monthButton(tr('من', 'From'), _f['from'] ?? '', (v) => _set({..._f, 'from': v}..remove('year')..remove('month')))),
            const SizedBox(width: 8),
            Expanded(child: _monthButton(tr('إلى', 'To'), _f['to'] ?? '', (v) => _set({..._f, 'to': v}..remove('year')..remove('month')))),
          ]),
          const SizedBox(height: 6),
        ],
      ]),
    );
  }

  /// يختار شهرًا: «من» أوّلُ يومٍ فيه، و«إلى» آخرُه — كما يرسل PeriodFilter في الموقع.
  Widget _monthButton(String label, String value, void Function(String) onPicked) => OutlinedButton(
        onPressed: () async {
          final d = await showDatePicker(
            context: context,
            initialDate: DateTime.tryParse(value) ?? DateTime.now(),
            firstDate: DateTime(2018), lastDate: DateTime(2100),
            initialDatePickerMode: DatePickerMode.year,
          );
          if (d == null) return;
          final isTo = label == tr('إلى', 'To');
          final day = isTo ? DateTime(d.year, d.month + 1, 0) : DateTime(d.year, d.month, 1);
          onPicked(day.toIso8601String().substring(0, 10));
        },
        onLongPress: () => onPicked(''),
        child: Text('$label: ${value.isEmpty ? '—' : value.substring(0, value.length >= 7 ? 7 : value.length)}',
            style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
      );

  Widget _breakdown(String title, List<Map<String, dynamic>> rows, num total, Color bar) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const SizedBox(height: 8),
          if (rows.isEmpty) Text(tr('لا بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          for (final x in rows) ...[
            Row(children: [
              Expanded(
                child: Text(_lines['${x['key']}'] != null ? tr(_lines['${x['key']}']!.$1, _lines['${x['key']}']!.$2) : '${x['key']}',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
              Text(_money(x['amount']), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _n(x['amount']) < 0 ? T.danger : T.ink)),
              if (total != 0) Text('  ${_pct(_n(x['amount']) / total)}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              Text('  ${tr('${x['deals']} معاملة', '${x['deals']} deals')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
            const SizedBox(height: 3),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: total == 0 ? 0 : (_n(x['amount']).abs() / total.abs()).clamp(0, 1).toDouble(),
                minHeight: 5, backgroundColor: T.line, color: bar,
              ),
            ),
            const SizedBox(height: 7),
          ],
        ]),
      );

  Widget _deals(String title, IconData icon, Color tone, List<Map<String, dynamic>> rows) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(icon, size: 16, color: tone),
            const SizedBox(width: 6),
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
            Text('${rows.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
          const SizedBox(height: 6),
          if (rows.isEmpty) Text(tr('لا شيء', 'None'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Text('${r['refNumber'] ?? r['blNumber'] ?? '—'}', style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace')),
                const SizedBox(width: 8),
                Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
                Text(_money(r['profit']), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _n(r['profit']) >= 0 ? T.success : T.danger)),
              ]),
            ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('تحليلات قسم التخليص', 'Customs Analytics')),
      actions: [
        if (d != null) IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      body: _denied
          ? EmptyState(
              icon: Icons.bar_chart_outlined,
              title: tr('تحليلات قسم التخليص', 'Customs section analytics'),
              subtitle: tr('هذه الصفحةُ لمدير النظام ومدير القسم. وللمتابعة اليوميّة افتح «لوحة القسم».',
                  'This page is for the system admin and the section manager. For day-to-day follow-up open the section dashboard.'),
            )
          : _loading && d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 180)])
              : _error != null || d == null
                  ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final t = Map<String, dynamic>.from(d['totals'] ?? const {});
    final i = Map<String, dynamic>.from(d['insight'] ?? const {});
    final cost = _maps(d['costBreakdown']);
    final margin = _maps(d['marginBreakdown']);
    final marginTotal = margin.fold<num>(0, (a, x) => a + _n(x['amount']));
    final rows = _rows(_tab);
    final maxRev = rows.fold<num>(0, (a, r) => _n(r['revenue']) > a ? _n(r['revenue']) : a);
    return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
      _filters(),
      if (_loading) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2)),
      const SizedBox(height: 10),
      _grid([
        _stat(tr('معاملات', 'Deals'), _money(t['clearances']), hint: tr('${t['monthsCovered'] ?? 0} شهرًا', '${t['monthsCovered'] ?? 0} months')),
        _stat(tr('حاويات', 'Containers'), _money(t['containers']), hint: tr('${t['avgContainersPerBl'] ?? 0} لكل بوليصة', '${t['avgContainersPerBl'] ?? 0} per BL')),
        _stat(tr('الإيراد', 'Revenue'), _money(t['totalRevenue']), color: T.success),
        _stat(tr('التكلفة', 'Cost'), _money(t['totalCosts']), color: T.inkSoft),
        _stat(tr('صافي الربح', 'Net profit'), _money(t['netProfit']), color: _n(t['netProfit']) >= 0 ? T.success : T.danger),
        _stat(tr('الهامش', 'Margin'), _pct(t['margin']), color: _n(t['margin']) >= 0 ? T.success : T.danger),
        _stat(tr('لم تُفوتَر', 'Uninvoiced'), _money(t['notInvoiced']), color: _n(t['notInvoiced']) != 0 ? T.warn : null),
        _stat(tr('عملاء', 'Customers'), _money(t['customers'])),
        _stat(tr('وكلاء شحن', 'Agents'), _money(t['agents'])),
        _stat(tr('متوسط الفاتورة', 'Avg invoice'), _money(t['avgInvoice'])),
        _stat(tr('متوسط المعاملات شهريًّا', 'Avg deals / month'), _money(t['avgPerMonth'])),
      ]),
      _head(tr('ما تسأل عنه الإدارة', 'Management questions')),
      _grid([
        _stat(tr('ربح الحاوية', 'Profit / container'), _money(i['profitPerContainer']), color: _n(i['profitPerContainer']) >= 0 ? T.success : T.danger),
        _stat(tr('إيراد الحاوية', 'Revenue / container'), _money(i['revenuePerContainer'])),
        _stat(tr('تكلفة الحاوية', 'Cost / container'), _money(i['costPerContainer'])),
        _stat(tr('متوسط ربح المعاملة', 'Avg profit / deal'), _money(i['avgProfit'])),
        _stat(tr('قيمة ما لم يُفوتَر', 'Uninvoiced value'), _money(i['notInvoicedValue']), color: _n(i['notInvoiced']) != 0 ? T.warn : null,
            hint: tr('${i['notInvoiced'] ?? 0} معاملة · مصروفُها ${_money(i['notInvoicedCosts'])}', '${i['notInvoiced'] ?? 0} deals · costs ${_money(i['notInvoicedCosts'])}')),
        _stat(tr('معاملات مفتوحة', 'Open deals'), _money(i['open']), hint: tr('قيمتُها ${_money(i['openValue'])}', 'value ${_money(i['openValue'])}')),
        _stat(tr('معاملات خاسرة', 'Losing deals'), _money(i['losing']), color: _n(i['losing']) != 0 ? T.danger : null),
        _stat(tr('تركّز الربح', 'Profit concentration'), _pct(i['top5Share']), color: _n(i['top1Share']) > 0.4 ? T.warn : null,
            hint: tr('أكبرُ خمسة عملاء · الأوّل ${_pct(i['top1Share'])}', 'top 5 customers · #1 ${_pct(i['top1Share'])}')),
      ]),
      const SizedBox(height: 12),
      _breakdown(tr('أين تذهب التكلفة', 'Where the cost goes'), cost, _n(t['totalCosts']), T.inkSoft),
      const SizedBox(height: 10),
      _breakdown(tr('من أين يأتي الربح', 'Where the profit comes from'), margin, marginTotal, T.orange),
      _head(tr('التجميعات', 'Groupings')),
      SizedBox(
        height: 36,
        child: ListView(scrollDirection: Axis.horizontal, children: [
          for (final x in _tabs)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 6),
              child: ChoiceChip(
                label: Text(tr(x.$2, x.$3), style: const TextStyle(fontSize: 12)),
                selected: _tab == x.$1,
                onSelected: (_) => setState(() => _tab = x.$1),
              ),
            ),
        ]),
      ),
      const SizedBox(height: 8),
      if (rows.isEmpty) EmptyState(icon: Icons.bar_chart_outlined, title: tr('لا بيانات', 'No data')),
      for (final b in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(child: Text(_nameOf('${b['key']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis)),
                Text(_money(b['profit']), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: _n(b['profit']) >= 0 ? T.success : T.danger)),
              ]),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: maxRev == 0 ? 0 : (_n(b['revenue']) / maxRev).clamp(0, 1).toDouble(),
                  minHeight: 5, backgroundColor: T.line, color: T.success,
                ),
              ),
              const SizedBox(height: 4),
              Text([
                tr('معاملات ${_money(b['count'])}', 'Deals ${_money(b['count'])}'),
                tr('حاويات ${_money(b['containers'])}', 'Containers ${_money(b['containers'])}'),
                tr('الإيراد ${_money(b['revenue'])}', 'Revenue ${_money(b['revenue'])}'),
                tr('التكلفة ${_money(b['costs'])}', 'Cost ${_money(b['costs'])}'),
                if (_n(b['revenue']) != 0) tr('الهامش ${_pct(_n(b['profit']) / _n(b['revenue']))}', 'Margin ${_pct(_n(b['profit']) / _n(b['revenue']))}'),
                if (_n(b['containers']) != 0) tr('ربح الحاوية ${_money(_n(b['profit']) / _n(b['containers']))}', 'Profit/container ${_money(_n(b['profit']) / _n(b['containers']))}'),
              ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ]),
          ),
        ),
      const SizedBox(height: 4),
      _deals(tr('أعلى المعاملات ربحًا', 'Most profitable'), Icons.trending_up_rounded, T.success, _maps(d['topDeals'])),
      const SizedBox(height: 10),
      _deals(tr('معاملات خاسرة', 'Losing deals'), Icons.trending_down_rounded, T.danger, _maps(d['losingDeals'])),
    ]);
  }
}
