import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تفاصيل الفاتورة — البيانات والأرصدة ومدفوعاتها، مع الإجراءات:
/// تسجيل دفعة، تحصيل كامل، تجميد/إلغاء تجميد (سوبر أدمن)، واسترداد (سوبر أدمن).
class InvoiceDetailScreen extends StatefulWidget {
  final String invoiceId;
  final String number;
  const InvoiceDetailScreen({super.key, required this.invoiceId, required this.number});
  @override
  State<InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

const _invStatuses = {
  'pending': ('قيد السداد', 'Pending', T.warn),
  'partial': ('سداد جزئي', 'Partial', T.info),
  'paid': ('مسددة', 'Paid', T.success),
  'overdue': ('متأخرة', 'Overdue', T.danger),
  'frozen': ('مجمدة', 'Frozen', T.inkFaint),
  'refunded': ('مستردة', 'Refunded', T.violet),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _InvoiceDetailScreenState extends State<InvoiceDetailScreen> {
  Map<String, dynamic>? _inv;
  List<Map<String, dynamic>> _payments = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('invoice:updated', _onLive);
    Live.instance.on('payment:logged', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('invoice:updated', _onLive);
    Live.instance.off('payment:logged', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/invoices/${widget.invoiceId}'),
        Api.instance.get('/api/payments?limit=200').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final Map<String, dynamic> inv = results[0]['invoice'] is Map ? Map<String, dynamic>.from(results[0]['invoice']) : {};
      final allPays = List<Map<String, dynamic>>.from(results[1]['payments'] ?? []);
      setState(() {
        _inv = inv;
        _payments = allPays.where((p) {
          final pid = p['invoice'] is Map ? p['invoice']['_id'] : p['invoice'];
          return pid == widget.invoiceId;
        }).toList();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool get _isSuper => context.read<AuthProvider>().role == 'super_admin';

  Future<void> _recordPayment() async {
    final inv = _inv ?? {};
    final amount = TextEditingController(text: (inv['balance'] ?? '').toString());
    final reference = TextEditingController();
    String method = 'bank_transfer';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تسجيل دفعة', 'Record payment'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ (المتبقي ${_money(inv['balance'])})', 'Amount (balance ${_money(inv['balance'])})'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: method,
              decoration: InputDecoration(labelText: tr('طريقة الدفع', 'Method')),
              items: [
                DropdownMenuItem(value: 'bank_transfer', child: Text(tr('تحويل بنكي', 'Bank transfer'))),
                DropdownMenuItem(value: 'cash', child: Text(tr('نقدًا', 'Cash'))),
                DropdownMenuItem(value: 'check', child: Text(tr('شيك', 'Cheque'))),
                DropdownMenuItem(value: 'online', child: Text(tr('إلكتروني', 'Online'))),
                DropdownMenuItem(value: 'other', child: Text(tr('أخرى', 'Other'))),
              ],
              onChanged: (v) => setS(() => method = v ?? method),
            ),
            const SizedBox(height: 10),
            TextField(controller: reference, decoration: InputDecoration(labelText: tr('المرجع', 'Reference'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if ((num.tryParse(amount.text) ?? 0) <= 0) return;
                  try {
                    await Api.instance.post('/api/payments', {
                      'invoice': widget.invoiceId,
                      'amount': num.tryParse(amount.text),
                      'paymentMethod': method,
                      if (reference.text.trim().isNotEmpty) 'reference': reference.text.trim(),
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

  Future<void> _confirm(String title, String path, String method, Map<String, dynamic> body, String okMsg) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(widget.number),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      if (method == 'POST') {
        await Api.instance.post(path, body);
      } else {
        await Api.instance.put(path, body);
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = _inv ?? {};
    final st = _invStatuses[inv['status']] ?? ('—', '—', T.inkFaint);
    final frozen = inv['isFrozen'] == true;
    final paid = inv['status'] == 'paid';
    final refunded = inv['status'] == 'refunded';

    return AppScaffold(
      title: Text('${tr('فاتورة', 'Invoice')} ${widget.number}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: st.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((inv['invoiceNumber'] ?? widget.number).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                            Chip2(tr(st.$1, st.$2), st.$3),
                          ]),
                          const SizedBox(height: 4),
                          Text(inv['customer'] is Map ? (inv['customer']['companyName'] ?? '').toString() : '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: T.inkSoft)),
                          const SizedBox(height: 10),
                          Row(children: [
                            _amountCol(tr('الإجمالي', 'Total'), _money(inv['amount']), T.navy),
                            _amountCol(tr('المسدد', 'Paid'), _money(inv['paidAmount']), T.success),
                            _amountCol(tr('المتبقي', 'Balance'), _money(inv['balance']), (inv['balance'] ?? 0) != 0 ? T.danger : T.success),
                          ]),
                          const SizedBox(height: 10),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2('${tr('التاريخ', 'Date')}: ${_d(inv['invoiceDate'])}', T.inkFaint, icon: Icons.event),
                            Chip2('${tr('الاستحقاق', 'Due')}: ${_d(inv['dueDate'])}', T.warn),
                            if (frozen) Chip2(tr('مجمدة', 'Frozen'), T.info, icon: Icons.ac_unit),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 10),
                    // actions
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      if (!paid && !refunded && !frozen)
                        _act(Icons.payment_rounded, tr('تسجيل دفعة', 'Record payment'), T.success, _recordPayment),
                      if (!paid && !refunded && !frozen)
                        _act(Icons.done_all_rounded, tr('تحصيل كامل', 'Mark paid'), T.navy,
                            () => _confirm(tr('تحصيل كامل', 'Mark fully paid'), '/api/invoices/${widget.invoiceId}/mark-paid', 'POST', {}, tr('سُجّلت مسددة', 'Marked paid'))),
                      if (_isSuper && !refunded)
                        _act(frozen ? Icons.play_arrow_rounded : Icons.ac_unit, frozen ? tr('إلغاء التجميد', 'Unfreeze') : tr('تجميد', 'Freeze'), T.info,
                            () => _confirm(frozen ? tr('إلغاء التجميد', 'Unfreeze') : tr('تجميد الفاتورة', 'Freeze invoice'), '/api/invoices/${widget.invoiceId}/freeze', 'PUT', {}, tr('تم التحديث', 'Updated'))),
                      if (_isSuper && !refunded)
                        _act(Icons.undo_rounded, tr('استرداد', 'Refund'), T.danger,
                            () => _confirm(tr('استرداد الفاتورة', 'Refund invoice'), '/api/invoices/${widget.invoiceId}/refund', 'POST', {}, tr('تم الاسترداد', 'Refunded'))),
                    ]),
                    const SizedBox(height: 14),
                    Text('${tr('مدفوعات هذه الفاتورة', 'Payments')} (${_payments.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_payments.isEmpty) EmptyState(icon: Icons.payments_outlined, title: tr('لا توجد مدفوعات بعد', 'No payments yet')),
                    ..._payments.map((p) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        child: Row(children: [
                          Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: T.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.payments_outlined, size: 17, color: T.success)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('${_money(p['amount'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                              Text('${_d(p['paymentDate'] ?? p['createdAt'])}${(p['paymentMethod'] ?? '').toString().isNotEmpty ? ' · ${p['paymentMethod']}' : ''}${(p['reference'] ?? '').toString().isNotEmpty ? ' · ${p['reference']}' : ''}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                            ]),
                          ),
                        ]),
                      ),
                    )),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _amountCol(String label, String value, Color color) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
          Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: color)),
        ]),
      );

  Widget _act(IconData icon, String label, Color color, VoidCallback onTap) => ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: onTap,
      );
}
