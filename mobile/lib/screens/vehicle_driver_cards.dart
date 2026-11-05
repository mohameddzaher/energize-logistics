import '../ui/person_docs.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/flex_match.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart' show callNumber;
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show VehicleRegistryDetailScreen;

/// Driver cards: a register in the vehicles section (mirrors /system/vehicles/driver-cards).
/// A card is a document that expires and must be renewed, and it has a logistics record under which it is issued. The server derives hasCard, state, daysLeft and vehicleClass; they are not computed here.

// Breach of trust cover: 'required' means a working driver whom the policy does not cover.
const _fidelity = {
  'covered': ('مشمول', 'Covered', T.success),
  'required': ('مطلوب ضمُّه', 'Required', T.danger),
  '': ('غير محدَّد', 'Not set', T.inkFaint),
};
(String, String, Color) _fid(dynamic s) => _fidelity['${s ?? ''}'] ?? _fidelity['']!;

// Transport type: derived by the server from the registration type of the vehicles authorized to him.
const _vclass = {
  'heavy': ('نقل ثقيل', 'Heavy', Color(0xFF4F46E5)),
  'light': ('مركبة خاصة', 'Private', Color(0xFF0D9488)),
  'motorcycle': ('دراجة آلية', 'Motorcycle', Color(0xFF7C3AED)),
  'none': ('بلا تفويض', 'No auth.', T.inkFaint),
};
(String, String, Color) _vc(dynamic s) => _vclass['${s ?? 'none'}'] ?? _vclass['none']!;

// Expiry chips by name, not by day counts; the threshold is set in section settings.
const _state = {
  'expired': ('منتهية', 'Expired', T.danger),
  'critical': ('حرجة', 'Critical', Color(0xFFEA580C)),
  'warning': ('تحذير', 'Warning', Color(0xFFD97706)),
  'upcoming': ('قريبة', 'Soon', Color(0xFF0284C7)),
  'valid': ('سارية', 'Valid', T.success),
  'unknown': ('بلا تاريخ', 'No date', T.inkFaint),
};
(String, String, Color) _st(dynamic s) => _state['${s ?? ''}'] ?? _state['unknown']!;

// Edit roles as on web (canEdit); the server guards with the same ADMIN roles.
const _editRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'hr_manager'];

String _s(dynamic v) => v == null ? '' : '$v';
String _d10(dynamic v) { final s = _s(v); return s.length >= 10 ? s.substring(0, 10) : s; }

class VehicleDriverCardsScreen extends StatefulWidget {
  /// Initial status chip the screen opens with, from the driver card in the overview.
  final String initialState;
  const VehicleDriverCardsScreen({super.key, this.initialState = ''});
  @override
  State<VehicleDriverCardsScreen> createState() => _VehicleDriverCardsScreenState();
}

class _VehicleDriverCardsScreenState extends State<VehicleDriverCardsScreen> {
  List<Map<String, dynamic>> _cards = [];
  Map<String, dynamic> _totals = {};
  List<String> _optReg = [], _optType = [];
  List<Map<String, dynamic>> _optClass = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  final _qc = TextEditingController();
  late String _fState = widget.initialState;
  String _fReg = '', _fType = '', _fFid = '', _fClass = '', _fHas = '', _fIqama = '', _fLicense = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (mounted) _load(); };
    Live.instance.on('vreg:updated', _onLive);
    _load();
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); _qc.dispose(); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vehicle-registry/driver-cards');
      if (!mounted || mine != _seq) return;
      final o = Map<String, dynamic>.from(d['options'] ?? {});
      setState(() {
        _cards = List<Map<String, dynamic>>.from(d['cards'] ?? []);
        _totals = Map<String, dynamic>.from(d['totals'] ?? {});
        _optReg = [for (final x in (o['logisticRegister'] as List? ?? [])) '$x'];
        _optType = [for (final x in (o['cardType'] as List? ?? [])) '$x'];
        _optClass = List<Map<String, dynamic>>.from(o['vehicleClass'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool get _canEdit {
    final a = context.read<AuthProvider>();
    return _editRoles.contains(a.role) || a.canEditSection('Vehicles');
  }

  List<Map<String, dynamic>> get _shown {
    final n = flexFold(_q);
    return _cards.where((c) {
      if (_fState.isNotEmpty && c['state'] != _fState) return false;
      final has = c['hasCard'] == true;
      final vc = _s(c['vehicleClass']);
      // 'Light' covers the motorbike and the private vehicle, like the card split.
      if (_fClass == 'light') {
        if (!has || !['light', 'motorcycle'].contains(vc)) return false;
      } else if (_fClass == 'heavy') {
        if (!has || vc != 'heavy') return false;
      } else if (_fClass.isNotEmpty && (vc.isEmpty ? 'none' : vc) != _fClass) {
        return false;
      }
      if (_fHas == 'yes' && !has) return false;
      if (_fHas == 'no' && has) return false;
      if (_fReg.isNotEmpty && _s(c['logisticRegister']) != _fReg) return false;
      if (_fType.isNotEmpty && _s(c['cardType']) != _fType) return false;
      if (_fFid.isNotEmpty && _s((c['fidelity'] as Map?)?['status']) != _fFid) return false;
      if (_fIqama.isNotEmpty && _s(c['iqamaState']) != _fIqama) return false;
      if (_fLicense.isNotEmpty && _s(c['licenseState']) != _fLicense) return false;
      if (n.isEmpty) return true;
      final emp = c['employee'] is Map ? c['employee'] as Map : const {};
      return [c['name'], c['idNumber'], c['cardNumber'], c['absherPhone'], c['logisticRegister'], c['cardType'], c['notes'],
        emp['employeeNumber'], emp['arabicName'],
        ...((c['authorizations'] as List?) ?? []).map((a) => (a as Map)['plateNumber'])].any((v) => flexFold(v).contains(n));
    }).toList();
  }

  int get _activeF => [_fState, _fReg, _fType, _fFid, _fHas, _fClass, _fIqama, _fLicense].where((x) => x.isNotEmpty).length;

  List<ExportCol> get _cols => [
        ExportCol('رقم الهوية', 'ID number', (r) => r['idNumber']),
        ExportCol('الاسم', 'Name', (r) => r['name']),
        ExportCol('جوال أبشر', 'Absher phone', (r) => r['absherPhone']),
        ExportCol('السجل اللوجستي', 'Logistic register', (r) => r['logisticRegister']),
        // The file says what the cell says: empty means 'required', not an entry omission.
        ExportCol('رقم البطاقة', 'Card number', (r) => r['hasCard'] == true ? r['cardNumber'] : tr('مطلوبة — لم تُستخرج', 'Needed — not issued')),
        ExportCol('له بطاقة', 'Has card', (r) => r['hasCard'] == true ? tr('نعم', 'Yes') : tr('لا', 'No')),
        ExportCol('نوع البطاقة', 'Card type', (r) => r['cardType']),
        ExportCol('تاريخ الانتهاء', 'Expiry', (r) => r['expiryDate']),
        ExportCol('الأيام المتبقية', 'Days left', (r) => r['daysLeft']),
        ExportCol('خيانة الأمانة', 'Fidelity insurance', (r) { final f = _fid((r['fidelity'] as Map?)?['status']); return tr(f.$1, f.$2); }),
        ExportCol('انتهاء الإقامة', 'Iqama expiry', (r) => personDocDate(r, 'iqama')),
        ExportCol('حالة الإقامة', 'Iqama status', (r) => personDocState(r, 'iqama')),
        ExportCol('انتهاء رخصة القيادة', 'Licence expiry', (r) => personDocDate(r, 'license')),
        ExportCol('حالة رخصة القيادة', 'Licence status', (r) => personDocState(r, 'license')),
        ExportCol('عدد التفاويض', 'Authorisations', (r) => ((r['authorizations'] as List?) ?? []).length),
        ExportCol('المركبات المفوَّضة', 'Authorised vehicles', (r) => ((r['authorizations'] as List?) ?? []).map((a) => _s((a as Map)['plateNumber'])).where((x) => x.isNotEmpty).join(' · ')),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
      ];

  Future<void> _remove(Map<String, dynamic> c) async {
    final who = _s(c['name']).isNotEmpty ? _s(c['name']) : _s(c['idNumber']);
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        content: Text(tr('حذف بطاقة «$who»؟', 'Delete card for “$who”?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(d, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/vehicle-registry/driver-cards/${c['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _edit(Map<String, dynamic>? c) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CardEditor(card: c),
    );
    if (saved == true) _load();
  }

  Future<void> _pick(String title, List<(String, String)> opts, String cur, ValueChanged<String> set) async {
    final r = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.6),
          child: ListView(shrinkWrap: true, children: [
            Padding(padding: const EdgeInsets.all(14), child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            for (final o in opts)
              ListTile(
                title: Text(o.$2),
                trailing: o.$1 == cur ? const Icon(Icons.check, color: T.orange) : null,
                onTap: () => Navigator.pop(c, o.$1),
              ),
          ]),
        ),
      ),
    );
    if (r != null) setState(() => set(r));
  }

  Widget _filterChip(String label, String cur, String allLabel, List<(String, String)> opts, ValueChanged<String> set) {
    final on = cur.isNotEmpty;
    String shown = label;
    if (on) { for (final o in opts) { if (o.$1 == cur) shown = o.$2; } }
    return ActionChip(
      onPressed: () => _pick(label, [('', allLabel), ...opts], cur, set),
      backgroundColor: on ? T.orange : Colors.white,
      side: BorderSide(color: on ? T.orange : T.line),
      avatar: Icon(on ? Icons.filter_alt : Icons.arrow_drop_down, size: 16, color: on ? Colors.white : T.inkFaint),
      label: Text(shown, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
    );
  }

  Widget _stat(String label, dynamic value, Color accent, {VoidCallback? onTap, bool on = false}) {
    return SizedBox(
      width: (MediaQuery.of(context).size.width - 28 - 8) / 2,
      child: Pressable(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: on ? T.orange : T.line, width: on ? 2 : 1),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 2),
            Text('${value ?? 0}', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: accent)),
          ]),
        ),
      ),
    );
  }

  Widget _card(Map<String, dynamic> c, bool canEdit) {
    final st = _st(c['state']);
    final vc = _vc(c['vehicleClass']);
    final fd = c['fidelity'] is Map ? c['fidelity'] as Map : const {};
    final fi = _fid(fd['status']);
    final auths = List<Map>.from((c['authorizations'] as List?) ?? []);
    final stale = [for (final x in (c['staleAssignments'] as List? ?? [])) '$x'];
    final emp = c['employee'] is Map ? c['employee'] as Map : null;
    final phone = _s(c['absherPhone']);
    TextStyle k = const TextStyle(fontSize: 11.5, color: T.inkFaint);
    TextStyle v = const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600);
    Widget kv(String label, Widget val) => Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 110, child: Text(label, style: k)), Expanded(child: val)]),
        );
    return AppCard(
      topAccent: st.$3,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(_s(c['name']).isEmpty ? '—' : _s(c['name']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5), maxLines: 2, overflow: TextOverflow.ellipsis)),
          Chip2(tr(st.$1, st.$2), st.$3),
          if (canEdit) ...[
            IconButton(visualDensity: VisualDensity.compact, tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 19, color: T.inkFaint), onPressed: () => _edit(c)),
            IconButton(visualDensity: VisualDensity.compact, tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 19, color: T.danger), onPressed: () => _remove(c)),
          ],
        ]),
        kv(tr('رقم الهوية', 'ID'), Text(_s(c['idNumber']), style: v.copyWith(fontFamily: 'monospace'))),
        kv(tr('جوال أبشر', 'Absher'), phone.isEmpty
            ? Text('—', style: v)
            : InkWell(onTap: () => callNumber(phone), child: Row(children: [const Icon(Icons.phone, size: 14, color: T.orange), const SizedBox(width: 4), Text(phone, style: v.copyWith(color: T.orange))]))),
        kv(tr('السجل اللوجستي', 'Register'), Text(_s(c['logisticRegister']).isEmpty ? '—' : _s(c['logisticRegister']), style: v)),
        // Empty reads as 'required'; the state is derived, and a word is not written into a number field.
        kv(tr('رقم البطاقة', 'Card no.'), c['hasCard'] == true
            ? Text(_s(c['cardNumber']), style: v.copyWith(fontFamily: 'monospace'))
            : Align(alignment: AlignmentDirectional.centerStart, child: Chip2(tr('مطلوبة — لم تُستخرج', 'Needed — not issued'), T.danger))),
        kv(tr('نوع البطاقة', 'Card type'), Text(_s(c['cardType']).isEmpty ? '—' : _s(c['cardType']), style: v)),
        kv(tr('نوع النقل', 'Transport'), Align(alignment: AlignmentDirectional.centerStart, child: Chip2(tr(vc.$1, vc.$2), vc.$3))),
        kv(tr('الانتهاء', 'Expiry'), Text(_s(c['expiryDate']).isEmpty ? '—' : _s(c['expiryDate']), style: v)),
        kv(tr('المتبقي', 'Days left'), Text(c['daysLeft'] == null ? '—' : '${c['daysLeft']}', style: v)),
        kv(tr('خيانة الأمانة', 'Fidelity'), Align(alignment: AlignmentDirectional.centerStart, child: Chip2(tr(fi.$1, fi.$2), fi.$3))),
        // Iqama and driving licence expiry come from his HR profile.
        for (final (ar, en, which) in [('انتهاء الإقامة', 'Iqama expiry', 'iqama'), ('انتهاء رخصة القيادة', 'Licence expiry', 'license')])
          kv(tr(ar, en), Align(alignment: AlignmentDirectional.centerStart,
              child: Chip2(personDocValue(c, which).$1, personDocValue(c, which).$2))),
        // Plates are openable: the row answers 'what does he hold?' and then leads to it.
        kv(tr('التفاويض', 'Authorisations'), auths.isEmpty
            ? Text('—', style: v.copyWith(color: T.inkFaint))
            : Wrap(spacing: 4, runSpacing: 4, children: [
                for (final a in auths)
                  InkWell(
                    onTap: _s(a['vehicle']).isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: _s(a['vehicle']), plate: _s(a['plateNumber'])))),
                    child: Tooltip(
                      message: [
                        if (_s(a['authorizationNumber']).isNotEmpty) tr('تفويض ${a['authorizationNumber']}', 'authorisation ${a['authorizationNumber']}'),
                        if (_s(a['startDate']).isNotEmpty) tr('من ${a['startDate']}', 'from ${a['startDate']}'),
                        if (_s(a['expiryDate']).isNotEmpty) tr('إلى ${a['expiryDate']}', 'to ${a['expiryDate']}'),
                      ].join(' · '),
                      child: Chip2(_s(a['plateNumber']).isEmpty ? '—' : _s(a['plateNumber']), T.info),
                    ),
                  ),
              ])),
        // The disagreement is shown, not swallowed: the older assignment log names a different plate for him.
        if (stale.isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 3), child: Text('⚠ ${tr('سجلٌّ أقدم:', 'older register:')} ${stale.join(' · ')}', style: const TextStyle(fontSize: 11, color: T.warn))),
        kv(tr('الموظف', 'Employee'), emp != null
            ? Text(_s(emp['employeeNumber']).isNotEmpty ? _s(emp['employeeNumber']) : (_s(emp['arabicName']).isNotEmpty ? _s(emp['arabicName']) : '✓'), style: v)
            : Text(tr('غير مربوط', 'unlinked'), style: const TextStyle(fontSize: 12, color: T.warn))),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = _canEdit;
    final rows = _shown;
    final t = _totals;
    return AppScaffold(
      title: Text(tr('بطاقات السائقين', 'Driver cards')),
      actions: [
        ExportButton(fileName: 'driver-cards', sheetName: tr('بطاقات السائقين', 'Driver cards'), columns: _cols, rows: () => _shown),
      ],
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(onPressed: () => _edit(null), icon: const Icon(Icons.add), label: Text(tr('بطاقة جديدة', 'New card')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                    // Cards filter on tap: the number that is read is the one that opens.
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      _stat(tr('إجمالي السائقين', 'Total drivers'), t['drivers'] ?? t['total'] ?? 0, T.ink,
                          onTap: () => setState(() { _fState = ''; _fFid = ''; _fHas = ''; _fClass = ''; }), on: _fState.isEmpty && _fFid.isEmpty && _fHas.isEmpty && _fClass.isEmpty),
                      _stat(tr('لهم بطاقة', 'With a card'), t['withCard'], T.success, onTap: () => setState(() { _fHas = 'yes'; _fState = ''; }), on: _fHas == 'yes'),
                      _stat(tr('بلا بطاقة — مطلوبة', 'No card — needed'), t['withoutCard'], T.danger, onTap: () => setState(() { _fHas = 'no'; _fState = ''; }), on: _fHas == 'no'),
                      _stat(tr('منتهية', 'Expired'), t['expired'], T.danger, onTap: () => setState(() => _fState = 'expired'), on: _fState == 'expired'),
                      _stat(tr('حرجة', 'Critical'), t['critical'], const Color(0xFFEA580C), onTap: () => setState(() => _fState = 'critical'), on: _fState == 'critical'),
                      _stat(tr('تحذير', 'Warning'), t['warning'], const Color(0xFFD97706), onTap: () => setState(() => _fState = 'warning'), on: _fState == 'warning'),
                      _stat(tr('قريبة', 'Soon'), t['upcoming'], const Color(0xFF0284C7), onTap: () => setState(() => _fState = 'upcoming'), on: _fState == 'upcoming'),
                      _stat(tr('سارية', 'Valid'), t['valid'], T.success, onTap: () => setState(() => _fState = 'valid'), on: _fState == 'valid'),
                      // The person, not the vehicle: his breach-of-trust cover and the transport split.
                      _stat(tr('لديهم وثيقة خيانة الأمانة', 'Have a fidelity policy'), t['fidelityCovered'], T.success, onTap: () => setState(() => _fFid = 'covered'), on: _fFid == 'covered'),
                      _stat(tr('ليس لديهم وثيقة خيانة الأمانة', 'No fidelity policy'), t['fidelityRequired'], T.danger, onTap: () => setState(() => _fFid = 'required'), on: _fFid == 'required'),
                      _stat(tr('سائقين النقل الثقيل', 'Heavy-transport drivers'), t['heavy'], const Color(0xFF4F46E5), onTap: () => setState(() => _fClass = _fClass == 'heavy' ? '' : 'heavy'), on: _fClass == 'heavy'),
                      _stat(tr('سائقين النقل الخفيف', 'Light-transport drivers'), t['light'], T.violet, onTap: () => setState(() => _fClass = _fClass == 'light' ? '' : 'light'), on: _fClass == 'light'),
                    ]),
                    const SizedBox(height: 12),
                    SearchField(
                      controller: _qc,
                      onChanged: (x) => setState(() => _q = x),
                      hint: tr('بحث بالاسم أو الهوية أو رقم البطاقة أو الجوال أو السجل…', 'name, ID, card no., phone, register…'),
                    ),
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      _filterChip(tr('السجل اللوجستي', 'Logistic register'), _fReg, tr('كل السجلات اللوجستية', 'All registers'), [for (final x in _optReg) (x, x)], (x) => _fReg = x),
                      _filterChip(tr('نوع البطاقة', 'Card type'), _fType, tr('كل الأنواع', 'All types'), [for (final x in _optType) (x, x)], (x) => _fType = x),
                      _filterChip(tr('نوع النقل', 'Transport type'), _fClass, tr('نوع النقل — الكل', 'Transport — all'),
                          [for (final o in _optClass) (_s(o['code']), tr(_s(o['ar']), _s(o['en'])))], (x) => _fClass = x),
                      _filterChip(tr('خيانة الأمانة', 'Fidelity insurance'), _fFid, tr('خيانة الأمانة — الكل', 'Fidelity — all'),
                          [('covered', tr('مشمول', 'Covered')), ('required', tr('مطلوب ضمُّه', 'Required'))], (x) => _fFid = x),
                      _filterChip(tr('انتهاء الإقامة', 'Iqama expiry'), _fIqama, tr('الإقامة — الكل', 'Iqama — all'),
                          [for (final o in personDocStates) (o.$1, tr(o.$2, o.$3))], (x) => _fIqama = x),
                      _filterChip(tr('انتهاء رخصة القيادة', 'Licence expiry'), _fLicense, tr('رخصة القيادة — الكل', 'Licence — all'),
                          [for (final o in personDocStates) (o.$1, tr(o.$2, o.$3))], (x) => _fLicense = x),
                      if (_activeF > 0 || _q.isNotEmpty)
                        TextButton.icon(
                          onPressed: () => setState(() { _fState = ''; _fReg = ''; _fType = ''; _fFid = ''; _fClass = ''; _fIqama = ''; _fLicense = ''; _q = ''; _qc.clear(); }),
                          icon: const Icon(Icons.restart_alt, size: 16),
                          label: Text(tr('مسح', 'Clear')),
                        ),
                      Text(tr('${rows.length} من ${_cards.length}', '${rows.length} of ${_cards.length}'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    ]),
                    const SizedBox(height: 10),
                    if (rows.isEmpty)
                      EmptyState(icon: Icons.badge_outlined, title: tr('لا نتائج', 'No results'))
                    else
                      for (final c in rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: _card(c, canEdit)),
                  ]),
                ),
    );
  }
}

// Card form
class _CardEditor extends StatefulWidget {
  final Map<String, dynamic>? card;
  const _CardEditor({this.card});
  @override
  State<_CardEditor> createState() => _CardEditorState();
}

class _CardEditorState extends State<_CardEditor> {
  late final Map<String, dynamic> c = widget.card ?? const {};
  late final Map fd0 = c['fidelity'] is Map ? c['fidelity'] as Map : const {};
  late final _id = TextEditingController(text: _s(c['idNumber']));
  late final _name = TextEditingController(text: _s(c['name']));
  late final _phone = TextEditingController(text: _s(c['absherPhone']));
  late final _reg = TextEditingController(text: _s(c['logisticRegister']));
  late final _cardNo = TextEditingController(text: _s(c['cardNumber']));
  // A new card starts as annual, as on web.
  late final _type = TextEditingController(text: widget.card == null ? 'سنوية' : _s(c['cardType']));
  late final _transport = TextEditingController(text: _s(c['transportTypeAr']));
  late final _policy = TextEditingController(text: _s(fd0['policyNumber']));
  late final _notes = TextEditingController(text: _s(c['notes']));
  late String _expiry = _d10(c['expiryDate']);
  late String _dob = _d10(c['dateOfBirth']);
  late String _fidStatus = _s(fd0['status']);
  late String _fidAdded = _d10(fd0['addedDate']);
  late String _empId = c['employee'] is Map ? _s((c['employee'] as Map)['_id']) : _s(c['employee']);
  List<Map<String, dynamic>> _emps = [];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/api/vehicles/employees').then((r) {
      if (mounted) setState(() => _emps = List<Map<String, dynamic>>.from(r['employees'] ?? []));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final x in [_id, _name, _phone, _reg, _cardNo, _type, _transport, _policy, _notes]) { x.dispose(); }
    super.dispose();
  }

  String _empLabel(Map e) {
    final n = _s(e['arabicName']).isNotEmpty ? _s(e['arabicName']) : '${_s(e['firstName'])} ${_s(e['lastName'])}'.trim();
    return n;
  }

  Future<void> _pickEmployee() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _EmpPicker(emps: _emps, label: _empLabel),
    );
    if (picked != null) setState(() => _empId = picked);
  }

  Future<void> _date(String cur, ValueChanged<String> set) async {
    final init = DateTime.tryParse(cur) ?? DateTime.now();
    final d = await showDatePicker(context: context, initialDate: init, firstDate: DateTime(1940), lastDate: DateTime(2100));
    if (d != null) setState(() => set(d.toIso8601String().substring(0, 10)));
  }

  Widget _dateField(String label, String val, ValueChanged<String> set) => InkWell(
        onTap: () => _date(val, set),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: val.isEmpty ? const Icon(Icons.calendar_today, size: 18) : IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() => set(''))),
          ),
          child: Text(val.isEmpty ? '—' : val),
        ),
      );

  // The person picked from search fills the fields, and typed text is replaced, as on web.
  void _onPick(Map p) {
    setState(() {
      if (_s(p['idNumber']).isNotEmpty) _id.text = _s(p['idNumber']);
      if (_s(p['name']).isNotEmpty) _name.text = _s(p['name']);
      final ph = _s(p['absherPhone']).isNotEmpty ? _s(p['absherPhone']) : _s(p['phone']);
      if (ph.isNotEmpty) _phone.text = ph;
      if (_s(p['dateOfBirth']).isNotEmpty) _dob = _d10(p['dateOfBirth']);
      if (_s(p['employeeId']).isNotEmpty) _empId = _s(p['employeeId']);
    });
  }

  // What is known about the number's owner fills only the empty fields (birth date and mobile).
  void _onFound(Map p) {
    setState(() {
      if (_dob.isEmpty && _s(p['dateOfBirth']).isNotEmpty) _dob = _d10(p['dateOfBirth']);
      if (_phone.text.trim().isEmpty) {
        final ph = _s(p['absherPhone']).isNotEmpty ? _s(p['absherPhone']) : _s(p['phone']);
        if (ph.isNotEmpty) _phone.text = ph;
      }
    });
  }

  Future<void> _save() async {
    if (_id.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('رقم الهوية مطلوب', 'ID number required'))));
      return;
    }
    setState(() => _saving = true);
    final body = <String, dynamic>{
      'idNumber': _id.text.trim(),
      'name': _name.text.trim(),
      'absherPhone': _phone.text.trim(),
      'logisticRegister': _reg.text.trim(),
      'cardNumber': _cardNo.text.trim(),
      'cardType': _type.text.trim(),
      'transportTypeAr': _transport.text.trim(),
      'expiryDate': _expiry,
      'dateOfBirth': _dob,
      'notes': _notes.text.trim(),
      'employee': _empId,
      'fidelity': {...fd0, 'status': _fidStatus, 'addedDate': _fidAdded, 'policyNumber': _policy.text.trim()},
    };
    try {
      if (widget.card != null) {
        await Api.instance.put('/api/vehicle-registry/driver-cards/${c['_id']}', body);
      } else {
        await Api.instance.post('/api/vehicle-registry/driver-cards', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    Map? emp;
    for (final e in _emps) { if (_s(e['_id']) == _empId) emp = e; }
    if (emp == null && c['employee'] is Map && _s((c['employee'] as Map)['_id']) == _empId) emp = c['employee'] as Map;
    const gap = SizedBox(height: 10);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(widget.card != null ? tr('تعديل بطاقة', 'Edit card') : tr('بطاقة جديدة', 'New card'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            _PersonLookup(onPick: _onPick),
            gap,
            TextField(controller: _id, decoration: InputDecoration(labelText: tr('رقم الهوية *', 'ID number *'))),
            _IdInfo(controller: _id, onFound: _onFound),
            gap,
            TextField(controller: _name, decoration: InputDecoration(labelText: tr('الاسم', 'Name'))),
            gap,
            // Linking to the employee makes renewing the card update his profile too.
            InkWell(
              onTap: _pickEmployee,
              child: InputDecorator(
                decoration: InputDecoration(labelText: tr('الموظف المرتبط', 'Linked employee'), suffixIcon: const Icon(Icons.arrow_drop_down)),
                child: Text(emp != null ? _empLabel(emp) : (_empId.isEmpty ? tr('اختر الموظف — اكتب للبحث…', 'Pick employee — type to search…') : _empId),
                    style: TextStyle(color: _empId.isEmpty ? T.inkFaint : T.ink)),
              ),
            ),
            gap,
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('جوال أبشر', 'Absher phone'))),
            gap,
            TextField(controller: _reg, decoration: InputDecoration(labelText: tr('السجل اللوجستي', 'Logistic register'))),
            gap,
            // A word is not written into a number field: empty reads as 'required' in the table.
            TextField(
              controller: _cardNo,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: tr('رقم البطاقة', 'Card number'),
                hintText: tr('اتركه فارغًا إن لم تُستخرج بعد', 'Leave empty if not issued yet'),
                helperText: _cardNo.text.trim().isEmpty ? tr('بلا رقم ⇒ تُقرأ «مطلوبة — لم تُستخرج» في الجدول', 'No number ⇒ shows as "needed — not issued"') : null,
                helperStyle: const TextStyle(color: T.danger),
              ),
            ),
            gap,
            LookupField(type: 'vehicle_driver_card_type', controller: _type, label: tr('نوع البطاقة', 'Card type')),
            gap,
            // A written transport type wins over the one derived from his vehicles.
            LookupField(type: 'vehicle_transport_type', controller: _transport, label: tr('نوع النقل', 'Transport type')),
            gap,
            _dateField(tr('تاريخ الانتهاء', 'Expiry date'), _expiry, (x) => _expiry = x),
            gap,
            _dateField(tr('تاريخ الميلاد', 'Date of birth'), _dob, (x) => _dob = x),
            gap,
            // Breach of trust cover: this driver's place in the single company policy.
            DropdownButtonFormField<String>(
              initialValue: _fidStatus,
              decoration: InputDecoration(labelText: tr('خيانة الأمانة', 'Fidelity insurance')),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('غير محدَّد', 'Not set'))),
                DropdownMenuItem(value: 'covered', child: Text(tr('مشمول', 'Covered'))),
                DropdownMenuItem(value: 'required', child: Text(tr('مطلوب ضمُّه', 'Required'))),
              ],
              onChanged: (x) => setState(() => _fidStatus = x ?? ''),
            ),
            gap,
            _dateField(tr('تاريخ الضمّ للوثيقة', 'Added to policy on'), _fidAdded, (x) => _fidAdded = x),
            gap,
            TextField(controller: _policy, decoration: InputDecoration(labelText: tr('وثيقة خاصّة (إن لم يكن على وثيقة الشركة)', 'Own policy number (if not on the company policy)'))),
            gap,
            TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            Row(children: [
              TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))),
              const Spacer(),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined),
                label: Text(tr('حفظ', 'Save')),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _EmpPicker extends StatefulWidget {
  final List<Map<String, dynamic>> emps;
  final String Function(Map) label;
  const _EmpPicker({required this.emps, required this.label});
  @override
  State<_EmpPicker> createState() => _EmpPickerState();
}

class _EmpPickerState extends State<_EmpPicker> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final n = flexFold(_q);
    final list = widget.emps.where((e) => n.isEmpty || [widget.label(e), e['employeeNumber'], e['iqamaNumber']].any((x) => flexFold(x).contains(n))).take(200).toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: SearchField(autofocus: true, onChanged: (x) => setState(() => _q = x),
                  hint: tr('اسم أو رقم وظيفي أو إقامة…', 'name, employee no. or iqama…')),
            ),
            Expanded(
              child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                if (list.isEmpty && _q.trim().isNotEmpty)
                  Padding(padding: const EdgeInsets.all(18), child: Text(tr('لا نتائج مطابقة', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
                for (final e in list)
                  ListTile(
                    dense: true,
                    title: Text(widget.label(e)),
                    subtitle: Text(_s(e['employeeNumber']).isNotEmpty ? _s(e['employeeNumber']) : _s(e['iqamaNumber'])),
                    onTap: () => Navigator.pop(context, _s(e['_id'])),
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

// Person lookup (mirrors PersonLookup on web)
const _sourceAr = {'hr': 'الموارد البشرية', 'light_transport': 'النقل الخفيف', 'driver_card': 'بطاقة سائق'};
const _sourceEn = {'hr': 'HR', 'light_transport': 'Light transport', 'driver_card': 'Driver card'};

class _PersonLookup extends StatefulWidget {
  final void Function(Map p) onPick;
  const _PersonLookup({required this.onPick});
  @override
  State<_PersonLookup> createState() => _PersonLookupState();
}

class _PersonLookupState extends State<_PersonLookup> {
  final _q = TextEditingController();
  bool _busy = false;
  List<Map>? _people;
  int _seq = 0; // The latest search wins

  @override
  void dispose() { _q.dispose(); super.dispose(); }

  Future<void> _run() async {
    final term = _q.text.trim();
    if (term.length < 3) { setState(() => _people = null); return; }
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.get('/api/vehicle-registry/person-lookup?q=${Uri.encodeQueryComponent(term)}');
      if (mounted && mine == _seq) setState(() => _people = List<Map>.from(d['people'] ?? []));
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _people = []);
    }
    if (mounted && mine == _seq) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final people = _people;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.how_to_reg_outlined, size: 16, color: T.orange),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('ابحث عن الشخص فتُملأ بيانات البطاقة', 'Find the person to fill the card'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft))),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _q,
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _run(),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search, size: 18), hintText: tr('الاسم أو رقم الهوية أو الإقامة…', 'Name, national ID or iqama…')),
            ),
          ),
          const SizedBox(width: 6),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.ink),
            onPressed: _busy || _q.text.trim().length < 3 ? null : _run,
            child: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('بحث', 'Search')),
          ),
          if (people != null) IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() { _people = null; _q.clear(); })),
        ]),
        if (people == null)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('بالاسم أو رقم الهوية أو الإقامة — والكتابة اليدوية تبقى متاحة.', 'By name, national ID or iqama — typing by hand still works.'), style: const TextStyle(fontSize: 11, color: T.inkFaint))),
        if (people != null && people.isEmpty)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(8), border: Border.all(color: T.warn.withValues(alpha: 0.3))),
            child: Text(tr('غير موجود في السجلات — كلّم الموارد البشرية لتسجيله، أو اكتب البيانات يدويًّا.', 'Not found — ask HR to register him, or type the details by hand.'), style: const TextStyle(fontSize: 11.5, color: T.warn)),
          ),
        if (people != null && people.isNotEmpty)
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 240),
            child: ListView(shrinkWrap: true, padding: const EdgeInsets.only(top: 6), children: [
              for (final p in people)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Material(
                    color: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: T.line)),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () { widget.onPick(p); setState(() { _people = null; _q.clear(); }); },
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_s(p['name']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                          Text([
                            _s(p['idNumber']),
                            _s(p['phone']).isNotEmpty ? _s(p['phone']) : _s(p['absherPhone']),
                            if (_s(p['employeeNumber']).isNotEmpty) '#${p['employeeNumber']}',
                          ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint, fontFamily: 'monospace')),
                          Wrap(spacing: 4, runSpacing: 2, children: [
                            for (final s in (p['sources'] as List? ?? [])) Chip2(tr(_sourceAr['$s'] ?? '$s', _sourceEn['$s'] ?? '$s'), T.inkFaint),
                            if (p['employmentStatus'] == 'terminated') Chip2(tr('أُنهيت خدمته', 'Terminated'), T.danger),
                          ]),
                        ]),
                      ),
                    ),
                  ),
                ),
            ]),
          ),
      ]),
    );
  }
}

/// What is known about the number's owner, under the field, like IqamaPersonInfo, with onFound to fill the empty birth date and mobile as web does.
class _IdInfo extends StatefulWidget {
  final TextEditingController controller;
  final void Function(Map p) onFound;
  const _IdInfo({required this.controller, required this.onFound});
  @override
  State<_IdInfo> createState() => _IdInfoState();
}

class _IdInfoState extends State<_IdInfo> {
  Map? _p;
  String _state = '';
  String _id = '';
  int _seq = 0;

  @override
  void initState() { super.initState(); widget.controller.addListener(_changed); _changed(); }

  @override
  void dispose() { widget.controller.removeListener(_changed); super.dispose(); }

  void _changed() {
    final id = widget.controller.text.replaceAll(RegExp(r'\s+'), '');
    if (id == _id) return;
    _id = id;
    final mine = ++_seq;
    if (!RegExp(r'^\d{8,}$').hasMatch(id)) {
      if (mounted) setState(() { _p = null; _state = ''; });
      return;
    }
    if (mounted) setState(() { _p = null; _state = 'loading'; });
    Future.delayed(const Duration(milliseconds: 350), () async {
      if (mine != _seq) return;
      try {
        final d = await Api.instance.get('/api/vehicle-registry/person-lookup?q=${Uri.encodeQueryComponent(id)}');
        if (!mounted || mine != _seq) return;
        final hit = List<Map>.from(d['people'] ?? []).where((x) => _s(x['idNumber']).replaceAll(RegExp(r'\s+'), '') == id).toList();
        setState(() { _p = hit.isEmpty ? null : hit.first; _state = hit.isEmpty ? 'missing' : ''; });
        if (hit.isNotEmpty) widget.onFound(hit.first);
      } catch (_) {
        if (mounted && mine == _seq) setState(() => _state = 'missing');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_state == 'loading') {
      return Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('يُبحَث عن صاحب الرقم…', 'Looking up…'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)));
    }
    if (_state == 'missing') {
      return Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('لا بياناتَ لهذا الرقم في الموارد البشريّة ولا في بطاقات السائقين.', 'No record for this number.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)));
    }
    final p = _p;
    if (p == null) return const SizedBox.shrink();
    final dob = _s(p['dateOfBirth']);
    final phone = _s(p['phone']).isNotEmpty ? _s(p['phone']) : _s(p['absherPhone']);
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.success.withValues(alpha: 0.3))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_s(p['name']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        Text('${tr('تاريخ الميلاد', 'Date of birth')}: ${dob.length >= 10 ? dob.substring(0, 10).split('-').reversed.join('/') : tr('غير مسجَّل', 'not recorded')}', style: const TextStyle(fontSize: 12)),
        Text('${tr('الجوال', 'Mobile')}: ${phone.isEmpty ? tr('غير مسجَّل', 'not recorded') : phone}', style: const TextStyle(fontSize: 12)),
        // Iqama and driving licence expiry, in Gregorian; expired ones in red.
        for (final e in [('انتهاء الإقامة', 'Iqama expiry', _s(p['iqamaExpiry'])), ('انتهاء رخصة القيادة', 'Driving licence expiry', _s(p['licenseExpiry']))])
          Builder(builder: (_) {
            final d = e.$3.length >= 10 ? e.$3.substring(0, 10) : '';
            final now = DateTime.now();
            final today = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
            final expired = d.isNotEmpty && d.compareTo(today) < 0;
            return Text('${tr(e.$1, e.$2)}: ${d.isEmpty ? tr('غير مسجَّل', 'not recorded') : d.split('-').reversed.join('/')}${expired ? tr(' (منتهية)', ' (expired)') : ''}',
                style: TextStyle(fontSize: 12, color: expired ? T.danger : null, fontWeight: expired ? FontWeight.w700 : null));
          }),
      ]),
    );
  }
}
