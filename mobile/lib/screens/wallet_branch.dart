import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'wallet_common.dart';

/// لوحةُ فرعٍ واحد — نظيرُ /system/wallet-dashboard/branch/[id] في الموقع.
/// تُفتح من بطاقة الفرع في لوحة المحفظة على الفترة نفسِها: ملخّصُ الفرع،
/// والمحافظُ يومًا يومًا، وسجلُّ الحركات بتصفيةٍ بالنوع وبالموظّف، والتصدير.
class WalletBranchScreen extends StatefulWidget {
  final String branchId;
  final String branchName;
  final String? date;
  final String? dateFrom;
  final String? dateTo;
  const WalletBranchScreen({super.key, required this.branchId, this.branchName = '', this.date, this.dateFrom, this.dateTo});
  @override
  State<WalletBranchScreen> createState() => _WalletBranchScreenState();
}

const _types = {
  'collection': ('تحصيل', 'Collection', T.success),
  'expense': ('مصروف', 'Expense', T.danger),
  'purchase': ('مشتريات', 'Purchase', T.info),
  'tax_invoice': ('استلام فاتورة ضريبية', 'Tax invoices received', T.inkFaint),
};

String _typeLabel(dynamic t) {
  final x = _types[t];
  return x == null ? '${t ?? ''}' : tr(x.$1, x.$2);
}

String _op(Map t, String k) => t['operationDetails'] is Map ? '${t['operationDetails'][k] ?? ''}' : '';

class _WalletBranchScreenState extends State<WalletBranchScreen> {
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _wallets = [];
  List<Map<String, dynamic>> _transactions = [];
  bool _loading = true;
  String? _error;
  int _seq = 0;
  late String _mode; // single | range
  late DateTime _date;
  late DateTime _from;
  late DateTime _to;
  late String _branchName;
  String _typeFilter = '';
  String _userFilter = '';
  late final void Function() _onLive;
  static const _events = ['wallet:transaction', 'wallet:dayClosed'];

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _mode = (widget.dateFrom != null && widget.dateTo != null) ? 'range' : 'single';
    _date = DateTime.tryParse(widget.date ?? '') ?? now;
    _from = DateTime.tryParse(widget.dateFrom ?? '') ?? now;
    _to = DateTime.tryParse(widget.dateTo ?? '') ?? now;
    _branchName = widget.branchName;
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
    super.dispose();
  }

  String get _query => _mode == 'range'
      ? 'dateFrom=${walletDayKey(_from)}&dateTo=${walletDayKey(_to)}'
      : 'date=${walletDayKey(_date)}';

  String get _dateLabel => _mode == 'range' ? '${walletDayKey(_from)}_to_${walletDayKey(_to)}' : walletDayKey(_date);

  Future<void> _load({bool spinner = true}) async {
    final my = ++_seq;
    if (spinner && mounted) setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/wallet/branch/${widget.branchId}?$_query');
      if (!mounted || my != _seq) return;
      setState(() {
        _summary = d['summary'] is Map ? Map<String, dynamic>.from(d['summary']) : null;
        _wallets = List<Map<String, dynamic>>.from(d['wallets'] ?? []);
        _transactions = List<Map<String, dynamic>>.from(d['transactions'] ?? []);
        if (_wallets.isNotEmpty && _wallets.first['branch'] is Map) {
          final n = '${_wallets.first['branch']['name'] ?? ''}';
          if (n.isNotEmpty) _branchName = n;
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _filtered => _transactions.where((t) {
        if (_typeFilter.isNotEmpty && t['type'] != _typeFilter) return false;
        if (_userFilter.isNotEmpty && walletUserName(t['user']) != _userFilter) return false;
        return true;
      }).toList();

  // ── أعمدةُ التصدير — أعمدةُ الموقع (walletColumns / txColumns) ──────────────
  List<ExportCol> get _walletCols => [
        ExportCol('المستخدم', 'User', (r) => walletUserName(r['user'])),
        if (_mode == 'range') ExportCol('التاريخ', 'Date', (r) => '${r['date'] ?? ''}'),
        ExportCol('الرصيد الافتتاحي (ريال)', 'Opening balance (SAR)', (r) => walletNum(r['openingBalance'])),
        ExportCol('التحصيلات (ريال)', 'Collections (SAR)', (r) => walletNum(r['totalCollections'])),
        ExportCol('المصروفات (ريال)', 'Expenses (SAR)', (r) => walletNum(r['totalExpenses'])),
        ExportCol('المشتريات (ريال)', 'Purchases (SAR)', (r) => walletNum(r['totalPurchases'])),
        ExportCol('الرصيد الختامي (ريال)', 'Closing balance (SAR)', (r) => walletNum(r['closingBalance'])),
        ExportCol('الحالة', 'Status', (r) => r['isClosed'] == true ? tr('مغلق', 'Closed') : tr('مفتوح', 'Open')),
        ExportCol('النقد الفعلي (ريال)', 'Actual cash (SAR)', (r) => r['actualCash'] != null ? walletNum(r['actualCash']) : (r['isClosed'] == true ? 0 : tr('لم يُغلق', 'Not closed'))),
        ExportCol('فرق النقد (ريال)', 'Cash difference (SAR)', (r) => r['cashDifference'] != null ? walletNum(r['cashDifference']) : (r['isClosed'] == true ? 0 : tr('لم يُغلق', 'Not closed'))),
      ];

  List<ExportCol> get _txCols => [
        if (_mode == 'range') ExportCol('التاريخ', 'Date', (r) => '${r['date'] ?? ''}'),
        ExportCol('الوقت', 'Time', (r) => walletTime(r['createdAt'])),
        ExportCol('المستخدم', 'User', (r) => walletUserName(r['user'])),
        ExportCol('النوع', 'Type', (r) => _typeLabel(r['type'])),
        ExportCol('المبلغ (ريال)', 'Amount (SAR)', (r) => walletNum(r['amount'])),
        ExportCol('العميل', 'Customer', (r) => r['customer'] is Map ? '${r['customer']['companyName'] ?? ''} (${r['customer']['customerNumber'] ?? ''})' : ''),
        ExportCol('رقم الفاتورة', 'Invoice #', (r) => r['invoice'] is Map ? '${r['invoice']['invoiceNumber'] ?? ''}' : ''),
        ExportCol('مبلغ الفاتورة', 'Invoice amount', (r) => r['invoice'] is Map && r['invoice']['amount'] != null ? walletNum(r['invoice']['amount']) : ''),
        ExportCol('رصيد الفاتورة', 'Invoice balance', (r) => r['invoice'] is Map && r['invoice']['balance'] != null ? walletNum(r['invoice']['balance']) : ''),
        ExportCol('رقم أمر النقل', 'Delivery statement #', (r) => '${r['deliveryStatementNumber'] ?? ''}'),
        ExportCol('المورد', 'Vendor', (r) => r['vendor'] is Map ? '${r['vendor']['name'] ?? ''}' : ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] is Map ? '${r['driver']['name'] ?? ''}' : ''),
        ExportCol('الفئة', 'Category', (r) => r['expenseCategory'] is Map ? '${r['expenseCategory']['name'] ?? ''}' : ''),
        ExportCol('الصنف / الوصف', 'Item / description', (r) => '${r['itemName'] ?? ''}'),
        ExportCol('المرجع', 'Reference', (r) => '${r['reference'] ?? ''}'),
        ExportCol('العميل (أمر النقل)', 'Client', (r) => _op(r, 'client')),
        ExportCol('من', 'From', (r) => _op(r, 'from')),
        ExportCol('إلى', 'To', (r) => _op(r, 'to')),
        ExportCol('نوع السيارة', 'Car type', (r) => _op(r, 'carType')),
        ExportCol('الطول', 'Length', (r) => _op(r, 'length')),
        ExportCol('رقم السيارة', 'Car number', (r) => _op(r, 'carNumber')),
        ExportCol('تاريخ أمر النقل', 'Report date', (r) => r['operationDetails'] is Map ? walletDateGb(r['operationDetails']['reportDate']) : ''),
        ExportCol('ملاحظات', 'Notes', (r) => '${r['notes'] ?? ''}'),
        ExportCol('مُعلَّمة', 'Flagged', (r) => r['isFlagged'] == true),
      ];

  Future<void> _export() async {
    final filtered = _typeFilter.isNotEmpty || _userFilter.isNotEmpty;
    String which = 'all';
    // والمعروضُ يُعرَض خيارًا حين تكون تصفية — كما في الموقع.
    if (filtered) {
      final w = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض', 'Shown')), onTap: () => Navigator.pop(c, 'shown')),
            ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
          ]),
        ),
      );
      if (w == null) return;
      which = w;
    }
    if (!mounted) return;
    final name = _branchName.isEmpty ? tr('فرع', 'Branch') : _branchName;
    await exportExcel(context, fileName: '${name}_Wallet_$_dateLabel', sheets: [
      ('Wallets', _walletCols, _wallets),
      ('Transactions', _txCols, which == 'shown' ? _filtered : _transactions),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final shown = _filtered;
    final users = _transactions.map((t) => walletUserName(t['user'])).where((x) => x.isNotEmpty).toSet().toList();
    final s = _summary;
    return AppScaffold(
      title: Text('${_branchName.isEmpty ? tr('الفرع', 'Branch') : _branchName} — ${tr('لوحة', 'Dashboard')}'),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: RefreshIndicator(
        onRefresh: () => _load(spinner: false),
        child: ListView(padding: const EdgeInsets.all(14), children: [
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'single', label: Text(tr('يوم', 'Day')), icon: const Icon(Icons.event, size: 15)),
                ButtonSegment(value: 'range', label: Text(tr('فترة', 'Range')), icon: const Icon(Icons.date_range, size: 15)),
              ],
              selected: {_mode},
              showSelectedIcon: false,
              onSelectionChanged: (v) { setState(() => _mode = v.first); _load(); },
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: OutlinedButton.icon(
              onPressed: () async {
                if (_mode == 'single') {
                  final v = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2020), lastDate: DateTime(2100));
                  if (v != null) { setState(() => _date = v); _load(); }
                } else {
                  final v = await showDateRangePicker(context: context, initialDateRange: DateTimeRange(start: _from, end: _to.isBefore(_from) ? _from : _to),
                      firstDate: DateTime(2020), lastDate: DateTime(2100));
                  if (v != null) { setState(() { _from = v.start; _to = v.end; }); _load(); }
                }
              },
              icon: Icon(_mode == 'single' ? Icons.event : Icons.date_range, size: 17),
              label: Text(_mode == 'single' ? walletDayKey(_date) : '${walletDayKey(_from)} → ${walletDayKey(_to)}',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
            )),
            TextButton(onPressed: () {
              setState(() { _date = DateTime.now(); _from = DateTime.now(); _to = DateTime.now(); });
              _load();
            }, child: Text(tr('اليوم', 'Today'))),
          ]),
          const SizedBox(height: 12),
          if (_loading)
            ...const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]
          else if (_error != null)
            ErrorRetry(message: _error!, onRetry: () => _load())
          else ...[
            if (s != null)
              AppCard(
                child: Column(children: [
                  Row(children: [
                    _col(tr('التحصيلات', 'Collections'), '+${walletMoney(s['totalCollections'])}', T.success),
                    _col(tr('المصروفات', 'Expenses'), '-${walletMoney(s['totalExpenses'])}', T.danger),
                    _col(tr('المشتريات', 'Purchases'), '-${walletMoney(s['totalPurchases'])}', T.info),
                  ]),
                  const Divider(height: 18),
                  Row(children: [
                    _col(tr('صافي الحركة', 'Net movement'), walletMoney(s['netMovement']), walletNum(s['netMovement']) >= 0 ? T.success : T.danger),
                    _col(tr('الرصيد الختامي', 'Closing balance'), walletMoney(s['closingBalance']), T.warn),
                    _col(tr('المحافظ النشطة', 'Active wallets'), '${s['activeWallets'] ?? 0}', T.ink),
                  ]),
                ]),
              ),
            if (_wallets.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(tr('المحافظ الفردية', 'Individual wallets'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 8),
              ..._wallets.map(_walletRow),
            ],
            const SizedBox(height: 14),
            Row(children: [
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: _typeFilter,
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('النوع', 'Type'), border: const OutlineInputBorder(), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('كل الأنواع', 'All types'))),
                  DropdownMenuItem(value: 'collection', child: Text(tr('التحصيلات', 'Collections'))),
                  DropdownMenuItem(value: 'expense', child: Text(tr('المصروفات', 'Expenses'))),
                  DropdownMenuItem(value: 'purchase', child: Text(tr('المشتريات', 'Purchases'))),
                ],
                onChanged: (v) => setState(() => _typeFilter = v ?? ''),
              )),
              const SizedBox(width: 8),
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: users.contains(_userFilter) ? _userFilter : '',
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('المستخدم', 'User'), border: const OutlineInputBorder(), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('كل المستخدمين', 'All users'))),
                  ...users.map((u) => DropdownMenuItem(value: u, child: Text(u, overflow: TextOverflow.ellipsis))),
                ],
                onChanged: (v) => setState(() => _userFilter = v ?? ''),
              )),
            ]),
            const SizedBox(height: 12),
            Text('${tr('سجل الحركات', 'Transaction log')} (${shown.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 8),
            if (shown.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد حركات', 'No transactions')),
            ...shown.map(_txRow),
            const SizedBox(height: 24),
          ],
        ]),
      ),
    );
  }

  Widget _walletRow(Map<String, dynamic> w) {
    final closed = w['isClosed'] == true;
    final diff = w['cashDifference'] == null ? null : walletNum(w['cashDifference']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text([walletUserName(w['user']), if (_mode == 'range') '${w['date'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
            Chip2(closed ? tr('مغلق', 'Closed') : tr('مفتوح', 'Open'), closed ? T.danger : T.success),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('افتتاحي', 'Open')} ${walletMoney(w['openingBalance'])}', T.inkSoft),
            Chip2('+${walletMoney(w['totalCollections'])}', T.success),
            Chip2('-${walletMoney(w['totalExpenses'])}', T.danger),
            Chip2('-${walletMoney(w['totalPurchases'])}', T.info),
            Chip2('${tr('ختامي/متوقع', 'Closing/expected')} ${walletMoney(w['closingBalance'])}', T.orange),
            if (w['actualCash'] != null) Chip2('${tr('الفعلي', 'Actual')} ${walletMoney(w['actualCash'])}', T.ink),
            if (diff != null && diff != 0)
              Chip2('${diff > 0 ? tr('عجز', 'Deficit') : tr('فائض', 'Surplus')} ${diff > 0 ? '-' : '+'}${walletMoney(diff.abs())}', diff > 0 ? T.danger : T.success)
            else if (closed)
              Chip2(tr('مطابق', 'Matched'), T.success),
          ]),
        ]),
      ),
    );
  }

  Widget _txRow(Map<String, dynamic> t) {
    final ty = _types[t['type']] ?? ('—', '—', T.inkFaint);
    final isIn = t['type'] == 'collection';
    String nm(String k) => t[k] is Map ? '${t[k]['name'] ?? t[k]['companyName'] ?? ''}' : '';
    final who = [nm('customer'), nm('vendor'), nm('driver'), '${t['itemName'] ?? ''}'].firstWhere((x) => x.isNotEmpty, orElse: () => '—');
    final ds = '${t['deliveryStatementNumber'] ?? ''}'.isNotEmpty ? '${t['deliveryStatementNumber']}' : '${t['purchaseDeliveryStatementNumber'] ?? ''}';
    final meta = [
      if (_mode == 'range') '${t['date'] ?? ''}',
      walletTime(t['createdAt']),
      walletUserName(t['user']),
      _typeLabel(t['type']),
      if (ds.isNotEmpty) ds,
      if ('${t['reference'] ?? ''}'.isNotEmpty) '${tr('مرجع', 'Ref')} ${t['reference']}',
      if ('${t['purchaseReceiptNumber'] ?? ''}'.isNotEmpty) '${tr('سند', 'Rcpt')} ${t['purchaseReceiptNumber']}',
    ].where((x) => x.isNotEmpty).join(' · ');
    final op = [_op(t, 'client'), [_op(t, 'from'), _op(t, 'to')].where((x) => x.isNotEmpty).join(' ← '), _op(t, 'carType'), _op(t, 'length'), _op(t, 'carNumber'),
      if (t['operationDetails'] is Map) walletDateGb(t['operationDetails']['reportDate'])].where((x) => x.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(who, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
              if (t['isFlagged'] == true) const Padding(padding: EdgeInsetsDirectional.only(start: 4), child: Icon(Icons.warning_amber_rounded, size: 13, color: T.danger)),
            ]),
            Text(meta, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            if (op.isNotEmpty) Text(op, style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
            if ('${t['notes'] ?? ''}'.isNotEmpty) Text('${t['notes']}', style: const TextStyle(fontSize: 10.5, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
          ])),
          Text('${isIn ? '+' : '-'}${walletMoney(t['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: isIn ? T.success : ty.$3 == T.inkFaint ? T.inkFaint : T.danger)),
        ]),
      ),
    );
  }

  Widget _col(String label, String value, Color color) => Expanded(
        child: Column(children: [
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 9.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
          FittedBox(fit: BoxFit.scaleDown, child: Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: color))),
        ]),
      );
}
