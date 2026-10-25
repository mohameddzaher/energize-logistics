import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'wallet_branch.dart';
import 'wallet_common.dart';

/// لوحة المحفظة — نظرة كل الفروع على العهدة: يومٌ أو شهرٌ أو فترة، والتحصيلات
/// والمصروفات والمشتريات والرصيد والفروقات لكل فرع، ونقرةُ الفرع تفتح لوحتَه.
/// مطابقة لصفحة الويب /system/wallet-dashboard.
class WalletDashboardScreen extends StatefulWidget {
  const WalletDashboardScreen({super.key});
  @override
  State<WalletDashboardScreen> createState() => _WalletDashboardScreenState();
}

class _WalletDashboardScreenState extends State<WalletDashboardScreen> {
  List<Map<String, dynamic>> _branches = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمٌ للشاشة: الخانةُ تعود بنصِّها بعد التحميل
  final _searchCtl = TextEditingController();
  int _seq = 0;
  String _mode = 'single'; // single | month | range
  DateTime _date = DateTime.now();
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();
  late final void Function() _onLive;
  static const _events = ['wallet:transaction', 'wallet:dayClosed', 'wallet:dayReopened', 'wallet:transactionDeleted', 'wallet:reset'];

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load(spinner: false);
    for (final e in _events) {
      Live.instance.on(e, _onLive);
    }
  }

  @override
  void dispose() {
    for (final e in _events) {
      Live.instance.off(e, _onLive);
    }
    _searchCtl.dispose();
    super.dispose();
  }

  /// مدى الفترة المختارة (من، إلى) — واليومُ مدًى من يومٍ واحد.
  (String, String) get _bounds {
    if (_mode == 'month') return ('${walletMonthKey(_month)}-01', walletMonthEnd(_month));
    if (_mode == 'range') return (walletDayKey(_from), walletDayKey(_to));
    return (walletDayKey(_date), walletDayKey(_date));
  }

  String get _query {
    if (_mode == 'single') return 'date=${walletDayKey(_date)}';
    final (f, t) = _bounds;
    return 'dateFrom=$f&dateTo=$t';
  }

  String get _periodLabel {
    if (_mode == 'month') return walletMonthKey(_month);
    if (_mode == 'range') return '${walletDayKey(_from)} → ${walletDayKey(_to)}';
    return walletDayKey(_date);
  }

  Future<void> _load({bool spinner = true}) async {
    final my = ++_seq;
    if (spinner && mounted) setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/wallet/dashboard?$_query');
      if (!mounted || my != _seq) return;
      setState(() {
        _branches = List<Map<String, dynamic>>.from(d['branches'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  num _sum(String key) => _branches.fold<num>(0, (a, b) => a + walletNum(b[key]));

  // ── أعمدةُ التصدير — هي أعمدةُ الموقع ─────────────────────────────────────
  List<ExportCol> get _cols => [
        ExportCol('الفرع', 'Branch', (r) => r['branch'] is Map ? '${r['branch']['name'] ?? ''}' : ''),
        ExportCol('رمز الفرع', 'Branch code', (r) => r['branch'] is Map ? '${r['branch']['code'] ?? ''}' : ''),
        ExportCol('الرصيد الافتتاحي', 'Opening balance', (r) => walletNum(r['openingBalance'])),
        ExportCol('التحصيلات', 'Collections', (r) => walletNum(r['totalCollections'])),
        ExportCol('المصروفات', 'Expenses', (r) => walletNum(r['totalExpenses'])),
        ExportCol('المشتريات', 'Purchases', (r) => walletNum(r['totalPurchases'])),
        ExportCol('صافي الحركة', 'Net movement', (r) => walletNum(r['netMovement'])),
        ExportCol('تسوية جرد', 'Stock-take adj.', (r) => walletNum(r['adjustment'])),
        ExportCol('الرصيد الختامي', 'Closing balance', (r) => walletNum(r['closingBalance'])),
        ExportCol('أيام بها حركة', 'Days with movement', (r) => r['movedToday'] ?? ''),
        ExportCol('المحافظ النشطة', 'Active wallets', (r) => r['activeWallets'] ?? 0),
        ExportCol('أيام مقفلة', 'Closed days', (r) => r['closedWallets'] ?? 0),
        ExportCol('النقد الفعلي', 'Actual cash', (r) => walletNum(r['totalActualCash'])),
        ExportCol('فرق الجرد', 'Cash difference', (r) => walletNum(r['totalDifference'])),
      ];

  Future<void> _export() async {
    final which = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text('${tr('المعروض', 'Shown')} — $_periodLabel'), onTap: () => Navigator.pop(c, 'shown')),
          ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (which == null || !mounted) return;
    var rows = _branches;
    if (which == 'all') {
      try {
        final d = await Api.instance.get('/api/wallet/dashboard?dateFrom=2000-01-01&dateTo=2100-12-31');
        rows = List<Map<String, dynamic>>.from(d['branches'] ?? []);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'Wallet_Dashboard_${_periodLabel.replaceAll(' → ', '_to_')}', sheets: [('Branches', _cols, rows)]);
  }

  /// لوحةُ الفرع على الفترة نفسِها — والشهرُ يُفتح مدًى من أوّله إلى آخره.
  void _openBranch(Map<String, dynamic> b) {
    final branch = Map<String, dynamic>.from(b['branch'] ?? {});
    final id = '${branch['_id'] ?? ''}';
    if (id.isEmpty) return;
    final (f, t) = _bounds;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => WalletBranchScreen(
      branchId: id,
      branchName: '${branch['name'] ?? ''}',
      date: _mode == 'single' ? walletDayKey(_date) : null,
      dateFrom: _mode == 'single' ? null : f,
      dateTo: _mode == 'single' ? null : t,
    )));
  }

  Widget _periodBar() {
    Widget picker;
    if (_mode == 'single') {
      picker = Row(children: [
        Expanded(child: OutlinedButton.icon(
          onPressed: () async {
            final v = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2020), lastDate: DateTime(2100));
            if (v != null) { setState(() => _date = v); _load(); }
          },
          icon: const Icon(Icons.event, size: 17),
          label: Text(walletDayKey(_date), style: const TextStyle(fontWeight: FontWeight.w800)),
        )),
        TextButton(onPressed: () { setState(() => _date = DateTime.now()); _load(); }, child: Text(tr('اليوم', 'Today'))),
      ]);
    } else if (_mode == 'month') {
      picker = Row(children: [
        Expanded(child: OutlinedButton.icon(
          onPressed: () async {
            final m = await pickWalletMonth(context, _month);
            if (m != null) { setState(() => _month = m); _load(); }
          },
          icon: const Icon(Icons.calendar_month, size: 17),
          label: Text(walletMonthLabel(_month), style: const TextStyle(fontWeight: FontWeight.w800)),
        )),
        TextButton(onPressed: () { setState(() => _month = DateTime(DateTime.now().year, DateTime.now().month)); _load(); }, child: Text(tr('هذا الشهر', 'This month'))),
      ]);
    } else {
      picker = Row(children: [
        Expanded(child: OutlinedButton.icon(
          onPressed: () async {
            final v = await showDateRangePicker(context: context, initialDateRange: DateTimeRange(start: _from, end: _to.isBefore(_from) ? _from : _to),
                firstDate: DateTime(2020), lastDate: DateTime(2100));
            if (v != null) { setState(() { _from = v.start; _to = v.end; }); _load(); }
          },
          icon: const Icon(Icons.date_range, size: 17),
          label: Text('${tr('من', 'From')} ${walletDayKey(_from)} ${tr('إلى', 'To')} ${walletDayKey(_to)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
        )),
        TextButton(onPressed: () { setState(() { _from = DateTime.now(); _to = DateTime.now(); }); _load(); }, child: Text(tr('اليوم', 'Today'))),
      ]);
    }
    return Column(children: [
      SizedBox(
        width: double.infinity,
        child: SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'single', label: Text(tr('يوم', 'Day')), icon: const Icon(Icons.event, size: 15)),
            ButtonSegment(value: 'month', label: Text(tr('شهر', 'Month')), icon: const Icon(Icons.calendar_month, size: 15)),
            ButtonSegment(value: 'range', label: Text(tr('فترة', 'Range')), icon: const Icon(Icons.date_range, size: 15)),
          ],
          selected: {_mode},
          showSelectedIcon: false,
          onSelectionChanged: (s) { setState(() => _mode = s.first); _load(); },
        ),
      ),
      const SizedBox(height: 8),
      picker,
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = q.isEmpty
        ? _branches
        : _branches.where((b) => _fold(((b['branch'] ?? const {})['name'] ?? '').toString()).contains(q)).toList();
    final adj = _sum('adjustment');
    final net = _sum('netMovement');

    return AppScaffold(
      title: Text(tr('لوحة المحفظة', 'Wallet Dashboard')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: RefreshIndicator(
        onRefresh: () => _load(spinner: false),
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.all(14),
          children: [
            _periodBar(),
            const SizedBox(height: 12),
            if (_loading)
              ...const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)]
            else if (_error != null)
              ErrorRetry(message: _error!, onRetry: () => _load())
            else ...[
              // ── الميزانُ يُقرأ كسطر حساب: افتتاحيٌّ + تحصيلاتٌ − مصروفاتٌ − مشترياتٌ = ختاميّ.
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.7,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                children: [
                  _tile(tr('الرصيد الافتتاحي', 'Opening balance'), walletMoney(_sum('openingBalance')), _sum('openingBalance') >= 0 ? T.ink : T.danger, Icons.account_balance_wallet_outlined),
                  _tile(tr('إجمالي التحصيلات', 'Collections'), walletMoney(_sum('totalCollections')), T.success, Icons.payments_outlined),
                  _tile(tr('إجمالي المصروفات', 'Expenses'), walletMoney(_sum('totalExpenses')), T.danger, Icons.money_off_outlined),
                  _tile(tr('إجمالي المشتريات', 'Purchases'), walletMoney(_sum('totalPurchases')), T.info, Icons.shopping_cart_outlined),
                  _tile(tr('صافي الحركة', 'Net movement'), walletMoney(net), net >= 0 ? T.success : T.danger, Icons.trending_up),
                  // تسويةُ الجرد تظهر حين تكون — الصفرُ لا يُعرض.
                  if (adj.abs() > 0.01) _tile(tr('تسوية جرد', 'Stock-take adj.'), walletMoney(adj), T.warn, Icons.warning_amber_outlined),
                  _tile(tr('الرصيد الختامي', 'Closing balance'), walletMoney(_sum('closingBalance')), T.warn, Icons.account_balance_wallet),
                  _tile(tr('المحافظ النشطة', 'Active wallets'), '${_sum('activeWallets')}', T.ink, Icons.people_outline),
                ],
              ),
              const SizedBox(height: 14),
              SearchField(
                controller: _searchCtl,
                onChanged: (v) => setState(() => _q = v),
                hint: tr('ابحث باسم الفرع…', 'Search branch…'),
              ),
              const SizedBox(height: 10),
              Text(tr('الفروع', 'Branches'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 8),
              if (rows.isEmpty)
                EmptyState(icon: Icons.store_mall_directory_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد فروع', 'No branches'))
              else
                ...rows.map(_branchCard),
              const SizedBox(height: 24),
            ],
          ],
        ),
      ),
    );
  }

  Widget _line(String label, String value, Color color, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 12, color: bold ? T.ink : T.inkSoft, fontWeight: bold ? FontWeight.w700 : FontWeight.w500))),
          Text(value, style: TextStyle(fontSize: 12.5, fontWeight: bold ? FontWeight.w900 : FontWeight.w700, color: color)),
        ]),
      );

  Widget _branchCard(Map<String, dynamic> b) {
    final branch = Map<String, dynamic>.from(b['branch'] ?? {});
    final diff = walletNum(b['totalDifference']);
    final adj = walletNum(b['adjustment']);
    final net = walletNum(b['netMovement']);
    final active = walletNum(b['activeWallets']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _openBranch(b),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.store_outlined, size: 18, color: T.orange),
              const SizedBox(width: 6),
              Expanded(child: Text((branch['name'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
              if ('${branch['code'] ?? ''}'.isNotEmpty) Chip2('${branch['code']}', T.inkSoft),
              const Icon(Icons.chevron_right, size: 18, color: T.inkFaint),
            ]),
            const SizedBox(height: 8),
            _line(tr('الافتتاحي', 'Opening'), walletMoney(b['openingBalance']), walletNum(b['openingBalance']) >= 0 ? T.ink : T.danger),
            _line(tr('التحصيلات', 'Collections'), '+${walletMoney(b['totalCollections'])}', T.success),
            _line(tr('المصروفات', 'Expenses'), '-${walletMoney(b['totalExpenses'])}', T.danger),
            _line(tr('المشتريات', 'Purchases'), '-${walletMoney(b['totalPurchases'])}', T.info),
            const Divider(height: 10),
            _line(tr('الصافي', 'Net'), walletMoney(net), net >= 0 ? T.success : T.danger, bold: true),
            if (adj.abs() > 0.01) _line(tr('تسوية جرد', 'Adjustment'), walletMoney(adj), T.warn),
            _line(tr('الرصيد الختامي', 'Closing balance'), walletMoney(b['closingBalance']), T.warn, bold: true),
            if (walletNum(b['closedWallets']) > 0 && diff != 0)
              _line(diff > 0 ? tr('عجز', 'Deficit') : tr('فائض', 'Surplus'), '${diff > 0 ? '-' : '+'}${walletMoney(diff.abs())}', diff > 0 ? T.danger : T.success, bold: true),
            const SizedBox(height: 4),
            Text('${active.toInt()} ${tr('محفظة نشطة', active == 1 ? 'active wallet' : 'active wallets')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        ),
      ),
    );
  }

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 8),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
              child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}
