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

/// Files on a status entry: the list, or the single file older entries carry.
List<Map<String, dynamic>> soLogFiles(Map h) {
  final list = h['files'];
  if (list is List && list.isNotEmpty) return [for (final f in list) Map<String, dynamic>.from(f as Map)];
  return '${h['fileUrl'] ?? ''}'.isNotEmpty ? [{'fileUrl': h['fileUrl'], 'fileName': h['fileName']}] : const [];
}

/// Shared by the shipment orders screens: status vocabulary, the write gate, the server waybill and the follow-up dialog. Mirrors lib/shipmentOrders.ts on web.

/// Same roles as routes/shipmentOrders.js, or an edit grant from the permissions matrix.
const soEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator',
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup', 'data_manager', 'data_analyst', 'data_entry',
  // Sales asks for shipments and the vendors team places them (server: config/priceView).
  'sales_manager', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'];
const soAdminRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader'];
bool canEditOrders(BuildContext c) {
  final a = c.read<AuthProvider>();
  return soEditRoles.contains(a.role) || a.canEditSection('Shipment Orders');
}
bool canAdminOrders(BuildContext c) {
  final a = c.read<AuthProvider>();
  return soAdminRoles.contains(a.role) || a.canEditSection('Shipment Orders');
}

/// A status record as shown on screen: key, name and colour.
typedef SoStatus = (String key, String ar, String en, Color color);

/// Base statuses: used to draw the screen before the server replies; the section-configured ones replace them on arrival.
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

/// Statuses configured on the server, falling back to the base ones on failure.
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

/// The prices this reader may see: the server drops the side a role may not see (sales: no buy; vendors: no sell).
String soPriceLine(Map o) {
  final parts = <String>[
    if (o.containsKey('sellPrice')) '${tr('بيع', 'Sell')} ${soMoney(o['sellPrice'])}',
    if (o.containsKey('buyPrice')) '${tr('شراء', 'Buy')} ${soMoney(o['buyPrice'])}',
  ];
  return parts.join(' / ');
}

/// Payment type: keys of the operations workflow (utils/paymentType on the server).
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

/// Waybill file name: waybill-501-customer name-22-7-2026, same as the file name on web.
/// Customer + plate + manifest number, as the team files them.
String soWaybillFileName(Map o) {
  final c = '${o['customerName'] ?? ''}'.isEmpty ? 'عميل' : '${o['customerName']}';
  final plate = '${o['vehiclePlate'] ?? ''}';
  return [c, if (plate.isNotEmpty) plate, soRef(o)].join(' - ').replaceAll(RegExp(r'[\\/:*?"<>|]'), ' ');
}

/// The waybill is rendered on the server, one or many, so the sheet is identical whichever button is used. The server caps a call at 100, so larger sets go out in sequential batches.
Future<void> soPrintWaybills(BuildContext context, List<Map<String, dynamic>> orders) async {
  if (orders.isEmpty) return;
  final messenger = ScaffoldMessenger.of(context);
  try {
    // One file per waybill.
    for (final o in orders) {
      final bytes = await Api.instance.postBytes('/api/shipment-orders/orders/waybills.pdf', {'ids': [o['_id']]});
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: soWaybillFileName(o));
    }
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر توليد أمر النقل', 'PDF failed'))));
  }
}

Future<void> soOpenFile(String u) async {
  if (u.isEmpty) return;
  await launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
}

/// Status history, shown in the follow-up dialog and in the details.
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
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if ('${h['from'] ?? ''}'.isNotEmpty) ...[
                Text(tr(soStatusOf(vocab, h['from']).$2, soStatusOf(vocab, h['from']).$3), style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                const Text(' ← ', style: TextStyle(fontSize: 13, color: T.inkSoft)),
              ],
              Text(tr(soStatusOf(vocab, h['to']).$2, soStatusOf(vocab, h['to']).$3), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
              const Spacer(),
              Text(soFmtDT(h['at']), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ]),
            if ('${h['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${h['note']}', style: const TextStyle(fontSize: 14.5, height: 1.35))),
            // Every file of the entry; older entries carry one in fileUrl.
            for (final f in soLogFiles(h))
              InkWell(
                onTap: () => soOpenFile('${f['fileUrl']}'),
                child: Padding(padding: const EdgeInsets.only(top: 3), child: Row(children: [
                  const Icon(Icons.attach_file, size: 13, color: T.orange),
                  Flexible(child: Text('${f['fileName'] ?? tr('المرفق', 'Attachment')}', style: const TextStyle(fontSize: 11.5, color: T.orange, fontWeight: FontWeight.w700))),
                ])),
              ),
            if ('${h['byName'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text('${h['byName']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
          ]),
        ),
    ]);
  }
}

/// Follow-up dialog: a status moves with an optional note; the 'voucher sent' status cannot be saved without its file, and 'cancelled' cannot be saved without a reason from the cancellation reasons list. Returns true if saved.
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
  // The bond can be several pages or photos.
  final List<PickedFile> _files = [];
  bool _busy = false;

  @override
  void dispose() { _note.dispose(); _reason.dispose(); super.dispose(); }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _save() async {
    final o = widget.order;
    final prev = '${o['status'] ?? ''}';
    if (_needsFile.contains(_status) && _status != prev && _files.isEmpty) {
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
        if (_files.isNotEmpty) 'files': [for (final f in _files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}],
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
        Text(tr('تغيير الحالة', 'Change status'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 19)),
        Text('${tr('أمر نقل', 'Transport order')} ${soRef(o)}${'${o['customerName'] ?? ''}'.isNotEmpty ? ' · ${o['customerName']}' : ''}${'${o['fromCity'] ?? ''}'.isNotEmpty ? ' · ${o['fromCity']} → ${o['toCity'] ?? ''}' : ''}',
            style: const TextStyle(fontSize: 13.5, color: T.inkSoft)),
        const SizedBox(height: 14),
        Text(tr('الحالة', 'Status'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 8),
        // Large buttons in two columns: readable and tappable without zooming.
        LayoutBuilder(builder: (c, box) {
          final w = (box.maxWidth - 8) / 2;
          return Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in widget.vocab)
              SizedBox(width: w, height: 50, child: Material(
                color: _status == s.$1 ? s.$4 : Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: _status == s.$1 ? s.$4 : T.line, width: 1.5)),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => setState(() => _status = s.$1),
                  child: Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 6), child: FittedBox(fit: BoxFit.scaleDown,
                      child: Text(tr(s.$2, s.$3), style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800,
                          color: _status == s.$1 ? Colors.white : T.ink))))),
                ),
              )),
          ]);
        }),
        if (_status == 'cancelled' && o['status'] != 'cancelled') ...[
          const SizedBox(height: 12),
          LookupField(type: 'so_cancel_reason', controller: _reason, label: '${tr('سبب الإلغاء', 'Cancellation reason')} *',
              fallback: const ['إلغاء من السائق', 'إلغاء من العميل', 'إلغاء من المندوب']),
        ],
        const SizedBox(height: 12),
        TextField(controller: _note, maxLines: 2, style: const TextStyle(fontSize: 16), decoration: InputDecoration(
          labelText: tr('ملاحظة (اختياري)', 'Note (optional)'),
          hintText: tr('سببُ النقلة إن كان لها سبب…', 'Why it moved, if there is a reason…'),
        )),
        if (_needsFile.contains(_status)) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.attach_file),
            label: Text(_files.isEmpty ? '${tr('صورة السند أو ملفه', 'Bond file')} *' : tr('إضافة ملف آخر', 'Add another file')),
            onPressed: () async {
              final picked = await pickFilesAsDataUrls();
              if (picked.isEmpty) return;
              final big = picked.where((f) => f.sizeBytes > 20 * 1024 * 1024).toList();
              if (big.isNotEmpty) _say(tr('«${big.first.fileName}» أكبر من 20 ميجابايت ولم يُضَف.', '"${big.first.fileName}" is larger than 20MB and was skipped.'));
              setState(() => _files.addAll(picked.where((f) => f.sizeBytes <= 20 * 1024 * 1024).take(10 - _files.length)));
            },
          ),
          for (final f in _files)
            Row(children: [
              const Icon(Icons.insert_drive_file_outlined, size: 14, color: T.inkSoft),
              const SizedBox(width: 4),
              Expanded(child: Text('${f.fileName} · ${(f.sizeBytes / 1024).round()}KB', style: const TextStyle(fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
              IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 16, color: T.danger), onPressed: () => setState(() => _files.remove(f))),
            ]),
          if (_files.isEmpty) Text(tr('لا تُحفَظ الحالة بلا إرفاق السند — يمكن رفع أكثر من ملف.', 'The status is not saved without the bond file — several files are allowed.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ],
        if (log.isNotEmpty) ...[
          const Divider(height: 24),
          Text('${tr('السجل', 'History')} ${log.length}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const SizedBox(height: 6),
          SoStatusLog(log: log, vocab: widget.vocab),
        ],
        const SizedBox(height: 12),
        SizedBox(height: 52, child: FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
          label: Text(tr('حفظ', 'Save'), style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w800)),
        )),
      ])),
    ));
  }
}
