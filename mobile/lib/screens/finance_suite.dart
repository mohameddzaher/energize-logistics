import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// المالية — العملاء والفواتير والمدفوعات: القوائم الكاملة بالبحث والفلاتر،
/// ملف العميل الموجز، وفعل «تحصيل كامل» على الفاتورة (للمصرّح لهم).

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

String _money(dynamic v) => v == null
    ? '—'
    : (v as num).toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');

// ── العملاء ──────────────────────────────────────────────────────────────────
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customers');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['customers'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _open(Map<String, dynamic> c) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((c['companyName'] ?? '').toString(), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: StatCard(label: tr('الرصيد المستحق', 'Outstanding'), value: (c['outstandingBalance'] ?? 0) as num, color: T.danger, icon: Icons.account_balance_wallet_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('حد الائتمان', 'Credit limit'), value: (c['creditLimit'] ?? 0) as num, color: T.info, icon: Icons.credit_score_outlined)),
          ]),
          const SizedBox(height: 12),
          ...[
            (Icons.person_outline, tr('جهة الاتصال', 'Contact'), c['contactPerson']),
            (Icons.phone_outlined, tr('الجوال', 'Phone'), c['phone']),
            (Icons.email_outlined, tr('البريد', 'Email'), c['email']),
            (Icons.schedule_outlined, tr('مدة السداد', 'Credit term'), c['creditTerm'] != null ? '${c['creditTerm']} ${tr('يوم', 'days')}' : null),
          ].where((x) => (x.$3 ?? '').toString().isNotEmpty).map((x) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  Icon(x.$1, size: 16, color: T.inkFaint),
                  const SizedBox(width: 8),
                  Text('${x.$2}: ', style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                  Expanded(child: Text(x.$3.toString(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
                ]),
              )),
          const SizedBox(height: 6),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((c) {
      if (q.isEmpty) return true;
      return [c['companyName'], c['contactPerson'], c['phone'], c['email']]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('العملاء', 'Customers')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالاسم أو الجوال…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.people_outline, title: tr('لا يوجد عملاء مطابقون', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                final c = filtered[i];
                                final outstanding = (c['outstandingBalance'] ?? 0) as num;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => _open(c),
                                    child: AppCard(
                                      child: Row(children: [
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text((c['companyName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                            Text([c['contactPerson'], c['phone']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ]),
                                        ),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Text(_money(outstanding), style: TextStyle(fontWeight: FontWeight.w800, color: outstanding > 0 ? T.danger : T.success)),
                                          Text(tr('مستحق', 'due'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
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

// ── الفواتير ─────────────────────────────────────────────────────────────────
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key});
  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

const _invStatuses = {
  'pending': ('قيد السداد', 'Pending', T.warn),
  'partial': ('سداد جزئي', 'Partial', T.info),
  'paid': ('مسددة', 'Paid', T.success),
  'overdue': ('متأخرة', 'Overdue', T.danger),
  'frozen': ('مجمدة', 'Frozen', T.inkFaint),
  'refunded': ('مستردة', 'Refunded', T.violet),
};

class _InvoicesScreenState extends State<InvoicesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/invoices');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['invoices'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _markPaid(Map<String, dynamic> inv) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تحصيل كامل', 'Mark fully paid')),
        content: Text(tr('تسجيل الفاتورة ${inv['invoiceNumber']} كمسددة بالكامل؟', 'Mark invoice ${inv['invoiceNumber']} fully paid?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/invoices/${inv['_id']}/mark-paid');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (_status.isNotEmpty && r['status'] != _status) return false;
      if (q.isEmpty) return true;
      final customer = r['customer'] is Map ? (r['customer']['companyName'] ?? '') : '';
      return [r['invoiceNumber'], customer].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    int countOf(String s) => _rows.where((r) => r['status'] == s).length;

    return AppScaffold(
      title: Text(tr('الفواتير', 'Invoices')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث برقم الفاتورة أو العميل…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _invStatuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) => setState(() => _status = selected ? '' : e.key),
                              label: Text('${tr(e.value.$1, e.value.$2)} (${countOf(e.key)})'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد فواتير مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                final r = filtered[i];
                                final st = _invStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                                final customer = r['customer'] is Map ? (r['customer']['companyName'] ?? '') : '';
                                final canMarkPaid = r['status'] != 'paid' && r['status'] != 'refunded';
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text('#${r['invoiceNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        const Spacer(),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text(customer.toString(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 6),
                                      Row(children: [
                                        Chip2('${_money(r['amount'])} ر.س', T.navy),
                                        const SizedBox(width: 6),
                                        if ((r['paidAmount'] ?? 0) > 0)
                                          Chip2('${tr('مدفوع', 'Paid')}: ${_money(r['paidAmount'])}', T.success),
                                        const Spacer(),
                                        if (canMarkPaid)
                                          TextButton(
                                            onPressed: () => _markPaid(r),
                                            child: Text(tr('تحصيل كامل', 'Mark paid'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                                          ),
                                      ]),
                                    ]),
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

// ── المدفوعات ────────────────────────────────────────────────────────────────
class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});
  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/payments');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['payments'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      final customer = r['customer'] is Map ? (r['customer']['companyName'] ?? '') : '';
      return [customer, r['method'], r['reference']].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();
    final total = filtered.fold<num>(0, (s, r) => s + ((r['amount'] ?? 0) as num));

    return AppScaffold(
      title: Text(tr('المدفوعات', 'Payments')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالعميل أو المرجع…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                        suffixText: '${_money(total)} ر.س',
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.payments_outlined, title: tr('لا توجد مدفوعات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                final r = filtered[i];
                                final customer = r['customer'] is Map ? (r['customer']['companyName'] ?? '') : '';
                                final date = DateTime.tryParse((r['paymentDate'] ?? r['createdAt'] ?? '').toString());
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    child: Row(children: [
                                      Container(
                                        padding: const EdgeInsets.all(9),
                                        decoration: BoxDecoration(color: T.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(11)),
                                        child: const Icon(Icons.payments_outlined, size: 19, color: T.success),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text(customer.toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          Text([r['method'], date != null ? '${date.day}/${date.month}/${date.year}' : null]
                                              .where((x) => (x ?? '').toString().isNotEmpty)
                                              .join(' · '),
                                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                        ]),
                                      ),
                                      Text('${_money(r['amount'])} ر.س', style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
                                    ]),
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
