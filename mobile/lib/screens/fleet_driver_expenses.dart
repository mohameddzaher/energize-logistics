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
import '../ui/stat_grid.dart';
import '../ui/vehicle_month_log.dart' show monthKeyNow;
import '../ui/search_field.dart';

/// Driver expenses: what is owed to the man on each load, and whether it was paid out.
/// Same as the web page: the amount is the driver expense written when the load was created (Friday bonus included), and the IBAN comes from the driver file. The paid mark separates owed-and-unpaid from paid so nothing is paid twice.
class FleetDriverExpensesScreen extends StatefulWidget {
  const FleetDriverExpensesScreen({super.key});
  @override
  State<FleetDriverExpensesScreen> createState() => _FleetDriverExpensesScreenState();
}

// Paying money: for Finance and the fleet manager by their roles (= PAY_ROLES on the web and EXPENSE_PAY_ROLES on the server).
const _payRoles = {
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager',
  'accountant', 'fleet_manager', 'operations_manager',
};

String _ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class _FleetDriverExpensesScreenState extends State<FleetDriverExpensesScreen> {
  // Period: month (default), day, range, all, as on the web.
  String _mode = 'month';
  String _month = monthKeyNow();
  String _day = _ymd(DateTime.now());
  String _from = '${monthKeyNow()}-01';
  String _to = _ymd(DateTime.now());
  String _paid = ''; // '' | '0' | '1'
  String _search = '';
  final _searchCtrl = TextEditingController();
  Timer? _deb;

  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic>? _summary;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  final Set<String> _picked = {};

  // Only the latest is shown: each search character is a request, and an old reply does not overwrite a new one.
  int _seq = 0;

  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // Payment is announced by fleet:driverExpense, and saving or deleting a load by fleet:updated.
    _onLive = () => _load();
    Live.instance.on('fleet:driverExpense', _onLive);
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:driverExpense', _onLive);
    Live.instance.off('fleet:updated', _onLive);
    _deb?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  String get _qs {
    final p = <String, String>{};
    if (_mode == 'day') { p['from'] = _day; p['to'] = _day; }
    else if (_mode == 'range') { p['from'] = _from; p['to'] = _to; }
    else if (_mode == 'month') { p['month'] = _month; }
    if (_paid.isNotEmpty) p['paid'] = _paid;
    if (_search.trim().isNotEmpty) p['search'] = _search.trim();
    return Uri(queryParameters: p).query;
  }

  Future<void> _load() async {
    final mine = ++_seq;
    if (mounted) setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/fleet/driver-expenses?$_qs');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(
            ((d as Map)['rows'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _summary = d['summary'] is Map ? Map<String, dynamic>.from(d['summary'] as Map) : null;
        _picked.clear();
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      // A failure is reported, not shown as an empty list.
      setState(() {
        _rows = [];
        _summary = null;
        _error = e is ApiException ? e.message : tr('تعذّر تحميل المصروفات', 'Failed to load the expenses');
        _loading = false;
      });
    }
  }

  void _set(VoidCallback f) { setState(f); _load(); }

  void _onSearch(String v) {
    _deb?.cancel();
    _deb = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      _search = v;
      _load();
    });
  }

  Future<void> _pickDate(String current, void Function(String) apply, {DateTime? first, DateTime? last}) async {
    final init = DateTime.tryParse(current) ?? DateTime.now();
    final v = await showDatePicker(
      context: context,
      initialDate: init,
      firstDate: first ?? DateTime(2020),
      lastDate: last ?? DateTime(2100),
    );
    if (v != null) _set(() => apply(_ymd(v)));
  }

  String _shiftMonth(String mk, int by) {
    final p = mk.split('-');
    final d = DateTime.utc(int.parse(p[0]), int.parse(p[1]) + by, 1);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}';
  }

  Future<bool> _confirm(String msg) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(msg),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _setPaidFor(List<String> ids, bool value) async {
    if (ids.isEmpty || _busy) return;
    // A touch is easier to mistake than a mouse, so confirmation applies to every mark, not only the bulk one.
    final n = ids.length;
    final msg = value
        ? (n > 1 ? tr('تعليم $n صفًّا كمسدَّد؟', 'Mark $n rows as paid?') : tr('تعليم هذا الصفّ كمسدَّد؟', 'Mark this row as paid?'))
        : (n > 1 ? tr('رفع السداد عن $n صفًّا؟', 'Unmark $n rows?') : tr('رفع السداد عن هذا الصفّ؟', 'Unmark this row?'));
    if (!await _confirm(msg)) return;
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      await Api.instance.patch('/api/fleet/driver-expenses/paid', {'ids': ids, 'paid': value});
      if (!mounted) return;
      // Update locally, then fetch: the mark is seen immediately.
      setState(() {
        for (final r in _rows) {
          if (ids.contains(r['_id'].toString())) r['driverExpensePaid'] = value;
        }
      });
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Failed')),
        ));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  String _money(dynamic v) {
    final x = _n(v);
    final s = (x == x.roundToDouble() ? x.toStringAsFixed(0) : x.toStringAsFixed(2));
    final parts = s.split('.');
    final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
    return parts.length > 1 ? '$whole.${parts[1].replaceFirst(RegExp(r'0+$'), '')}'.replaceFirst(RegExp(r'\.$'), '') : whole;
  }

  String _dt(dynamic v) {
    final d = DateTime.tryParse(v?.toString() ?? '');
    if (d == null) return '—';
    final l = d.toLocal();
    return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year}';
  }

  @override
  Widget build(BuildContext context) {
    final canPay = _payRoles.contains(context.watch<AuthProvider>().role);
    final s = _summary ?? const {};
    final loads = _n(s['loads']);
    final paidLoads = _n(s['paidLoads']);
    final pickedUnpaid = _rows.where((r) => _picked.contains(r['_id'].toString()) && r['driverExpensePaid'] != true)
        .map((r) => r['_id'].toString()).toList();
    final pickedPaid = _rows.where((r) => _picked.contains(r['_id'].toString()) && r['driverExpensePaid'] == true)
        .map((r) => r['_id'].toString()).toList();
    final allPicked = _rows.isNotEmpty && _picked.length == _rows.length;

    return AppScaffold(
      title: Text(tr('مصاريف السوّاق', 'Driver expenses')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          Text(
            tr('المبلغ هو مصروف السائق المكتوب وقت إنشاء الحمولة، والإيبان من ملفّ السائق.',
                'The amount is the driver expense entered when the load was created; the IBAN comes from the driver’s profile.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
          ),
          const SizedBox(height: 10),

          // Cards: over everything matching, not over what is displayed.
          StatGrid(
            spacing: 10,
            children: [
              _Kpi(tr('عدد الحمولات', 'Loads'), '${loads.toInt()}', T.navy, Icons.calendar_month_outlined),
              _Kpi(tr('عدد السوّاق', 'Drivers'), '${_n(s['driverCount']).toInt()}', T.navy, Icons.people_outline),
              _Kpi(tr('إجمالي المصاريف', 'Total expenses'), _money(s['total']), T.ink, Icons.payments_outlined),
              _Kpi(tr('تم السداد', 'Paid'), _money(s['paid']), T.success, Icons.check_circle_outline,
                  hint: tr('${paidLoads.toInt()} حمولة', '${paidLoads.toInt()} loads')),
              _Kpi(tr('لم يتم السداد', 'Not paid'), _money(s['unpaid']), T.danger, Icons.schedule,
                  hint: tr('${(loads - paidLoads).toInt()} حمولة', '${(loads - paidLoads).toInt()} loads')),
              _Kpi(tr('بونص الجمعة', 'Friday bonus'), '${_n(s['fridays']).toInt()}', T.violet, Icons.verified_outlined,
                  hint: tr('حمولات عليها بونص', 'loads with bonus')),
            ],
          ),
          const SizedBox(height: 12),

          // Filters.
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SegmentedButton<String>(
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(value: 'month', label: Text(tr('شهر', 'Month'))),
                  ButtonSegment(value: 'day', label: Text(tr('يوم', 'Day'))),
                  ButtonSegment(value: 'range', label: Text(tr('فترة', 'Period'))),
                  ButtonSegment(value: 'all', label: Text(tr('الكل', 'All'))),
                ],
                selected: {_mode},
                onSelectionChanged: (v) => _set(() => _mode = v.first),
              ),
              const SizedBox(height: 8),
              if (_mode == 'month')
                Row(children: [
                  IconButton(
                    icon: const Icon(Icons.chevron_right, color: T.navy),
                    onPressed: () => _set(() => _month = _shiftMonth(_month, -1)),
                  ),
                  Expanded(child: Center(
                    child: Text(_month, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  )),
                  IconButton(
                    icon: const Icon(Icons.chevron_left, color: T.navy),
                    onPressed: () => _set(() => _month = _shiftMonth(_month, 1)),
                  ),
                ]),
              if (_mode == 'day')
                OutlinedButton.icon(
                  onPressed: () => _pickDate(_day, (v) => _day = v),
                  icon: const Icon(Icons.event, size: 17),
                  label: Text('${tr('اليوم', 'Day')}: $_day'),
                ),
              if (_mode == 'range')
                Row(children: [
                  Expanded(child: OutlinedButton(
                    onPressed: () => _pickDate(_from, (v) => _from = v, last: DateTime.tryParse(_to)),
                    child: Text('${tr('من', 'From')} $_from', style: const TextStyle(fontSize: 12.5)),
                  )),
                  const Padding(padding: EdgeInsets.symmetric(horizontal: 6), child: Text('→', style: TextStyle(color: T.inkFaint))),
                  Expanded(child: OutlinedButton(
                    onPressed: () => _pickDate(_to, (v) => _to = v, first: DateTime.tryParse(_from)),
                    child: Text('${tr('إلى', 'To')} $_to', style: const TextStyle(fontSize: 12.5)),
                  )),
                ]),
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [
                for (final p in [
                  ('', tr('كل الحالات', 'All statuses')),
                  ('0', tr('لم يتم السداد', 'Not paid')),
                  ('1', tr('تم السداد', 'Paid')),
                ])
                  ChoiceChip(
                    label: Text(p.$2),
                    selected: _paid == p.$1,
                    onSelected: (_) => _set(() => _paid = p.$1),
                  ),
              ]),
              const SizedBox(height: 8),
              SearchField(
                controller: _searchCtrl, dense: true,
                onChanged: _onSearch,
                hint: tr('أمر نقل أو سائق أو لوحة…', 'Transport order, driver or plate…'),
              ),
            ]),
          ),

          // Bulk marking.
          if (canPay && _rows.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: [
              Checkbox(
                value: allPicked,
                activeColor: T.orange,
                onChanged: (v) => setState(() {
                  _picked.clear();
                  if (v == true) _picked.addAll(_rows.map((r) => r['_id'].toString()));
                }),
              ),
              Text(tr('تحديد الكل', 'Select all'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
              const Spacer(),
              if (pickedUnpaid.isNotEmpty)
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.success, visualDensity: VisualDensity.compact),
                  onPressed: _busy ? null : () => _setPaidFor(pickedUnpaid, true),
                  icon: const Icon(Icons.check_circle_outline, size: 16),
                  label: Text(tr('تم السداد (${pickedUnpaid.length})', 'Mark paid (${pickedUnpaid.length})'),
                      style: const TextStyle(fontSize: 12)),
                ),
              if (pickedPaid.isNotEmpty) ...[
                const SizedBox(width: 6),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                  onPressed: _busy ? null : () => _setPaidFor(pickedPaid, false),
                  child: Text(tr('رفع السداد (${pickedPaid.length})', 'Unmark (${pickedPaid.length})'),
                      style: const TextStyle(fontSize: 12)),
                ),
              ],
            ]),
          ],
          const SizedBox(height: 10),

          if (_error != null && !_loading)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: T.danger.withValues(alpha: 0.07),
                border: Border.all(color: T.danger.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(children: [
                Expanded(child: Text(_error!, style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700, fontSize: 13))),
                TextButton(onPressed: _load, child: Text(tr('إعادة', 'Retry'))),
              ]),
            ),

          if (_loading && _rows.isEmpty)
            ...const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110)]
          else ...[
            if (_loading) const LinearProgressIndicator(minHeight: 2),
            ..._rows.map((r) => _rowCard(r, canPay)),
            if (_rows.isEmpty && _error == null)
              EmptyState(icon: Icons.account_balance_wallet_outlined, title: tr('لا مصاريف في هذا المدى', 'No expenses in this range')),
          ],
          const SizedBox(height: 20),
        ]),
      ),
    );
  }

  Widget _rowCard(Map<String, dynamic> r, bool canPay) {
    final id = r['_id'].toString();
    final paid = r['driverExpensePaid'] == true;
    final iban = (r['driverIban'] ?? '').toString();
    final second = (r['secondDriverName'] ?? '').toString();
    final paidBy = (r['driverExpensePaidByName'] ?? '').toString();
    final picked = _picked.contains(id);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        topAccent: paid ? T.success : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (canPay)
              SizedBox(
                width: 30,
                child: Checkbox(
                  value: picked,
                  activeColor: T.orange,
                  visualDensity: VisualDensity.compact,
                  onChanged: (v) => setState(() { if (v == true) { _picked.add(id); } else { _picked.remove(id); } }),
                ),
              ),
            Text('#${r['waybillNumber'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(width: 8),
            Expanded(
              child: Text((r['vehiclePlate'] ?? '—').toString(),
                  overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            ),
            Text(_money(r['driverExpense']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: T.ink)),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.person_outline, size: 15, color: T.inkFaint),
            const SizedBox(width: 4),
            Flexible(child: Text((r['driverName'] ?? '—').toString(),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: T.ink))),
            if (r['fridayBonus'] == true) ...[
              const SizedBox(width: 6),
              Chip2(tr('جمعة', 'Fri'), T.violet),
            ],
            const Spacer(),
            Text(_dt(r['loadDate']), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ]),
          // The second driver is written if present.
          if (second.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('${tr('السائق الثاني', 'Second driver')}: $second',
                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ),
          const SizedBox(height: 4),
          iban.isNotEmpty
              ? Directionality(
                  textDirection: TextDirection.ltr,
                  child: SelectableText(iban, style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace', color: T.inkSoft)),
                )
              : Text(tr('الإيبان غير مسجَّل في ملفّه', 'IBAN not on file'),
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.warn)),
          const SizedBox(height: 8),
          Row(children: [
            Chip2(paid ? tr('تم السداد', 'Paid') : tr('لم يتم السداد', 'Not paid'), paid ? T.success : T.danger),
            if (paid && paidBy.isNotEmpty) ...[
              const SizedBox(width: 6),
              Expanded(
                child: Text('$paidBy · ${_dt(r['driverExpensePaidAt'])}',
                    overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ),
            ] else
              const Spacer(),
            if (canPay)
              TextButton(
                onPressed: _busy ? null : () => _setPaidFor([id], !paid),
                child: Text(paid ? tr('رفع السداد', 'Unmark') : tr('تم السداد', 'Mark paid'),
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: paid ? T.inkSoft : T.success)),
              ),
          ]),
        ]),
      ),
    );
  }
}

/// Number card: amounts with separators, not an animated count (StatCard rounds and does not separate).
class _Kpi extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final IconData icon;
  final String? hint;
  const _Kpi(this.label, this.value, this.color, this.icon, {this.hint});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
        Row(children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600))),
          Icon(icon, size: 15, color: T.line),
        ]),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: AlignmentDirectional.centerStart,
          child: Text(value, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: color)),
        ),
        if (hint != null) Text(hint!, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      ]),
    );
  }
}
