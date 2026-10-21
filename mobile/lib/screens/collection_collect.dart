import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

// ═════════════════════════════════════════════════════════════════════════
// تسجيلُ التحصيل — كاملٌ أو جزئيّ. نظيرُ نافذة «تسجيل تحصيل» في
// components/collections/InvoicesPage.tsx.
//
// «تحصيل بالكامل» يقبض الباقي كلَّه فتصير الفاتورةُ محصَّلةً بالكامل،
// و«تحصيل جزئي» يكتب ما قُبض فينقص به الباقي وتبقى «جزئيّة» حتى يبلغ
// المقبوضُ قيمتَها. والتحقّقُ تحقّقُ الخادم نفسُه: الجزئيُّ أكبرُ من صفر
// وأقلُّ من الباقي. والكاشُ الذي لا قيمةَ معروفةً له يكتب المحصِّلُ ما قبضه.
// ═════════════════════════════════════════════════════════════════════════

num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _money(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);

/// يفتح نافذةَ التحصيل للصفّ — ويردّ `true` إن سُجِّل شيء.
Future<bool> openCollectSheet(BuildContext context, {required bool isCash, required Map<String, dynamic> row}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (c) => _CollectSheet(isCash: isCash, row: row),
  );
  return saved == true;
}

class _CollectSheet extends StatefulWidget {
  final bool isCash;
  final Map<String, dynamic> row;
  const _CollectSheet({required this.isCash, required this.row});
  @override
  State<_CollectSheet> createState() => _CollectSheetState();
}

class _CollectSheetState extends State<_CollectSheet> {
  String _mode = 'full';
  final _amount = TextEditingController();
  final _note = TextEditingController();
  late DateTime _date;
  bool _saving = false;
  String? _error;

  Map<String, dynamic> get r => widget.row;
  num get _value => _num(r['value']);
  String get _state => '${r['collectionState'] ?? ''}'.isNotEmpty
      ? '${r['collectionState']}'
      : (r['fullyCollected'] == true || '${r['collectionDate'] ?? ''}'.isNotEmpty ? 'full' : 'none');
  bool get _full => _state == 'full';
  num get _paid => _num(r['collectedAmount']);
  num get _remaining => r['remaining'] != null ? _num(r['remaining']) : (_value - _paid).clamp(0, double.infinity);
  /// كاشٌ بلا قيمةٍ معروفة: يُكتب المقبوضُ كلُّه ولا جزئيَّ فيه.
  bool get _needAmount => widget.isCash && !(_value > 0);

  @override
  void initState() {
    super.initState();
    final d = DateTime.tryParse('${r['collectionDate'] ?? ''}');
    _date = _full && d != null ? d : DateTime.now();
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String get _ymd => '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  Future<void> _save() async {
    final partial = _mode == 'partial' && !_full;
    final a = num.tryParse(_amount.text.replaceAll(',', '').trim());
    if (partial) {
      if (a == null || a <= 0) { setState(() => _error = tr('اكتب المبلغ المحصَّل رقمًا أكبر من صفر', 'Enter an amount greater than zero')); return; }
      if (a >= _remaining - 0.005) {
        setState(() => _error = tr('المبلغ الجزئي يجب أن يكون أقل من الباقي (${_money(_remaining)}) — ولتحصيل الباقي كله اختر «تحصيل بالكامل»',
            'A partial amount must be below the balance (${_money(_remaining)}) — choose “Collect in full”'));
        return;
      }
    } else if (_needAmount && !_full && (a == null || a <= 0)) {
      setState(() => _error = tr('مبلغ التحصيل مطلوب', 'Collected amount required'));
      return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      final res = await Api.instance.post('/api/collections-dept/invoices/collect', {
        if (widget.isCash) 'ids': ['${r['_id']}'] else 'invoiceNumber': '${r['invoiceNumber']}',
        'mode': partial ? 'partial' : 'full',
        'collectionDate': _ymd,
        'note': _note.text.trim(),
        if (partial || _needAmount) 'amount': a,
      });
      if (!mounted) return;
      if (res is Map && '${res['message'] ?? ''}'.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${res['message']}')));
      }
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _error = e.toString(); });
    }
  }

  Widget _figure(String label, num v, Color c) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFE2E8F0))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: Colors.black54)),
            Text(_money(v), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: c)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final label = widget.isCash ? '${r['reportNumber'] ?? ''}' : '${r['invoiceNumber'] ?? ''}';
    final payments = (r['payments'] is List) ? (r['payments'] as List).whereType<Map>().toList() : const <Map>[];
    final showAmount = !_full && (_mode == 'partial' || _needAmount);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text('${tr('تسجيل تحصيل', 'Record collection')} — $label',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Row(children: [
              _figure(tr('القيمة', 'Value'), _value, T.navy),
              const SizedBox(width: 6),
              _figure(tr('المحصَّل', 'Collected'), _full ? (_value > 0 ? _value : _paid) : _paid, T.success),
              const SizedBox(width: 6),
              _figure(tr('المتبقي', 'Balance'), _full ? 0 : _remaining, _full ? Colors.black38 : T.danger),
            ]),
            const SizedBox(height: 12),
            if (_full)
              Text(tr('محصَّلة بالكامل — يُعدَّل هنا يوم التحصيل.', 'Fully collected — edit the collection day here.'),
                  style: const TextStyle(fontSize: 12, color: Colors.black54))
            else if (!_needAmount)
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'full', label: Text(tr('تحصيل بالكامل', 'Collect in full'))),
                  ButtonSegment(value: 'partial', label: Text(tr('تحصيل جزئي', 'Partial'))),
                ],
                selected: {_mode},
                onSelectionChanged: (s) => setState(() { _mode = s.first; _error = null; }),
              ),
            const SizedBox(height: 12),
            if (showAmount)
              TextField(
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: _mode == 'partial' ? tr('المبلغ المحصَّل *', 'Amount collected *') : tr('مبلغ التحصيل *', 'Collected amount *'),
                  helperText: _mode == 'partial'
                      ? (() {
                          final a = num.tryParse(_amount.text.replaceAll(',', '').trim());
                          return a != null && a > 0
                              ? tr('يبقى بعد هذه الدفعة: ${_money(_remaining - a)}', 'Balance after: ${_money(_remaining - a)}')
                              : tr('أقل من الباقي (${_money(_remaining)})', 'Below the balance (${_money(_remaining)})');
                        })()
                      : null,
                ),
              ),
            if (!_full && _mode == 'full' && !_needAmount)
              Text(tr('يُسجَّل الباقي (${_money(_remaining)}) دفعةً أخيرة وتصير محصَّلةً بالكامل.',
                      'The balance (${_money(_remaining)}) is recorded as the final payment.'),
                  style: const TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_outlined),
              title: Text(tr('تاريخ التحصيل', 'Collection date')),
              subtitle: Text(_ymd),
              onTap: () async {
                final d = await showDatePicker(context: context, initialDate: _date,
                    firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)));
                if (d != null) setState(() => _date = d);
              },
            ),
            if (!_full)
              TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            if (payments.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(tr('الدفعات', 'Payments'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.black54)),
              for (final p in payments)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    '${_money(_num(p['amount']))} · ${'${p['date'] ?? ''}'.split('T').first}'
                    '${'${p['byName'] ?? ''}'.isNotEmpty ? ' · ${p['byName']}' : ''}'
                    '${'${p['note'] ?? ''}'.isNotEmpty ? ' · ${p['note']}' : ''}',
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: T.danger, fontSize: 12.5)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(tr('حفظ', 'Save')),
            ),
          ]),
        ),
      ),
    );
  }
}
