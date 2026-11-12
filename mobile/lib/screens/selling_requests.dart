// Selling-price change requests, twin of /system/selling-requests on the web.
// The data team's selling-price edits wait here; approvers decide them. The server decides who approves.
import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ops_common.dart';

const sellingRequestsPath = '/system/selling-requests';
const sellingRequestsEvent = 'sellingRequests:changed';

/// Same rule as config/sellingPriceRequests on the server; only decides what is shown.
bool canApproveSelling(AuthProvider auth) =>
    const ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'sales_manager', 'sales_team_leader'].contains(auth.role) || auth.user?['isTopManagement'] == true;

const _status = {
  'pending': ('بانتظار الاعتماد', 'Pending', T.warn),
  'approved': ('معتمدة', 'Approved', T.success),
  'rejected': ('مرفوضة', 'Rejected', T.danger),
};

String _when(dynamic v) {
  if (v == null || '$v'.isEmpty) return '—';
  final d = DateTime.tryParse('$v')?.toLocal();
  if (d == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${gregDay(v)} ${two(d.hour)}:${two(d.minute)}';
}

class SellingRequestsScreen extends StatefulWidget {
  const SellingRequestsScreen({super.key});
  @override
  State<SellingRequestsScreen> createState() => _SellingRequestsScreenState();
}

class _SellingRequestsScreenState extends State<SellingRequestsScreen> {
  static const _tabs = [('pending', 'بانتظار الاعتماد', 'Pending'), ('approved', 'معتمدة', 'Approved'), ('rejected', 'مرفوضة', 'Rejected'), ('', 'الكل', 'All')];
  String _tab = 'pending';
  List<Map<String, dynamic>> _rows = [];
  int _pending = 0;
  bool _loading = true;
  String? _error;
  String _busy = '';
  // Each reply carries its sequence so a slower, older one never overwrites a newer tab.
  int _seq = 0;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on(sellingRequestsEvent, _onLive); }
  @override
  void dispose() { Live.instance.off(sellingRequestsEvent, _onLive); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/selling-price-requests${_tab.isEmpty ? '' : '?status=$_tab'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []);
        _pending = (d['pending'] as num?)?.toInt() ?? 0;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = opsErr(e); });
    }
  }

  Future<void> _approve(Map<String, dynamic> r) async {
    setState(() => _busy = '${r['_id']}');
    try {
      await Api.instance.post('/api/selling-price-requests/${r['_id']}/approve', {});
      if (mounted) opsSnack(context, tr('اعتُمد سعر البيع ${opsMoney(r['requestedPrice'])} لأمر النقل ${r['reportNumber']}', 'Approved ${opsMoney(r['requestedPrice'])} for ${r['reportNumber']}'));
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    }
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _reject(Map<String, dynamic> r) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('رفض طلب تعديل سعر البيع', 'Reject selling-price request')),
        content: TextField(
          controller: ctrl, autofocus: true, maxLines: 3,
          decoration: InputDecoration(labelText: tr('سبب الرفض (اختياري)', 'Reason (optional)')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, ctrl.text.trim()),
            child: Text(tr('رفض', 'Reject')),
          ),
        ],
      ),
    );
    if (reason == null) return;
    setState(() => _busy = '${r['_id']}');
    try {
      await Api.instance.post('/api/selling-price-requests/${r['_id']}/reject', {'reason': reason});
      if (mounted) opsSnack(context, tr('رُفض الطلب ولم يتغيّر السعر', 'Rejected; price unchanged'));
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    }
    if (mounted) setState(() => _busy = '');
  }

  Widget _card(Map<String, dynamic> r) {
    final st = _status['${r['status']}'];
    final oldP = (r['oldPrice'] as num?) ?? 0;
    final newP = (r['requestedPrice'] as num?) ?? 0;
    final diff = newP - oldP;
    final busy = _busy == '${r['_id']}';
    final details = [r['driverName'], r['plate']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
    return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text('${tr('أمر النقل', 'Order')} ${r['reportNumber'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800))),
        if (st != null) Chip2(tr(st.$1, st.$2), st.$3),
      ]),
      const SizedBox(height: 4),
      Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'} · ${gregDay(r['orderDate'])}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      if (details.isNotEmpty) Text(details, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: Text('${tr('الحالي', 'Current')}: ${opsMoney(oldP)}', style: const TextStyle(fontSize: 13))),
        Text('${tr('المطلوب', 'Requested')}: ${opsMoney(newP)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
        const SizedBox(width: 6),
        Text('${diff >= 0 ? '+' : ''}${opsMoney(diff)}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: diff >= 0 ? T.success : T.danger)),
      ]),
      const SizedBox(height: 4),
      Text('${tr('طلبه', 'By')}: ${r['requestedByName'] ?? '—'} · ${_when(r['requestedAt'])}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
      if ('${r['status']}' != 'pending')
        Text('${tr('قرّره', 'Decided by')}: ${r['decidedByName'] ?? '—'} · ${_when(r['decidedAt'])}${'${r['reason'] ?? ''}'.isNotEmpty ? ' · ${tr('السبب', 'Reason')}: ${r['reason']}' : ''}',
            style: const TextStyle(fontSize: 12, color: T.inkFaint)),
      if ('${r['status']}' == 'pending') ...[
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.success),
            onPressed: busy ? null : () => _approve(r),
            icon: busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check, size: 18),
            label: Text(tr('اعتماد', 'Approve')),
          )),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: T.danger),
            onPressed: busy ? null : () => _reject(r),
            icon: const Icon(Icons.close, size: 18),
            label: Text(tr('رفض', 'Reject')),
          )),
        ]),
      ],
    ]));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات تعديل سعر البيع', 'Selling-price requests')),
      body: Column(children: [
        SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), children: [
          for (final t in _tabs) Padding(padding: const EdgeInsets.only(left: 6), child: ChoiceChip(
            selected: _tab == t.$1,
            label: Text('${tr(t.$2, t.$3)}${t.$1 == 'pending' && _pending > 0 ? ' ($_pending)' : ''}'),
            onSelected: (_) { setState(() { _tab = t.$1; _loading = true; }); _load(); },
          )),
        ])),
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
          onRefresh: _load,
          child: _error != null && _rows.isEmpty
              ? ListView(children: [ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })])
              : _rows.isEmpty
                  ? ListView(children: [EmptyState(icon: Icons.price_check_outlined, title: tr('لا توجد طلبات', 'No requests'))])
                  : ListView(padding: const EdgeInsets.all(12), children: [
                      for (final r in _rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: _card(r)),
                    ]),
        )),
      ]),
    );
  }
}

/// Workflow-screen action with the live pending count; opens the list.
class SellingRequestsAction extends StatefulWidget {
  const SellingRequestsAction({super.key});
  @override
  State<SellingRequestsAction> createState() => _SellingRequestsActionState();
}

class _SellingRequestsActionState extends State<SellingRequestsAction> {
  int _count = 0;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on(sellingRequestsEvent, _onLive); }
  @override
  void dispose() { Live.instance.off(sellingRequestsEvent, _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/selling-price-requests/count');
      if (mounted) setState(() => _count = (d['pending'] as num?)?.toInt() ?? 0);
    } catch (_) { /* The count is a hint; the list shows the truth. */ }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tr('طلبات تعديل سعر البيع', 'Selling-price requests'),
      onPressed: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => const SellingRequestsScreen()));
        _load();
      },
      icon: Badge(isLabelVisible: _count > 0, label: Text(_count > 99 ? '99+' : '$_count'), child: const Icon(Icons.price_check_outlined)),
    );
  }
}
