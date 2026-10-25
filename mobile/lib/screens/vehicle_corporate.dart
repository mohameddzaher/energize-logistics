import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/flex_match.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show money, fmtDate, daysText;

/// وثائق التأمين على مستوى الشركة — نظيرُ /system/vehicles/registry/corporate.
///
/// تأمين البضائع وخيانة الأمانة: غير مرتبطة بمركبة، وانتهاءُ واحدةٍ يوقف العمل
/// كله. إنشاء وتعديل وتجديد (فردي وجماعي) وإنهاء وإعادة فتح وحذف، وقائمةُ
/// السائقين المشمولين — بنفس نقاط النهاية وبوّابات الأدوار في الويب.

// ── بوّاباتُ القسم — نسخةُ canEditVehicles / canAdminVehicles في الويب ──────
const _editRoles = ['super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'];
const _adminRoles = ['super_admin', 'admin', 'vehicles_manager', 'hr_manager'];
bool canEditVehiclesOf(AuthProvider a) =>
    a.user != null && (_editRoles.contains(a.role) || a.canEditSection('Vehicles'));
bool canAdminVehiclesOf(AuthProvider a) =>
    a.user != null && (_adminRoles.contains(a.role) || (a.role != 'client' && a.canEditSection('Vehicles')));

// ── حالاتُ المستند — STATE_META في الويب ────────────────────────────────────
const _stateMeta = <String, (String, String, Color)>{
  'expired': ('منتهي', 'Expired', Color(0xFFDC2626)),
  'due': ('قارب على الانتهاء', 'Due soon', Color(0xFFF59E0B)),
  'valid': ('ساري', 'Valid', Color(0xFF16A34A)),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('تحذير', 'Warning', Color(0xFFF59E0B)),
  'upcoming': ('قريب', 'Upcoming', Color(0xFF0EA5E9)),
  'missing': ('مطلوب — بلا تاريخ', 'Needed — no date', Color(0xFF94A3B8)),
  'not_applicable': ('غير مطلوب', 'Not applicable', Color(0xFF64748B)),
};
Color vStateColor(dynamic s) => _stateMeta[(s ?? 'valid').toString()]?.$3 ?? const Color(0xFF64748B);
String vStateLabel(dynamic s) {
  final m = _stateMeta[(s ?? '').toString()];
  return m == null ? (s ?? '—').toString() : tr(m.$1, m.$2);
}

// ── ماذا تغطّي الوثيقة ─────────────────────────────────────────────────────
const _subjects = [
  ('vehicles', 'السيارات', 'Vehicles',
    'يُحسب القسط لكل سيارة: اكتب سعر السيارة وعددها ويُحسب الإجمالي — أو اكتب الإجمالي مباشرةً.',
    'Priced per vehicle: enter the rate and the count, or the total directly.'),
  ('goods', 'البضائع', 'Goods', 'تأمين على البضائع المنقولة — قسط إجمالي واحد.', 'Cargo cover — one total premium.'),
  ('drivers', 'السائقين', 'Drivers',
    'مثل خيانة الأمانة: القسط لكل سائق، والإجمالي من عدد السائقين المشمولين بأسمائهم — يزيد بمن يدخل وينقص بمن يخرج.',
    'Like fidelity: priced per named driver; the total follows the number covered.'),
  ('other', 'أخرى', 'Other', 'قسط إجمالي واحد.', 'One total premium.'),
];
String _subjectOf(Map p) => (p['coverageSubject'] ?? (p['coversDrivers'] == true ? 'drivers' : 'other')).toString();
(String, String, String, String, String) _subject(String k) =>
    _subjects.firstWhere((x) => x.$1 == k, orElse: () => _subjects.last);

String _ymd(DateTime d) => d.toIso8601String().substring(0, 10);
num? _num(String v) => v.trim().isEmpty ? null : num.tryParse(v.trim());
List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.map((e) => Map<String, dynamic>.from(e as Map)).toList() : [];

void _snack(BuildContext c, String m, {bool error = false}) =>
    ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m), backgroundColor: error ? T.danger : null));

Future<bool> _confirm(BuildContext c, String msg, {String? okLabel, bool danger = false}) async {
  final r = await showDialog<bool>(
    context: c,
    builder: (d) => AlertDialog(
      content: Text(msg),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: T.danger) : null,
          onPressed: () => Navigator.pop(d, true), child: Text(okLabel ?? tr('تأكيد', 'OK')),
        ),
      ],
    ),
  );
  return r == true;
}

Future<String?> _prompt(BuildContext c, String label) async {
  final ctl = TextEditingController();
  final r = await showDialog<String>(
    context: c,
    builder: (d) => AlertDialog(
      title: Text(label, style: const TextStyle(fontSize: 15)),
      content: TextField(controller: ctl, autofocus: true),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(d, ctl.text), child: Text(tr('تأكيد', 'OK'))),
      ],
    ),
  );
  ctl.dispose();
  return r;
}

Future<String?> _pickDate(BuildContext c, String current, {DateTime? first}) async {
  final init = DateTime.tryParse(current) ?? DateTime.now();
  final lo = first ?? DateTime(2000);
  final d = await showDatePicker(
    context: c, initialDate: init.isBefore(lo) ? lo : init, firstDate: lo, lastDate: DateTime(2100));
  return d == null ? null : _ymd(d);
}

class VehicleCorporatePoliciesScreen extends StatefulWidget {
  const VehicleCorporatePoliciesScreen({super.key});
  @override
  State<VehicleCorporatePoliciesScreen> createState() => _VehicleCorporatePoliciesScreenState();
}

class _VehicleCorporatePoliciesScreenState extends State<VehicleCorporatePoliciesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  final Set<String> _picked = {};
  int _seq = 0; // ردٌّ قديم لا يكتب فوق أحدث
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/vehicle-registry/corporate-policies');
      if (!mounted || my != _seq) return;
      setState(() {
        _rows = _maps(d['policies']);
        _picked.removeWhere((id) => !_rows.any((p) => p['_id'] == id));
        _loading = false; _error = null;
      });
    } catch (e) {
      if (!mounted || my != _seq) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // أعمدةُ الملفّ — نفسُ أعمدة تصدير الويب.
  List<ExportCol> get _cols => [
        ExportCol('الوثيقة', 'Policy', (r) => r['scopeAr']),
        ExportCol('المؤمَّن له', 'Policyholder', (r) => r['policyholderAr']),
        ExportCol('شركة التأمين', 'Insurer', (r) => r['companyAr']),
        ExportCol('أرقام الوثيقة', 'Policy numbers', (r) => ((r['policyNumbers'] as List?) ?? []).join(' · ')),
        ExportCol('تاريخ البداية', 'Start', (r) => fmtDate(r['startDate'])),
        ExportCol('تاريخ الانتهاء', 'Expiry', (r) => fmtDate(r['expiryDate'])),
        ExportCol('المتبقي (يوم)', 'Days left', (r) => r['daysRemaining']),
        ExportCol('الحالة', 'State', (r) => vStateLabel(r['state'])),
        ExportCol('تغطّي', 'Covers', (r) => _subject(_subjectOf(r)).$2),
        ExportCol('القسط لكل سائق سنويًّا', 'Per driver / yr', (r) => r['premiumPerPersonSar'] == null ? '' : money(r['premiumPerPersonSar'])),
        ExportCol('القسط لكل سيارة', 'Per vehicle', (r) => r['premiumPerVehicleSar'] == null ? '' : money(r['premiumPerVehicleSar'])),
        ExportCol('عدد السيارات', 'Vehicles', (r) => r['vehicleCount'] ?? ''),
        ExportCol('السائقون المشمولون', 'Drivers covered', (r) => r['drivers'] is Map ? r['drivers']['coveredCount'] : ''),
        ExportCol('القسط الإجمالي', 'Total premium', (r) => money(r['computedPremiumSar'] ?? r['premiumSar'] ?? 0)),
        ExportCol('المشمولون', 'Covered names', (r) => r['drivers'] is Map
            ? _maps(r['drivers']['covered']).map((d) => d['name'] ?? d['idNumber']).join(' · ') : ''),
        ExportCol('مطلوب ضمُّهم', 'To be added', (r) => r['drivers'] is Map
            ? _maps(r['drivers']['pending']).map((d) => d['name'] ?? d['idNumber']).join(' · ') : ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notesAr']),
      ];

  Future<void> _end(Map<String, dynamic> p) async {
    final who = (p['companyAr'] ?? p['scopeAr'] ?? '').toString();
    if (!await _confirm(context,
        tr('يُنهى العقدُ مع «$who»؟ لن تعود الوثيقةُ تُطالِب بتجديد.', 'End the contract with "$who"? It will stop asking to be renewed.'),
        okLabel: tr('إنهاء', 'End'), danger: true)) { return; }
    if (!mounted) return;
    final reason = await _prompt(context, tr('سبب الإنهاء (اختياري)', 'Reason (optional)'));
    try {
      await Api.instance.post('/api/vehicle-registry/corporate-policies/${p['_id']}/end', {'reason': reason ?? ''});
      _load();
    } catch (e) { if (mounted) _snack(context, e.toString(), error: true); }
  }

  Future<void> _reopen(Map<String, dynamic> p) async {
    try {
      await Api.instance.post('/api/vehicle-registry/corporate-policies/${p['_id']}/reopen', {});
      _load();
    } catch (e) { if (mounted) _snack(context, e.toString(), error: true); }
  }

  Future<void> _delete(Map<String, dynamic> p) async {
    if (!await _confirm(context, tr('حذف «${p['scopeAr']}»؟ تبقى في السجلّ ولا تظهر في الشاشات.', 'Delete “${p['scopeAr']}”?'),
        okLabel: tr('حذف', 'Delete'), danger: true)) { return; }
    try {
      await Api.instance.delete('/api/vehicle-registry/corporate-policies/${p['_id']}');
      if (mounted) _snack(context, tr('حُذفت', 'Deleted'));
      _load();
    } catch (e) { if (mounted) _snack(context, e.toString(), error: true); }
  }

  Future<void> _sheet(Widget child) => showModalBottomSheet(
        context: context, isScrollControlled: true, useSafeArea: true,
        builder: (_) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom), child: child),
      );

  void _renew(Map<String, dynamic> p) => _sheet(_RenewSheet(p: p, onDone: () { setState(_picked.clear); _load(); }));
  void _edit(Map<String, dynamic> p) => _sheet(_PolicyForm(p: p, onDone: _load));
  void _bulk() {
    final chosen = _rows.where((p) => _picked.contains(p['_id'])).toList();
    _sheet(_BulkRenewSheet(policies: chosen, onReload: _load, onDone: () { setState(_picked.clear); _load(); }));
  }

  void _roster(Map<String, dynamic> p, bool canEdit) => Navigator.push(context, MaterialPageRoute(
      builder: (_) => _DriverRosterScreen(policyId: p['_id'].toString(), initial: p, canEdit: canEdit, onChanged: _load)));

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final canEdit = canEditVehiclesOf(auth);
    final canDelete = canAdminVehiclesOf(auth);
    final chosen = _rows.where((p) => _picked.contains(p['_id'])).length;
    return AppScaffold(
      title: Text(tr('وثائق تأمين الشركة', 'Company Policies')),
      actions: [
        ExportButton(fileName: 'company-policies', sheetName: tr('وثائق الشركة', 'Company policies'), columns: _cols, rows: () => _rows),
        if (canEdit)
          IconButton(tooltip: tr('وثيقة جديدة', 'New policy'), icon: const Icon(Icons.add), onPressed: () => _edit({})),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(14), children: [
                        Text(tr('وثائق غير مرتبطة بمركبة بعينها — انتهاؤها يوقف العمل كله', 'Not tied to any vehicle — their expiry stops everything'),
                            style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                        const SizedBox(height: 10),
                        if (_rows.isEmpty) EmptyState(icon: Icons.verified_user_outlined, title: tr('لا توجد وثائق', 'No policies')),
                        for (final p in _rows) ...[
                          _card(p, canEdit, canDelete),
                          const SizedBox(height: 10),
                        ],
                      ]),
                    ),
                  ),
                  // شريطُ التحديد — تجديدٌ جماعي بتاريخ واحد
                  if (canEdit && chosen > 0)
                    SafeArea(
                      top: false,
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                        decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: T.line))),
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                            Text(tr('$chosen وثيقة محدَّدة', '$chosen selected'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                            Text(tr('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          ])),
                          IconButton(tooltip: tr('إلغاء التحديد', 'Clear'), icon: const Icon(Icons.close), onPressed: () => setState(_picked.clear)),
                          FilledButton(
                            style: FilledButton.styleFrom(backgroundColor: T.success),
                            onPressed: _bulk,
                            child: Text(tr('تجديدها بتاريخ واحد ($chosen)', 'Renew to one date ($chosen)')),
                          ),
                        ]),
                      ),
                    ),
                ]),
    );
  }

  Widget _fact(String label, String value, {Color? color}) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        const SizedBox(height: 2),
        Text(value.isEmpty ? '—' : value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color ?? T.ink)),
      ]);

  Widget _card(Map<String, dynamic> p, bool canEdit, bool canDelete) {
    final id = p['_id'].toString();
    final st = (p['state'] ?? 'valid').toString();
    final col = vStateColor(st);
    final subj = _subjectOf(p);
    final s = _subject(subj);
    final perPerson = p['premiumPerPersonSar'];
    final perVehicle = p['premiumPerVehicleSar'];
    final drivers = p['drivers'] is Map ? Map<String, dynamic>.from(p['drivers']) : <String, dynamic>{};
    final covered = _maps(drivers['covered']);
    final pending = _maps(drivers['pending']);
    final coveredCount = (drivers['coveredCount'] ?? 0) as num;
    final numbers = ((p['policyNumbers'] as List?) ?? []).map((e) => e.toString()).toList();
    final renewals = _maps(p['renewals']).reversed.toList();
    final ended = p['endedAt'] != null;
    final picked = _picked.contains(id);

    final premiumLabel = subj == 'drivers' && perPerson != null
        ? tr('القسط لكل سائق سنويًّا (ر.س)', 'Premium per driver / yr')
        : subj == 'vehicles' && perVehicle != null
            ? tr('القسط لكل سيارة (ر.س)', 'Premium per vehicle')
            : tr('القسط الإجمالي (ر.س)', 'Total premium (SAR)');
    final premiumValue = subj == 'drivers' && perPerson != null
        ? money(perPerson)
        : subj == 'vehicles' && perVehicle != null
            ? money(perVehicle)
            : ((p['premiumSar'] ?? 0) != 0 ? money(p['premiumSar']) : '—');

    return Container(
      decoration: picked ? BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: T.orange.withValues(alpha: 0.6), width: 2)) : null,
      child: AppCard(
        topAccent: st == 'valid' ? null : col,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (canEdit)
              SizedBox(
                width: 32, height: 28,
                child: Checkbox(
                  value: picked, activeColor: T.orange,
                  onChanged: (_) => setState(() => picked ? _picked.remove(id) : _picked.add(id)),
                ),
              ),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((p['scopeAr'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
              if ((p['policyholderAr'] ?? '').toString().isNotEmpty)
                Text(p['policyholderAr'].toString(), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            ])),
            Chip2(vStateLabel(st), col),
          ]),
          const SizedBox(height: 12),
          Wrap(spacing: 18, runSpacing: 10, children: [
            SizedBox(width: 140, child: _fact(tr('شركة التأمين', 'Insurer'), (p['companyAr'] ?? '').toString())),
            SizedBox(width: 140, child: _fact(tr('ينتهي في', 'Expires'), fmtDate(p['expiryDate']))),
            SizedBox(width: 140, child: _fact(tr('المتبقي', 'Remaining'), daysText(p['daysRemaining']), color: col)),
            SizedBox(width: 140, child: _fact(premiumLabel, premiumValue)),
            SizedBox(width: 140, child: _fact(tr('تغطّي', 'Covers'),
                '${tr(s.$2, s.$3)}${subj == 'vehicles' && p['vehicleCount'] != null ? ' (${p['vehicleCount']})' : ''}')),
          ]),
          if (subj == 'drivers' && perPerson != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
              tr('الإجمالي: ${money(p['computedPremiumSar'] ?? 0)} ر.س — $coveredCount سائق × ${money(perPerson)}',
                 'Total ${money(p['computedPremiumSar'] ?? 0)} SAR — $coveredCount drivers × ${money(perPerson)}'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
          if (subj == 'vehicles' && p['computedPremiumSar'] != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
              tr('الإجمالي: ${money(p['computedPremiumSar'])} ر.س — ${p['vehicleCount']} سيارة × ${money(perVehicle)}',
                 'Total ${money(p['computedPremiumSar'])} SAR — ${p['vehicleCount']} vehicles × ${money(perVehicle)}'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),

          if (p['coversDrivers'] == true) ...[
            const Divider(height: 22),
            Row(children: [
              const Icon(Icons.groups_outlined, size: 16, color: T.orange),
              const SizedBox(width: 6),
              Expanded(child: Text.rich(TextSpan(style: const TextStyle(fontSize: 11.5, color: T.inkFaint), children: [
                TextSpan(text: '${tr('السائقون المشمولون', 'Drivers covered')}: '),
                TextSpan(text: '$coveredCount', style: const TextStyle(fontWeight: FontWeight.w800, color: T.ink)),
                if (pending.isNotEmpty)
                  TextSpan(text: ' · ${tr('${pending.length} مطلوب ضمُّه', '${pending.length} to add')}',
                      style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700)),
              ]))),
              TextButton(
                onPressed: () => _roster(p, canEdit),
                child: Text(canEdit ? tr('عرض وتعديل', 'View & edit') : tr('عرض', 'View'), style: const TextStyle(fontSize: 12)),
              ),
            ]),
            Wrap(spacing: 4, runSpacing: 4, children: [
              for (final d in covered.take(8))
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFFECFDF5), borderRadius: BorderRadius.circular(5), border: Border.all(color: const Color(0xFFD1FAE5))),
                  child: Text((d['name'] ?? d['idNumber'] ?? '').toString(), style: const TextStyle(fontSize: 10.5, color: Color(0xFF065F46))),
                ),
              if (coveredCount > 8) Text('+${coveredCount - 8}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ],

          if (numbers.isNotEmpty) ...[
            const Divider(height: 22),
            Text(tr('أرقام الوثيقة', 'Policy numbers'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            const SizedBox(height: 4),
            Wrap(spacing: 6, runSpacing: 4, children: [
              for (final n in numbers)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(5), border: Border.all(color: const Color(0xFFF1F5F9))),
                  child: Text(n, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 11, fontFamily: 'monospace', color: T.inkSoft)),
                ),
            ]),
          ],

          if (renewals.isNotEmpty) ...[
            const Divider(height: 22),
            Text(tr('سجل التجديد', 'Renewal history'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            const SizedBox(height: 4),
            for (final r in renewals)
              Text.rich(TextSpan(style: const TextStyle(fontSize: 11.5, color: T.inkFaint), children: [
                TextSpan(text: '${fmtDate(r['previousExpiry'])} → '),
                TextSpan(text: fmtDate(r['newExpiry']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.inkSoft)),
                if ((r['cost'] ?? 0) != 0) TextSpan(text: ' · ${money(r['cost'])} ${tr('ر.س', 'SAR')}'),
                if ((r['byName'] ?? '').toString().isNotEmpty) TextSpan(text: ' · ${r['byName']}'),
              ])),
          ],

          if (canEdit) ...[
            const SizedBox(height: 12),
            Row(children: [
              // الإنهاءُ فعلٌ غيرُ التجديد — وما أُنهي يُعاد فتحه
              if (ended)
                Expanded(child: OutlinedButton.icon(
                  onPressed: () => _reopen(p), icon: const Icon(Icons.refresh, size: 16),
                  label: Text(tr('إعادة فتح العقد', 'Reopen'), style: const TextStyle(fontSize: 12.5))))
              else
                OutlinedButton(
                  onPressed: () => _end(p),
                  child: Text(tr('إنهاء العقد', 'End contract'), style: const TextStyle(fontSize: 12.5))),
              const SizedBox(width: 6),
              Expanded(child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.success),
                onPressed: ended ? null : () => _renew(p),
                icon: const Icon(Icons.refresh, size: 16), label: Text(tr('تجديد', 'Renew')))),
              IconButton(tooltip: tr('تعديل بيانات الوثيقة', 'Edit policy'), icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _edit(p)),
              if (canDelete)
                IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 20, color: T.danger), onPressed: () => _delete(p)),
            ]),
          ],
        ]),
      ),
    );
  }
}

// ══════════════════ تجديد وثيقة ══════════════════
class _RenewSheet extends StatefulWidget {
  final Map<String, dynamic> p;
  final VoidCallback onDone;
  const _RenewSheet({required this.p, required this.onDone});
  @override
  State<_RenewSheet> createState() => _RenewSheetState();
}

class _RenewSheetState extends State<_RenewSheet> {
  late String _newExpiry;
  final _cost = TextEditingController();
  final _ref = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // سنةٌ بعد الانتهاء الحالي إن لم يفُت، وإلّا سنةٌ من اليوم — كما في الويب
    final cur = DateTime.tryParse((widget.p['expiryDate'] ?? '').toString());
    final base = cur != null && cur.isAfter(DateTime.now()) ? cur : DateTime.now();
    _newExpiry = _ymd(DateTime(base.year + 1, base.month, base.day));
  }

  @override
  void dispose() { _cost.dispose(); _ref.dispose(); super.dispose(); }

  Future<void> _save() async {
    if (_newExpiry.isEmpty) { _snack(context, tr('اختر التاريخ الجديد', 'Pick a date'), error: true); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/vehicle-registry/corporate-policies/${widget.p['_id']}/renew',
          {'newExpiry': _newExpiry, 'cost': _num(_cost.text), 'reference': _ref.text.trim()});
      if (!mounted) return;
      final m = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      m.showSnackBar(SnackBar(content: Text(tr('تم التجديد حتى $_newExpiry', 'Renewed until $_newExpiry'))));
      widget.onDone();
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _snack(context, e.toString(), error: true); }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text(tr('تجديد الوثيقة', 'Renew policy'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: T.success)),
        const SizedBox(height: 4),
        Text('${widget.p['scopeAr'] ?? ''} · ${tr('تنتهي', 'expires')} ${fmtDate(widget.p['expiryDate'])}', style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
        const SizedBox(height: 14),
        _DateField(label: '${tr('تاريخ الانتهاء الجديد', 'New expiry')} *', value: _newExpiry, onChanged: (v) => setState(() => _newExpiry = v)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: TextField(controller: _cost, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('القسط (ر.س)', 'Premium (SAR)')))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _ref, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('رقم الوثيقة الجديد', 'New policy no.')))),
        ]),
        const SizedBox(height: 16),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: T.success, padding: const EdgeInsets.symmetric(vertical: 13)),
          onPressed: _busy ? null : _save, icon: const Icon(Icons.check),
          label: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('تأكيد التجديد', 'Confirm')),
        ),
      ]),
    );
  }
}

class _DateField extends StatelessWidget {
  final String label, value;
  final ValueChanged<String> onChanged;
  final DateTime? first;
  final bool clearable;
  const _DateField({required this.label, required this.value, required this.onChanged, this.first, this.clearable = false});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () async { final v = await _pickDate(context, value, first: first); if (v != null) onChanged(v); },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: clearable && value.isNotEmpty
                ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => onChanged(''))
                : const Icon(Icons.calendar_today_outlined, size: 18),
          ),
          child: Text(value.isEmpty ? '—' : value, textDirection: TextDirection.ltr),
        ),
      );
}

// ══════════════════ تجديد جماعي بتاريخ واحد ══════════════════
// لا endpoint جماعي: نداءات متتابعة، عدّاد أثناء التنفيذ، أسماء صريحة لما فشل،
// وإعادة المحاولة تمسّ ما فشل وحده — كما في الويب.
class _BulkRenewSheet extends StatefulWidget {
  final List<Map<String, dynamic>> policies;
  final VoidCallback onDone, onReload;
  const _BulkRenewSheet({required this.policies, required this.onDone, required this.onReload});
  @override
  State<_BulkRenewSheet> createState() => _BulkRenewSheetState();
}

class _BulkRenewSheetState extends State<_BulkRenewSheet> {
  String _newExpiry = '';
  final _cost = TextEditingController();
  final _ref = TextEditingController();
  bool _busy = false;
  int _done = 0;
  List<(String, String)> _failed = [];
  final Set<String> _succeeded = {};

  @override
  void dispose() { _cost.dispose(); _ref.dispose(); super.dispose(); }

  String get _today => _ymd(DateTime.now());
  bool get _past => _newExpiry.isNotEmpty && _newExpiry.compareTo(_today) < 0;
  List<Map<String, dynamic>> get _pending => widget.policies.where((p) => !_succeeded.contains(p['_id'])).toList();

  Future<void> _save() async {
    final run = _pending;
    setState(() { _busy = true; _done = 0; _failed = []; });
    var ok = 0;
    final bad = <(String, String)>[];
    for (final p in run) {
      try {
        await Api.instance.post('/api/vehicle-registry/corporate-policies/${p['_id']}/renew',
            {'newExpiry': _newExpiry, 'cost': _num(_cost.text), 'reference': _ref.text.trim()});
        ok += 1; _succeeded.add(p['_id'].toString());
        if (mounted) setState(() => _done = ok);
      } catch (e) {
        bad.add(((p['scopeAr'] ?? p['_id']).toString(), e.toString()));
        if (mounted) setState(() => _failed = [...bad]);
      }
    }
    if (!mounted) return;
    setState(() => _busy = false);
    final m = ScaffoldMessenger.of(context);
    if (bad.isEmpty) {
      Navigator.pop(context);
      m.showSnackBar(SnackBar(content: Text(tr('تم تجديد ${_succeeded.length} وثيقة حتى $_newExpiry', 'Renewed ${_succeeded.length} policies until $_newExpiry'))));
      widget.onDone();
      return;
    }
    _snack(context, tr('جُدِّدت ${_succeeded.length} من ${widget.policies.length} — وفشلت ${bad.length}',
        'Renewed ${_succeeded.length} of ${widget.policies.length} — ${bad.length} failed'), error: true);
    widget.onReload();
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.policies.length;
    final pending = _pending.length;
    return PopScope(
      canPop: !_busy,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Text(tr('تجديد جماعي', 'Bulk renewal'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          const SizedBox(height: 6),
          Text(tr('$n وثيقة هتتجدّد لنفس التاريخ', '$n policies will get the same date'), style: const TextStyle(fontSize: 12.5)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final p in widget.policies) Chip2((p['scopeAr'] ?? '').toString(), T.inkSoft),
          ]),
          const SizedBox(height: 12),
          _DateField(label: '${tr('تاريخ الانتهاء الجديد', 'New expiry date')} *', value: _newExpiry, first: DateTime.now().subtract(const Duration(days: 1)),
              onChanged: (v) => setState(() => _newExpiry = v)),
          if (_past)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('التاريخ في الماضي — راجعه', 'That date is in the past'),
                style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700))),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: TextField(controller: _cost, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('القسط لكل وثيقة (ر.س)', 'Premium per policy (SAR)')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _ref, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('رقم الوثيقة الجديد', 'New policy no.')))),
          ]),
          if (_busy)
            Padding(padding: const EdgeInsets.only(top: 10), child: Text(tr('جارٍ التجديد… $_done/$pending', 'Renewing… $_done/$pending'), style: const TextStyle(fontWeight: FontWeight.w700))),
          if (_failed.isNotEmpty && !_busy)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: const Color(0xFFFFF1F2), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFFECDD3))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('جُدِّدت ${_succeeded.length} — ولم تُجدَّد هذه:', 'Renewed ${_succeeded.length} — these were not renewed:'),
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Color(0xFF881337))),
                for (final f in _failed) Text('${f.$1} — ${f.$2}', style: const TextStyle(fontSize: 11.5, color: Color(0xFF9F1239))),
              ]),
            ),
          const SizedBox(height: 16),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.success, padding: const EdgeInsets.symmetric(vertical: 13)),
            onPressed: _busy || _newExpiry.isEmpty || _past ? null : _save,
            child: Text(_busy
                ? tr('جارٍ التجديد… $_done/$pending', 'Renewing… $_done/$pending')
                : _newExpiry.isEmpty
                    ? tr('اختر التاريخ أولًا', 'Pick the date first')
                    : _failed.isNotEmpty
                        ? tr('إعادة المحاولة على $pending وثيقة', 'Retry $pending policies')
                        : tr('تجديد $n وثيقة', 'Renew $n policies')),
          ),
        ]),
      ),
    );
  }
}

// ══════════════════ استمارةُ الوثيقة (جديدة/تعديل) ══════════════════
class _PolicyForm extends StatefulWidget {
  final Map<String, dynamic> p;
  final VoidCallback onDone;
  const _PolicyForm({required this.p, required this.onDone});
  @override
  State<_PolicyForm> createState() => _PolicyFormState();
}

class _PolicyFormState extends State<_PolicyForm> {
  late final bool _isNew = widget.p['_id'] == null;
  late final _scope = TextEditingController(text: (widget.p['scopeAr'] ?? '').toString());
  late final _holder = TextEditingController(text: (widget.p['policyholderAr'] ?? '').toString());
  late final _company = TextEditingController(text: (widget.p['companyAr'] ?? '').toString());
  late final _numbers = TextEditingController(text: ((widget.p['policyNumbers'] as List?) ?? []).join('، '));
  late final _perPerson = TextEditingController(text: (widget.p['premiumPerPersonSar'] ?? '').toString());
  late final _perVehicle = TextEditingController(text: (widget.p['premiumPerVehicleSar'] ?? '').toString());
  late final _vehCount = TextEditingController(text: (widget.p['vehicleCount'] ?? '').toString());
  late final _premium = TextEditingController(text: (widget.p['premiumSar'] ?? '').toString());
  late final _status = TextEditingController(text: (widget.p['statusAr'] ?? '').toString());
  late final _notes = TextEditingController(text: (widget.p['notesAr'] ?? '').toString());
  late String _start = _d(widget.p['startDate']);
  late String _expiry = _d(widget.p['expiryDate']);
  late String _subj = _subjectOf(widget.p);
  bool _busy = false;

  static String _d(dynamic v) => v == null || v.toString().isEmpty ? '' : v.toString().split('T').first;

  @override
  void dispose() {
    for (final c in [_scope, _holder, _company, _numbers, _perPerson, _perVehicle, _vehCount, _premium, _status, _notes]) { c.dispose(); }
    super.dispose();
  }

  num? get _vehTotal {
    final a = _num(_perVehicle.text), b = _num(_vehCount.text);
    if (a == null || b == null) return null;
    return (a * b * 100).round() / 100;
  }

  Future<void> _save() async {
    if (_scope.text.trim().isEmpty) { _snack(context, tr('اكتب اسم الوثيقة', 'Enter the policy name'), error: true); return; }
    setState(() => _busy = true);
    try {
      final vt = _vehTotal;
      final body = {
        'scopeAr': _scope.text.trim(), 'policyholderAr': _holder.text.trim(), 'companyAr': _company.text.trim(),
        'policyNumbers': _numbers.text, 'startDate': _start.isEmpty ? null : _start, 'expiryDate': _expiry.isEmpty ? null : _expiry,
        'statusAr': _status.text.trim(), 'notesAr': _notes.text.trim(),
        'coverageSubject': _subj,
        'premiumPerPersonSar': _subj == 'drivers' ? _num(_perPerson.text) : null,
        'premiumPerVehicleSar': _subj == 'vehicles' ? _num(_perVehicle.text) : null,
        'vehicleCount': _subj == 'vehicles' ? _num(_vehCount.text) : null,
        // السائقون يُحسب إجماليُّهم من القائمة؛ والسيّارات من السعر × العدد إن كُتبا
        'premiumSar': _subj == 'drivers' ? null : (_subj == 'vehicles' && vt != null ? vt : _num(_premium.text)),
      };
      if (_isNew) {
        await Api.instance.post('/api/vehicle-registry/corporate-policies', body);
      } else {
        await Api.instance.put('/api/vehicle-registry/corporate-policies/${widget.p['_id']}', body);
      }
      if (!mounted) return;
      final m = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      m.showSnackBar(SnackBar(content: Text(_isNew ? tr('أُضيفت الوثيقة', 'Policy added') : tr('حُفظت', 'Saved'))));
      widget.onDone();
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _snack(context, e.toString(), error: true); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _subject(_subj);
    final vt = _vehTotal;
    InputDecoration dec(String l) => InputDecoration(labelText: l);
    const numKb = TextInputType.numberWithOptions(decimal: true);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text(_isNew ? tr('وثيقة جديدة', 'New policy') : tr('تعديل الوثيقة', 'Edit policy'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
        const SizedBox(height: 12),
        TextField(controller: _scope, autofocus: _isNew, decoration: dec('${tr('اسم الوثيقة', 'Policy name')} *')),
        const SizedBox(height: 10),
        TextField(controller: _holder, decoration: dec(tr('المؤمَّن له', 'Policyholder'))),
        const SizedBox(height: 10),
        TextField(controller: _company, decoration: dec(tr('شركة التأمين', 'Insurer'))),
        const SizedBox(height: 10),
        TextField(controller: _numbers, textDirection: TextDirection.ltr, decoration: dec(tr('أرقام الوثيقة (تُفصَل بفاصلة)', 'Policy numbers (comma separated)'))),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _DateField(label: tr('تاريخ البداية', 'Start date'), value: _start, clearable: true, onChanged: (v) => setState(() => _start = v))),
          const SizedBox(width: 10),
          Expanded(child: _DateField(label: tr('تاريخ الانتهاء', 'Expiry date'), value: _expiry, clearable: true, onChanged: (v) => setState(() => _expiry = v))),
        ]),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('الوثيقة تغطّي', 'This policy covers'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final x in _subjects)
                ChoiceChip(
                  label: Text(tr(x.$2, x.$3)), selected: _subj == x.$1,
                  selectedColor: T.orange.withValues(alpha: 0.15),
                  onSelected: (_) => setState(() => _subj = x.$1),
                ),
            ]),
            const SizedBox(height: 6),
            Text(tr(s.$4, s.$5), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 8),
            if (_subj == 'drivers')
              TextField(controller: _perPerson, keyboardType: numKb, decoration: dec(tr('القسط لكل سائق سنويًّا (ر.س)', 'Per driver / year (SAR)'))),
            if (_subj == 'vehicles') Row(children: [
              Expanded(child: TextField(controller: _perVehicle, keyboardType: numKb, onChanged: (_) => setState(() {}), decoration: dec(tr('القسط لكل سيارة (ر.س)', 'Per vehicle (SAR)')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _vehCount, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: dec(tr('عدد السيارات', 'Number of vehicles')))),
            ]),
            if (_subj != 'drivers') ...[
              const SizedBox(height: 10),
              if (_subj == 'vehicles' && vt != null)
                InputDecorator(
                  decoration: dec(tr('القسط الإجمالي (ر.س)', 'Total premium (SAR)')),
                  child: Text('${money(vt)}  ${tr('= ${_vehCount.text} سيارة × ${money(_num(_perVehicle.text))}', '= ${_vehCount.text} × ${money(_num(_perVehicle.text))}')}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                )
              else
                TextField(controller: _premium, keyboardType: numKb, decoration: dec(tr('القسط الإجمالي (ر.س)', 'Total premium (SAR)'))),
            ],
          ]),
        ),
        const SizedBox(height: 10),
        TextField(controller: _status, decoration: dec(tr('الحالة', 'Status'))),
        const SizedBox(height: 10),
        TextField(controller: _notes, decoration: dec(tr('ملاحظات', 'Notes'))),
        const SizedBox(height: 16),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: T.orange, padding: const EdgeInsets.symmetric(vertical: 13)),
          onPressed: _busy ? null : _save,
          child: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ', 'Save')),
        ),
      ]),
    );
  }
}

// ══════════════════ قائمةُ المشمولين ══════════════════
// الأسماء من سجلّ بطاقات السائقين، والضمّ والإخراج يُكتبان فيه
// (POST corporate-policies/:id/drivers). تُعاد قراءة الوثيقة بعد كل تغيير.
class _DriverRosterScreen extends StatefulWidget {
  final String policyId;
  final Map<String, dynamic> initial;
  final bool canEdit;
  final VoidCallback onChanged;
  const _DriverRosterScreen({required this.policyId, required this.initial, required this.canEdit, required this.onChanged});
  @override
  State<_DriverRosterScreen> createState() => _DriverRosterScreenState();
}

class _DriverRosterScreenState extends State<_DriverRosterScreen> {
  late Map<String, dynamic> _p = widget.initial;
  String _q = '';
  // متحكِّمٌ للشاشة: الخانةُ لا تعود فارغةً إذا مُرِّرت خارج الشاشة ثم عادت
  final _searchCtl = TextEditingController();
  String? _busyId;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _reload();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); _searchCtl.dispose(); super.dispose(); }

  Future<void> _reload() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/vehicle-registry/corporate-policies');
      if (!mounted || my != _seq) return;
      final p = _maps(d['policies']).where((x) => x['_id'] == widget.policyId);
      if (p.isNotEmpty) setState(() => _p = p.first);
    } catch (_) {}
  }

  Future<void> _toggle(Map<String, dynamic> d, bool next) async {
    setState(() => _busyId = d['_id'].toString());
    try {
      await Api.instance.post('/api/vehicle-registry/corporate-policies/${widget.policyId}/drivers', {'cardId': d['_id'], 'covered': next});
      final who = (d['name'] ?? d['idNumber'] ?? '').toString();
      if (mounted) _snack(context, next ? tr('ضُمَّ $who', 'Added') : tr('أُخرِج $who', 'Removed'));
      widget.onChanged();
      await _reload();
    } catch (e) {
      if (mounted) _snack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  bool _match(Map d) {
    final q = flexFold(_q.trim());
    if (q.isEmpty) return true;
    return [d['name'], d['idNumber'], d['employeeNumber']].any((x) => flexFold(x).contains(q));
  }

  Widget _row(Map<String, dynamic> d, bool on) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((d['name'] ?? '—').toString(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text('${d['idNumber'] ?? ''}${(d['employeeNumber'] ?? '').toString().isNotEmpty ? ' · ${d['employeeNumber']}' : ''}${(d['addedDate'] ?? '').toString().isNotEmpty ? ' · ${d['addedDate']}' : ''}',
                textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 11, color: T.inkFaint, fontFamily: 'monospace')),
          ])),
          if (widget.canEdit)
            on
                ? OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: T.danger, visualDensity: VisualDensity.compact),
                    onPressed: _busyId == d['_id'] ? null : () => _toggle(d, false),
                    child: Text(tr('إخراج', 'Remove')))
                : FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: T.success, visualDensity: VisualDensity.compact),
                    onPressed: _busyId == d['_id'] ? null : () => _toggle(d, true),
                    child: Text(tr('ضمّ', 'Add'))),
        ]),
      );

  Widget _group(List<Map<String, dynamic>> list, bool on, Color border) {
    final shown = list.where(_match).toList();
    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: border)),
      child: shown.isEmpty
          ? Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا نتائج', 'No results'), style: const TextStyle(fontSize: 12, color: T.inkFaint)))
          : Column(children: [
              for (var i = 0; i < shown.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                _row(shown[i], on),
              ],
            ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final drivers = _p['drivers'] is Map ? Map<String, dynamic>.from(_p['drivers']) : <String, dynamic>{};
    final covered = _maps(drivers['covered']);
    final pending = _maps(drivers['pending']);
    final per = _p['premiumPerPersonSar'];
    return AppScaffold(
      title: Text(tr('السائقون المشمولون', 'Drivers covered')),
      body: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
        Text((_p['scopeAr'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
        const SizedBox(height: 8),
        SearchField(
          controller: _searchCtl,
          onChanged: (v) => setState(() => _q = v),
          hint: tr('ابحث بالاسم أو الهوية أو الرقم الوظيفي…', 'Name, ID or employee no…'),
        ),
        if (per != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(
            tr('القسط لكل سائق ${money(per)} ر.س سنويًّا — الإجمالي الآن ${money((num.tryParse('$per') ?? 0) * covered.length)} ر.س',
               '${money(per)} SAR per person — total now ${money((num.tryParse('$per') ?? 0) * covered.length)} SAR'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
        const SizedBox(height: 14),
        if (pending.isNotEmpty) ...[
          Text(tr('مطلوب ضمُّهم (${pending.length})', 'To be added (${pending.length})'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.danger)),
          const SizedBox(height: 6),
          _group(pending, false, const Color(0xFFFECDD3)),
          const SizedBox(height: 14),
        ],
        Text(tr('مشمولون (${covered.length})', 'Covered (${covered.length})'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.success)),
        const SizedBox(height: 6),
        _group(covered, true, T.line),
        const SizedBox(height: 12),
        Text(tr('الأسماءُ من سجلّ بطاقات السائقين، والضمُّ والإخراج يُكتبان فيه — فلا تفترق هذه الشاشة عن صفحة البطاقات ولا عن شاشة التفاويض.',
                'Names come from the driver-card register and changes are written there, so this screen cannot drift from the cards page or the authorisations tab.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
      ]),
    );
  }
}
