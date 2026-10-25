import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/vehicle_month_log.dart';
import 'jp.dart' show JpTaskPanel;
import 'fleet_new_shipment.dart';

/// تفاصيل الشحنة — the SAME detail view the web opens: full info, the status
/// control, the follow-up form, and the complete event history (إنشاء /
/// تغييرات الحالة / تغيير سائق / متابعات) as a timeline.
class FleetShipmentDetailsScreen extends StatefulWidget {
  final String shipmentId;
  const FleetShipmentDetailsScreen({super.key, required this.shipmentId});

  @override
  State<FleetShipmentDetailsScreen> createState() => _FleetShipmentDetailsScreenState();
}

const _statuses = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

// أدوارُ القسم — نفس FLEET_EDIT_ROLES / FLEET_ADMIN_ROLES في الويب (lib/fleet.ts)
// وفي routes/fleet.js: التعديلُ لـ EDIT، والحذفُ لـ ADMIN.
const _fleetEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'];
const _fleetAdminRoles = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

const _eventMeta = {
  'created': ('أُنشئت الحمولة', 'Created', Icons.add_circle_outline, T.success),
  'status': ('تغيير حالة', 'Status change', Icons.swap_horiz_rounded, T.info),
  'driver_change': ('تغيير سائق', 'Driver change', Icons.badge_outlined, T.violet),
  'followup': ('متابعة', 'Follow-up', Icons.phone_in_talk_outlined, T.cyan),
  'updated': ('تعديل', 'Edited', Icons.edit_outlined, T.inkSoft),
};

class _FleetShipmentDetailsScreenState extends State<FleetShipmentDetailsScreen> {
  Map<String, dynamic>? _shipment;
  List<Map<String, dynamic>> _events = [];
  Map<String, List<Map<String, dynamic>>> _lk = {};
  bool _loading = true;
  String? _error;

  String _lkLabel(String type, String? key) {
    if (key == null || key.isEmpty) return '';
    final it = (_lk[type] ?? const []).firstWhere((x) => (x['key'] ?? '').toString() == key, orElse: () => const {});
    if (it.isEmpty) return key;
    return (Lang.instance.ar ? (it['nameAr'] ?? it['nameEn']) : (it['nameEn'] ?? it['nameAr'])).toString();
  }
  final _location = TextEditingController();
  final _note = TextEditingController();
  // وقتُ المتابعة (الآن افتراضًا) ومتوقّعُ الوصول (اختياري) — كنموذج الويب.
  DateTime _contactTime = DateTime.now();
  DateTime? _fuArrival;
  bool _busy = false;

  // canEditFleet / canAdminFleet: الدورُ أو صلاحيةُ «تعديل» على القسم.
  bool get _editor {
    final a = context.read<AuthProvider>();
    return _fleetEditRoles.contains(a.role) || a.canEditSection('Fleet Management');
  }
  bool get _admin {
    final a = context.read<AuthProvider>();
    return _fleetAdminRoles.contains(a.role) || a.canEditSection('Fleet Management');
  }
  bool _printing = false;
  late final void Function() _onLive;

  /// الملاحظاتُ الجاهزة — تُقرأ من قوائم القسم لا من الشيفرة.
  ///
  /// كانت سبعةَ سطورٍ مكتوبةً هنا وثمانيةً في الويب، **ومختلفةً بينهما**:
  /// «نايم — استراحة» في الجوّال و«متوقف — استراحة» في الموقع، فتخرج تقاريرُ
  /// بصيغتين لنفس الحالة. صارت قائمةً واحدة تُدار من إعدادات الأسطول، وهذه
  /// نسخةٌ احتياطيّة تُستعمل ما دام الجلبُ لم يصل فقط.
  static const _fallbackNotes = [
    'في الطريق إلى موقع التنزيل', 'في الطريق إلى موقع التحميل', 'حمَّل وتحرّك',
    'متوقف — استراحة', 'فارغ', 'متوقف — عُطل على الطريق', 'وصل موقع التنزيل', 'جارٍ التفريغ',
  ];
  List<String> _quickNotes = List<String>.from(_fallbackNotes);

  Future<void> _loadQuickNotes() async {
    try {
      final d = await Api.instance.get('/api/lookups?type=fleet_followup_note');
      final items = List<Map<String, dynamic>>.from(
          ((d as Map)['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
      final names = items
          .map((i) => (i['nameAr'] ?? i['nameEn'] ?? '').toString().trim())
          .where((x) => x.isNotEmpty)
          .toList();
      if (names.isNotEmpty && mounted) setState(() => _quickNotes = names);
    } catch (_) { /* تبقى النسخةُ الاحتياطيّة */ }
  }

  @override
  void initState() {
    super.initState();
    _loadQuickNotes();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    _location.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/fleet/shipments/${widget.shipmentId}'),
        if (_lk.isEmpty) Api.instance.get('/api/lookups?type=fleet_rent_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        if (_lk.isEmpty) Api.instance.get('/api/lookups?type=fleet_payment_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        if (_lk.isEmpty) Api.instance.get('/api/lookups?type=fleet_load_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
      ]);
      final d = results[0];
      if (!mounted) return;
      setState(() {
        _shipment = d['shipment'] as Map<String, dynamic>?;
        _events = List<Map<String, dynamic>>.from(d['events'] ?? []);
        if (results.length > 3) {
          _lk = {
            'fleet_rent_type': List<Map<String, dynamic>>.from(results[1]['items'] ?? []),
            'fleet_payment_type': List<Map<String, dynamic>>.from(results[2]['items'] ?? []),
            'fleet_load_type': List<Map<String, dynamic>>.from(results[3]['items'] ?? []),
          };
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _setStatus(String v) async {
    try {
      await Api.instance.patch('/api/fleet/shipments/${widget.shipmentId}/status', {'status': v});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _sendFollowUp() async {
    if ((_location.text.trim().isEmpty && _note.text.trim().isEmpty) || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/fleet/shipments/${widget.shipmentId}/followups', {
        'contactTime': _contactTime.toUtc().toIso8601String(),
        'currentLocation': _location.text.trim(),
        'note': _note.text.trim(),
        'expectedArrival': _fuArrival?.toUtc().toIso8601String(),
      });
      _location.clear();
      _note.clear();
      if (mounted) setState(() { _contactTime = DateTime.now(); _fuArrival = null; });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // منتقي تاريخٍ ووقت — للمتابعة.
  Future<DateTime?> _pickDateTime(DateTime? initial, {required DateTime first, required DateTime last}) async {
    final init = initial ?? DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: init.isBefore(first) ? first : (init.isAfter(last) ? last : init),
      firstDate: first,
      lastDate: last,
    );
    if (d == null || !mounted) return null;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(init));
    return DateTime(d.year, d.month, d.day, t?.hour ?? init.hour, t?.minute ?? init.minute);
  }

  String _dtLocal(DateTime d) => '${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';

  // تعديل الحمولة — نفس شاشة الإنشاء بمعرّفها، ويُعاد الجلبُ عند العودة.
  Future<void> _edit() async {
    final saved = await Navigator.push<bool>(context,
        MaterialPageRoute(builder: (c) => FleetNewShipmentScreen(editId: widget.shipmentId)));
    if (saved == true) _load();
  }

  // حذف الحمولة — تأكيدٌ ثم DELETE ثم الرجوع للقائمة (تتحدّث عبر fleet:updated).
  Future<void> _delete(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف الحمولة', 'Delete shipment')),
        content: Text(tr('حذف الشحنة بوليصة رقم ${s['waybillNumber'] ?? ''} (${s['customerName'] ?? '—'})؟',
            'Delete shipment, waybill ${s['waybillNumber'] ?? ''}?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await Api.instance.delete('/api/fleet/shipments/${widget.shipmentId}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _dt(String? v) {
    final d = v != null ? DateTime.tryParse(v)?.toLocal() : null;
    if (d == null) return '—';
    return '${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  // طباعة/مشاركة البوليصة — نفس ملف الويب بالضبط: الخادم يولّده على ترويسة
  // الشركة بالختم (Puppeteer + pdf-lib)، ونطبع البايتات كما هي.
  Future<void> _print(Map<String, dynamic> s) async {
    final id = s['_id']?.toString();
    if (id == null) return;
    setState(() => _printing = true);
    try {
      final bytes = await Api.instance.getBytes('/api/fleet/shipments/$id/waybill.pdf?lang=${Lang.instance.ar ? 'ar' : 'en'}');
      await Printing.layoutPdf(
        onLayout: (_) async => bytes,
        name: 'بوليصة-${s['waybillNumber'] ?? id}',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر توليد البوليصة', 'Could not generate the waybill'))),
        );
      }
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  String _eventText(Map<String, dynamic> e) {
    final data = e['data'] as Map<String, dynamic>? ?? {};
    switch (e['type']) {
      case 'created':
        return tr('بوليصة رقم ${data['waybillNumber'] ?? ''}', 'Waybill ${data['waybillNumber'] ?? ''}');
      case 'status':
        final st = _statuses[data['to'] ?? data['status']];
        return st != null ? tr('إلى «${st.$1}»', 'To "${st.$2}"') : (data['to'] ?? '').toString();
      case 'followup':
        return [
          if ((data['currentLocation'] ?? '').toString().isNotEmpty) '${tr('الموقع', 'Location')}: ${data['currentLocation']}',
          if ((data['note'] ?? '').toString().isNotEmpty) data['note'].toString(),
        ].join(' — ');
      case 'driver_change':
        return (data['text'] ?? '').toString();
      default:
        return (data['text'] ?? data['note'] ?? '').toString();
    }
  }

  /// لوحةُ السيّارة قد تصل كائنًا مُعبّأً أو لقطةً نصّية — والسجلُّ يُطلب بأيّهما.
  String get _vehiclePlate {
    final v = _shipment?['vehicle'];
    if (v is Map && (v['plate'] ?? '').toString().isNotEmpty) return v['plate'].toString();
    return (_shipment?['vehiclePlate'] ?? '').toString();
  }

  /// شهرُ الحمولة لا الشهرُ الجاري: من يفتح بوليصةً من مايو يريد سجلَّ مايو.
  String get _shipmentMonth {
    final d = DateTime.tryParse((_shipment?['loadDate'] ?? _shipment?['createdAt'] ?? '').toString());
    final x = d ?? DateTime.now();
    return '${x.year}-${x.month.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final s = _shipment;
    final st = s != null ? (_statuses[s['status']] ?? ('—', '—', T.inkFaint)) : ('—', '—', T.inkFaint);
    return AppScaffold(
      title: Text(s != null ? '${tr('بوليصة', 'Waybill')} ${s['waybillNumber'] ?? ''}' : tr('تفاصيل الشحنة', 'Shipment')),
      actions: [
        if (s != null)
          IconButton(
            icon: _printing
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.print_outlined),
            tooltip: tr('طباعة / مشاركة', 'Print / share'),
            onPressed: _printing ? null : () => _print(s),
          ),
        if (s != null && _editor)
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: tr('تعديل', 'Edit'),
            onPressed: _edit,
          ),
        if (s != null && _admin)
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: tr('حذف', 'Delete'),
            onPressed: () => _delete(s),
          ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 140), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 260),
            ])
          : _error != null || s == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      // بطاقة المعلومات الرئيسية
                      FadeSlideIn(
                        child: AppCard(
                          topAccent: st.$3,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}',
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                              const Spacer(),
                              Chip2(tr(st.$1, st.$2), st.$3),
                            ]),
                            const SizedBox(height: 10),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              if ((s['customerName'] ?? '').toString().isNotEmpty)
                                Chip2(s['customerName'].toString(), T.navy, icon: Icons.people_outline),
                              if ((s['vehiclePlate'] ?? '').toString().isNotEmpty)
                                Chip2(s['vehiclePlate'].toString(), T.cyan, icon: Icons.local_shipping_outlined),
                              if ((s['driverName'] ?? '').toString().isNotEmpty)
                                Chip2(s['driverName'].toString(), T.inkSoft, icon: Icons.person_outline),
                              if ((s['supervisorName'] ?? '').toString().isNotEmpty)
                                Chip2('${tr('المشرف', 'Supervisor')}: ${s['supervisorName']}', T.violet, icon: Icons.supervisor_account_outlined),
                              if (s['loadDate'] != null)
                                Chip2('${tr('التحميل', 'Load')}: ${_dt(s['loadDate'])}', T.info, icon: Icons.event_outlined),
                              if (s['expectedArrival'] != null)
                                Chip2('${tr('الوصول المتوقع', 'ETA')}: ${_dt(s['expectedArrival'])}', T.warn, icon: Icons.schedule_outlined),
                              if ((num.tryParse((s['price'] ?? '').toString()) ?? 0) > 0)
                                Chip2('${tr('إيجار السيارة', 'Vehicle rent')}: ${s['price']}', T.success, icon: Icons.payments_outlined),
                              if ((num.tryParse((s['fullRent'] ?? '').toString()) ?? 0) > 0)
                                Chip2('${tr('الإيجار كامل', 'Full rent')}: ${s['fullRent']}', T.cyan, icon: Icons.account_balance_wallet_outlined),
                              if (s['customerType'] == 'heavy')
                                Chip2(tr('نقل ثقيل', 'Heavy'), T.violet, icon: Icons.workspace_premium_outlined),
                              if (s['customerType'] == 'branch')
                                Chip2(tr('عميل فروع', 'Branch'), T.info, icon: Icons.store_outlined),
                              if (_lkLabel('fleet_load_type', (s['loadType'] ?? '').toString()).isNotEmpty)
                                Chip2(_lkLabel('fleet_load_type', (s['loadType'] ?? '').toString()), T.inkSoft, icon: Icons.category_outlined),
                              if (_lkLabel('fleet_rent_type', (s['rentType'] ?? '').toString()).isNotEmpty)
                                Chip2(_lkLabel('fleet_rent_type', (s['rentType'] ?? '').toString()), T.navy, icon: Icons.swap_horiz_outlined),
                              if (_lkLabel('fleet_payment_type', (s['paymentType'] ?? '').toString()).isNotEmpty)
                                Chip2(_lkLabel('fleet_payment_type', (s['paymentType'] ?? '').toString()), T.inkSoft, icon: Icons.credit_card_outlined),
                              if ((num.tryParse((s['driverExpense'] ?? '').toString()) ?? 0) > 0)
                                Chip2('${tr('مصروف السائق', 'Driver expense')}: ${s['driverExpense']}', T.warn, icon: Icons.account_balance_wallet_outlined),
                              if ((s['branch'] ?? '').toString().isNotEmpty)
                                Chip2('${tr('الفرع', 'Branch')}: ${s['branch']}', T.inkSoft, icon: Icons.store_mall_directory_outlined),
                            ]),
                            // اتصال/واتساب على رقم السائق مباشرة من التفاصيل.
                            Builder(builder: (_) {
                              final phone = (s['driverPhone'] ?? (s['driver'] is Map ? s['driver']['phone'] : null) ?? '').toString();
                              if (phone.isEmpty) return const SizedBox.shrink();
                              return Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Row(children: [
                                  Text('${tr('السائق', 'Driver')}: ${s['driverName'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
                                  const Spacer(),
                                  ContactButtons(phone: phone, compact: true),
                                ]),
                              );
                            }),
                            if ((s['notes'] ?? '').toString().isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Text(s['notes'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                            ],
                            const SizedBox(height: 12),
                            DropdownButtonFormField<String>(
                              initialValue: (s['status'] ?? '').toString().isEmpty ? null : s['status'],
                              decoration: InputDecoration(labelText: tr('تغيير الحالة', 'Change status')),
                              items: _statuses.entries
                                  .map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2))))
                                  .toList(),
                              onChanged: (v) { if (v != null) _setStatus(v); },
                            ),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      // تسجيل متابعة — للمحرّرين فقط كالويب (والخادمُ يردّ غيرهم بـ403).
                      if (_editor) FadeSlideIn(
                        delayMs: 80,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('تسجيل متابعة', 'Log a follow-up'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            const SizedBox(height: 10),
                            Row(children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  icon: const Icon(Icons.access_time, size: 18),
                                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
                                  label: Text('${tr('وقت المتابعة', 'Contact time')}: ${_dtLocal(_contactTime)}', style: const TextStyle(fontSize: 12.5)),
                                  onPressed: () async {
                                    final now = DateTime.now();
                                    final v = await _pickDateTime(_contactTime,
                                        first: now.subtract(const Duration(days: 30)), last: now.add(const Duration(days: 1)));
                                    if (v != null) setState(() => _contactTime = v);
                                  },
                                ),
                              ),
                            ]),
                            const SizedBox(height: 8),
                            Row(children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  icon: const Icon(Icons.schedule_outlined, size: 18),
                                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
                                  label: Text(_fuArrival == null
                                      ? tr('متوقع الوصول (اختياري)', 'Expected arrival (optional)')
                                      : '${tr('متوقع الوصول', 'ETA')}: ${_dtLocal(_fuArrival!)}', style: const TextStyle(fontSize: 12.5)),
                                  onPressed: () async {
                                    final now = DateTime.now();
                                    final v = await _pickDateTime(_fuArrival,
                                        first: now.subtract(const Duration(days: 1)), last: now.add(const Duration(days: 30)));
                                    if (v != null) setState(() => _fuArrival = v);
                                  },
                                ),
                              ),
                              if (_fuArrival != null)
                                IconButton(
                                  icon: const Icon(Icons.close, size: 18),
                                  tooltip: tr('مسح', 'Clear'),
                                  onPressed: () => setState(() => _fuArrival = null),
                                ),
                            ]),
                            const SizedBox(height: 8),
                            TextField(controller: _location, decoration: InputDecoration(labelText: tr('الموقع الحالي', 'Current location'))),
                            const SizedBox(height: 8),
                            TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة المتابعة', 'Note'))),
                            const SizedBox(height: 8),
                            Wrap(spacing: 6, runSpacing: 6, children: _quickNotes.map((n) => ActionChip(
                                  label: Text(n, style: const TextStyle(fontSize: 11.5)),
                                  onPressed: () => setState(() => _note.text = n),
                                  backgroundColor: T.navy.withValues(alpha: 0.06),
                                  side: BorderSide.none,
                                )).toList()),
                            const SizedBox(height: 10),
                            FilledButton.icon(
                              icon: const Icon(Icons.phone_in_talk_outlined),
                              onPressed: _busy ? null : _sendFollowUp,
                              label: Text(tr('حفظ المتابعة', 'Save follow-up')),
                            ),
                          ]),
                        ),
                      ),
                      if (_editor) const SizedBox(height: 12),
                      // ── سجلّ السيّارة الشهريّ ────────────────────────────
                      // أحداثُ هذه الشحنة أدناه تجيب «أين هي». وهذا يجيب
                      // السؤال الآخر: ماذا جرى لهذه السيّارة هذا الشهر —
                      // عطلٌ وإطارٌ وستُّ حمولاتٍ بينها. والشهرُ يُقفل مع
                      // أوّل الشهر التالي.
                      if (_vehiclePlate.isNotEmpty)
                        FadeSlideIn(
                          delayMs: 130,
                          child: VehicleMonthLog(
                            vehicle: _vehiclePlate,
                            month: _shipmentMonth,
                            canEdit: _editor,
                            shipmentId: widget.shipmentId,
                          ),
                        ),
                      if (_vehiclePlate.isNotEmpty) const SizedBox(height: 12),
                      // سجل الأحداث الكامل — نفس هيستوري السيستم.
                      FadeSlideIn(
                        delayMs: 140,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              const Icon(Icons.history_rounded, size: 18, color: T.navy),
                              const SizedBox(width: 6),
                              Text(tr('سجل الأحداث', 'Event history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                              const Spacer(),
                              Chip2('${_events.length}', T.navy),
                            ]),
                            const SizedBox(height: 12),
                            if (_events.isEmpty)
                              Text(tr('لا توجد أحداث بعد', 'No events yet'), style: const TextStyle(color: T.inkFaint, fontSize: 13)),
                            ..._events.map((e) {
                              final meta = _eventMeta[e['type']] ?? _eventMeta['updated']!;
                              final isLast = e == _events.last;
                              return IntrinsicHeight(
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Column(children: [
                                    Container(
                                      padding: const EdgeInsets.all(6),
                                      decoration: BoxDecoration(
                                        color: meta.$4.withValues(alpha: 0.12),
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(meta.$3, size: 15, color: meta.$4),
                                    ),
                                    if (!isLast)
                                      Expanded(child: Container(width: 2, color: const Color(0xFFE8EDF4))),
                                  ]),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.only(bottom: 14),
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Text(tr(meta.$1, meta.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                          const Spacer(),
                                          Text(_dt(e['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                        ]),
                                        if (_eventText(e).isNotEmpty)
                                          Text(_eventText(e), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                        if ((e['byName'] ?? '').toString().isNotEmpty)
                                          Text(e['byName'], style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                      ]),
                                    ),
                                  ),
                                ]),
                              );
                            }),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                      JpTaskPanel(section: 'fleet', kind: 'fleetShipment', refId: '${s['_id'] ?? widget.shipmentId}'),
                    ],
                  ),
                ),
    );
  }
}
