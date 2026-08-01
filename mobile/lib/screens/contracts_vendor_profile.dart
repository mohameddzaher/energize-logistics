import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الملف التحليلي لمورد 3PL — بيانات المورد وحالة العقد والسعة،
/// وجدول التشغيل الشهري (عدد الطلبات ونسبة استغلال السعة).
class ContractsVendorProfileScreen extends StatefulWidget {
  final String vendorId;
  final String name;
  const ContractsVendorProfileScreen({super.key, required this.vendorId, required this.name});
  @override
  State<ContractsVendorProfileScreen> createState() => _ContractsVendorProfileScreenState();
}

const _monthsAr = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class _ContractsVendorProfileScreenState extends State<ContractsVendorProfileScreen> {
  Map<String, dynamic>? _vendor;
  List<Map<String, dynamic>> _util = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/contracts/vendors/${widget.vendorId}');
      if (!mounted) return;
      setState(() {
        _vendor = d['vendor'] is Map ? Map<String, dynamic>.from(d['vendor']) : {};
        _util = List<Map<String, dynamic>>.from((d['utilisation'] ?? []) as List);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  Future<void> _uploadAttachment() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('رفع مرفق', 'Upload attachment')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(picked.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 8),
          TextField(controller: title, autofocus: true, decoration: InputDecoration(labelText: tr('العنوان', 'Title'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('رفع', 'Upload'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/contracts/vendors/${widget.vendorId}/attachments', {
        'dataUrl': picked.dataUrl, 'fileName': picked.fileName, 'title': title.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _deleteAttachment(Map<String, dynamic> att) async {
    try { await Api.instance.delete('/api/contracts/vendors/${widget.vendorId}/attachments/${att['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final v = _vendor ?? {};
    final status = (v['status'] ?? '').toString();
    final statusMeta = {
      'signed': ('موقّع الطرفين', 'Signed', T.success),
      'pending': ('عقد ناقص', 'Pending', T.warn),
      'unsigned': ('بلا عقد', 'Unsigned', T.danger),
    }[status] ?? ('—', '—', T.inkFaint);
    final capacity = _n(v['monthlyCapacity']);
    final maxOrders = _util.fold<num>(1, (m, r) => _n(r['orders']) > m ? _n(r['orders']) : m);

    final attachments = List<Map<String, dynamic>>.from(v['attachments'] ?? []);
    return AppScaffold(
      title: Text(widget.name),
      actions: [
        IconButton(icon: const Icon(Icons.upload_file_outlined), tooltip: tr('رفع مرفق', 'Upload attachment'), onPressed: _loading ? null : _uploadAttachment),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(height: 220)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: statusMeta.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((v['name'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                            Chip2(tr(statusMeta.$1, statusMeta.$2), statusMeta.$3),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if (v['fleetSize'] != null) Chip2('${tr('الأسطول', 'Fleet')}: ${v['fleetSize']}', T.navy, icon: Icons.local_shipping_outlined),
                            if (capacity > 0) Chip2('${tr('السعة الشهرية', 'Capacity')}: ${capacity.round()}', T.violet),
                            if (v['paymentType'] != null && v['paymentType'].toString().isNotEmpty) Chip2(v['paymentType'].toString(), T.info),
                            if (v['rating'] != null) Chip2('★ ${v['rating']}', T.orange),
                            Chip2(v['vendorSideContract'] == true ? tr('عقد المورد ✓', 'Vendor side ✓') : tr('عقد المورد ✗', 'Vendor side ✗'), v['vendorSideContract'] == true ? T.success : T.danger),
                            Chip2(v['ourSideContract'] == true ? tr('عقدنا ✓', 'Our side ✓') : tr('عقدنا ✗', 'Our side ✗'), v['ourSideContract'] == true ? T.success : T.danger),
                          ]),
                          ...[
                            (Icons.person_outline, v['contactPerson']),
                            (Icons.phone_outlined, v['phone']),
                            (Icons.email_outlined, v['email']),
                            (Icons.notes_outlined, v['notes']),
                          ].where((x) => (x.$2 ?? '').toString().isNotEmpty).map((x) => Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Icon(x.$1, size: 15, color: T.inkFaint),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(x.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                                ]),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    FadeSlideIn(
                      delayMs: 50,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('التشغيل الشهري', 'Monthly utilisation'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 10),
                          if (_util.isEmpty)
                            Text(tr('لا يوجد تشغيل مسجل لهذا المورد', 'No utilisation recorded'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ..._util.reversed.take(18).map((r) {
                            final orders = _n(r['orders']);
                            final pct = capacity > 0 ? (orders / capacity * 100) : null;
                            final month = _n(r['month']).toInt();
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 7),
                              child: Row(children: [
                                SizedBox(
                                  width: 86,
                                  child: Text('${tr(_monthsAr[month.clamp(0, 12)], _monthsEn[month.clamp(0, 12)])} ${r['year'] ?? ''}',
                                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                ),
                                Expanded(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: (orders / maxOrders).clamp(0.02, 1).toDouble(),
                                      minHeight: 12,
                                      backgroundColor: T.navy.withValues(alpha: 0.06),
                                      color: pct != null && pct > 100 ? T.danger : T.navy,
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  width: 92,
                                  child: Text(' ${orders.round()}${pct != null ? ' · ${pct.toStringAsFixed(0)}%' : ''}',
                                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                                ),
                              ]),
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── المرفقات ──
                    FadeSlideIn(
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text('${tr('المرفقات', 'Attachments')} (${attachments.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            TextButton.icon(onPressed: _uploadAttachment, icon: const Icon(Icons.add, size: 16), label: Text(tr('رفع', 'Upload'))),
                          ]),
                          if (attachments.isEmpty)
                            Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(tr('لا توجد مرفقات', 'No attachments'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))),
                          ...attachments.map((att) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Row(children: [
                                  const Icon(Icons.attach_file_rounded, size: 17, color: T.navy),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text((att['title'] ?? att['fileName'] ?? att['originalName'] ?? '—').toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                  IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => _deleteAttachment(att)),
                                ]),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
