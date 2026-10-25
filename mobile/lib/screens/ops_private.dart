import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ops_common.dart';

/// «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها بقيمة البيع وربحها.
///
/// قيمةُ البيع هنا هي عمودُ الكشف نفسُه في سير العمل — مرجعٌ واحد (٢٠٢٦/١٠/٢١).
/// وتعديلُها هنا يمرّ بطريق سير العمل: الصلاحيّةُ نفسُها، ويُكتب في منصّة
/// التشغيل. وسعرُ مسار العميل يُعرَض اقتراحًا يُعتمَد بضغطة.
/// وتُقرأ كما يُقرأ سيرُ العمل: بطاقاتُ الحالة، وفلاترُ الأعمدة (`cf_*`)، والفترة،
/// و«فواتير لم تصل»، والتصديرُ بنطاقاته الثلاثة — نفسُ /system/operations/private.
class OpsPrivateScreen extends StatefulWidget {
  const OpsPrivateScreen({super.key});
  @override
  State<OpsPrivateScreen> createState() => _OpsPrivateScreenState();
}

/// شاشةُ أسعار البيع — مقيّدةٌ بالأسماء عمدًا (كالويب).
const _roles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'cfo', 'accounting_manager', 'accountant'];

/// الأعمدةُ التي يقبل الخادمُ الفلترةَ عليها — (المفتاح، العربيّ، الإنجليزيّ، مالٌ؟).
const _filterCols = [
  ('reportNumber', 'رقم الكشف', 'Report #', false), ('reportDate', 'تاريخ الكشف', 'Report date', false),
  ('fromLocation', 'من', 'From', false), ('toLocation', 'إلى', 'To', false), ('branch', 'الفرع', 'Branch', false),
  ('carOwner', 'مالك السيارة', 'Car owner', false), ('carNumber', 'رقم السيارة', 'Car #', false), ('ownerType', 'نوع المالك', 'Owner type', false),
  ('executionStatus', 'حالة التنفيذ', 'Execution', false), ('applicationStatus', 'حالة الطلب', 'Status', false), ('paymentMethod', 'طريقة الدفع', 'Payment method', false),
  ('username', 'العميل', 'Customer', false), ('userPhone', 'هاتف العميل', 'Customer phone', false), ('taxIndicator', 'ض / غ ض', 'Tax indicator', false),
  ('purchaseValue', 'قيمة الشراء', 'Purchase value', false), ('sellingValue', 'قيمة البيع', 'Selling value', false),
  ('driverName', 'السائق', 'Driver', false), ('truckType', 'نوع الشاحنة', 'Truck type', false), ('truckSize', 'حجم الشاحنة', 'Truck size', false),
  ('representativeName', 'المندوب', 'Representative', false), ('operationsReview', 'مراجعة التشغيل', 'Ops review', false),
  ('paymentDate', 'تاريخ السداد', 'Payment date', false), ('paymentDateByName', 'مسؤول البيانات', 'Data owner', false), ('payingBranch', 'الفرع المسدِّد', 'Paying branch', false),
  ('paymentAmount', 'مبلغ السداد', 'Payment amount', false), ('paymentType', 'نوع الدفع', 'Payment type', false),
  ('finalReportDestination', 'وجهة الكشف النهائية', 'Final destination', false), ('documentNumber', 'رقم السند', 'Document #', false),
  ('sendingDate', 'تاريخ الإرسال', 'Sending date', false), ('branchDeliveryDate', 'تاريخ التسليم للفرع', 'Delivered to branch', false),
  ('accountingReview', 'مراجعة المحاسبة', 'Accounting review', true), ('invoiceNumber', 'رقم الفاتورة', 'Invoice #', true),
  ('netInvoice', 'صافي الفاتورة', 'Net invoice', true), ('tax', 'الضريبة', 'Tax', true), ('totalInvoice', 'إجمالي الفاتورة', 'Total invoice', true),
  ('invoiceDate', 'تاريخ الفاتورة', 'Invoice date', true), ('deliveryDate', 'تاريخ التسليم', 'Delivery date', false),
  ('collectedAmount', 'المبلغ المحصّل', 'Collected', true), ('collectionDate', 'تاريخ التحصيل', 'Collection date', true), ('stage', 'المرحلة', 'Stage', true),
];
const _dateF = {'reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate'};
const _numF = {'purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount'};
const _stageL = {
  'draft': ('مسودة', 'Draft'), 'submitted_to_ops': ('مرسل للتشغيل', 'Submitted to Ops'), 'ops_completed': ('التشغيل مكتمل', 'Ops Completed'),
  'submitted_to_collections': ('للتحصيلات', 'To Collections'), 'completed': ('مكتمل', 'Completed'),
};

String _sourceLabel(dynamic s) => s == 'manual' ? tr('يدويّ', 'manual')
    : s == 'collections_book' ? tr('دفتر التحصيل', 'collections book')
    : s == 'platform' ? tr('المنصّة', 'platform') : '—';

class _OpsPrivateScreenState extends State<OpsPrivateScreen> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _stats = const {};
  bool _loading = true;
  String? _error;
  String _q = '';
  Timer? _debounce;
  int _page = 1;
  int _pages = 1;
  int _total = 0;
  bool _canMoney = false;
  int _seq = 0;
  int _statsSeq = 0;
  // يُفتح على الشهر الجاري — كالويب.
  final OpsPeriod _period = OpsPeriod(mode: OpsDateMode.month, month: DateTime(DateTime.now().year, DateTime.now().month));
  String _priced = ''; // '' | yes | no
  bool _pendingOnly = false;
  final Map<String, Set<String>> _cf = {};
  Timer? _liveTimer;
  late final void Function() _onLive;

  static const _events = [
    'workflow:created', 'workflow:updated', 'workflow:deleted',
    'workflow:stageChanged', 'workflow:bulkImported', 'operationsPrivate:updated',
  ];

  @override
  void initState() {
    super.initState();
    _load();
    // الأحداثُ المتلاحقةُ تُجمَع في تحديثٍ واحد (كالويب: ١٫٢ ثانية).
    _onLive = () {
      _liveTimer?.cancel();
      _liveTimer = Timer(const Duration(milliseconds: 1200), () { if (mounted) _load(); });
    };
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    _liveTimer?.cancel();
    _debounce?.cancel();
    super.dispose();
  }

  List<(String, String)> _params({String? skip, bool withPriced = true}) {
    final (from, to) = _period.dates;
    return [
      if (_q.trim().isNotEmpty) ('search', _q.trim()),
      if (from != null) ('dateFrom', from),
      if (to != null) ('dateTo', to),
      if (_pendingOnly) ('pendingOnly', 'true'),
      if (withPriced && _priced.isNotEmpty) ('priced', _priced),
      for (final e in _cf.entries)
        if (e.key != skip)
          for (final v in e.value) ('cf_${e.key}', v),
    ];
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final mineStats = ++_statsSeq;
    final p = _params();
    Api.instance.get('/api/operations-private/stats?${opsQs(p)}').then((d) {
      if (mounted && mineStats == _statsSeq) setState(() => _stats = Map<String, dynamic>.from(d));
    }).catchError((_) {});
    try {
      final d = await Api.instance.get('/api/operations-private?${opsQs([...p, ('page', '$_page'), ('limit', '50')])}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['workflows'] ?? const []);
        _pages = ((d['pages'] ?? 1) as num).toInt();
        _total = ((d['total'] ?? 0) as num).toInt();
        _canMoney = d['money'] == true;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = opsErr(e); });
    }
  }

  void _reload() { setState(() { _page = 1; _loading = true; }); _load(); }

  String _valueLabel(String field, String v) {
    if (v.isEmpty) return tr('(فارغ)', '(blank)');
    if (field == 'stage') { final s = _stageL[v]; return s == null ? v : tr(s.$1, s.$2); }
    if (field == 'executionStatus' || field == 'applicationStatus') return opsStatusLabel(v);
    if (field == 'paymentMethod') return opsPayMethodLabel(v);
    if (field == 'paymentType') { final l = opsPaymentKindLabel(v); return l.isEmpty ? v : l; }
    if (_dateF.contains(field)) {
      final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(v);
      return m != null ? '${m[3]}/${m[2]}/${m[1]}' : opsDate(v);
    }
    if (_numF.contains(field)) return opsMoney(num.tryParse(v));
    return v;
  }

  Future<void> _pickColumn() async {
    final fields = [for (final f in _filterCols) if (!f.$4 || _canMoney) (f.$1, f.$2, f.$3)];
    final k = await opsPickFilterField(context, fields, _cf);
    if (k == null || !mounted) return;
    final f = fields.firstWhere((x) => x.$1 == k);
    final picked = await opsPickColumnFilter(context,
        field: k, label: tr(f.$2, f.$3), params: _params(skip: k, withPriced: false), current: _cf[k] ?? const {}, labelOf: _valueLabel);
    if (picked == null) return;
    setState(() { if (picked.isEmpty) { _cf.remove(k); } else { _cf[k] = picked; } });
    _reload();
  }

  void _toggleStatus(String key) {
    if (key.isEmpty) { _cf.remove('applicationStatus'); _reload(); return; }
    final cur = Set<String>.from(_cf['applicationStatus'] ?? const {});
    if (!cur.remove(key)) cur.add(key);
    if (cur.isEmpty) { _cf.remove('applicationStatus'); } else { _cf['applicationStatus'] = cur; }
    _reload();
  }

  /// قيمةُ البيع وحدَها تُعدَّل — في الكشف نفسِه، وتصير آخرَ سعرٍ في ملفّ العميل.
  Future<void> _editPrice(Map<String, dynamic> w, {num? suggest}) async {
    final ctrl = TextEditingController(
      text: suggest != null ? '$suggest' : ((w['sellingValue'] ?? 0) == 0 ? '' : '${w['sellingValue']}'),
    );
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('قيمة البيع', 'Selling value'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 2),
            Text('${w['reportNumber'] ?? ''} · ${w['username'] ?? ''}\n${w['fromLocation'] ?? ''} ← ${w['toLocation'] ?? ''} · ${tr('شراء', 'purchase')} ${opsMoney(w['purchaseValue'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            if (w['routePrice'] != null) ...[
              const SizedBox(height: 6),
              ActionChip(
                avatar: const Icon(Icons.alt_route, size: 16),
                label: Text('${tr('سعر مسار العميل', 'Customer route price')}: ${opsMoney(w['routePrice'])}'),
                onPressed: () => ctrl.text = '${w['routePrice']}',
              ),
            ],
            const SizedBox(height: 12),
            TextField(controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), autofocus: true,
                decoration: InputDecoration(labelText: tr('سعر البيع', 'Selling price'))),
            const SizedBox(height: 6),
            Text(tr('يُكتب في سير عمل التشغيل وفي منصّة التشغيل، ويصير آخرَ سعرٍ لهذا المسار في ملفّ العميل.',
                    'Written to the operations workflow and the platform, and becomes the latest price for this route on the customer profile.'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final v = num.tryParse(ctrl.text.trim());
    if (v == null || v < 0) { if (mounted) opsSnack(context, tr('سعرٌ غير صالح', 'Invalid price'), error: true); return; }
    try {
      final d = await Api.instance.put('/api/operations-private/${w['_id']}', {'sellingValue': v});
      if (!mounted) return;
      setState(() {
        final i = _rows.indexWhere((x) => x['_id'] == w['_id']);
        if (i >= 0) {
          final profit = d is Map ? d['profit'] : null;
          _rows = [..._rows]..[i] = {
              ..._rows[i], 'sellingValue': v, 'platformSellingValue': v, 'priceSource': 'manual', 'priceSaved': true, 'profit': profit,
              'margin': v > 0 && profit is num ? ((profit / v) * 10000).round() / 100 : null,
            };
        }
      });
      opsSnack(context, d is Map && d['sellingPlatform'] == true
          ? tr('حُفظت قيمة البيع — وكُتبت في منصّة التشغيل', 'Saved — and written to the operations platform')
          : tr('حُفظت قيمة البيع', 'Selling value saved'));
      final mineStats = ++_statsSeq;
      Api.instance.get('/api/operations-private/stats?${opsQs(_params())}').then((s) {
        if (mounted && mineStats == _statsSeq) setState(() => _stats = Map<String, dynamic>.from(s));
      }).catchError((_) {});
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    }
  }

  // ── التصدير: الصفحةُ هنا، و«كلُّ ما طابق» و«الجدولُ كلُّه» من الخادم ─────
  String _cell(Map<String, dynamic> r, String k) {
    final v = r[k];
    if (k == 'stage') { final s = _stageL[v]; return s == null ? '${v ?? '—'}' : tr(s.$1, s.$2); }
    if (k == 'executionStatus' || k == 'applicationStatus') return (v ?? '').toString().isEmpty ? '—' : opsStatusLabel(v);
    if (k == 'paymentMethod') return (v ?? '').toString().isEmpty ? '—' : opsPayMethodLabel(v);
    if (k == 'paymentType') { final l = opsPaymentKindLabel(opsPaymentKindOf(r)); return l.isEmpty ? '—' : l; }
    if (k == 'operationsReview' || k == 'accountingReview') return (v ?? '').toString().isNotEmpty ? tr('تمّت', 'Done') : '—';
    if (_dateF.contains(k)) return opsDate(v);
    if (_numF.contains(k)) return v == null || v == 0 ? '—' : opsMoney(v);
    return v == null || '$v'.isEmpty ? '—' : '$v';
  }

  void _exportPage() {
    final cols = <ExportCol>[];
    for (final f in _filterCols) {
      if (f.$4 && !_canMoney) continue;
      if (f.$1 == 'sellingValue') {
        cols.addAll([
          ExportCol(f.$2, f.$3, (r) => ((r['sellingValue'] ?? 0) as num) > 0 ? r['sellingValue'] : ''),
          ExportCol('سعر مسار العميل (اقتراح)', 'Customer route price (suggested)', (r) => r['routePrice'] ?? ''),
          ExportCol('الربح', 'Profit', (r) => r['profit'] ?? ''),
          ExportCol('الهامش %', 'Margin %', (r) => r['margin'] ?? ''),
          ExportCol('مصدر السعر', 'Price source', (r) => _sourceLabel(r['priceSource'])),
        ]);
      } else {
        cols.add(ExportCol(f.$2, f.$3, (r) => _cell(r, f.$1)));
      }
    }
    exportExcel(context, fileName: 'operations-private', sheets: [('Private', cols, _rows)]);
  }

  Future<void> _export() => opsExportMenu(context, [
        (tr('الصفحة المعروضة (${_rows.length})', 'Current page (${_rows.length})'), () async => _exportPage()),
        (tr('كلّ ما طابق الفلتر ($_total)', 'Everything matching the filter ($_total)'),
            () => opsServerExport(context, '/api/operations-private/export?${opsQs(_params())}', 'operations-private')),
        (tr('الجدول كلّه (بلا فلتر)', 'The whole table (no filter)'), () => opsBackgroundExport(context, 'operations-private', {'scope': 'all'})),
      ]);

  Widget _kpi(String label, String value, String sub, Color tone, IconData icon, {VoidCallback? onTap, bool active = false}) => Expanded(
        child: Pressable(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: active ? T.warn.withValues(alpha: 0.08) : T.card,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: active ? T.warn : T.line),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700))),
                Icon(icon, size: 15, color: tone),
              ]),
              const SizedBox(height: 5),
              FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                  child: Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: tone))),
              const SizedBox(height: 2),
              Text(sub, maxLines: 2, style: const TextStyle(fontSize: 10, color: T.inkFaint)),
            ]),
          ),
        ),
      );

  Widget _statusCards() {
    final by = _stats['byStatus'];
    if (by is! Map) return const SizedBox.shrink();
    final sel = _cf['applicationStatus'] ?? const <String>{};
    Widget card(String key, String label, num n, Color color) {
      final on = key.isEmpty ? sel.isEmpty : sel.contains(key);
      return Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: Pressable(
          onTap: () => _toggleStatus(key),
          child: Container(
            width: 104,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: on ? (key.isEmpty ? T.ink : color.withValues(alpha: 0.12)) : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: on ? (key.isEmpty ? T.ink : color) : T.line, width: on ? 1.5 : 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(opsMoney(n), style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: on && key.isEmpty ? Colors.white : T.ink)),
              Row(children: [
                if (key.isNotEmpty) Container(width: 6, height: 6, margin: const EdgeInsetsDirectional.only(end: 4), decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: on && key.isEmpty ? Colors.white : T.inkSoft))),
              ]),
            ]),
          ),
        ),
      );
    }
    return SizedBox(
      height: 62,
      child: ListView(scrollDirection: Axis.horizontal, children: [
        card('', tr('الكل', 'All'), (_stats['statusTotal'] ?? 0) as num, T.ink),
        for (final e in opsAppStatuses.entries) card(e.key, tr(e.value.$1, e.value.$2), (by[e.key] ?? 0) as num, e.value.$3),
      ]),
    );
  }

  Widget _header() {
    final s = _stats;
    final has = s.isNotEmpty;
    final priced = (s['priced'] ?? 0) as num;
    final unpriced = (s['unpriced'] ?? 0) as num;
    final total = (s['total'] ?? 0) as num;
    final share = total > 0 ? (priced / total * 100).round() : 0;
    final colActive = _cf.keys.where((k) => k != 'applicationStatus').length;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _statusCards(),
      const SizedBox(height: 8),
      Row(children: [
        _kpi(tr('إجمالي البيع', 'Selling total'), has ? opsMoney(s['sumSelling']) : '…',
            tr('على $priced كشفًا مسعَّرًا', 'over $priced priced sheets'), T.success, Icons.payments_outlined),
        const SizedBox(width: 8),
        _kpi(tr('إجمالي الشراء', 'Purchase total'), has ? opsMoney(s['sumPurchaseAll']) : '…',
            tr('المسعَّر ${opsMoney(s['sumPurchase'])} · غير المسعَّر ${opsMoney(s['sumPurchaseUnpriced'])}', 'priced ${opsMoney(s['sumPurchase'])} · unpriced ${opsMoney(s['sumPurchaseUnpriced'])}'),
            T.inkSoft, Icons.shopping_cart_outlined),
      ]),
      const SizedBox(height: 8),
      Row(children: [
        _kpi(tr('الربح والهامش', 'Profit & margin'), has ? '${opsMoney(s['profit'])}  ${s['margin'] ?? 0}%' : '…',
            tr('على المسعَّر وحدَه — البيع ناقص شرائه', 'priced rows only — selling minus their purchase'),
            ((s['profit'] ?? 0) as num) < 0 ? T.danger : T.orange, Icons.trending_up),
        const SizedBox(width: 8),
        _kpi(tr('مسعَّر / بلا سعر', 'Priced / unpriced'), has ? '$priced / $unpriced' : '…',
            _priced == 'no' ? tr('تعرض غيرَ المسعَّر — اضغط للإلغاء', 'Showing unpriced — tap to clear') : tr('$share% مسعَّر — اضغط لعرض ما بلا سعر', '$share% priced — tap to show unpriced'),
            T.warn, Icons.sell_outlined, active: _priced == 'no',
            onTap: () { _priced = _priced == 'no' ? '' : 'no'; _reload(); }),
      ]),
      const SizedBox(height: 10),
      TextField(
        onChanged: (v) {
          _debounce?.cancel();
          _debounce = Timer(const Duration(milliseconds: 350), () { _q = v; _reload(); });
        },
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(hintText: tr('كشف أو عميل أو مدينة…', 'Sheet, customer or city…'), prefixIcon: const Icon(Icons.search), isDense: true),
      ),
      const SizedBox(height: 6),
      OpsPeriodBar(period: _period, onChanged: _reload),
      const SizedBox(height: 4),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final p in const [('', 'الكل', 'All'), ('yes', 'مسعَّر', 'Priced'), ('no', 'بلا سعر', 'Unpriced')]) ...[
            ChoiceChip(visualDensity: VisualDensity.compact, label: Text(tr(p.$2, p.$3)), selected: _priced == p.$1, onSelected: (_) { _priced = p.$1; _reload(); }),
            const SizedBox(width: 6),
          ],
          FilterChip(
            visualDensity: VisualDensity.compact,
            label: Text(tr('فواتير لم تصل', 'Pending invoices')),
            selected: _pendingOnly,
            onSelected: (_) { _pendingOnly = !_pendingOnly; _reload(); },
          ),
          const SizedBox(width: 6),
          ActionChip(
            visualDensity: VisualDensity.compact,
            avatar: const Icon(Icons.filter_alt_outlined, size: 16),
            label: Text(colActive > 0 ? tr('فلاتر الأعمدة ($colActive)', 'Column filters ($colActive)') : tr('فلاتر الأعمدة', 'Column filters')),
            onPressed: _pickColumn,
          ),
          if (_cf.isNotEmpty)
            TextButton(onPressed: () { _cf.clear(); _reload(); }, child: Text(tr('مسح فلاتر الأعمدة (${_cf.length})', 'Clear column filters (${_cf.length})'))),
        ]),
      ),
      if (_cf.isNotEmpty)
        Wrap(spacing: 6, runSpacing: 4, children: [
          for (final e in _cf.entries)
            InputChip(
              visualDensity: VisualDensity.compact,
              label: Text('${() { final f = _filterCols.where((x) => x.$1 == e.key).firstOrNull; return f == null ? e.key : tr(f.$2, f.$3); }()}: ${e.value.length == 1 ? _valueLabel(e.key, e.value.first) : e.value.length}',
                  style: const TextStyle(fontSize: 11)),
              onDeleted: () { _cf.remove(e.key); _reload(); },
            ),
        ]),
      Align(
        alignment: AlignmentDirectional.centerEnd,
        child: Text(tr('$_total كشفًا حسب الفلتر', '$_total sheets match'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
      ),
    ]);
  }

  Widget _rowCard(Map<String, dynamic> w) {
    final priced = ((w['sellingValue'] ?? 0) as num) > 0;
    final profit = w['profit'];
    final margin = w['margin'];
    return AppCard(
      topAccent: priced ? T.success : T.warn,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${w['username'] ?? '—'}', maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
          Text('${w['reportNumber'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.orange, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 3),
        Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'} · ${opsDate(w['reportDate'])}',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text([w['branch'], w['driverName'], w['carNumber'], if ((w['applicationStatus'] ?? '').toString().isNotEmpty) opsStatusLabel(w['applicationStatus'])]
                  .where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Chip2('${tr('شراء', 'buy')} ${opsMoney(w['purchaseValue'])}', T.inkSoft),
          if (w['routePrice'] != null && (w['routePrice'] as num) != ((w['sellingValue'] ?? 0) as num))
            Pressable(
              onTap: () => _editPrice(w, suggest: w['routePrice'] as num),
              child: Chip2('${tr('المسار', 'route')} ${opsMoney(w['routePrice'])}', T.inkFaint),
            ),
          Pressable(
            onTap: () => _editPrice(w),
            child: Chip2(priced ? '${tr('بيع', 'sell')} ${opsMoney(w['sellingValue'])}' : tr('بلا سعر', 'not priced'), priced ? T.success : T.warn, icon: Icons.edit_outlined),
          ),
          if (profit != null)
            Text('${opsMoney(profit)}${margin != null ? '  ($margin%)' : ''}',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: (profit as num) >= 0 ? T.success : T.danger)),
          Text(_sourceLabel(w['priceSource']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final allowed = _roles.contains(context.watch<AuthProvider>().role);
    if (!allowed) {
      return AppScaffold(
        title: Text(tr('التشغيل — خاصّ', 'Operations — private')),
        body: EmptyState(icon: Icons.lock_outline, title: tr('هذه الصفحة للإدارة فقط.', 'Management only.')),
      );
    }
    return AppScaffold(
      title: Text(tr('التشغيل — خاصّ', 'Operations — private')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: _loading && _rows.isEmpty && _stats.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 180)])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      _header(),
                      const SizedBox(height: 10),
                      if (_loading) const LinearProgressIndicator(minHeight: 2),
                      if (_rows.isEmpty)
                        EmptyState(icon: Icons.lock_outline, title: _cf.isNotEmpty || _priced.isNotEmpty || _pendingOnly ? tr('لا نتائج للفلتر المحدد', 'No rows match the filters') : tr('لا كشوف', 'No sheets'))
                      else
                        for (final w in _rows) ...[_rowCard(w), const SizedBox(height: 8)],
                      if (_pages > 1)
                        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          IconButton(onPressed: _page > 1 ? () { setState(() { _page--; _loading = true; }); _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
                          Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w800)),
                          IconButton(onPressed: _page < _pages ? () { setState(() { _page++; _loading = true; }); _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
                        ]),
                    ],
                  ),
                ),
    );
  }
}
