import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/file_upload.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';

/// ما تتشاركه شاشاتُ «طلبات الشحنات»: مفرداتُ الحالات، وبابُ الكتابة، والبوليصةُ
/// من الخادم، ونافذةُ المتابعة — نظيرُ lib/shipmentOrders.ts في الويب.

/// الأدوارُ نفسُها في routes/shipmentOrders.js — أو منحةُ «تعديل» من مصفوفة الصلاحيات.
const soEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator',
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup'];
const soAdminRoles = ['super_admin', 'admin', 'it_manager', 'operations_manager'];
bool canEditOrders(BuildContext c) {
  final a = c.read<AuthProvider>();
  return soEditRoles.contains(a.role) || a.canEditSection('Shipment Orders');
}
bool canAdminOrders(BuildContext c) {
  final a = c.read<AuthProvider>();
  return soAdminRoles.contains(a.role) || a.canEditSection('Shipment Orders');
}

/// سجلُّ حالةٍ كما تعرضه الشاشة: مفتاحُها واسمُها ولونُها.
typedef SoStatus = (String key, String ar, String en, Color color);

/// الحالاتُ الأساسيّة — تُرسَم بها الشاشةُ قبل أن يردّ الخادم، والمضبوطُ من
/// إعدادات القسم يحلّ محلَّها متى وصل.
const soBaseStatuses = <SoStatus>[
  ('requesting', 'قيد الطلب', 'Requesting', T.inkFaint),
  ('loading', 'جاري التحميل', 'Loading', T.warn),
  ('uploaded', 'تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  ('on_way', 'في الطريق', 'On way', T.info),
  ('arrived', 'وصلت', 'Arrived', Color(0xFF4F46E5)),
  ('bond_sent', 'أُرسل السند', 'Bond sent', T.cyan),
  ('bond_received', 'استُلم السند', 'Bond received', T.success),
  ('late', 'متأخرة', 'Late', Color(0xFFEA580C)),
  ('invoiced', 'تمت الفوترة', 'Invoiced', T.violet),
  ('cancelled', 'ملغاة', 'Cancelled', T.danger),
];

Color soHex(String? v) {
  final h = (v ?? '').replaceAll('#', '').trim();
  if (h.length != 6) return T.inkFaint;
  final n = int.tryParse(h, radix: 16);
  return n == null ? T.inkFaint : Color(0xFF000000 | n);
}

/// المفرداتُ المضبوطة من الخادم — والأساسيّةُ إن تعذّر.
Future<List<SoStatus>> loadSoStatuses() async {
  try {
    final d = await Api.instance.get('/api/shipment-orders/statuses');
    final rows = List<Map<String, dynamic>>.from(d['statuses'] ?? []);
    if (rows.isEmpty) return soBaseStatuses;
    return rows.map((r) => ('${r['key'] ?? ''}', '${r['ar'] ?? ''}', '${r['en'] ?? ''}', soHex(r['color'] as String?))).toList();
  } catch (_) {
    return soBaseStatuses;
  }
}

SoStatus soStatusOf(List<SoStatus> vocab, dynamic key) {
  for (final v in vocab) { if (v.$1 == key) return v; }
  for (final v in soBaseStatuses) { if (v.$1 == key) return v; }
  return ('$key', '$key', '$key', T.inkFaint);
}

String soRef(Map o) => '${o['reference'] ?? o['waybillNumber'] ?? ''}';

String soFmtDate(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  return d == null ? '' : '${d.day}/${d.month}/${d.year}';
}

String soFmtDT(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  if (d == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.day}/${d.month}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

String soMoney(dynamic n) {
  if (n == null || '$n'.isEmpty) return '—';
  final v = num.tryParse('$n');
  if (v == null) return '$n';
  final s = v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);
  return s.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
}

/// «نوع الدفع» — مفاتيحُ سير عمل التشغيل (utils/paymentType في الخادم).
const soPaymentKinds = {
  'deferred_cash': ('آجل - كاش', 'Deferred – cash'),
  'deferred_invoice': ('آجل - فاتورة', 'Deferred – invoice'),
  'cash_3pl': ('نقدي - 3PL', 'Cash – 3PL'),
  'cash_ht': ('نقدي - HT', 'Cash – HT'),
};
String soPaymentKindLabel(dynamic k) {
  final l = soPaymentKinds['${k ?? ''}'];
  return l == null ? '' : tr(l.$1, l.$2);
}

/// بوليصة-501-اسم العميل-22-7-2026 — كاسم الملفّ في الويب.
String soWaybillFileName(Map o) {
  final d = DateTime.tryParse('${o['pickupTime'] ?? o['createdAt'] ?? ''}')?.toLocal() ?? DateTime.now();
  final c = '${o['customerName'] ?? ''}'.isEmpty ? 'عميل' : '${o['customerName']}';
  return 'بوليصة-${soRef(o)}-$c-${d.day}-${d.month}-${d.year}';
}

/// البوليصةُ تُرسَم في الخادم — واحدةً أو كثيرة — فالورقةُ واحدةٌ مهما كان زرُّها.
/// والخادمُ يحدّ النداءَ بمئة، فما زاد يُرسَل دفعاتٍ متتابعة.
Future<void> soPrintWaybills(BuildContext context, List<Map<String, dynamic>> orders) async {
  if (orders.isEmpty) return;
  final messenger = ScaffoldMessenger.of(context);
  try {
    for (var i = 0; i < orders.length; i += 100) {
      final part = orders.sublist(i, i + 100 > orders.length ? orders.length : i + 100);
      final bytes = await Api.instance.postBytes('/api/shipment-orders/orders/waybills.pdf', {'ids': part.map((o) => o['_id']).toList()});
      final name = part.length == 1 ? soWaybillFileName(part.first) : 'بوليصات-الشحن-${part.length}';
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: name);
    }
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر توليد البوليصة', 'PDF failed'))));
  }
}

Future<void> soOpenFile(String u) async {
  if (u.isEmpty) return;
  await launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
}

/// سجلُّ الحالات — يُعرض في نافذة المتابعة وفي التفاصيل.
class SoStatusLog extends StatelessWidget {
  final List log;
  final List<SoStatus> vocab;
  const SoStatusLog({super.key, required this.log, required this.vocab});
  @override
  Widget build(BuildContext context) {
    final items = log.reversed.map((h) => Map<String, dynamic>.from(h as Map)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final h in items)
        Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(8), border: Border.all(color: T.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if ('${h['from'] ?? ''}'.isNotEmpty) ...[
                Text(tr(soStatusOf(vocab, h['from']).$2, soStatusOf(vocab, h['from']).$3), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                const Text(' ← ', style: TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ],
              Text(tr(soStatusOf(vocab, h['to']).$2, soStatusOf(vocab, h['to']).$3), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
              const Spacer(),
              Text(soFmtDT(h['at']), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
            ]),
            if ('${h['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text('${h['note']}', style: const TextStyle(fontSize: 12.5))),
            if ('${h['fileUrl'] ?? ''}'.isNotEmpty)
              InkWell(
                onTap: () => soOpenFile('${h['fileUrl']}'),
                child: Padding(padding: const EdgeInsets.only(top: 3), child: Row(children: [
                  const Icon(Icons.attach_file, size: 13, color: T.orange),
                  Flexible(child: Text('${h['fileName'] ?? tr('المرفق', 'Attachment')}', style: const TextStyle(fontSize: 11.5, color: T.orange, fontWeight: FontWeight.w700))),
                ])),
              ),
            if ('${h['byName'] ?? ''}'.isNotEmpty) Text('${h['byName']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        ),
    ]);
  }
}

/// ── نافذةُ المتابعة ──────────────────────────────────────────────────────────
/// الحالةُ تُنقَل ومعها ملاحظةٌ اختياريّة، و«أُرسل السند» لا تُحفظ بلا ملفّه،
/// و«ملغاة» لا تُحفظ بلا سببٍ من «أسباب الإلغاء». يرجّع true إن حُفظت.
Future<bool> soFollowUp(BuildContext context, Map<String, dynamic> order, List<SoStatus> vocab) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (c) => _FollowUpSheet(order: order, vocab: vocab),
  );
  return saved == true;
}

class _FollowUpSheet extends StatefulWidget {
  final Map<String, dynamic> order;
  final List<SoStatus> vocab;
  const _FollowUpSheet({required this.order, required this.vocab});
  @override
  State<_FollowUpSheet> createState() => _FollowUpSheetState();
}

class _FollowUpSheetState extends State<_FollowUpSheet> {
  static const _needsFile = {'bond_sent'};
  late String _status = '${widget.order['status'] ?? ''}';
  final _note = TextEditingController();
  final _reason = TextEditingController();
  PickedFile? _file;
  bool _busy = false;

  @override
  void dispose() { _note.dispose(); _reason.dispose(); super.dispose(); }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _save() async {
    final o = widget.order;
    final prev = '${o['status'] ?? ''}';
    if (_needsFile.contains(_status) && _status != prev && _file == null) {
      return _say(tr('أرفق صورة السند أو ملفه أولًا.', 'Attach the bond file first.'));
    }
    final reason = _reason.text.trim();
    if (_status == 'cancelled' && prev != 'cancelled' && reason.isEmpty) {
      return _say(tr('اختر سببَ الإلغاء.', 'Choose the cancellation reason.'));
    }
    setState(() => _busy = true);
    try {
      await Api.instance.patch('/api/shipment-orders/orders/${o['_id']}/status', {
        'status': _status,
        'note': _note.text.trim(),
        'cancelReason': reason,
        if (_file != null) ...{'dataUrl': _file!.dataUrl, 'fileName': _file!.fileName},
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _say(e is ApiException ? e.message : '$e'); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    final log = List.from(o['statusLog'] ?? const []);
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('تسجيل متابعة', 'Record a follow-up'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        Text('${tr('بوليصة', 'Waybill')} ${soRef(o)}${'${o['customerName'] ?? ''}'.isNotEmpty ? ' · ${o['customerName']}' : ''}${'${o['fromCity'] ?? ''}'.isNotEmpty ? ' · ${o['fromCity']} → ${o['toCity'] ?? ''}' : ''}',
            style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const SizedBox(height: 12),
        Text(tr('الحالة', 'Status'), style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final s in widget.vocab)
            ChoiceChip(
              selected: _status == s.$1,
              onSelected: (_) => setState(() => _status = s.$1),
              label: Text(tr(s.$2, s.$3)),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _status == s.$1 ? Colors.white : T.inkSoft),
              selectedColor: s.$4,
              showCheckmark: false,
            ),
        ]),
        if (_status == 'cancelled' && o['status'] != 'cancelled') ...[
          const SizedBox(height: 12),
          LookupField(type: 'so_cancel_reason', controller: _reason, label: '${tr('سبب الإلغاء', 'Cancellation reason')} *',
              fallback: const ['إلغاء من السائق', 'إلغاء من العميل', 'إلغاء من المندوب']),
        ],
        const SizedBox(height: 12),
        TextField(controller: _note, maxLines: 2, decoration: InputDecoration(
          labelText: tr('ملاحظة (اختياري)', 'Note (optional)'),
          hintText: tr('سببُ النقلة إن كان لها سبب…', 'Why it moved, if there is a reason…'),
        )),
        if (_needsFile.contains(_status)) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.attach_file),
            label: Text(_file == null ? '${tr('صورة السند أو ملفه', 'Bond file')} *' : '${_file!.fileName} · ${(_file!.sizeBytes / 1024).round()}KB'),
            onPressed: () async {
              final f = await pickFileAsDataUrl();
              if (f == null) return;
              if (f.sizeBytes > 20 * 1024 * 1024) return _say(tr('الملف أكبر من ٢٠ ميجابايت.', 'File larger than 20MB.'));
              setState(() => _file = f);
            },
          ),
          if (_file == null) Text(tr('لا تُحفَظ الحالة بلا إرفاق السند.', 'The status is not saved without the bond file.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ],
        if (log.isNotEmpty) ...[
          const Divider(height: 24),
          Text('${tr('السجل', 'History')} ${log.length}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkFaint)),
          const SizedBox(height: 6),
          SoStatusLog(log: log, vocab: widget.vocab),
        ],
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
          label: Text(tr('حفظ المتابعة', 'Save follow-up')),
        ),
      ])),
    ));
  }
}
