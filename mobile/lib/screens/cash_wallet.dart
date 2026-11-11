import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'wallet_common.dart';
import 'ops_loads_board.dart';

/// Daily cash wallet: the branch's daily wallet with collections, expenses and purchases, with transaction entry and day closing, /api/wallet/daily. The counterpart of /system/wallet on the web: a day, period or month, branch selector, edit, delete and move of a transaction, reopening a day, and export. Finance staff hold the same wallet powers as the system admin; mirrors backend/src/config/financeAuthority.js. The server is the guard.
const _financeFullRoles = ['cfo', 'accounting_manager', 'accountant'];
bool _financePowers(String role) => const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(role) || _financeFullRoles.contains(role);

class CashWalletScreen extends StatefulWidget {
  const CashWalletScreen({super.key});
  @override
  State<CashWalletScreen> createState() => _CashWalletScreenState();
}

const _txTypes = {
  'collection': ('تحصيل', 'Collection', T.success, Icons.south_west),
  'expense': ('مصروف', 'Expense', T.danger, Icons.north_east),
  'purchase': ('مشتريات', 'Purchase', T.info, Icons.shopping_bag_outlined),
  // Receiving tax invoices. The button name states the action, not the thing: "tax invoice" reads like issuing or paying a value, but the action is receipt. It is an entry with no amount: it records that the sheets of these invoices are now with the employee, and does not touch the custody balance or day closing.
  'tax_invoice': ('استلام فاتورة ضريبية', 'Tax invoices received', T.inkFaint, Icons.receipt_long_outlined),
};

String _typeLabel(dynamic t) {
  final x = _txTypes[t];
  return x == null ? '${t ?? ''}' : tr(x.$1, x.$2);
}

String _money(dynamic v) => walletMoney(v);

/// Statement, customer and driver: the same columns as the web (statementOf / customerOf / driverOf).
String _statementOf(Map t) => '${t['description'] ?? ''}'.isNotEmpty ? '${t['description']}' : '${t['itemName'] ?? ''}';
String _customerOf(Map t) => t['customer'] is Map ? '${t['customer']['companyName'] ?? ''} (${t['customer']['customerNumber'] ?? ''})' : '';
String _driverOf(Map t) {
  if (t['driver'] is Map && '${t['driver']['name'] ?? ''}'.isNotEmpty) return '${t['driver']['name']}';
  for (final k in ['driverName', 'purchaseDriverName']) {
    if ('${t[k] ?? ''}'.isNotEmpty) return '${t[k]}';
  }
  return '';
}
String _op(Map t, String k) => t['operationDetails'] is Map ? '${t['operationDetails'][k] ?? ''}' : '';

class _CashWalletScreenState extends State<CashWalletScreen> {
  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _transactions = [];
  List<Map<String, dynamic>> _rangeWallets = [];
  bool _loading = true;
  String? _error;
  int _seq = 0; // An older reply does not overwrite a newer one when the branch or date changes.
  /// First day of the ledger, mirroring `config/walletStart.js` on the server. The server is the real blocker and rejects any read or write before this day. This copy blocks nothing; it only avoids offering a date whose selection will be rejected, so the block is not discovered after tapping.
  static final DateTime walletStart = DateTime(2026, 9, 1);

  static DateTime _startOfBook(DateTime d) => d.isBefore(walletStart) ? walletStart : d;

  // A day, a period or a month. Period and month are read-only: a transaction belongs to a day, and closing is a day action.
  String _mode = 'day';
  DateTime _date = _startOfBook(DateTime.now());
  DateTime _from = _startOfBook(DateTime.now());
  DateTime _to = DateTime.now();
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  // Branch selector for users not locked to their branch (only an operations employee is locked).
  List<Map<String, dynamic>> _branches = [];
  String _branchId = '';
  int _branchUsers = 0;

  // Local filtering of the displayed transactions (like the web column filters).
  String _typeFilter = '';
  String _q = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _q after loading (the field is inside the "after loading" branch).

  late final void Function() _onLive;
  static const _events = ['wallet:transaction', 'wallet:transactionDeleted', 'wallet:dayClosed', 'wallet:dayReopened'];

  String get _dateKey => walletDayKey(_date);

  AuthProvider get _auth => context.read<AuthProvider>();
  String get _role => _auth.role;
  bool get _superPowers => _auth.user?['superAdminPowers'] == true;
  /// System admin and finance staff: edit, delete, move and reopen (hasFinancePowers).
  bool get _finance => _financePowers(_role) || _superPowers;
  bool get _isManager => const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', ..._financeFullRoles].contains(_role)
      || _auth.canEditSection('Operations');
  // View only: the supervisor and the collections section; the server rejects their writes by role.
  bool get _readOnly => const ['moderator', 'collections_manager', 'collections_staff', 'collections_trainee'].contains(_role);
  /// Writing into a closed day is a financial authority; role-only as on the server (`mayWriteIntoClosedDay`).
  bool get _canWriteClosedDay => const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', ..._financeFullRoles].contains(_role) || _superPowers;
  bool get _canSelectBranch => _role.isNotEmpty && _role != 'operations_staff';

  @override
  void initState() {
    super.initState();
    _onLive = () => _load(spinner: false);
    for (final e in _events) {
      Live.instance.on(e, _onLive);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _init());
  }

  @override
  void dispose() {
    for (final e in _events) {
      Live.instance.off(e, _onLive);
    }
    _searchCtl.dispose();
    super.dispose();
  }

  /// The branch list is read once and serves both purposes: the branch selector and the purchase branch.
  Future<void> _init() async {
    try {
      final d = await Api.instance.get('/api/branches');
      final list = d is Map ? (d['branches'] ?? []) : (d ?? []);
      _branches = List<Map<String, dynamic>>.from((list as List).whereType<Map>().map((m) => Map<String, dynamic>.from(m)));
      if (_canSelectBranch && _branchId.isEmpty && _branches.isNotEmpty) {
        _branchId = '${_branches.first['_id']}';
        _loadBranchUsers();
      }
    } catch (_) { /* The list stays empty. */ }
    await _load();
  }

  /// Branch staff for display only: "who works on this wallet". A failed read is not reported as an error.
  Future<void> _loadBranchUsers() async {
    final id = _branchId;
    try {
      final d = await Api.instance.get('/api/users?branch=$id');
      final list = (d is Map ? d['users'] : d) as List? ?? const [];
      final n = list.whereType<Map>().where((u) => const ['operations_staff', 'operations_manager', 'operations_team_leader'].contains(u['role'])).length;
      if (mounted && id == _branchId) setState(() => _branchUsers = n);
    } catch (_) {
      if (mounted) setState(() => _branchUsers = 0);
    }
  }

  String get _branchQ => _canSelectBranch && _branchId.isNotEmpty ? '&branchId=$_branchId' : '';

  (String, String) _rangeBounds() {
    if (_mode == 'month') {
      var end = walletMonthEnd(_month);
      final cap = walletDayKey(DateTime.now().add(const Duration(days: 1)));
      // The current month ends at the ledger limit, not on its last day.
      if (!_finance && end.compareTo(cap) > 0) end = cap;
      return ('${walletMonthKey(_month)}-01', end);
    }
    return (walletDayKey(_from), walletDayKey(_to));
  }

  Future<void> _load({bool spinner = true}) async {
    if (_canSelectBranch && _branchId.isEmpty) {
      if (mounted) setState(() { _loading = false; _wallet = null; _transactions = []; });
      return;
    }
    final my = ++_seq;
    if (spinner && mounted) setState(() => _loading = true);
    try {
      if (_mode == 'day') {
        final d = await Api.instance.get('/api/wallet/daily?date=$_dateKey$_branchQ');
        if (!mounted || my != _seq) return;
        setState(() {
          _wallet = d['wallet'] is Map ? Map<String, dynamic>.from(d['wallet']) : null;
          _transactions = List<Map<String, dynamic>>.from(d['transactions'] ?? []);
          _rangeWallets = [];
          _loading = false;
          _error = null;
        });
      } else {
        final (f, t) = _rangeBounds();
        final d = await Api.instance.get('/api/wallet/range?dateFrom=$f&dateTo=$t$_branchQ');
        if (!mounted || my != _seq) return;
        setState(() {
          _wallet = null;
          _rangeWallets = List<Map<String, dynamic>>.from(d['wallets'] ?? []);
          _transactions = List<Map<String, dynamic>>.from(d['transactions'] ?? []);
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (!mounted || my != _seq) return;
      final msg = e.toString();
      setState(() {
        _loading = false;
        _wallet = null;
        _transactions = [];
        _error = msg.contains('branch')
            ? tr('لم يتم تعيين فرع لهذا المستخدم. يرجى تعيين فرع من إعدادات المستخدمين.', 'No branch assigned to this user. Please assign a branch in User Settings.')
            : msg;
      });
    }
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  // Move a transaction to another branch or day, for finance staff. Like "move" on the web. Both daily records are recomputed and their balances roll forward on the server; see `moveTransaction`.
  Future<void> _moveTransaction(Map<String, dynamic> t) async {
    final fromBranch = (t['branch'] ?? '').toString();
    final fromDate = (t['date'] ?? _dateKey).toString();
    String toBranch = fromBranch;
    String toDate = fromDate;
    bool busy = false;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('نقل الحركة', 'Move transaction'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text('${_typeLabel(t['type'])} · ${_money(t['amount'])} · $fromDate',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 14),
            if (_branches.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: _branches.any((b) => b['_id'] == toBranch) ? toBranch : null,
                decoration: InputDecoration(labelText: tr('الفرع', 'Branch'), border: const OutlineInputBorder(), isDense: true),
                items: _branches.map((b) => DropdownMenuItem(value: '${b['_id']}', child: Text((b['name'] ?? '').toString(), style: const TextStyle(fontSize: 13)))).toList(),
                onChanged: (v) => setS(() => toBranch = v ?? toBranch),
              ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () async {
                final d = DateTime.tryParse(toDate) ?? DateTime.now();
                final v = await showDatePicker(context: c, initialDate: d, firstDate: DateTime(2020), lastDate: DateTime(2100));
                if (v != null) setS(() => toDate = walletDayKey(v));
              },
              icon: const Icon(Icons.event, size: 17),
              label: Text('${tr('التاريخ', 'Date')}: $toDate', style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 10),
            Text(
              tr('غيّر الفرعَ أو التاريخَ أو كليهما. تُعاد اليوميّتان وتتدحرج الأرصدةُ على أيّامهما التالية، ويُقيَّد النقلُ في سجلّ المراجعة.',
                 'Change the branch, the date, or both. Both days are recalculated and their later days roll forward. The move is written to the audit log.'),
              style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: busy || (toBranch == fromBranch && toDate == fromDate) ? null : () async {
                  setS(() => busy = true);
                  try {
                    final r = await Api.instance.patch('/api/wallet/transactions/${t['_id']}/move', {'branch': toBranch, 'date': toDate});
                    if (c.mounted) Navigator.pop(c);
                    _snack((r is Map ? r['message'] : null)?.toString() ?? tr('نُقلت الحركة', 'Moved'));
                    await _load(spinner: false);
                  } catch (e) {
                    setS(() => busy = false);
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                icon: busy
                    ? const SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.swap_horiz, size: 17),
                label: Text(tr('نقل', 'Move')),
              ),
            ),
          ]),
        ),
      )),
    );
  }

  // Edit a recorded transaction, for finance staff only (maySettle on the server)
  Future<void> _editTransaction(Map<String, dynamic> t) async {
    final type = '${t['type']}';
    final amount = TextEditingController(text: '${t['amount'] ?? ''}');
    final notes = TextEditingController(text: '${t['notes'] ?? ''}');
    final itemName = TextEditingController(text: '${t['itemName'] ?? ''}');
    final ds = TextEditingController(text: '${t['deliveryStatementNumber'] ?? ''}');
    final desc = TextEditingController(text: '${t['description'] ?? ''}');
    final pds = TextEditingController(text: '${t['purchaseDeliveryStatementNumber'] ?? ''}');
    final pDriver = TextEditingController(text: '${t['purchaseDriverName'] ?? ''}');
    final pReceipt = TextEditingController(text: '${t['purchaseReceiptNumber'] ?? ''}');
    String pBranch = '${t['purchaseBranch'] ?? ''}';
    // A historical value stays in the list even if it matches no existing branch.
    final branchNames = <String>{if (pBranch.isNotEmpty) pBranch, ..._branches.map((b) => '${b['name'] ?? ''}').where((x) => x.isNotEmpty)}.toList();
    bool busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        Widget f(TextEditingController ctl, String ar, String en, {bool number = false, int lines = 1}) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: TextField(controller: ctl, maxLines: lines,
                  keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
                  decoration: InputDecoration(labelText: tr(ar, en), border: const OutlineInputBorder(), isDense: true)),
            );
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${tr('تعديل المعاملة', 'Edit transaction')} — ${_typeLabel(type)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                f(amount, 'المبلغ (ريال) *', 'Amount (SAR) *', number: true),
                if (type == 'collection') ...[
                  f(ds, 'رقم أمر النقل', 'Delivery statement #'),
                  f(desc, 'البيان', 'Description'),
                ],
                if (type == 'expense') f(itemName, 'الصنف / الوصف', 'Item / description'),
                if (type == 'purchase') ...[
                  f(pds, 'رقم أمر النقل', 'Delivery statement #'),
                  f(pDriver, 'اسم السائق', 'Driver name'),
                  f(pReceipt, 'رقم السند', 'Receipt number'),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DropdownButtonFormField<String>(
                      initialValue: pBranch.isEmpty ? '' : pBranch,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('الفرع', 'Branch'), border: const OutlineInputBorder(), isDense: true),
                      items: [
                        DropdownMenuItem(value: '', child: Text(tr('— اختر الفرع —', '— choose branch —'))),
                        ...branchNames.map((n) => DropdownMenuItem(value: n, child: Text(n))),
                      ],
                      onChanged: (v) => setS(() => pBranch = v ?? ''),
                    ),
                  ),
                ],
                f(notes, 'ملاحظات', 'Notes', lines: 2),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: busy ? null : () async {
                      final n = num.tryParse(amount.text.trim());
                      if (n == null || n <= 0) return;
                      String? v(TextEditingController x) => x.text.trim().isEmpty ? null : x.text.trim();
                      final body = <String, dynamic>{'amount': n, 'notes': v(notes)};
                      if (type == 'expense') body['itemName'] = v(itemName);
                      if (type == 'collection') { body['deliveryStatementNumber'] = v(ds); body['description'] = v(desc); }
                      if (type == 'purchase') {
                        body['purchaseDeliveryStatementNumber'] = v(pds);
                        body['purchaseDriverName'] = v(pDriver);
                        body['purchaseReceiptNumber'] = v(pReceipt);
                        body['purchaseBranch'] = pBranch.isEmpty ? null : pBranch;
                      }
                      body.removeWhere((k, val) => val == null);
                      setS(() => busy = true);
                      try {
                        await Api.instance.put('/api/wallet/transactions/${t['_id']}', body);
                        if (c.mounted) Navigator.pop(c);
                        await _load(spinner: false);
                      } catch (e) {
                        setS(() => busy = false);
                        if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    },
                    child: Text(tr('حفظ التعديلات', 'Save changes')),
                  ),
                ),
              ]),
            ),
          ),
        );
      }),
    );
  }

  Future<bool> _confirm(String msg) async => await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(msg),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
          ],
        ),
      ) == true;

  Future<void> _deleteTransaction(Map<String, dynamic> t) async {
    if (!await _confirm(tr('هل تريد حذف هذه المعاملة؟', 'Delete this transaction?'))) return;
    try {
      await Api.instance.delete('/api/wallet/transactions/${t['_id']}');
      await _load(spinner: false);
    } catch (e) {
      _snack(e.toString());
    }
  }

  // Reopening is for finance staff only: a closed day has become a figure in an approved ledger.
  Future<void> _reopenDay() async {
    final id = _wallet?['_id'];
    if (id == null) return;
    if (!await _confirm(tr('هل تريد إعادة فتح هذا اليوم؟', 'Reopen this day?'))) return;
    try {
      await Api.instance.post('/api/wallet/reopen/$id');
      await _load(spinner: false);
    } catch (e) {
      _snack(e.toString());
    }
  }

  Future<void> _txActions(Map<String, dynamic> t) async {
    final a = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.edit_outlined), title: Text(tr('تعديل', 'Edit')), onTap: () => Navigator.pop(c, 'edit')),
          ListTile(leading: const Icon(Icons.swap_horiz, color: T.info), title: Text(tr('نقل إلى فرع / يوم آخر', 'Move to another branch / day')), onTap: () => Navigator.pop(c, 'move')),
          ListTile(leading: const Icon(Icons.delete_outline, color: T.danger), title: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger)), onTap: () => Navigator.pop(c, 'delete')),
        ]),
      ),
    );
    if (a == 'edit') await _editTransaction(t);
    if (a == 'move') await _moveTransaction(t);
    if (a == 'delete') await _deleteTransaction(t);
  }

  Future<void> _addTransaction() async {
    final type = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: _txTypes.entries.map((e) => ListTile(
          leading: Icon(e.value.$4, color: e.value.$3),
          title: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontWeight: FontWeight.w700)),
          onTap: () => Navigator.pop(c, e.key),
        )).toList()),
      ),
    );
    if (type == null || !mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => _TxForm(type: type, date: _dateKey, branchId: _canSelectBranch ? _branchId : ''),
    );
    if (saved == true) _load(spinner: false);
  }

  /// Clearance sheets in the displayed transactions, sorted and deduplicated. The counterpart of the web button.
  List<String> _reportNumbers(List<Map<String, dynamic>> txs) {
    final out = <String>{};
    for (final t in txs) {
      for (final v in [
        t['deliveryStatementNumber'],
        t['purchaseDeliveryStatementNumber'],
        ...((t['receivedReportNumbers'] as List?) ?? const []),
      ]) {
        final s = (v ?? '').toString().trim();
        if (s.isNotEmpty) out.add(s);
      }
    }
    final list = out.toList();
    list.sort((a, b) {
      final x = int.tryParse(a);
      final y = int.tryParse(b);
      if (x != null && y != null) return x.compareTo(y);
      return a.compareTo(b);
    });
    return list;
  }

  Future<void> _copyReports(List<Map<String, dynamic>> txs) async {
    final nums = _reportNumbers(txs);
    if (nums.isEmpty) {
      _snack(tr('لا أوامر نقل في المعروض', 'No report numbers in view'));
      return;
    }
    await Clipboard.setData(ClipboardData(text: nums.join('\n')));
    _snack('${tr('نُسِخ', 'Copied')} ${nums.length} ${tr('أمر نقل', 'reports')}');
  }

  Future<void> _closeDay() async {
    final w = _wallet ?? {};
    final expected = walletNum(w['closingBalance']);
    final actualCash = TextEditingController();
    final notes = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final a = num.tryParse(actualCash.text.trim());
        final diff = a == null ? 0 : expected - a;
        return AlertDialog(
          title: Text(tr('إغلاق اليوم', 'Close day')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            // The expected balance is for the manager only, as on the web: the employee counts what is in hand and is not handed the figure.
            if (_isManager) ...[
              Text('${tr('الرصيد النقدي المتوقع', 'Expected cash balance')}: ${_money(expected)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
              const SizedBox(height: 10),
            ],
            TextField(controller: actualCash, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setS(() {}),
                decoration: InputDecoration(labelText: tr('النقد الفعلي (ريال) *', 'Cash in hand (SAR) *'))),
            if (a != null && diff != 0) ...[
              const SizedBox(height: 8),
              Text('${diff > 0 ? tr('عجز', 'Deficit') : tr('فائض', 'Surplus')}: ${_money(diff.abs())}',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: diff > 0 ? T.danger : T.success)),
            ],
            const SizedBox(height: 10),
            TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات (اختياري)', 'Notes (optional)'))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إغلاق اليوم', 'Close day'))),
          ],
        );
      }),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/wallet/close-day', {
        'date': _dateKey,
        if (_canSelectBranch && _branchId.isNotEmpty) 'branchId': _branchId,
        if (actualCash.text.trim().isNotEmpty) 'actualCash': num.tryParse(actualCash.text.trim()),
        'differenceReason': '',
        'differenceNotes': notes.text.trim(),
      });
      // A non-manager moves to tomorrow after closing, as on the web.
      if (!_isManager) {
        setState(() => _date = _date.add(const Duration(days: 1)));
      }
      _load(spinner: false);
    } catch (e) {
      _snack(e.toString());
    }
  }

  // Export: the same columns as the web (walletSummaryColumns / txColumns)
  List<ExportCol> get _summaryCols => [
        ExportCol('الفرع', 'Branch', (r) => r['branch'] is Map ? '${r['branch']['name'] ?? ''}' : ''),
        ExportCol('التاريخ', 'Date', (r) => '${r['date'] ?? ''}'),
        ExportCol('الرصيد الافتتاحي (SAR)', 'Opening (SAR)', (r) => walletNum(r['openingBalance'])),
        ExportCol('التحصيلات (SAR)', 'Collections (SAR)', (r) => walletNum(r['totalCollections'])),
        ExportCol('المصروفات (SAR)', 'Expenses (SAR)', (r) => walletNum(r['totalExpenses'])),
        ExportCol('المشتريات (SAR)', 'Purchases (SAR)', (r) => walletNum(r['totalPurchases'])),
        ExportCol('الرصيد الختامي (SAR)', 'Closing balance (SAR)', (r) => walletNum(r['closingBalance'])),
        ExportCol('الحالة', 'Status', (r) => r['isClosed'] == true ? tr('مغلق', 'Closed') : tr('مفتوح', 'Open')),
        ExportCol('الفعلي (SAR)', 'Actual (SAR)', (r) => r['actualCash'] != null ? walletNum(r['actualCash']) : (r['isClosed'] == true ? 0 : tr('مفتوح', 'Open'))),
        ExportCol('فرق النقد (SAR)', 'Cash Difference (SAR)', (r) => r['cashDifference'] != null ? walletNum(r['cashDifference']) : (r['isClosed'] == true ? 0 : tr('مفتوح', 'Open'))),
      ];

  List<ExportCol> get _txCols => [
        ExportCol('التاريخ', 'Date', (r) => '${r['date'] ?? ''}'),
        ExportCol('الوقت', 'Time', (r) => walletTime(r['createdAt'])),
        ExportCol('النوع', 'Type', (r) => _typeLabel(r['type'])),
        ExportCol('المبلغ (SAR)', 'Amount (SAR)', (r) => r['type'] == 'tax_invoice' ? tr('خارج الرصيد', 'off-balance') : walletNum(r['amount'])),
        ExportCol('البيان', 'Statement', (r) => _statementOf(r)),
        ExportCol('العميل', 'Customer', (r) => _customerOf(r)),
        ExportCol('من الشركة', 'From company', (r) => r['collectionSource'] == 'company' ? tr('نعم', 'Yes') : ''),
        ExportCol('رقم أمر النقل', 'Delivery statement #', (r) => '${r['deliveryStatementNumber'] ?? ''}'.isNotEmpty ? '${r['deliveryStatementNumber']}' : '${r['purchaseDeliveryStatementNumber'] ?? ''}'),
        ExportCol('السند', 'Receipt', (r) => '${r['purchaseReceiptNumber'] ?? ''}'),
        ExportCol('السائق', 'Driver', (r) => _driverOf(r)),
        ExportCol('الفرع', 'Branch', (r) => '${r['purchaseBranch'] ?? ''}'.isNotEmpty ? '${r['purchaseBranch']}' : _op(r, 'branch')),
        ExportCol('العميل (أمر النقل)', 'Client', (r) => _op(r, 'client')),
        ExportCol('من', 'From', (r) => _op(r, 'from')),
        ExportCol('إلى', 'To', (r) => _op(r, 'to')),
        ExportCol('نوع السيارة', 'Car type', (r) => _op(r, 'carType')),
        ExportCol('الطول', 'Length', (r) => _op(r, 'length')),
        ExportCol('رقم السيارة', 'Car number', (r) => _op(r, 'carNumber')),
        ExportCol('تاريخ أمر النقل', 'Report date', (r) => r['operationDetails'] is Map ? walletDateGb(r['operationDetails']['reportDate']) : ''),
        ExportCol('ملاحظات', 'Notes', (r) => '${r['notes'] ?? ''}'),
        ExportCol('سجّلها', 'Recorded by', (r) => walletUserName(r['user'])),
        ExportCol('أوامر نقل الفاتورة الضريبيّة', 'Received reports', (r) {
          final l = (r['receivedReportNumbers'] as List?) ?? const [];
          return (l.isNotEmpty ? l : [r['receivedDocNumber']]).where((x) => '${x ?? ''}'.isNotEmpty).join(' , ');
        }),
        ExportCol('مرجع', 'Reference', (r) => '${r['reference'] ?? ''}'),
        ExportCol('مُعلَّمة', 'Flagged', (r) => r['isFlagged'] == true),
      ];

  String get _shownLabel {
    if (_mode == 'day') return _dateKey;
    if (_mode == 'month') return walletMonthKey(_month);
    return '${walletDayKey(_from)} → ${walletDayKey(_to)}';
  }

  String get _branchName {
    if (_wallet?['branch'] is Map) return '${_wallet!['branch']['name'] ?? ''}';
    final b = _branches.where((b) => '${b['_id']}' == _branchId);
    return b.isEmpty ? '' : '${b.first['name'] ?? ''}';
  }

  Future<void> _export(List<Map<String, dynamic>> shown) async {
    final which = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text('${tr('المعروض', 'Shown')} — $_shownLabel'), onTap: () => Navigator.pop(c, 'shown')),
          ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (which == null || !mounted) return;
    final file = 'Wallet_${_branchName.isEmpty ? 'wallet' : _branchName}_${_shownLabel.replaceAll(RegExp(r'[^0-9A-Za-z-]'), '_')}';
    List<Map<String, dynamic>> wallets;
    List<Map<String, dynamic>> txs;
    if (which == 'shown') {
      wallets = _mode == 'day' ? [if (_wallet != null) _wallet!] : _rangeWallets;
      txs = shown;
    } else {
      try {
        final d = await Api.instance.get('/api/wallet/range?dateFrom=2000-01-01&dateTo=2100-12-31$_branchQ');
        wallets = List<Map<String, dynamic>>.from(d['wallets'] ?? []);
        txs = List<Map<String, dynamic>>.from(d['transactions'] ?? []);
      } catch (e) {
        _snack(e.toString());
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: file, sheets: [
      (tr('ملخّص المحفظة', 'Wallet summary'), _summaryCols, wallets),
      (tr('المحفظة اليومية', 'Daily Wallet'), _txCols, txs),
    ]);
  }

  List<Map<String, dynamic>> get _shownTx {
    final q = _q.trim().toLowerCase();
    return _transactions.where((t) {
      if (_typeFilter.isNotEmpty && t['type'] != _typeFilter) return false;
      if (q.isEmpty) return true;
      final hay = [
        _statementOf(t), _customerOf(t), _driverOf(t), t['deliveryStatementNumber'], t['purchaseDeliveryStatementNumber'],
        t['purchaseReceiptNumber'], t['purchaseBranch'], _op(t, 'client'), _op(t, 'carNumber'), t['notes'], walletUserName(t['user']),
        ...((t['receivedReportNumbers'] as List?) ?? const []),
      ].map((x) => '${x ?? ''}').join(' ').toLowerCase();
      return hay.contains(q);
    }).toList();
  }

  Future<void> _pickDay() async {
    // Tomorrow is allowed because work passes midnight. The system admin and finance staff have no limit.
    final v = await showDatePicker(
        context: context,
        initialDate: _date,
        firstDate: _finance ? DateTime(2020) : walletStart,
        lastDate: _finance ? DateTime(2100) : DateTime.now().add(const Duration(days: 1)));
    if (v != null) { setState(() => _date = v); _load(); }
  }

  Future<void> _pickRange() async {
    final v = await showDateRangePicker(
      context: context,
      initialDateRange: DateTimeRange(start: _from, end: _to.isBefore(_from) ? _from : _to),
      firstDate: _finance ? DateTime(2020) : walletStart,
      lastDate: _finance ? DateTime(2100) : DateTime.now().add(const Duration(days: 1)),
    );
    if (v != null) { setState(() { _from = v.start; _to = v.end; }); _load(); }
  }

  Widget _periodBar() {
    final chips = Row(children: [
      Expanded(child: SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'day', label: Text(tr('يوم', 'Day'))),
          ButtonSegment(value: 'range', label: Text(tr('فترة', 'Period'))),
          ButtonSegment(value: 'month', label: Text(tr('شهر', 'Month'))),
        ],
        selected: {_mode},
        showSelectedIcon: false,
        onSelectionChanged: (s) { setState(() => _mode = s.first); _load(); },
      )),
    ]);
    Widget picker;
    if (_mode == 'day') {
      picker = Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: _pickDay, icon: const Icon(Icons.event, size: 17),
            label: Text(_dateKey, style: const TextStyle(fontWeight: FontWeight.w800)))),
        const SizedBox(width: 6),
        TextButton(onPressed: () { setState(() => _date = _startOfBook(DateTime.now())); _load(); }, child: Text(tr('اليوم', 'Today'))),
      ]);
    } else if (_mode == 'range') {
      picker = Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: _pickRange, icon: const Icon(Icons.date_range, size: 17),
            label: Text('${walletDayKey(_from)} → ${walletDayKey(_to)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)))),
        const SizedBox(width: 6),
        TextButton(onPressed: () {
          final n = DateTime.now();
          setState(() { _from = _startOfBook(DateTime(n.year, n.month, 1)); _to = n; });
          _load();
        }, child: Text(tr('هذا الشهر', 'This month'))),
      ]);
    } else {
      picker = OutlinedButton.icon(
        onPressed: () async {
          final m = await pickWalletMonth(context, _month,
              fromYear: _finance ? 2023 : walletStart.year,
              toYear: _finance ? null : DateTime.now().add(const Duration(days: 1)).year);
          if (m != null) { setState(() => _month = m); _load(); }
        },
        icon: const Icon(Icons.calendar_month, size: 17),
        label: Text(walletMonthLabel(_month), style: const TextStyle(fontWeight: FontWeight.w800)),
      );
    }
    return Column(children: [chips, const SizedBox(height: 8), SizedBox(width: double.infinity, child: picker)]);
  }

  Widget _branchPicker() => DropdownButtonFormField<String>(
        initialValue: _branches.any((b) => '${b['_id']}' == _branchId) ? _branchId : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: tr('الفرع', 'Branch'), border: const OutlineInputBorder(), isDense: true,
            helperText: _branchUsers > 0 ? tr('$_branchUsers موظفًا على هذه المحفظة', '$_branchUsers staff on this wallet') : null),
        items: _branches.map((b) => DropdownMenuItem(value: '${b['_id']}', child: Text('${b['name'] ?? ''}'))).toList(),
        onChanged: (v) {
          if (v == null || v == _branchId) return;
          setState(() { _branchId = v; _branchUsers = 0; _wallet = null; _transactions = []; });
          _loadBranchUsers();
          _load();
        },
      );

  @override
  Widget build(BuildContext context) {
    final w = _wallet;
    final closed = w?['isClosed'] == true;
    final shown = _shownTx;
    final canAdd = !_readOnly && _mode == 'day' && w != null && (!closed || _canWriteClosedDay);
    final canFix = _mode == 'day' && w != null && _finance;

    return AppScaffold(
      title: Text(tr('المحفظة اليومية', 'Daily Wallet')),
      actions: [
        // Staff move between the wallet and the loads board all day.
        if (canOpenOpsBoard(context.watch<AuthProvider>()))
          IconButton(
            tooltip: tr('متابعة الحمولات والشحنات', 'Loads & Shipments'),
            icon: const Icon(Icons.local_shipping_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OpsLoadsBoardScreen())),
          ),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: () => _export(shown)),
      ],
      floatingActionButton: canAdd
          ? FloatingActionButton.extended(onPressed: _addTransaction, icon: const Icon(Icons.add), label: Text(tr('حركة', 'Entry')))
          : null,
      body: RefreshIndicator(
        onRefresh: () => _load(spinner: false),
        child: ListView(padding: EdgeInsets.fromLTRB(14, 14, 14, canAdd ? 96 : 14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          if (_canSelectBranch && _branches.isNotEmpty) ...[_branchPicker(), const SizedBox(height: 10)],
          _periodBar(),
          const SizedBox(height: 12),
          if (_loading)
            ...const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]
          else if (_error != null)
            ErrorRetry(message: _error!, onRetry: () => _load())
          else ...[
            if (_mode == 'day' && w == null)
              EmptyState(icon: Icons.account_balance_wallet_outlined,
                  title: _canSelectBranch ? tr('اختر الفرع', 'Select a branch') : tr('لا يوجد فرع لحسابك', 'No branch on your account'),
                  subtitle: _canSelectBranch ? null : tr('تواصل مع الإدارة', 'Contact the administrator')),
            if (w != null) ..._dayCards(w, closed),
            if (_mode != 'day') _rangeCards(),
            const SizedBox(height: 14),
            Row(children: [
              Text('${tr('الحركات', 'Transactions')} (${shown.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const Spacer(),
              // Displayed sheets are copied in one tap, the counterpart of the web button.
              if (shown.isNotEmpty)
                TextButton.icon(
                  onPressed: () => _copyReports(shown),
                  icon: const Icon(Icons.copy_all_outlined, size: 16),
                  label: Text('${tr('نسخ أوامر النقل', 'Copy reports')} (${_reportNumbers(shown).length})',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ),
            ]),
            const SizedBox(height: 6),
            SearchField(
              controller: _searchCtl,
              dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('ابحث: كشف، عميل، سائق، سند…', 'Search: report, customer, driver, receipt…'),
            ),
            const SizedBox(height: 6),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(label: Text(tr('الكل', 'All')), selected: _typeFilter.isEmpty, onSelected: (_) => setState(() => _typeFilter = ''))),
                ..._txTypes.entries.map((e) => Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: ChoiceChip(
                        label: Text('${tr(e.value.$1, e.value.$2)} (${_transactions.where((t) => t['type'] == e.key).length})'),
                        selected: _typeFilter == e.key,
                        onSelected: (_) => setState(() => _typeFilter = _typeFilter == e.key ? '' : e.key),
                      ),
                    )),
              ]),
            ),
            const SizedBox(height: 8),
            if (shown.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد حركات', 'No transactions')),
            ...shown.map((t) => _txRow(t, canFix)),
            const SizedBox(height: 80),
          ],
        ]),
      ),
    );
  }

  List<Widget> _dayCards(Map<String, dynamic> w, bool closed) {
    final diff = walletNum(w['cashDifference']);
    return [
      FadeSlideIn(
        child: AppCard(
          topAccent: closed ? T.inkFaint : T.navy,
          child: Column(children: [
            Row(children: [
              Expanded(child: Text(_branchName, style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w700))),
              Chip2(closed ? tr('مُغلق', 'Closed') : tr('مفتوح', 'Open'), closed ? T.danger : T.success),
            ]),
            const SizedBox(height: 6),
            Text(tr('الرصيد الختامي', 'Closing balance'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${_money(w['closingBalance'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: T.orange)),
            const SizedBox(height: 12),
            Row(children: [
              _sumCol(tr('افتتاحي', 'Opening'), _money(w['openingBalance']), T.ink),
              _sumCol(tr('تحصيلات', 'Collections'), '+${_money(w['totalCollections'])}', T.success),
              _sumCol(tr('مصروفات', 'Expenses'), '-${_money(w['totalExpenses'])}', T.danger),
              _sumCol(tr('مشتريات', 'Purchases'), '-${_money(w['totalPurchases'])}', T.info),
            ]),
          ]),
        ),
      ),
      // Counting difference: manager only, as on the web.
      if (_isManager && closed && w['cashDifference'] != null && diff != 0) ...[
        const SizedBox(height: 10),
        AppCard(
          topAccent: diff > 0 ? T.danger : T.success,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${diff > 0 ? tr('عجز', 'Deficit') : tr('فائض', 'Surplus')}: ${_money(diff.abs())}',
                style: TextStyle(fontWeight: FontWeight.w800, color: diff > 0 ? T.danger : T.success)),
            const SizedBox(height: 2),
            Text('${tr('المتوقع', 'Expected')}: ${_money(w['closingBalance'])} | ${tr('الفعلي', 'Actual')}: ${_money(w['actualCash'] ?? 0)}'
                '${'${w['differenceReason'] ?? ''}'.isNotEmpty ? ' | ${tr('السبب', 'Reason')}: ${w['differenceReason']}' : ''}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ]),
        ),
      ],
      if (!_readOnly) ...[
        const SizedBox(height: 10),
        // The empty space is explained: whoever closed the day knows why the buttons disappeared.
        if (closed && !_canWriteClosedDay)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.warn.withValues(alpha: .1), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.warn.withValues(alpha: .3))),
            child: Row(children: [
              const Icon(Icons.lock_outline, size: 16, color: T.warn),
              const SizedBox(width: 8),
              Expanded(child: Text(tr('اليوم مُقفل — لا تُسجَّل فيه حركة. اطلب من مدير النظام إعادة فتحه إن كان هناك قيدٌ ناقص.',
                  'The day is closed — no entries can be recorded. Ask a system administrator to reopen it.'),
                  style: const TextStyle(fontSize: 11.5, color: T.ink))),
            ]),
          ),
        if (!closed)
          SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _closeDay, icon: const Icon(Icons.lock_outline, size: 17), label: Text(tr('إغلاق اليوم', 'Close day')))),
        if (closed && _finance) ...[
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: _reopenDay, icon: const Icon(Icons.lock_open, size: 17, color: T.warn), label: Text(tr('إعادة فتح اليوم', 'Reopen day')))),
        ],
      ],
    ];
  }

  /// Period cards; the balance is not summed: it is the opening of the first day and the closing of the last.
  Widget _rangeCards() {
    num s(String k) => _rangeWallets.fold<num>(0, (a, w) => a + walletNum(w[k]));
    final opening = _rangeWallets.isEmpty ? 0 : walletNum(_rangeWallets.first['openingBalance']);
    final closing = _rangeWallets.isEmpty ? 0 : walletNum(_rangeWallets.last['closingBalance']);
    return AppCard(
      child: Column(children: [
        Row(children: [
          _sumCol(tr('عدد الأيام', 'Days'), '${_rangeWallets.length}', T.ink),
          _sumCol(tr('عدد الحركات', 'Transactions'), '${_transactions.length}', T.ink),
          _sumCol(tr('رصيد أول يوم ← آخر يوم', 'Opening → closing'), '${_money(opening)} → ${_money(closing)}', T.orange),
        ]),
        const Divider(height: 18),
        Row(children: [
          _sumCol(tr('إجمالي التحصيل', 'Collections'), _money(s('totalCollections')), T.success),
          _sumCol(tr('إجمالي المصروفات', 'Expenses'), _money(s('totalExpenses')), T.danger),
          _sumCol(tr('إجمالي المشتريات', 'Purchases'), _money(s('totalPurchases')), T.violet),
        ]),
      ]),
    );
  }

  Widget _txRow(Map<String, dynamic> t, bool canFix) {
    final ty = _txTypes[t['type']] ?? ('—', '—', T.inkFaint, Icons.help_outline);
    final isIn = t['type'] == 'collection';
    final customer = t['customer'] is Map ? '${t['customer']['companyName'] ?? ''}' : '';
    final label = customer.isNotEmpty ? customer : _statementOf(t).isNotEmpty ? _statementOf(t) : '${t['vendorName'] ?? ''}';
    final ds = '${t['deliveryStatementNumber'] ?? ''}'.isNotEmpty ? '${t['deliveryStatementNumber']}' : '${t['purchaseDeliveryStatementNumber'] ?? ''}';
    final meta = [
      _typeLabel(t['type']),
      if (_mode != 'day') '${t['date'] ?? ''}',
      walletTime(t['createdAt']),
      if (ds.isNotEmpty) ds,
      if ('${t['purchaseReceiptNumber'] ?? ''}'.isNotEmpty) '${tr('سند', 'Rcpt')} ${t['purchaseReceiptNumber']}',
      if (_driverOf(t).isNotEmpty) _driverOf(t),
      if (walletUserName(t['user']).isNotEmpty) walletUserName(t['user']),
    ].where((x) => x.isNotEmpty).join(' · ');
    final op = t['operationDetails'] is Map ? [_op(t, 'client'), [_op(t, 'from'), _op(t, 'to')].where((x) => x.isNotEmpty).join(' ← '), _op(t, 'carNumber')].where((x) => x.isNotEmpty).join(' · ') : '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: canFix ? () => _txActions(t) : null,
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(children: [
            Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: ty.$3.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)), child: Icon(ty.$4, size: 17, color: ty.$3)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(label.isEmpty ? tr(ty.$1, ty.$2) : label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  if (t['isFlagged'] == true) const Padding(padding: EdgeInsetsDirectional.only(start: 4), child: Icon(Icons.flag, size: 13, color: T.danger)),
                ]),
                Text(meta, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                if (op.isNotEmpty) Text(op, style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
                if ('${t['notes'] ?? ''}'.isNotEmpty) Text('${t['notes']}', style: const TextStyle(fontSize: 10.5, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
                // Received sheets are the whole content of the receipt entry, so they are shown on its line.
                if (t['type'] == 'tax_invoice')
                  Text(
                    ((t['receivedReportNumbers'] as List?)?.isNotEmpty == true
                        ? (t['receivedReportNumbers'] as List).join('، ')
                        : (t['receivedDocNumber'] ?? '').toString()),
                    style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
              ]),
            ),
            if (t['type'] == 'tax_invoice')
              Text(tr('خارج الرصيد', 'off-balance'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: T.inkFaint))
            else
              Text('${isIn ? '+' : '−'}${_money(t['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: ty.$3)),
            if (canFix) ...[
              const SizedBox(width: 4),
              Icon(Icons.more_vert, size: 16, color: T.inkFaint.withValues(alpha: 0.7)),
            ],
          ]),
        ),
      ),
    );
  }

  Widget _sumCol(String label, String value, Color color) => Expanded(
        child: Column(children: [
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 9.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
          FittedBox(fit: BoxFit.scaleDown, child: Text(value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: color))),
        ]),
      );
}

/// Transaction form, the counterpart of the web add dialog, type by type: collection from a customer (by a searched sheet) or from the company (with a statement), an expense with its category, purchases for a sheet that exists and was not bought and cannot be recorded before the voucher is received, and receipt of tax invoices as pairs (sheet and its voucher) with no amount.
class _TxForm extends StatefulWidget {
  final String type;
  final String date;
  final String branchId;
  const _TxForm({required this.type, required this.date, required this.branchId});
  @override
  State<_TxForm> createState() => _TxFormState();
}

class _TxFormState extends State<_TxForm> {
  final _amount = TextEditingController();
  final _notes = TextEditingController();
  final _ds = TextEditingController();
  final _desc = TextEditingController();
  final _item = TextEditingController();
  final _pSearch = TextEditingController();
  final _pDriver = TextEditingController();
  final _pReceipt = TextEditingController();
  final _pBranch = TextEditingController();
  final _rReport = TextEditingController();
  final _rSand = TextEditingController();
  final _mismatchNote = TextEditingController();
  String _source = 'client';
  String _mismatch = '';
  final List<(String, String)> _received = [];
  bool _busy = false;
  String _err = '';

  // Sheet search
  String _collMsg = '';
  bool _collFound = false;
  String _pMsg = '';
  bool _pFound = false;
  String _pReport = '';
  Map? _pAlready;
  (bool, String)? _pBond;
  num? _selling;
  num? _expected;

  static const _statusAr = {
    'requesting': 'قيد الطلب', 'loading': 'جارٍ التحميل', 'uploaded': 'تم التحميل', 'on_way': 'في الطريق', 'arrived': 'وصلت',
    'bond_sent': 'أُرسل السند', 'late': 'متأخرة', 'invoiced': 'تمت الفوترة', 'cancelled': 'ملغاة',
  };

  String get type => widget.type;

  bool get _canSubmit {
    if (type == 'tax_invoice') return _received.isNotEmpty || _rReport.text.trim().isNotEmpty;
    final a = num.tryParse(_amount.text.trim()) ?? 0;
    if (type == 'purchase') return a > 0 && _pFound && _pAlready == null && _pBond?.$1 != false;
    return a > 0;
  }

  Future<void> _lookupCollection() async {
    final q = _ds.text.trim();
    if (q.isEmpty) return;
    setState(() { _collMsg = ''; _collFound = false; });
    try {
      final d = await Api.instance.get('/api/wallet/lookup-report?reportNumber=${Uri.encodeQueryComponent(q)}');
      setState(() { _ds.text = '${d['reportNumber'] ?? q}'; _collFound = true; _collMsg = tr('أمر النقل موجود ✓', 'Report found ✓'); });
    } catch (e) {
      setState(() { _collFound = false; _collMsg = e.toString(); });
    }
  }

  Future<void> _lookupPurchase() async {
    final q = _pSearch.text.trim();
    if (q.isEmpty) return;
    setState(() { _pMsg = ''; _pFound = false; _pAlready = null; _pBond = null; _selling = null; _expected = null; });
    try {
      // The branch decides what a purchase costs: heavy transport pays the truck rent (server, purchaseBasis).
      final branchQs = widget.branchId.isNotEmpty ? '&branchId=${widget.branchId}' : '';
      final d = await Api.instance.get('/api/wallet/lookup-report?reportNumber=${Uri.encodeQueryComponent(q)}$branchQs');
      setState(() {
        _pReport = '${d['reportNumber'] ?? q}';
        _pSearch.text = _pReport;
        if ('${d['driverName'] ?? ''}'.isNotEmpty) _pDriver.text = '${d['driverName']}';
        if ('${d['branch'] ?? ''}'.isNotEmpty) _pBranch.text = '${d['branch']}';
        final pv = walletNum(d['purchaseValue']);
        if (_amount.text.trim().isEmpty && pv > 0) _amount.text = '$pv';
        _selling = walletNum(d['sellingValue']) > 0 ? walletNum(d['sellingValue']) : null;
        _expected = d['purchaseValue'] != null ? pv : null;
        _pFound = true;
        _pAlready = d['alreadyPurchased'] is Map ? d['alreadyPurchased'] as Map : null;
        _pBond = (d['bondReceived'] == true, '${d['applicationStatus'] ?? ''}');
        _pMsg = '${d['heavy'] == true ? tr('الإيجار', 'Rent') : tr('سعر الشراء', 'Purchase price')}: ${walletMoney(pv)}';
      });
    } catch (e) {
      setState(() { _pFound = false; _pMsg = e.toString(); });
    }
  }

  void _addReceived() {
    final r = _rReport.text.trim();
    if (r.isEmpty || _received.any((x) => x.$1 == r)) return;
    setState(() { _received.add((r, _rSand.text.trim())); _rReport.clear(); _rSand.clear(); });
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() { _busy = true; _err = ''; });
    final body = <String, dynamic>{
      'date': widget.date,
      'type': type,
      'amount': num.tryParse(_amount.text.trim()) ?? 0,
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      if (widget.branchId.isNotEmpty) 'branchId': widget.branchId,
    };
    // Whatever remains in the input and was not added still counts: someone who typed it and pressed Record meant to add it.
    final pairs = [..._received];
    final pending = _rReport.text.trim();
    if (pending.isNotEmpty && !pairs.any((x) => x.$1 == pending)) pairs.add((pending, _rSand.text.trim()));
    if (type == 'purchase' && _expected != null && ((num.tryParse(_amount.text.trim()) ?? 0) - _expected!).abs() > 0.009) {
      if (_mismatch.isEmpty) { setState(() { _busy = false; _err = tr('اختر سبب اختلاف المبلغ', 'Select a reason for the amount difference'); }); return; }
      if (_mismatch == 'other' && _mismatchNote.text.trim().isEmpty) { setState(() { _busy = false; _err = tr('اكتب سبب الاختلاف', 'Write the reason for the difference'); }); return; }
      body['mismatchReason'] = _mismatch;
      if (_mismatch == 'other') body['mismatchNote'] = _mismatchNote.text.trim();
    }
    if (type == 'collection') {
      body['collectionSource'] = _source;
      if (_source == 'client' && _ds.text.trim().isNotEmpty) body['deliveryStatementNumber'] = _ds.text.trim();
      if (_source == 'company' && _desc.text.trim().isNotEmpty) body['description'] = _desc.text.trim();
    }
    if (type == 'expense' && _item.text.trim().isNotEmpty) body['itemName'] = _item.text.trim();
    if (type == 'tax_invoice') {
      body['amount'] = 0;
      body['receivedReports'] = pairs.map((p) => {'reportNumber': p.$1, 'documentNumber': p.$2}).toList();
    }
    if (type == 'purchase') {
      for (final (k, c) in [('purchaseDeliveryStatementNumber', _pSearch), ('purchaseDriverName', _pDriver), ('purchaseReceiptNumber', _pReceipt), ('purchaseBranch', _pBranch)]) {
        if (c.text.trim().isNotEmpty) body[k] = c.text.trim();
      }
    }
    try {
      final res = await Api.instance.post('/api/wallet/transactions', body);
      final unknown = (res is Map ? res['unknownReports'] : null) as List?;
      if (!mounted) return;
      if (unknown != null && unknown.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
            tr('حُفظ القيد — ولم نجد أوامر نقل بهذه الأرقام: ', 'Saved — but no reports found for: ') + unknown.join('، '))));
      }
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  Widget _field(TextEditingController c, String ar, String en, {bool number = false, bool readOnly = false, int lines = 1, Widget? suffix, VoidCallback? onSubmit}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          controller: c, readOnly: readOnly, maxLines: lines,
          keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
          onChanged: (_) => setState(() {}),
          onSubmitted: onSubmit == null ? null : (_) => onSubmit(),
          decoration: InputDecoration(labelText: tr(ar, en), border: const OutlineInputBorder(), isDense: true, suffixIcon: suffix,
              filled: readOnly, fillColor: readOnly ? T.canvas : null),
        ),
      );

  Widget _msg(String m, bool ok) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(m, style: TextStyle(fontSize: 11.5, color: ok ? T.success : T.danger, fontWeight: FontWeight.w600)),
      );

  @override
  Widget build(BuildContext context) {
    final ty = _txTypes[type]!;
    final amountN = num.tryParse(_amount.text.trim());
    final differs = type == 'purchase' && _expected != null && amountN != null && (amountN - _expected!).abs() > 0.009;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(ty.$4, color: ty.$3),
              const SizedBox(width: 8),
              Text('${tr('إضافة', 'Add')} ${tr(ty.$1, ty.$2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const Spacer(),
              Text(widget.date, style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ]),
            const SizedBox(height: 12),
            if (type == 'purchase') ...[
              _field(_pSearch, 'رقم أمر النقل *', 'Delivery statement # *', onSubmit: _lookupPurchase,
                  suffix: IconButton(icon: const Icon(Icons.search), onPressed: _lookupPurchase)),
              if (_pBond != null && !_pBond!.$1)
                _msg(tr('لا تُسجَّل مشتريات قبل استلام السند — ${_pBond!.$2.isEmpty ? 'الحالة غير محدَّدة' : 'حالتُه الآن: ${_statusAr[_pBond!.$2] ?? _pBond!.$2}'}',
                        'No purchase before the bond is received — current status: ${_pBond!.$2.isEmpty ? 'unknown' : _pBond!.$2}'), false),
              if (_pAlready != null)
                _msg(tr('سُجّلت مشترياتٌ لهذا أمر النقل من قبل: ${walletMoney(_pAlready!['amount'])} ريال بتاريخ ${_pAlready!['date'] ?? ''}'
                        '${'${_pAlready!['branch'] ?? ''}'.isNotEmpty ? ' — من عهدة ${_pAlready!['branch']}' : ''}'
                        '${'${_pAlready!['by'] ?? ''}'.isNotEmpty ? ' — بواسطة ${_pAlready!['by']}' : ''}'
                        '${'${_pAlready!['receipt'] ?? ''}'.isNotEmpty ? ' — سند ${_pAlready!['receipt']}' : ''}',
                        'Already purchased: ${walletMoney(_pAlready!['amount'])} SAR on ${_pAlready!['date'] ?? ''}'), false),
              if (_pMsg.isNotEmpty && _pAlready == null) _msg(_pMsg, _pFound),
              if (_selling != null) _msg('${tr('سعر البيع', 'Selling Price')}: ${walletMoney(_selling)}', true),
            ],
            if (type != 'tax_invoice') ...[
              _field(_amount, 'المبلغ (ريال) *', 'Amount (SAR) *', number: true),
              if (type == 'purchase' && _expected != null && amountN != null)
                differs
                    ? _msg('⚠ ${tr('المبلغ مختلف عن سعر الشراء', 'Amount differs from the purchase price')} (${walletMoney(_expected)})', false)
                    : _msg('✓ ${tr('المبلغ مطابق لسعر الشراء', 'Amount matches the purchase price')} (${walletMoney(_expected)})', true),
              if (differs) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: DropdownButtonFormField<String>(
                    initialValue: _mismatch,
                    decoration: InputDecoration(labelText: tr('سبب الاختلاف *', 'Reason for the difference *'), border: const OutlineInputBorder(), isDense: true),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('—')),
                      DropdownMenuItem(value: 'daily', child: Text(tr('يومية', 'Daily'))),
                      DropdownMenuItem(value: 'violation', child: Text(tr('مخالفة', 'Violation'))),
                      DropdownMenuItem(value: 'other', child: Text(tr('أخرى', 'Other'))),
                    ],
                    onChanged: (v) => setState(() => _mismatch = v ?? ''),
                  ),
                ),
                if (_mismatch == 'other') _field(_mismatchNote, 'اكتب سبب الاختلاف', 'Write the reason', lines: 2),
              ],
            ],
            if (type == 'collection') ...[
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'client', label: Text(tr('من العميل', 'From Client'))),
                  ButtonSegment(value: 'company', label: Text(tr('من الشركة', 'From Company'))),
                ],
                selected: {_source},
                onSelectionChanged: (s) => setState(() => _source = s.first),
              ),
              const SizedBox(height: 10),
              if (_source == 'client') ...[
                _field(_ds, 'رقم أمر النقل *', 'Delivery statement # *', onSubmit: _lookupCollection,
                    suffix: IconButton(icon: const Icon(Icons.search), onPressed: _lookupCollection)),
                if (_collMsg.isNotEmpty) _msg(_collMsg, _collFound),
              ] else
                _field(_desc, 'البيان *', 'Description *'),
            ],
            if (type == 'expense') _field(_item, 'البيان *', 'Description *'),
            if (type == 'purchase') ...[
              _field(_pDriver, 'اسم السائق', 'Driver name', readOnly: _pFound),
              _field(_pReceipt, 'رقم السند — يُكتب في أمر النقل تلقائيًّا', 'Receipt number — written onto the report'),
              _field(_pBranch, 'الفرع', 'Branch', readOnly: _pFound),
              if (_pFound)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(tr('اسم السائق والفرع مأخوذان من أمر النقل ولا يُعدَّلان — إن كانا خطأً فالتصحيح في أمر النقل نفسه.',
                      'Driver and branch come from the dispatch sheet and cannot be edited — correct them on the sheet itself.'),
                      style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                ),
            ],
            if (type == 'tax_invoice') ...[
              Container(
                padding: const EdgeInsets.all(10),
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: .08), borderRadius: BorderRadius.circular(8)),
                child: Text(
                  tr('تسجيلُ استلام — تقول به إنّ أوامر نقل هذه الفواتير صارت بيدك. لا مبلغَ فيه، ولا يدخل رصيدَ العهدة ولا إقفالَ اليوم.',
                     'A receipt record — these reports are now in your hands. No amount, and it does not touch the wallet balance or the day’s close.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ),
              // Each sheet has its voucher; they are written together so they are saved as a pair.
              Row(children: [
                Expanded(child: _field(_rReport, 'رقم أمر النقل', 'Report number', onSubmit: _addReceived)),
                const SizedBox(width: 6),
                Expanded(child: _field(_rSand, 'رقم السند (اختياري)', 'Voucher no (optional)', onSubmit: _addReceived)),
                const SizedBox(width: 6),
                Padding(padding: const EdgeInsets.only(bottom: 10), child: FilledButton(onPressed: _addReceived, child: Text(tr('إضافة', 'Add')))),
              ]),
              if (_received.isNotEmpty)
                Wrap(spacing: 6, runSpacing: 6, children: _received.map((r) => Chip(
                  label: Text('${r.$1} · ${r.$2.isEmpty ? tr('بلا سند', 'no vch') : '${tr('سند', 'vch')} ${r.$2}'}', style: const TextStyle(fontSize: 11.5)),
                  onDeleted: () => setState(() => _received.remove(r)),
                )).toList()),
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 10),
                child: Text(_received.isNotEmpty
                    ? tr('${_received.length} أمر نقل في هذا القيد', '${_received.length} reports in this record')
                    : tr('يمكنك إضافة أكثر من أمر نقل في القيد الواحد — ولكل أمر نقل رقم سنده', 'Add more than one report — each with its own voucher number'),
                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ),
            ],
            _field(_notes, 'ملاحظات', 'Notes', lines: 2),
            if (_err.isNotEmpty) _msg(_err, false),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy || !_canSubmit ? null : _submit,
                child: _busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text('${tr('إضافة', 'Add')} ${tr(ty.$1, ty.$2)}'),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
