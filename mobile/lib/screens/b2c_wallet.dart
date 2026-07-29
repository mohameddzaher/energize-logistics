import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// عهد المشاريع (B2C) — دفتر عهدة لكل مدير مشروع: رصيد جارٍ = مجموع الوارد
/// ناقص الصادر. المديرون يختارون المندوب أولًا؛ المندوب يرى عهدته مباشرة.

const _walletManagerRoles = {'super_admin', 'admin', 'b2c_head'};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _userName(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '—';

class B2cWalletScreen extends StatelessWidget {
  const B2cWalletScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isManager = _walletManagerRoles.contains(auth.role);
    if (isManager) return const _WalletManagersScreen();
    return const B2cWalletLedgerScreen();
  }
}

// ── قائمة المديرين (للمشرفين) ───────────────────────────────────────────────
class _WalletManagersScreen extends StatefulWidget {
  const _WalletManagersScreen();
  @override
  State<_WalletManagersScreen> createState() => _WalletManagersScreenState();
}

class _WalletManagersScreenState extends State<_WalletManagersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('b2c:wallet', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('b2c:wallet', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/b2c-wallet/managers');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['managers'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((m) => q.isEmpty || _fold(_userName(m)).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('عهد المشاريع', 'Project Custody')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن مدير المشروع…', 'Search manager…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.account_balance_wallet_outlined, title: tr('لا يوجد مديرو مشاريع', 'No project managers'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final m = filtered[i];
                                final bal = (m['balance'] ?? 0) as num;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => B2cWalletLedgerScreen(managerId: (m['_id'] ?? '').toString(), managerName: _userName(m)))),
                                    child: AppCard(
                                      topAccent: bal > 0 ? T.warn : T.success,
                                      child: Row(children: [
                                        CircleAvatar(radius: 16, backgroundColor: T.navy.withValues(alpha: 0.1), child: const Icon(Icons.person_outline, size: 18, color: T.navy)),
                                        const SizedBox(width: 10),
                                        Expanded(child: Text(_userName(m), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Text('${_money(bal)} ${tr('ر.س', 'SAR')}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: bal > 0 ? T.warn : T.success)),
                                          Text(tr('العهدة الحالية', 'Current custody'), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}

// ── دفتر العهدة ─────────────────────────────────────────────────────────────
class B2cWalletLedgerScreen extends StatefulWidget {
  final String? managerId;
  final String? managerName;
  const B2cWalletLedgerScreen({super.key, this.managerId, this.managerName});
  @override
  State<B2cWalletLedgerScreen> createState() => _B2cWalletLedgerScreenState();
}

class _B2cWalletLedgerScreenState extends State<B2cWalletLedgerScreen> {
  List<Map<String, dynamic>> _entries = [];
  num _balance = 0, _totalIn = 0, _totalOut = 0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  bool get _isMine => widget.managerId == null;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('b2c:wallet', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('b2c:wallet', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final path = _isMine ? '/api/b2c-wallet/me' : '/api/b2c-wallet/${widget.managerId}';
      final d = await Api.instance.get(path);
      if (!mounted) return;
      setState(() {
        _entries = List<Map<String, dynamic>>.from(d['entries'] ?? []);
        _balance = (d['balance'] ?? 0) as num;
        _totalIn = (d['totalIn'] ?? 0) as num;
        _totalOut = (d['totalOut'] ?? 0) as num;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool get _canAdd {
    final role = context.read<AuthProvider>().role;
    return _walletManagerRoles.contains(role);
  }

  Future<void> _addEntry() async {
    String direction = 'in';
    final amount = TextEditingController();
    final reason = TextEditingController();
    String method = 'cash';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('حركة عهدة', 'Custody entry'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'in', label: Text(tr('تسليم عهدة (وارد)', 'In')), icon: const Icon(Icons.south_west, size: 16)),
                ButtonSegment(value: 'out', label: Text(tr('صرف (صادر)', 'Out')), icon: const Icon(Icons.north_east, size: 16)),
              ],
              selected: {direction},
              onSelectionChanged: (s) => setS(() => direction = s.first),
            ),
            const SizedBox(height: 12),
            TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ *', 'Amount *'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: method,
              decoration: InputDecoration(labelText: tr('الطريقة', 'Method')),
              items: [
                DropdownMenuItem(value: 'cash', child: Text(tr('نقدًا', 'Cash'))),
                DropdownMenuItem(value: 'bank_transfer', child: Text(tr('تحويل بنكي', 'Bank transfer'))),
                DropdownMenuItem(value: 'other', child: Text(tr('أخرى', 'Other'))),
              ],
              onChanged: (v) => setS(() => method = v ?? method),
            ),
            const SizedBox(height: 10),
            TextField(controller: reason, decoration: InputDecoration(labelText: tr('البيان', 'Reason'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if ((num.tryParse(amount.text) ?? 0) <= 0) return;
                  try {
                    await Api.instance.post('/api/b2c-wallet', {
                      'projectManager': widget.managerId,
                      'direction': direction,
                      'amount': num.tryParse(amount.text),
                      'method': method,
                      if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
                    });
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('تسجيل', 'Record')),
              ),
            ),
          ]),
        ),
      )),
    );
  }

  String _dt(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(widget.managerName ?? tr('عهدتي', 'My Custody')),
      floatingActionButton: (_canAdd && !_isMine)
          ? FloatingActionButton.extended(onPressed: _addEntry, icon: const Icon(Icons.add), label: Text(tr('حركة', 'Entry')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: _balance > 0 ? T.warn : T.success,
                        child: Column(children: [
                          Text(tr('العهدة الحالية', 'Current custody'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text('${_money(_balance)} ${tr('ر.س', 'SAR')}', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: _balance > 0 ? T.warn : T.success)),
                          const SizedBox(height: 10),
                          Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                            Column(children: [Text(tr('إجمالي الوارد', 'Total in'), style: const TextStyle(fontSize: 11, color: T.inkFaint)), Text(_money(_totalIn), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success))]),
                            Column(children: [Text(tr('إجمالي الصادر', 'Total out'), style: const TextStyle(fontSize: 11, color: T.inkFaint)), Text(_money(_totalOut), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger))]),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(tr('الحركات', 'Entries'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_entries.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد حركات بعد', 'No entries yet')),
                    ..._entries.map((e) {
                      final isIn = e['direction'] == 'in';
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(color: (isIn ? T.success : T.danger).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                              child: Icon(isIn ? Icons.south_west : Icons.north_east, size: 17, color: isIn ? T.success : T.danger),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text((e['reason'] ?? (isIn ? tr('تسليم عهدة', 'Custody in') : tr('صرف', 'Custody out'))).toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                                Text('${_dt(e['createdAt'])}${_userName(e['createdBy']).isNotEmpty ? ' · ${_userName(e['createdBy'])}' : ''}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                              ]),
                            ),
                            Text('${isIn ? '+' : '−'}${_money(e['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: isIn ? T.success : T.danger)),
                          ]),
                        ),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
