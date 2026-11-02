import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_order_detail.dart';
import 'shipment_orders_common.dart';

/// Shipment orders analytics, mirrors /system/shipment-orders/analytics. Brokerage is measured by the difference: what we bought, what we sold for, and from whom.
class ShipmentOrdersAnalyticsScreen extends StatefulWidget {
  const ShipmentOrdersAnalyticsScreen({super.key});
  @override
  State<ShipmentOrdersAnalyticsScreen> createState() => _ShipmentOrdersAnalyticsScreenState();
}

const _tabs = [
  ('byCustomer', 'حسب العميل', 'By customer'),
  ('bySupplier', 'حسب المورّد', 'By supplier'),
  ('byRoute', 'حسب المسار', 'By route'),
  ('byTruckType', 'حسب نوع الشاحنة', 'By truck type'),
  ('byBranch', 'حسب الفرع', 'By branch'),
];

class _ShipmentOrdersAnalyticsScreenState extends State<ShipmentOrdersAnalyticsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  String _from = '', _to = '', _status = '', _q = '';
  String _tab = 'byCustomer';
  Timer? _debounce;
  final _searchCtrl = TextEditingController();
  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Live.instance.on('shipmentOrders:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final p = <String>[
      if (_from.isNotEmpty) 'from=$_from',
      if (_to.isNotEmpty) 'to=$_to',
      if (_status.isNotEmpty) 'status=$_status',
      if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
    ];
    try {
      final d = await Api.instance.get('/api/shipment-orders/analytics?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _refilter(VoidCallback f) { setState(f); _load(); }

  Future<void> _pickDate(bool from) async {
    final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(from ? _from : _to) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
    if (d == null) return;
    final s = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    _refilter(() => from ? _from = s : _to = s);
  }

  List<ExportCol> get _cols => [
        ExportCol('البند', 'Item', (r) => r['name']),
        ExportCol('شحنات', 'Orders', (r) => r['orders']),
        ExportCol('البيع', 'Sell', (r) => r['sell']),
        ExportCol('الشراء', 'Buy', (r) => r['buy']),
        ExportCol('الفرق', 'Margin', (r) => r['margin']),
        ExportCol('الهامش %', 'Margin %', (r) => r['marginPct'] ?? '—'),
        ExportCol('متوسط الفرق', 'Avg margin', (r) => r['avgMargin']),
      ];

  List<Map<String, dynamic>> _rowsOf(String k) => List<Map<String, dynamic>>.from(_d?[k] ?? const []);

  Future<void> _export(String scope) async {
    if (_d == null) return;
    if (scope == 'view') {
      final rows = _rowsOf(_tab);
      if (rows.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
        return;
      }
      await exportExcel(context, fileName: 'shipment-orders-analytics', sheets: [(tr('تحليل', 'Analysis'), _cols, rows)]);
    } else {
      await exportExcel(context, fileName: 'shipment-orders-analytics', sheets: [for (final t in _tabs) (tr(t.$2, t.$3), _cols, _rowsOf(t.$1))]);
    }
  }

  Widget _stat(String label, String value, {Color color = T.ink}) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color), maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );

  num _n(dynamic v) => num.tryParse('${v ?? 0}') ?? 0;

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final t = Map<String, dynamic>.from(d?['totals'] ?? {});
    final rows = _rowsOf(_tab);
    final byMonth = List.from(d?['byMonth'] ?? const []);
    final ranking = List.from(d?['salesRanking'] ?? const []);
    final reasons = List.from(d?['cancelReasons'] ?? const []);
    final losing = List<Map<String, dynamic>>.from(d?['losing'] ?? const []);
    return AppScaffold(
      title: Text(tr('تحليلات طلبات الشحنات', 'Shipment Orders Analytics')),
      actions: [
        PopupMenuButton<String>(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: 'view', child: Text(tr('الجدول المعروض', 'Shown table'))),
            PopupMenuItem(value: 'all', child: Text(tr('كلّ التجميعات', 'All groupings'))),
          ],
        ),
      ],
      body: _loading && d == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
                    // Filters
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        ActionChip(avatar: const Icon(Icons.event, size: 15), label: Text(_from.isEmpty ? tr('من', 'From') : _from), onPressed: () => _pickDate(true)),
                        ActionChip(avatar: const Icon(Icons.event, size: 15), label: Text(_to.isEmpty ? tr('إلى', 'To') : _to), onPressed: () => _pickDate(false)),
                        DropdownButton<String>(
                          value: _vocab.any((v) => v.$1 == _status) ? _status : '',
                          underline: const SizedBox.shrink(),
                          style: const TextStyle(fontSize: 12.5, color: T.ink),
                          items: [
                            DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All statuses'))),
                            for (final s in _vocab) DropdownMenuItem(value: s.$1, child: Text(tr(s.$2, s.$3))),
                          ],
                          onChanged: (v) => _refilter(() => _status = v ?? ''),
                        ),
                      ]),
                      const SizedBox(height: 6),
                      Row(children: [
                        Expanded(child: SearchField(
                          controller: _searchCtrl,
                          hint: tr('عميل، مورّد، مدينة، سائق، أمر نقل…', 'customer, supplier, city, driver, waybill…'),
                          onChanged: (v) { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), () => _refilter(() => _q = v)); },
                        )),
                        IconButton(
                          tooltip: tr('مسح', 'Reset'),
                          icon: const Icon(Icons.restart_alt),
                          onPressed: () { _debounce?.cancel(); _searchCtrl.clear(); _refilter(() { _from = ''; _to = ''; _status = ''; _q = ''; }); },
                        ),
                      ]),
                    ])),
                    const SizedBox(height: 10),
                    // Figures
                    GridView.count(
                      crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 6, crossAxisSpacing: 6, childAspectRatio: 1.45,
                      children: [
                        _stat(tr('شحنات منفّذة', 'Live orders'), '${t['live'] ?? 0}'),
                        _stat(tr('إجمالي البيع', 'Total sell'), soMoney(t['sell'] ?? 0), color: T.success),
                        _stat(tr('إجمالي الشراء', 'Total buy'), soMoney(t['buy'] ?? 0), color: T.inkSoft),
                        _stat(tr('الفرق (الربح)', 'Spread (profit)'), soMoney(t['margin'] ?? 0), color: _n(t['margin']) >= 0 ? T.success : T.danger),
                        _stat(tr('الهامش', 'Margin'), '${t['marginPct'] ?? 0}%', color: _n(t['marginPct']) >= 0 ? T.success : T.danger),
                        _stat(tr('متوسط الفرق للشحنة', 'Avg spread / order'), soMoney(t['avgMargin'] ?? 0)),
                        _stat(tr('عملاء', 'Customers'), '${t['customers'] ?? 0}'),
                        _stat(tr('موردون', 'Suppliers'), '${t['suppliers'] ?? 0}'),
                        _stat(tr('مسارات', 'Routes'), '${t['routes'] ?? 0}'),
                        _stat(tr('ملغاة', 'Cancelled'), '${t['cancelled'] ?? 0} (${t['cancelRate'] ?? 0}%)', color: T.inkFaint),
                        _stat(tr('شحنات خاسرة', 'Losing orders'), '${t['losing'] ?? 0}', color: _n(t['losing']) > 0 ? T.danger : T.ink),
                        _stat(tr('بلا سعر كامل', 'Missing a price'), '${t['missingPrice'] ?? 0}', color: _n(t['missingPrice']) > 0 ? T.warn : T.ink),
                      ],
                    ),
                    if (_n(t['missingPrice']) > 0)
                      Container(
                        margin: const EdgeInsets.only(top: 10),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.warn.withValues(alpha: 0.3))),
                        child: Text(tr('${t['missingPrice']} شحنة ينقصها سعرُ البيع أو الشراء — لا تدخل في حساب الفرق، فالربحُ أعلاه لا يشملها.',
                            '${t['missingPrice']} order(s) are missing a sell or buy price — they are excluded from the spread, so the profit above does not include them.'),
                            style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
                      ),
                    // Months
                    if (byMonth.length > 1)
                      Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr('الشهور: البيع والشراء والفرق', 'By month: sell, buy and spread'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Table(columnWidths: const {0: FlexColumnWidth(1.2)}, children: [
                          TableRow(children: [for (final h in [tr('الشهر', 'Month'), tr('البيع', 'Sell'), tr('الشراء', 'Buy'), tr('الفرق', 'Spread')]) Text(h, style: const TextStyle(fontSize: 11, color: T.inkFaint))]),
                          for (final m in byMonth)
                            TableRow(children: [
                              Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text('${m['key']}', style: const TextStyle(fontSize: 12))),
                              Text(soMoney(_n(m['sell']).round()), style: const TextStyle(fontSize: 12, color: T.success)),
                              Text(soMoney(_n(m['buy']).round()), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              Text(soMoney(_n(m['margin']).round()), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _n(m['margin']) >= 0 ? T.orange : T.danger)),
                            ]),
                        ]),
                      ]))),
                    // Groupings
                    Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                        for (final x in _tabs)
                          Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                            showCheckmark: false,
                            selected: _tab == x.$1,
                            selectedColor: T.navy,
                            labelStyle: TextStyle(fontSize: 12, color: _tab == x.$1 ? Colors.white : T.inkSoft),
                            label: Text(tr(x.$2, x.$3)),
                            onSelected: (_) => setState(() => _tab = x.$1),
                          )),
                        Text('${rows.length}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      ])),
                      const SizedBox(height: 6),
                      if (rows.isEmpty)
                        Padding(padding: const EdgeInsets.all(16), child: Text(tr('لا بيانات ضمن هذه الفلاتر', 'No data for these filters'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))
                      else
                        for (final r in rows)
                          Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Row(children: [
                              Expanded(child: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13), overflow: TextOverflow.ellipsis)),
                              Text(soMoney(r['margin']), style: TextStyle(fontWeight: FontWeight.w800, color: _n(r['margin']) >= 0 ? T.success : T.danger)),
                            ]),
                            Text('${tr('شحنات', 'Orders')} ${r['orders'] ?? 0} · ${tr('بيع', 'sell')} ${soMoney(r['sell'])} · ${tr('شراء', 'buy')} ${soMoney(r['buy'])} · ${r['marginPct'] == null ? '—' : '${r['marginPct']}%'} · ${tr('متوسط', 'avg')} ${soMoney(r['avgMargin'])}',
                                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          ])),
                    ]))),
                    // Operations sales ranking
                    Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(tr('ترتيب السيلز التشغيلي', 'Operational sales ranking'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      Text(tr('بالشحنات المنفَّذة في المدّة', 'by executed shipments in the period'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      if (ranking.isEmpty)
                        Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا شحنات عليها سيلز تشغيلي في هذه المدّة بعد', 'No shipments with an operational sales person yet'), style: const TextStyle(color: T.inkFaint, fontSize: 12)))
                      else
                        for (final r in ranking)
                          ListTile(
                            dense: true, contentPadding: EdgeInsets.zero,
                            leading: Text('#${r['rank']}', style: const TextStyle(color: T.inkFaint)),
                            title: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text('${tr('الشحنات', 'Shipments')} ${r['shipments']} · ${tr('المنفَّذة', 'Executed')} ${r['live']} · ${tr('الملغاة', 'Cancelled')} ${r['cancelled']} (${r['cancelRate']}%) · ${tr('البيع', 'Sell')} ${soMoney(r['sell'])}'),
                            trailing: Text(soMoney(r['margin']), style: TextStyle(fontWeight: FontWeight.w800, color: _n(r['margin']) < 0 ? T.danger : T.success)),
                          ),
                    ]))),
                    // Cancellation reasons
                    Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        Text(tr('أسباب الإلغاء', 'Cancellation reasons'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const Spacer(),
                        Text('${reasons.fold<num>(0, (a, x) => a + _n(x['count']))}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      ]),
                      if (reasons.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا شحنات ملغاة في هذه المدّة', 'No cancellations in this period'), style: const TextStyle(color: T.inkFaint, fontSize: 12))),
                      for (final x in reasons)
                        Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: Text('${x['reason']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                            Text('${x['count']} · ${x['pct']}%', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          ]),
                          const SizedBox(height: 3),
                          LinearProgressIndicator(value: (_n(x['pct']).clamp(0, 100)) / 100, minHeight: 5, color: T.danger, backgroundColor: T.line.withValues(alpha: 0.4)),
                        ])),
                    ]))),
                    // Losing shipments: a waybill is listed by name so it can be queried
                    if (losing.isNotEmpty)
                      Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(topAccent: T.danger, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Row(children: [
                          const Icon(Icons.warning_amber_rounded, color: T.danger, size: 18),
                          const SizedBox(width: 5),
                          Expanded(child: Text(tr('شحنات بيعُها أقلُّ من شرائها', 'Orders sold below cost'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger))),
                          Text('${losing.length}', style: const TextStyle(color: T.danger)),
                        ]),
                        for (final o in losing)
                          ListTile(
                            dense: true, contentPadding: EdgeInsets.zero,
                            title: Text('${o['waybillNumber'] ?? ''} · ${o['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, color: T.orange)),
                            subtitle: Text('${o['supplierName'] ?? '—'} · ${o['fromCity'] ?? '—'} ← ${o['toCity'] ?? '—'} · ${soMoney(o['sellPrice'])} / ${soMoney(o['buyPrice'])}'),
                            trailing: Text(soMoney(o['margin']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: o, vocab: _vocab))),
                          ),
                      ]))),
                  ]),
                ),
    );
  }
}
