import '../ui/person_docs.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'vehicle_lifecycle.dart' show revokeVehicleAuthorization;
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/filter_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show fmtDate, daysText, money;
import '../services/flex_match.dart';
import '../ui/api_picker.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import 'vehicle_renew.dart';

/// One document family screen, mirrors the document pages on web.
/// The problem it solves is not missing data: operating card, authorization and insurance numbers have all been recorded since import, but no screen had a column showing them, so filtering on the operating card gave the right vehicles with no card number and looked like the file was not imported.
/// One family per screen, not all six documents together: together they exceed 40 fields, and the source file groups them family by family with its own colour, so the screen follows the sheet the department knows.
/// One data-described screen instead of seven copies: copies diverge at the first edit, fixing the renew button in one and leaving it broken in six.

/// A field shown on the vehicle card: how it is read from the vehicle and how it is named.
class DocField {
  final String ar, en;
  final String Function(Map v) get;

  /// Document numbers are read left to right whatever the screen language.
  final bool mono;
  const DocField(this.ar, this.en, this.get, {this.mono = false});
}

/// A family field that is written, distinct from the displayed DocField.
/// Display can be computed (the 'open - no cap' text is built from two fields and is not written into either), but anything written needs a real path on the vehicle, otherwise it is saved nowhere and the row returns unchanged after refresh.
class DocEditField {
  /// Path in the vehicle document: operatingCard.cardNumber.
  final String path;
  final String ar, en;

  /// text · date · number · flag
  final String kind;

  /// The checkbox writes text, not a boolean: 'open' in fuelCard.limitStatus.
  final String on, off;
  final bool mono;

  /// A dropdown type fills the field instead of free typing, managed from section settings, dropdown lists. The Arabic name is stored, not the key, because stored values have been Arabic text since the first import and filters and exports read them.
  final String? lookup;

  /// Iqama number: shows the holder's birth date and mobile beneath it (IqamaPersonInfo).
  final bool personInfo;
  const DocEditField(this.path, this.ar, this.en,
      {this.kind = 'text', this.on = 'open', this.off = '', this.mono = false, this.lookup, this.personInfo = false});
}

/// Local filter chip over the loaded rows.
class DocChip {
  final String key, ar, en;
  final Color tone;
  final bool Function(Map v)? test;
  const DocChip(this.key, this.ar, this.en, this.tone, [this.test]);
}

class DocFamily {
  /// Key of the expiry-dated document, or null for a family that does not expire.
  /// The Petro App chip belongs to the latter: it has a number, a status and a spending cap but no expiry date. Forcing it into the days-left column makes the whole fleet show 'no date' on a screen where dates mean nothing, a fabricated gap implying work is due. The renew button is also dropped, since what does not expire is not renewed.
  final String? docKey;
  final String arTitle, enTitle;
  final IconData icon;
  final List<DocField> fields;
  final List<String> Function(Map v) searchIn;
  final List<DocChip>? chips;

  /// Fields of this family only; add, edit and clear open with these alone.
  /// The full vehicle form is not opened from here: it has 47 fields belonging to seven other families, and someone fixing a card number would pass through insurance and inspection, making every screen a back door to everything. That is the vehicle register screen.
  final List<DocEditField> editable;

  /// The field whose presence means the document exists.
  /// Previously any non-empty family field meant 'has a document'. In fuel chips, ten vehicles have a chip status but no chip, so they counted as having one and vanished from the add picker even though the chip above the table said it was there.
  final String? keyField;

  /// Is this document one sheet covering many vehicles?
  /// One insurance policy covers 198 vehicles with a single number and its renewal is one event. Operating cards and authorizations are one sheet per vehicle with its own number; one number across a hundred of them makes a hundred copies of one sheet. Copy of sharedNumber on the server, which rejects violations.
  final bool sharedPaper;

  /// Export file name, same as fileName in the web page.
  final String fileName;

  /// A page with its own action does not show 'clear data' (authorizations: revoking has two sides and clearing touches only the first).
  final bool hideClear;

  /// Authorize / revoke buttons on the row; authorizations page only.
  final bool authActions;

  /// Document name in the chip: 'insurance expired' not just 'expired'.
  String get docLabelAr => docKey == null ? arTitle : renewDocLabelAr(docKey!);
  String get docLabelEn => docKey == null ? enTitle : renewDocLabelEn(docKey!);
  const DocFamily({
    required this.docKey,
    required this.arTitle,
    required this.enTitle,
    required this.icon,
    required this.fields,
    required this.searchIn,
    this.chips,
    this.editable = const [],
    this.sharedPaper = false,
    this.keyField,
    this.fileName = 'vehicle-documents',
    this.hideClear = false,
    this.authActions = false,
  });
}

/// Is this document required of us? Two buttons, not a list.
/// Not every vehicle in the register is ours: some belong to an employee and only get a tracking chip, so their insurance and operating card are not a gap for us. Silence used to read as a gap, so the chip work list showed dozens of rows mostly needing no work.
/// Twin of components/vehicles/ReqToggle on web, writing the same field (<root>.statusCode), so what is marked in the app is read on web and in the overview, with no second copy of the truth.
class ReqToggle extends StatelessWidget {
  final String label, code;
  final ValueChanged<String> onChanged;
  const ReqToggle({super.key, required this.label, required this.code, required this.onChanged});

  /// Recorded states that mean 'not required', as the server reads them.
  static bool _off(String c) => c == 'not_required' || c == 'not_in_use';

  /// A third saved state ('with the bank', 'active') is not overwritten by two buttons: it was recorded by the import or by a user before us, and is neither required nor not required.
  static bool _other(String c) => c.isNotEmpty && !_off(c) && c != 'required' && c != 'none';

  @override
  Widget build(BuildContext context) {
    final off = _off(code);
    final other = _other(code);
    Widget pill(String text, bool on, Color tone, VoidCallback tap) => InkWell(
          onTap: tap,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: on ? tone.withValues(alpha: 0.12) : Colors.white,
              border: Border.all(color: on ? tone : const Color(0xFFE2E8F0)),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(text,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? tone : T.inkFaint)),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          pill(tr('مطلوب', 'Required'), !off && !other, T.success, () => onChanged('required')),
          pill(tr('غير مطلوب', 'Not required'), off, T.ink, () => onChanged('not_required')),
          if (other)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(tr('وضعٌ مسجَّل', 'recorded state'),
                  style: const TextStyle(fontSize: 11, color: T.info)),
            ),
        ]),
        const SizedBox(height: 6),
        Text(
          tr('«غير مطلوب» ليست نقصًا: تخرج المركبة من قائمة العمل وتظهر رماديّةً هنا وفي سجلّ المركبات.',
              '«Not required» is not a gap: the vehicle leaves the work list and shows greyed out here and in the registry.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint, height: 1.4),
        ),
      ]),
    );
  }
}

String _s(dynamic v) => (v == null) ? '' : v.toString();

/// Vehicle make, model and year on one line under the plate; twin of the three columns repeated on every family page on web (commonColumns).
String _identity(Map v) =>
    [_s(v['brandAr']), _s(v['modelAr']), _s(v['modelYear'])].where((x) => x.isNotEmpty).join(' · ');
Map _sub(Map v, String k) => (v[k] is Map) ? v[k] as Map : const {};
/// Reads a dotted path; the path is text known only at runtime.
dynamic _readPath(Map v, String path) {
  dynamic cur = v;
  for (final k in path.split('.')) {
    if (cur is! Map) return null;
    cur = cur[k];
  }
  return cur;
}

/// What is sent to the server is always nested, never {'gps.serialImei': ...}.
/// express-mongo-sanitize on the server strips any key containing a dot before it reaches the controller, so a dotted path is sent and silently vanishes: 'saved' shows and nothing changes. The controller flattens the nested object so it merges instead of replacing the whole object.
void _writePath(Map<String, dynamic> out, String path, dynamic val) {
  final ks = path.split('.');
  Map<String, dynamic> cur = out;
  for (final k in ks.sublist(0, ks.length - 1)) {
    cur[k] = (cur[k] is Map<String, dynamic>) ? cur[k] : <String, dynamic>{};
    cur = cur[k] as Map<String, dynamic>;
  }
  cur[ks.last] = val;
}

Map<String, dynamic> _buildPatch(List<DocEditField> fields, Map<String, dynamic> vals) {
  final out = <String, dynamic>{};
  for (final f in fields) {
    final raw = vals[f.path];
    dynamic v;
    if (f.kind == 'number') {
      v = (raw == null || '$raw'.trim().isEmpty) ? null : num.tryParse('$raw'.trim());
    } else if (f.kind == 'date') {
      v = (raw == null || '$raw'.isEmpty) ? null : raw;
    } else if (f.kind == 'flag') {
      v = (raw == true) ? f.on : f.off;
    } else {
      v = raw ?? '';
    }
    _writePath(out, f.path, v);
  }
  return out;
}

/// First segment of each path: the object the family lives in (gps, insurance...).
List<String> _rootsOf(List<DocEditField> fields) =>
    fields.map((f) => f.path.split('.').first).toSet().toList();

/// Does this vehicle have anything recorded for this family at all?
bool _hasDoc(Map v, List<DocEditField> fields, [String? keyField]) {
  if (keyField != null) {
    final x = _readPath(v, keyField);
    return x != null && '$x'.isNotEmpty;
  }
  return fields.any((f) {
    final x = _readPath(v, f.path);
    return x != null && '$x'.isNotEmpty;
  });
}

/// All text and numeric row values to depth 3, like deepValues on web.
List<String> _deepValues(dynamic o, [int depth = 0]) {
  if (o == null || depth > 3) return const [];
  if (o is List) return o.expand((x) => _deepValues(x, depth + 1)).toList();
  if (o is Map) {
    return o.entries.where((e) => e.key != '_id' && e.key != '__v').expand((e) => _deepValues(e.value, depth + 1)).toList();
  }
  return (o is String || o is num) ? ['$o'] : const [];
}

/// Unified folding; see services/flex_match.
String _fold(String s) => flexFold(s);

/// This document's state on this vehicle as computed by the server with the settings thresholds. Not computed here, otherwise this screen's colours would differ from the vehicle's alerts screen, which the user sees the same day.
Map<String, dynamic> _state(Map v, String docKey) {
  final st = (v['docStatuses'] is Map) ? (v['docStatuses'][docKey] as Map?) : null;
  return {'status': _s(st?['status']).isEmpty ? 'none' : _s(st?['status']), 'days': st?['days']};
}

/// Document state in the vocabulary of the web family pages (stateOf): none maps to missing, not_required maps to not_applicable. The display table stateMetaOf is never empty.
String docStateKey(Map v, String docKey) {
  final s = _s(_state(v, docKey)['status']);
  if (s == 'none' || s.isEmpty) return 'missing';
  if (s == 'not_required') return 'not_applicable';
  return s;
}

const _stateMeta = {
  'expired': ('منتهي', 'Expired', Color(0xFFDC2626)),
  'due': ('قارب على الانتهاء', 'Due soon', Color(0xFFF59E0B)),
  'valid': ('ساري', 'Valid', Color(0xFF16A34A)),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('تحذير', 'Warning', Color(0xFFF59E0B)),
  'upcoming': ('قريب', 'Upcoming', Color(0xFF0EA5E9)),
  'missing': ('مطلوب — بلا تاريخ', 'Needed — no date', Color(0xFF94A3B8)),
  'not_applicable': ('غير مطلوب', 'Not applicable', Color(0xFF64748B)),
};

/// Twin of stateMeta: a name and a colour; an unknown state shows grey with its own name.
(String, Color) stateMetaOf(String? s) {
  final m = _stateMeta[s ?? 'valid'];
  if (m == null) return ((s ?? '—'), const Color(0xFF64748B));
  return (tr(m.$1, m.$2), m.$3);
}

/// Is this document required of us, as web reads it (docNeed): have, required, not_required, unknown.
String _docNeed(Map v, String docKey) {
  if (docDateOf(v, docKey) != null && docDateOf(v, docKey)!.isNotEmpty) return 'have';
  final root = docKey == 'authorization' ? 'authorizedPerson' : docKey;
  final code = _s(_sub(v, root)['statusCode']);
  if (ReqToggle._off(code)) return 'not_required';
  if (code == 'required' || code == 'none' || code.isEmpty) return 'required';
  return 'unknown';
}

class VehicleDocumentsScreen extends StatefulWidget {
  final DocFamily family;
  /// Preset search: the vehicle profile opens the page on its plate (?q= on web).
  final String? initialQuery;
  const VehicleDocumentsScreen({super.key, required this.family, this.initialQuery});
  @override
  State<VehicleDocumentsScreen> createState() => _VehicleDocumentsScreenState();
}

class _VehicleDocumentsScreenState extends State<VehicleDocumentsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, String> _filters = {};
  late String _q = widget.initialQuery ?? '';
  // Search text lives in a screen-owned controller: what is shown is always the filter.
  late final _searchCtl = TextEditingController(text: _q);
  String _chip = '';
  // 'Expires within' works on top of the chips, not instead of them, as on web.
  String _within = '';
  final _withinCtl = TextEditingController();
  bool _includeExpired = true;
  final Set<String> _picked = {};
  int _seq = 0;
  int _total = 0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (mounted) _load(); };
    Live.instance.on('vreg:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    _withinCtl.dispose();
    _searchCtl.dispose();
    super.dispose();
  }

  // Search and filters run on the server like web, and a stale response does not overwrite a newer one.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>['limit=2000'];
      if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
      _filters.forEach((k, v) { if (v.isNotEmpty) p.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/vehicle-registry?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
        _total = (d['total'] ?? 0) as int;
        _loading = false;
        _error = null;
        // A selection that dropped out of the result does not stay saved invisibly.
        _picked.removeWhere((id) => !_rows.any((v) => _s(v['_id']) == id));
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<DocChip> get _chips {
    final f = widget.family;
    if (f.chips != null) return f.chips!;
    final k = f.docKey;
    if (k == null) return const [DocChip('', 'الكل', 'All', T.navy)];
    // Four chips the user reads.
    // There used to be five, three of them one thing at three urgency levels: expiring very soon, close to expiring, on the radar. The department head asked 'is it valid, close to expiring, or expired', and a chip needing explanation is not a filter. So it is one name, with colour alone distinguishing the degrees.
    // 'No date recorded' joined 'required': both are pending work, and separating them splits the work list in two. The name carries the document name ('insurance expired', not just 'expired') so the reader does not ask 'expired what'. Twin in components/vehicles/DocumentFamilyPage.tsx.
    return [
      const DocChip('', 'الكل', 'All', T.navy),
      DocChip('expired', '${f.docLabelAr} منتهٍ', '${f.docLabelEn} expired', T.danger,
          (v) => docStateKey(v, k) == 'expired'),
      // Three chips instead of one: critical is today's work, warning is the week's, soon is preparation for next month, as on web.
      DocChip('critical', 'حرج', 'Critical', const Color(0xFFEA580C), (v) => docStateKey(v, k) == 'critical'),
      DocChip('warning', 'تحذير', 'Warning', const Color(0xFFF59E0B), (v) => docStateKey(v, k) == 'warning'),
      DocChip('upcoming', 'قريب', 'Upcoming', const Color(0xFF0EA5E9), (v) => docStateKey(v, k) == 'upcoming'),
      DocChip('valid', 'ساري', 'Valid', T.success, (v) => docStateKey(v, k) == 'valid'),
      DocChip('needed', 'مطلوب — ناقص', 'Needed — missing', T.danger,
          (v) => _docNeed(v, k) == 'required' || docStateKey(v, k) == 'missing'),
    ];
  }

  // Who writes in the section: the same split as on the server and on web. Three scattered lists used to diverge at the first new role, so the vehicles manager saw the section but could not edit it from mobile alone.
  static const _editRoles = {'super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'vehicles_staff',
    'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'};
  static const _adminRoles = {'super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'hr_manager'};

  /// Removing a Petro App chip is an action recorded with who removed it and when.
  /// It is a condition of employee clearance, so it cannot be a silent field wipe: emptying it drops the condition, and two months later there is no answer to 'who removed it and when?'.
  Future<void> _removeChip(Map<String, dynamic> v) async {
    final card = _s(_sub(v, 'fuelCard')['cardNumber']);
    final who = _s(_sub(v, 'authorizedPerson')['name']);
    final okGo = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('نزع الشريحة', 'Remove chip')),
        content: Text(tr(
          'نزع شريحة بترو اب $card عن المركبة ${v['plateNumber']}${who.isEmpty ? '' : ' ($who)'}؟ يُقيَّد النزع باسمك وتاريخه.',
          'Remove Petro App chip $card from ${v['plateNumber']}? The removal is recorded with your name and the date.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.warn),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('نزع', 'Remove')),
          ),
        ],
      ),
    );
    if (okGo != true) return;
    try {
      final d = await Api.instance.post('/api/vehicle-registry/${v['_id']}/fuel-card', {'action': 'remove'});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${d['message'] ?? tr('نُزعت الشريحة', 'Chip removed')}')));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Choosing the vehicle the document is registered on.
  /// 'Create' here does not create a vehicle: a vehicle is born on the vehicle register screen with plate, chassis and sector, and must not be born from the operating card screen with a card only, entering the fleet with incomplete identity through a side door. What is actually missing is a document not yet recorded on an existing vehicle, so the list starts with those lacking one.
  Future<Map<String, dynamic>?> _pickVehicle() async {
    final fields = widget.family.editable;
    List<Map<String, dynamic>>? pool;
    var onlyMissing = true;
    var q = '';
    // The list is fetched unfiltered: the screen filter is a question about what is displayed, not a limit on what may be registered. Filtering on 'expired' does not mean forbidding a valid vehicle.
    Api.instance.get('/api/vehicle-registry?limit=2000').then((d) {
      pool = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
    }).catchError((_) { pool = <Map<String, dynamic>>[]; });

    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setSheet) {
        // Rebuilds until the list arrives; no timer and no preload before opening.
        if (pool == null) {
          Future.delayed(const Duration(milliseconds: 120), () { if (c.mounted) setSheet(() {}); });
        }
        final all = pool ?? const <Map<String, dynamic>>[];
        final q2 = _fold(q);
        final list = all.where((v) {
          if (onlyMissing && _hasDoc(v, fields, widget.family.keyField)) return false;
          if (q2.isEmpty) return true;
          return [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(v['departmentAr']), _s(v['sectorAr'])]
              .any((x) => _fold(x).contains(q2));
        }).take(400).toList();
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.7,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('اختر المركبة', 'Pick a vehicle'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              SearchField(
                onChanged: (v) => setSheet(() => q = v),
                hint: tr('ابحث بلوحة أو مالك أو إدارة…', 'Search plate, owner or department…'),
              ),
              // Default is 'those without data', the reason the screen is opened. Whoever wants to correct a registered vehicle clears the flag, which is allowed.
              SwitchListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: onlyMissing,
                onChanged: (b) => setSheet(() => onlyMissing = b),
                title: Text(tr('التي لا بيانات لها فقط', 'Only vehicles with no data'), style: const TextStyle(fontSize: 12.5)),
              ),
              Expanded(
                child: pool == null
                    ? const Center(child: CircularProgressIndicator())
                    : list.isEmpty
                        ? Center(child: Text(tr('لا مركبات مطابقة', 'No matching vehicles'), style: const TextStyle(color: T.inkFaint)))
                        : ListView.separated(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            itemCount: list.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (c2, i) => ListTile(
                              dense: true,
                              title: Text(_s(list[i]['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                              subtitle: Text([_s(list[i]['ownerNameAr']), _s(list[i]['departmentAr']), _s(list[i]['cityAr'])].where((x) => x.isNotEmpty).join(' · '),
                                  maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5)),
                              onTap: () => Navigator.pop(c, list[i]),
                            ),
                          ),
              ),
            ]),
          ),
        );
      }),
    );
  }

  /// Family form: its own fields only, on an existing vehicle.
  Future<void> _editDoc(Map<String, dynamic>? row) async {
    final fields = widget.family.editable;
    if (fields.isEmpty) return;
    var v = row;
    if (v == null) {
      v = await _pickVehicle();
      if (v == null || !mounted) return;
    }
    final target = v;
    final vals = <String, dynamic>{};
    final ctrls = <String, TextEditingController>{};
    // Is this document required of us on this vehicle?
    // It used to be asked only in the vehicle register form, which a periodic-inspection reviewer does not open: they see a trailer as 'required - missing' though trailers are not inspected, and must leave for another screen to fix it. Now the question is where the document is edited, on web and in the app.
    // The answer lives in the object holding the family: inspection.statusCode for the inspection screen and gps.statusCode for the tracking screen. It is the same field the register writes and the server reads, so no second copy of the truth.
    final statusPath = '${_rootsOf(fields).first}.statusCode';
    final initialNeed = _s(_readPath(target, statusPath));
    var need = initialNeed;
    // Dropdown lists are fetched before the sheet opens: fetching inside build repeats the call on every rebuild, making one field hit the server dozens of times.
    final lookups = <String, List<String>>{};
    for (final f in fields.where((x) => x.lookup != null)) {
      if (lookups.containsKey(f.lookup)) continue;
      try {
        final d = await Api.instance.get('/api/lookups?type=${Uri.encodeComponent(f.lookup!)}&active=true');
        lookups[f.lookup!] = List<Map<String, dynamic>>.from(d['items'] ?? [])
            .map((i) => _s(i['nameAr']).isEmpty ? _s(i['nameEn']) : _s(i['nameAr']))
            .where((x) => x.isNotEmpty).toList();
      } catch (_) { lookups[f.lookup!] = const []; }
    }
    // Fetching lists is a network wait, and the screen may close during it.
    if (!mounted) { for (final ctl in ctrls.values) { ctl.dispose(); } return; }
    for (final f in fields) {
      final raw = _readPath(target, f.path);
      if (f.kind == 'flag') {
        vals[f.path] = raw != null && '$raw' == f.on;
      } else if (f.kind == 'date') {
        vals[f.path] = raw == null ? '' : '$raw'.split('T').first;
      } else {
        vals[f.path] = raw == null ? '' : '$raw';
        ctrls[f.path] = TextEditingController(text: '$raw' == 'null' ? '' : '${raw ?? ''}');
      }
      // A list field is written straight from vals; if it listened to a text watcher it would overwrite what was chosen from the list.
      if (f.lookup == null && (f.kind == 'number' || f.kind == 'text')) {
        ctrls[f.path]!.addListener(() => vals[f.path] = ctrls[f.path]!.text);
      }
    }

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr(widget.family.arTitle, widget.family.enTitle),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              Text(_s(target['plateNumber']), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
              const SizedBox(height: 12),
              // The question comes before the fields: answering 'not required' makes what is beneath meaningless, and nobody who answered so is expected to fill a date.
              ReqToggle(
                label: tr('هل هذا المستند مطلوبٌ على هذه المركبة؟', 'Is this document required on this vehicle?'),
                code: need,
                onChanged: (x) => setSheet(() => need = x),
              ),
              const SizedBox(height: 12),
              ...fields.map((f) {
                if (f.kind == 'flag') {
                  return SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: vals[f.path] == true,
                    onChanged: (b) => setSheet(() => vals[f.path] = b),
                    title: Text(tr(f.ar, f.en), style: const TextStyle(fontSize: 13)),
                  );
                }
                if (f.kind == 'date') {
                  final cur = '${vals[f.path] ?? ''}';
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.calendar_month_outlined, size: 18),
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                      label: Text('${tr(f.ar, f.en)}: ${cur.isEmpty ? tr('—', '—') : cur}'),
                      onPressed: () async {
                        final init = DateTime.tryParse(cur) ?? DateTime.now();
                        final d = await showDatePicker(context: c, initialDate: init, firstDate: DateTime(2000), lastDate: DateTime(2040));
                        if (d != null) setSheet(() => vals[f.path] = d.toIso8601String().split('T').first);
                      },
                    ),
                  );
                }
                if (f.lookup != null) {
                  final opts = lookups[f.lookup] ?? const <String>[];
                  final cur = '${vals[f.path] ?? ''}';
                  // A saved value that left the list remains as an orphan option: dropping it from the screen makes the field look empty when it is not, and the empty is then saved over a valid value on the first edit of another field.
                  final items = [if (cur.isNotEmpty && !opts.contains(cur)) cur, ...opts];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DropdownButtonFormField<String>(
                      initialValue: cur.isEmpty ? null : cur,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr(f.ar, f.en)),
                      hint: Text(tr('اختر…', 'Select…')),
                      items: items.map((o) => DropdownMenuItem(value: o, child: Text(o, style: const TextStyle(fontSize: 13.5)))).toList(),
                      onChanged: (val) => setSheet(() => vals[f.path] = val ?? ''),
                    ),
                  );
                }
                // The delegate is chosen from employees, not typed.
                // Like web (PersonSelect): name and iqama number are filled together from the employee profile, and the server rejects a name not matching an employee. So both fields are read-only; pick from the list or clear.
                if (f.path == 'authorizedPerson.name' && ctrls[f.path] != null) {
                  final nameCtl = ctrls[f.path]!;
                  final idCtl = ctrls['authorizedPerson.iqamaNumber'];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(children: [
                      Expanded(child: OutlinedButton.icon(
                        icon: const Icon(Icons.person_search_outlined, size: 18),
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                        label: Text('${tr(f.ar, f.en)}: ${nameCtl.text.isEmpty ? tr('اختر من الموظّفين', 'Pick an employee') : nameCtl.text}',
                            overflow: TextOverflow.ellipsis),
                        onPressed: () async {
                          final p = await pickFromApi(c,
                              endpoint: '/api/vehicle-registry/people', listKey: 'people',
                              label: (r) => ['${r['name'] ?? ''}', '${r['idNumber'] ?? ''}', '${r['jobTitleAr'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '),
                              title: tr('المفوَّض', 'Authorised person'));
                          if (p == null) return;
                          setSheet(() { nameCtl.text = '${p['name'] ?? ''}'; idCtl?.text = '${p['idNumber'] ?? ''}'; });
                        },
                      )),
                      if (nameCtl.text.isNotEmpty)
                        IconButton(tooltip: tr('بلا تفويض', 'No authorisation'), icon: const Icon(Icons.close),
                            onPressed: () => setSheet(() { nameCtl.clear(); idCtl?.clear(); })),
                    ]),
                  );
                }
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    TextField(
                      // The delegate's iqama number follows the choice; never typed by hand.
                      readOnly: f.path == 'authorizedPerson.iqamaNumber',
                      controller: ctrls[f.path],
                      keyboardType: f.kind == 'number' ? TextInputType.number : TextInputType.text,
                      textDirection: f.mono ? TextDirection.ltr : null,
                      decoration: InputDecoration(labelText: tr(f.ar, f.en)),
                    ),
                    if (f.personInfo && ctrls[f.path] != null) IqamaPersonInfo(controller: ctrls[f.path]!),
                  ]),
                );
              }),
              Text(
                tr('لا يُكتب من هنا إلا حقول هذا المستند — بقيّة بيانات المركبة تُعدَّل من شاشة سجل المركبات.',
                    'Only this document\u2019s fields are written here — the rest of the vehicle is edited in the vehicle registry.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
              ),
              const SizedBox(height: 12),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
            ]),
          ),
        ),
      ),
    );
    for (final ctl in ctrls.values) { ctl.dispose(); }
    if (ok != true) return;
    try {
      final patch = _buildPatch(fields, vals);
      // Nothing is written without a tap: absence today implicitly means 'required', so writing it ourselves on every save would change rows nobody meant to.
      if (need != initialNeed) _writePath(patch, statusPath, need);
      await Api.instance.put('/api/vehicle-registry/${target['_id']}', patch);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // 'Delete' on a document screen clears the document, not the vehicle.
  // The vehicle exists in reality with a plate, accidents and authorizations. A wrong card number does not mean it no longer exists, and deleting it from here wipes six families not shown on this screen, damage the person tapping cannot see.
  Future<void> _clearDoc(Map<String, dynamic> v) async {
    final fields = widget.family.editable;
    if (fields.isEmpty) return;
    final name = tr(widget.family.arTitle, widget.family.enTitle);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('مسح بيانات المستند', 'Clear document data')),
        content: Text(tr(
            'ستُفرَّغ خانات «$name» على المركبة ${_s(v['plateNumber'])}. المركبة نفسها تبقى في السجلّ ببقيّة مستنداتها.',
            'The «$name» fields on ${_s(v['plateNumber'])} will be emptied. The vehicle stays in the registry with its other documents.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('مسح البيانات', 'Clear data')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final patch = _buildPatch(fields, const {});
    // statusCode is cleared too: it is the reason the date is absent ('not required', 'with the bank'), and keeping it after an explicit clear makes the row apologise for a gap that no longer exists.
    for (final r in _rootsOf(fields)) { _writePath(patch, '$r.statusCode', ''); }
    try {
      await Api.instance.put('/api/vehicle-registry/${v['_id']}', patch);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم مسح بيانات المستند', 'Document data cleared'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Deleting the vehicle itself: only for whoever holds delete rights, and by typing the plate by hand.
  // A button tapped by mistake in a list of 300 erases a vehicle with its accidents, authorizations and whole renewal history. Typing the plate forces reading the row before it is deleted.
  Future<void> _deleteVehicle(Map<String, dynamic> v) async {
    final plate = _s(v['plateNumber']).trim();
    final typed = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setD) => AlertDialog(
          title: Text(tr('حذف المركبة نهائيًا', 'Delete vehicle permanently')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr(
                'هذا ليس مسحًا للمستند. ستُحذف المركبة $plate من السجلّ نهائيًا بكل مستنداتها وتفاويضها وسجلّ تجديداتها — ولا رجعة.',
                'This is not clearing the document. Vehicle $plate will be removed from the registry with every document, authorisation and renewal record — this cannot be undone.'),
                style: const TextStyle(fontSize: 12.5)),
            const SizedBox(height: 10),
            TextField(
              controller: typed,
              onChanged: (_) => setD(() {}),
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: tr('اكتب رقم اللوحة للتأكيد', 'Type the plate to confirm'), hintText: plate),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.danger),
              onPressed: typed.text.trim() == plate ? () => Navigator.pop(c, true) : null,
              child: Text(tr('حذف المركبة', 'Delete vehicle')),
            ),
          ],
        ),
      ),
    );
    typed.dispose();
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/vehicle-registry/${v['_id']}');
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُذفت المركبة $plate', 'Deleted $plate'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Renewing one sheet that covers many vehicles.
  /// One insurance policy covers 198 vehicles. Renewing vehicle by vehicle is not renewing the policy: it is 198 operations for one event, and any vehicle forgotten stays 'expired' on screen though insured.
  /// So the policy is asked, not the vehicles: the numbers are listed with each one's vehicle count and the date is written once. The new number applies to all and is valid only here, since it is one policy; the server rejects it for any document that has a sheet per vehicle.
  Future<void> _renewSharedPaper() async {
    final k = widget.family.docKey;
    if (k == null) return;
    // Groups are built from the loaded rows, so what is listed is what is on screen.
    final groups = <String, ({int count, dynamic expiry})>{};
    for (final v in _rows) {
      final n = _numberOf(v, k);
      if (n.isEmpty) continue;
      final g = groups[n];
      final exp = _dateOf(v, k);
      if (g == null) {
        groups[n] = (count: 1, expiry: exp);
      } else {
        final a = DateTime.tryParse('${g.expiry ?? ''}');
        final b = DateTime.tryParse('${exp ?? ''}');
        groups[n] = (count: g.count + 1, expiry: (b != null && (a == null || b.isBefore(a))) ? exp : g.expiry);
      }
    }
    if (groups.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا وثائقَ في المعروض', 'No policies in view'))));
      return;
    }
    final keys = groups.keys.toList()..sort((a, b) => groups[b]!.count.compareTo(groups[a]!.count));
    var number = keys.first;
    DateTime? when;
    final newNumber = TextEditingController();
    final note = TextEditingController();

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) {
          final g = groups[number]!;
          return Padding(
            padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('تجديد وثيقة كاملة', 'Renew a whole policy'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                Text(tr('الوثيقة الواحدة تغطّي عدّة مركبات، وتجديدها يسري عليها كلّها.',
                        'One policy covers many vehicles; renewing it applies to all of them.'),
                    style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: number,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('رقم الوثيقة', 'Policy number')),
                  items: keys.map((n) => DropdownMenuItem(
                        value: n,
                        child: Text('$n — ${groups[n]!.count} ${tr('مركبة', 'vehicles')}',
                            style: const TextStyle(fontSize: 13)),
                      )).toList(),
                  onChanged: (v) => setSheet(() { number = v ?? number; when = null; }),
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: const Color(0xFFFFF7ED), borderRadius: BorderRadius.circular(10)),
                  child: Text(tr('سيُجدَّد على ${g.count} مركبة', 'Will renew on ${g.count} vehicles'),
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  icon: const Icon(Icons.calendar_month_outlined, size: 18),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                  label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: '
                      '${when == null ? tr('اختر', 'pick') : when!.toIso8601String().split('T').first}'),
                  onPressed: () async {
                    // One year from its current expiry if valid, otherwise one year from today.
                    final cur = DateTime.tryParse('${g.expiry ?? ''}');
                    final base = (cur != null && cur.isAfter(DateTime.now())) ? cur : DateTime.now();
                    final d = await showDatePicker(
                      context: c,
                      initialDate: DateTime(base.year + 1, base.month, base.day),
                      firstDate: DateTime.now(),
                      lastDate: DateTime(2040),
                    );
                    if (d != null) setSheet(() => when = d);
                  },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: newNumber,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: tr('رقم الوثيقة الجديد (إن تغيّر)', 'New policy number (if changed)'),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: when == null ? null : () => Navigator.pop(c, true),
                  child: Text(tr('تجديد على ${g.count} مركبة', 'Renew on ${g.count} vehicles')),
                ),
              ]),
            ),
          );
        },
      ),
    );
    final newNum = newNumber.text.trim();
    final noteTxt = note.text.trim();
    newNumber.dispose();
    note.dispose();
    if (ok != true || when == null) return;
    try {
      final r = await Api.instance.post('/api/vehicle-registry/renew-shared', {
        'document': k,
        'number': number,
        'newExpiry': when!.toIso8601String().split('T').first,
        if (newNum.isNotEmpty) 'newNumber': newNum,
        if (noteTxt.isNotEmpty) 'note': noteTxt,
      });
      await _load();
      final n = (r['summary'] is Map) ? r['summary']['count'] : null;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('اتجدّدت الوثيقة على ${n ?? '—'} مركبة', 'Renewed on ${n ?? '—'} vehicles'))));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Renewal accepting a new number: the operating card comes out with a new number each time, and sometimes the authorization too. An empty field means the number is unchanged, not erased.
  Future<void> _renew(Map v) async {
    final k = widget.family.docKey;
    if (k == null) return;
    if (await showRenewSheet(context, renewTargetOf(v, k))) _load();
  }

  Future<void> _bulkRenew() async {
    final k = widget.family.docKey;
    if (k == null || _picked.isEmpty) return;
    final rows = _rows.where((v) => _picked.contains(_s(v['_id']))).map((v) => renewTargetOf(v, k)).toList();
    if (await showBulkRenewSheet(context, rows)) {
      setState(() => _picked.clear());
      _load();
    }
  }

  // Authorizations: authorize and revoke on the row, two actions rather than two fields to clear
  Future<void> _revokeAuth(Map v) async {
    // The shared revoke (vehicle_lifecycle.dart), same path as the registry, the profile and B2C.
    if (await revokeVehicleAuthorization(context, v, source: 'authorizations')) _load();
  }

  Future<void> _assignAuth(Map v) async {
    Map<String, dynamic>? emp;
    final job = TextEditingController(), number = TextEditingController();
    String start = '', end = '';
    String err = '';
    bool saving = false;
    String? msg;
    Widget dateBtn(BuildContext c, String label, String val, ValueChanged<String> on) => OutlinedButton.icon(
          icon: const Icon(Icons.event, size: 18),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
          label: Text('$label: ${val.isEmpty ? '—' : val}'),
          onPressed: () async {
            final d = await showDatePicker(context: c, initialDate: DateTime.tryParse(val) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
            if (d != null) on(d.toIso8601String().split('T').first);
          },
        );
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('تفويض مركبة', 'Authorise a vehicle'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          Text([_s(v['plateNumber']), _s(v['ownerNameAr'])].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.person_search_outlined, size: 18),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
            label: Text('${tr('الموظّف *', 'Employee *')}: ${emp == null ? tr('اختر', 'Pick') : _s(emp!['name'])}', overflow: TextOverflow.ellipsis),
            onPressed: () async {
              final p = await pickFromApi(c, endpoint: '/api/vehicle-registry/people', listKey: 'people',
                  label: (r) => ['${r['name'] ?? ''}', '${r['idNumber'] ?? ''}', '${r['jobTitleAr'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '),
                  title: tr('الموظّف', 'Employee'));
              if (p == null) return;
              setS(() { emp = p; if (job.text.trim().isEmpty) job.text = _s(p['jobTitleAr']); });
            },
          ),
          if (emp != null)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text([_s(emp!['idNumber']), _s(emp!['phone']), _s(emp!['projectAr'])].where((x) => x.isNotEmpty).join(' · '),
                style: const TextStyle(fontSize: 11.5, color: T.success))),
          const SizedBox(height: 10),
          LookupField(type: 'vehicle_job_title', controller: job, label: tr('المسمّى الوظيفي', 'Job title')),
          const SizedBox(height: 10),
          TextField(controller: number, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('رقم التفويض', 'Authorisation number'))),
          const SizedBox(height: 10),
          dateBtn(c, tr('بداية التفويض', 'Start date'), start, (x) => setS(() => start = x)),
          const SizedBox(height: 8),
          dateBtn(c, tr('نهاية التفويض', 'End date'), end, (x) => setS(() => end = x)),
          const SizedBox(height: 8),
          Text(tr('يُكتب التفويضُ على المركبة، ويظهر في ملفّ الموظّف متى عُرف برقم إقامته.',
              'The authorisation is written on the vehicle, and appears in the employee\'s file once matched by iqama number.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          if (err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(err, style: const TextStyle(color: T.danger, fontSize: 12.5))),
          const SizedBox(height: 12),
          FilledButton.icon(
            icon: const Icon(Icons.save_outlined),
            label: Text(tr('تفويض', 'Authorise')),
            onPressed: saving || emp == null ? null : () async {
              setS(() { saving = true; err = ''; });
              try {
                final r = await Api.instance.post('/api/vehicle-registry/${v['_id']}/authorization', {
                  'action': 'assign', 'name': _s(emp!['name']), 'iqamaNumber': _s(emp!['idNumber']),
                  'jobTitleAr': job.text.trim(), 'authorizationNumber': number.text.trim(),
                  'startDate': start, 'expiryDate': end,
                  'employeeId': emp!['employeeId'], 'ltId': emp!['ltId'],
                });
                msg = _s(r is Map ? r['message'] : null);
                if (c.mounted) Navigator.pop(c);
              } catch (e) { setS(() { saving = false; err = e.toString(); }); }
            },
          ),
        ])),
      )),
    );
    if (msg != null) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg!.isEmpty ? tr('تمّ التفويض', 'Authorised') : msg!)));
      _load();
    }
  }

  // Export: 'shown' is after filter, chip and search; 'all' is the whole register
  List<ExportCol> get _exportCols {
    final f = widget.family;
    final k = f.docKey;
    return [
      ExportCol('رقم اللوحة', 'Plate', (v) => v['plateNumber'] ?? ''),
      ExportCol('رقم الهيكل', 'Chassis', (v) => v['chassisNumber'] ?? ''),
      ExportCol('الرقم التسلسلي', 'Serial', (v) => v['serialNumber'] ?? ''),
      ExportCol('نوع التسجيل', 'Registration type', (v) => v['registrationTypeAr'] ?? ''),
      ExportCol('ماركة المركبة', 'Brand', (v) => v['brandAr'] ?? ''),
      ExportCol('طراز المركبة', 'Model', (v) => v['modelAr'] ?? ''),
      ExportCol('الموديل', 'Year', (v) => v['modelYear'] ?? ''),
      ExportCol('اللون', 'Colour', (v) => v['colorAr'] ?? ''),
      ExportCol('القطاع', 'Sector', (v) => v['sectorAr'] ?? ''),
      ExportCol('الإدارة', 'Department', (v) => v['departmentAr'] ?? ''),
      ExportCol('المدينة', 'City', (v) => v['cityAr'] ?? ''),
      ExportCol('المالك', 'Owner', (v) => v['ownerNameAr'] ?? ''),
      ...f.fields.where((x) => !const ['المالك', 'الإدارة'].contains(x.ar)).map((x) => ExportCol(x.ar, x.en, (v) => x.get(v))),
      if (k != null) ...[
        ExportCol('الحالة', 'State', (v) => stateMetaOf(docStateKey(v, k)).$1),
        ExportCol('الأيام المتبقية', 'Days left', (v) => _state(v, k)['days'] ?? ''),
      ],
    ];
  }

  Future<void> _export(List<Map<String, dynamic>> shown) async {
    final f = widget.family;
    final scope = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('تصدير المعروض (بعد الفلتر)', 'Export what is shown (filtered)')), subtitle: Text('${shown.length}'), onTap: () => Navigator.pop(c, 'shown')),
      ListTile(leading: const Icon(Icons.select_all), title: Text(tr('تصدير الكلّ', 'Export everything')), subtitle: Text(tr('السجلّ كلُّه', 'whole register')), onTap: () => Navigator.pop(c, 'all')),
    ])));
    if (scope == null || !mounted) return;
    var rows = shown;
    if (scope == 'all') {
      try {
        rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/vehicle-registry?limit=2000'))['vehicles'] ?? []);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
        return;
      }
    }
    if (!mounted) return;
    final title = tr(f.arTitle, f.enTitle);
    await exportExcel(context, fileName: f.fileName, sheets: [(title.length > 28 ? title.substring(0, 28) : title, _exportCols, rows)]);
  }

  // Name and path of the document number, as the server defines them in config/vehicleDocuments. The driving licence and inspection have no number, so no field in the renewal dialog.
  String _numberOf(Map v, String k) => switch (k) {
        'insurance' => _s(_sub(v, 'insurance')['policyNumber']),
        'operatingCard' => _s(_sub(v, 'operatingCard')['cardNumber']),
        'gps' => _s(_sub(v, 'gps')['serialImei']),
        'authorization' => _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
        _ => '',
      };
  dynamic _dateOf(Map v, String k) => switch (k) {
        'insurance' => _sub(v, 'insurance')['expiryDate'],
        'operatingCard' => _sub(v, 'operatingCard')['expiryDate'],
        'vehicleLicense' => _sub(v, 'vehicleLicense')['expiryDate'],
        'inspection' => _sub(v, 'inspection')['expiryDate'],
        'gps' => _sub(v, 'gps')['expiryDate'],
        'authorization' => _sub(v, 'authorizedPerson')['expiryDate'],
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final f = widget.family;
    final auth = context.watch<AuthProvider>();
    // No writing without known fields: a family that did not declare its fields stays read and renew only, so no button appears that does not know where to write.
    final canEdit = f.editable.isNotEmpty
        && (_editRoles.contains(auth.role) || auth.canEditSection('Vehicles'));
    /// Real delete is a narrower permission than edit; the same split as on the server.
    final canDelete = _adminRoles.contains(auth.role)
        || (auth.role != 'client' && auth.canEditSection('Vehicles'));
    // Search passes twice, so both must agree.
    // The server searches every text field, then the result is filtered here with all row values (like deepValues on web), otherwise the screen would drop what the server found.
    final q = _fold(_q);
    final searched = q.isEmpty
        ? _rows
        : _rows.where((v) => [..._deepValues(v), ...f.searchIn(v)].any((x) => _fold(x).contains(q))).toList();
    final chips = _chips;
    final active = chips.firstWhere((c) => c.key == _chip, orElse: () => chips.first);
    final chipped = active.test == null ? searched : searched.where((v) => active.test!(v)).toList();
    // The day range works on top of the chips, not instead of them; a row with no date is excluded from any range.
    final k0 = f.docKey;
    final withinN = int.tryParse(_within);
    final rows = (k0 == null || withinN == null) ? chipped : chipped.where((v) {
      final d = _state(v, k0)['days'];
      if (d == null) return false;
      final n = d is num ? d : num.tryParse('$d') ?? 0;
      if (n < 0) return _includeExpired;
      return n <= withinN;
    }).toList();

    final canEditVeh = _editRoles.contains(auth.role) || auth.canEditSection('Vehicles');
    final canRenewShared = f.sharedPaper && f.docKey != null && canEditVeh;
    final renewable = f.docKey != null && canEditVeh;
    final allPicked = rows.isNotEmpty && rows.every((v) => _picked.contains(_s(v['_id'])));

    return AppScaffold(
      title: Text(tr(f.arTitle, f.enTitle)),
      actions: [
        if (renewable && _picked.isNotEmpty)
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            icon: const Icon(Icons.autorenew, size: 18),
            label: Text(tr('تجديد ${_picked.length}', 'Renew ${_picked.length}')),
            onPressed: _bulkRenew,
          ),
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onPressed: _loading ? null : () => _export(rows),
        ),
        if (canRenewShared)
          IconButton(
            tooltip: tr('تجديد وثيقة كاملة', 'Renew a whole policy'),
            icon: const Icon(Icons.autorenew),
            onPressed: _renewSharedPaper,
          ),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () => _editDoc(null),
        icon: const Icon(Icons.add),
        label: Text(tr('إضافة', 'Add')),
      ),
      body: Column(children: [
          // Search sits outside the loading/error branch so it is not rebuilt empty
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(
                        child: SearchField(
                          controller: _searchCtl,
                          onChanged: (v) {
                            setState(() => _q = v);
                            final mine = ++_seq;
                            Future.delayed(const Duration(milliseconds: 350), () { if (mounted && mine == _seq) _load(); });
                          },
                          hint: tr('ابحث بأيّ شيء — لوحة، هيكل، مالك، رقم هويّة، رقم وثيقة…', 'Search anything — plate, chassis, owner, ID, policy…'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Exactly the web filters: they come from the server with counts computed after the other filters, so what the user sees here does not differ from what they see there.
                      Badge(
                        isLabelVisible: _filters.isNotEmpty,
                        label: Text('${_filters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                          icon: const Icon(Icons.tune),
                          tooltip: tr('التصفية', 'Filter'),
                          onPressed: () async {
                            final r = await showFilterSheet(
                              context: context,
                              optionsUrl: '/api/vehicle-registry/filters',
                              value: _filters,
                            );
                            if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                          },
                        ),
                      ),
                    ]),
                  ),
          Expanded(child: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // 'What expires within N days?' works together with the filter and chips.
                  if (k0 != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 0, 14, 4),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(children: [
                          Text(tr('ينتهي خلال', 'Expiring within'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                          const SizedBox(width: 6),
                          SizedBox(
                            width: 72,
                            child: TextField(
                              controller: _withinCtl,
                              keyboardType: TextInputType.number,
                              textAlign: TextAlign.center,
                              decoration: InputDecoration(isDense: true, hintText: tr('الكل', 'Any'),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 12)),
                              onChanged: (x) => setState(() => _within = x.trim()),
                            ),
                          ),
                          const SizedBox(width: 4),
                          for (final n in const [7, 15, 30, 60, 90, 180])
                            Padding(
                              padding: const EdgeInsetsDirectional.only(end: 4),
                              child: ChoiceChip(
                                visualDensity: VisualDensity.compact,
                                label: Text('$n', style: const TextStyle(fontSize: 11.5)),
                                selected: _within == '$n',
                                onSelected: (_) => setState(() { _within = '$n'; _withinCtl.text = '$n'; }),
                              ),
                            ),
                          ChoiceChip(
                            visualDensity: VisualDensity.compact,
                            label: Text(tr('الكل', 'All'), style: const TextStyle(fontSize: 11.5)),
                            selected: _within.isEmpty,
                            onSelected: (_) => setState(() { _within = ''; _withinCtl.clear(); }),
                          ),
                          if (_within.isNotEmpty) ...[
                            Checkbox(value: _includeExpired, onChanged: (x) => setState(() => _includeExpired = x == true)),
                            Text(tr('يشمل المنتهي', 'Include expired'), style: const TextStyle(fontSize: 11.5)),
                          ],
                        ]),
                      ),
                    ),
                  if (renewable)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Row(children: [
                        Checkbox(
                          value: allPicked,
                          onChanged: (_) => setState(() {
                            if (allPicked) {
                              for (final v in rows) { _picked.remove(_s(v['_id'])); }
                            } else {
                              for (final v in rows) { _picked.add(_s(v['_id'])); }
                            }
                          }),
                        ),
                        Text(tr('اختيار كل المعروض', 'Select all shown'), style: const TextStyle(fontSize: 12)),
                        const Spacer(),
                        if (_picked.isNotEmpty)
                          TextButton.icon(
                            icon: const Icon(Icons.autorenew, size: 17),
                            label: Text(tr('تجديد ${_picked.length} مستند', 'Renew ${_picked.length}')),
                            style: TextButton.styleFrom(foregroundColor: T.success),
                            onPressed: _bulkRenew,
                          ),
                      ]),
                    ),
                  SizedBox(
                    height: 42,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      children: chips.map((c) {
                        final n = c.test == null ? searched.length : searched.where(c.test!).length;
                        final on = c.key == active.key;
                        return Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: ChoiceChip(
                            selected: on,
                            selectedColor: c.tone.withValues(alpha: 0.18),
                            label: Text('${tr(c.ar, c.en)} $n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? c.tone : T.inkFaint)),
                            onSelected: (_) => setState(() => _chip = on ? '' : c.key),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: f.icon, title: tr('لا نتائج مطابقة', 'No matching rows'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              // Bottom padding so the add button does not cover the last card.
                              padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final k = f.docKey;
                                final st = k == null ? null : _state(v, k);
                                final meta = k == null ? null : stateMetaOf(docStateKey(v, k));
                                final id = _s(v['_id']);
                                return AppCard(
                                  topAccent: meta == null ? T.navy : meta.$2,
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      if (renewable)
                                        SizedBox(width: 30, height: 24, child: Checkbox(
                                          value: _picked.contains(id),
                                          onChanged: (x) => setState(() => x == true ? _picked.add(id) : _picked.remove(id)),
                                        )),
                                      Flexible(flex: 5, child: Text(_s(v['plateNumber']), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                                      const SizedBox(width: 8),
                                      Expanded(flex: 6, child: meta == null ? const SizedBox() : Align(alignment: AlignmentDirectional.centerEnd,
                                          child: Chip2(st!['days'] == null ? meta.$1 : '${meta.$1} · ${daysText(st['days'])}', meta.$2))),
                                    ]),
                                    // Which vehicle this is, not just its number.
                                    // The plate says which row this is but not which vehicle; someone reviewing inspection or insurance asks about the truck ('Hino model 2019'), not the plate. These are three fields that arrive with the row anyway, the same ones that became fixed columns on web.
                                    if (_identity(v).isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Text(_identity(v),
                                            style: const TextStyle(fontSize: 11.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                                      ),
                                    const SizedBox(height: 6),
                                    ...f.fields.map((fl) {
                                      final val = fl.get(v);
                                      return Padding(
                                        padding: const EdgeInsets.symmetric(vertical: 2),
                                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Expanded(flex: 2, child: Text(tr(fl.ar, fl.en), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                                          Expanded(
                                            flex: 3,
                                            child: Text(
                                              val.isEmpty ? '—' : val,
                                              textAlign: TextAlign.end,
                                              textDirection: fl.mono ? TextDirection.ltr : null,
                                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                                            ),
                                          ),
                                        ]),
                                      );
                                    }),
                                    if (renewable || canEdit || (f.authActions && canEditVeh)) ...[
                                      const SizedBox(height: 6),
                                      Align(
                                        alignment: AlignmentDirectional.centerEnd,
                                        child: Wrap(spacing: 2, children: [
                                          if (f.authActions && canEditVeh)
                                            _s(_sub(v, 'authorizedPerson')['name']).isNotEmpty
                                                ? TextButton.icon(
                                                    onPressed: () => _revokeAuth(v),
                                                    icon: const Icon(Icons.person_remove_outlined, size: 17),
                                                    label: Text(tr('إلغاء التفويض', 'Revoke')),
                                                    style: TextButton.styleFrom(foregroundColor: T.danger),
                                                  )
                                                : TextButton.icon(
                                                    onPressed: () => _assignAuth(v),
                                                    icon: const Icon(Icons.person_add_alt_1_outlined, size: 17),
                                                    label: Text(tr('تفويض', 'Authorise')),
                                                    style: TextButton.styleFrom(foregroundColor: T.success),
                                                  ),
                                          if (renewable)
                                            TextButton.icon(
                                              onPressed: () => _renew(v),
                                              icon: const Icon(Icons.autorenew_rounded, size: 17),
                                              label: Text(tr('تجديد', 'Renew')),
                                            ),
                                          // Removing the chip is a recorded action.
                                          // It is a condition of employee clearance: service does not end while the chip is in his hand, and even if the vehicle is his, the chip is ours and billed to our account. A condition built on an empty field proves nothing.
                                          if (canEdit
                                              && f.keyField == 'fuelCard.cardNumber'
                                              && _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty)
                                            TextButton.icon(
                                              onPressed: () => _removeChip(v),
                                              icon: const Icon(Icons.power_off_outlined, size: 17),
                                              label: Text(tr('نزع الشريحة', 'Remove chip')),
                                              style: TextButton.styleFrom(foregroundColor: T.warn),
                                            ),
                                          if (canEdit)
                                            IconButton(
                                              tooltip: tr('تعديل بيانات هذا المستند', 'Edit this document'),
                                              icon: const Icon(Icons.edit_outlined, size: 18),
                                              onPressed: () => _editDoc(v),
                                            ),
                                          // An eraser, not a trash can: the icon itself says that data is cleared, not a vehicle.
                                          if (canEdit && !f.hideClear && _hasDoc(v, f.editable, f.keyField))
                                            IconButton(
                                              tooltip: tr('مسح بيانات هذا المستند', 'Clear this document'),
                                              icon: const Icon(Icons.backspace_outlined, size: 18, color: T.danger),
                                              onPressed: () => _clearDoc(v),
                                            ),
                                          if (canEdit && canDelete)
                                            IconButton(
                                              tooltip: tr('حذف المركبة نهائيًا', 'Delete vehicle permanently'),
                                              icon: const Icon(Icons.delete_forever_outlined, size: 18, color: T.danger),
                                              onPressed: () => _deleteVehicle(v),
                                            ),
                                        ]),
                                      ),
                                    ],
                                  ]),
                                );
                              },
                            ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(tr('${rows.length} من $_total مركبة', '${rows.length} of $_total vehicles'),
                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  ),
                ])),
        ]),
    );
  }
}

// The seven families
// Same columns, order and names as on web, so someone opening both screens the same day does not find two different tables for the same data.

final vehicleInsuranceFamily = DocFamily(
  docKey: 'insurance',
  fileName: 'vehicle-insurance',
  sharedPaper: true,
  arTitle: 'تأمين المركبات', enTitle: 'Vehicle Insurance',
  icon: Icons.shield_outlined,
  fields: [
    DocField('رقم وثيقة التأمين', 'Policy number', (v) => _s(_sub(v, 'insurance')['policyNumber']), mono: true),
    DocField('تاريخ انتهاء التأمين', 'Insurance expiry', (v) => fmtDate(_sub(v, 'insurance')['expiryDate'])),
    DocField('شركة التأمين', 'Insurer', (v) => _s(_sub(v, 'insurance')['companyAr'])),
    DocField('نوع التأمين', 'Coverage type', (v) => _s(_sub(v, 'insurance')['coverageTypeAr'])),
    // A vehicle whose instalment is paid by the financier is not 'no instalment': it is insured and the number is with them.
    DocField('قيمة التأمين', 'Premium', (v) {
      final ins = _sub(v, 'insurance');
      return ins['premiumSar'] != null ? money(ins['premiumSar']) : _s(ins['premiumStatusAr']);
    }),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'insurance')['policyNumber']), _s(_sub(v, 'insurance')['companyAr']), _s(v['ownerNameAr'])],
  // Insurance value is two fields, not one: a number when we pay, text when the financier pays ('owned by Al Rajhi Bank'). Merging them forces the entry person to leave the number empty, so the vehicle is counted uninsured while it is insured.
  editable: const [
    DocEditField('insurance.policyNumber', 'رقم وثيقة التأمين', 'Policy number', mono: true),
    DocEditField('insurance.companyAr', 'شركة التأمين', 'Insurer', lookup: 'vehicle_insurance_company'),
    DocEditField('insurance.coverageTypeAr', 'نوع التأمين', 'Coverage type', lookup: 'vehicle_coverage_type'),
    DocEditField('insurance.expiryDate', 'تاريخ انتهاء التأمين', 'Insurance expiry', kind: 'date'),
    DocEditField('insurance.premiumSar', 'قيمة التأمين (ر.س)', 'Premium (SAR)', kind: 'number'),
    DocEditField('insurance.premiumStatusAr', 'جهة سداد القسط', 'Who pays the premium'),
  ],
);

final vehicleOperatingCardFamily = DocFamily(
  docKey: 'operatingCard',
  fileName: 'vehicle-operating-cards',
  arTitle: 'بطاقات التشغيل', enTitle: 'Operating Cards',
  icon: Icons.credit_card_outlined,
  fields: [
    DocField('رقم بطاقة التشغيل', 'Operating card number', (v) => _s(_sub(v, 'operatingCard')['cardNumber']), mono: true),
    DocField('تاريخ الانتهاء', 'Expiry date', (v) => fmtDate(_sub(v, 'operatingCard')['expiryDate'])),
    DocField('الإدارة', 'Department', (v) => _s(v['departmentAr'])),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'operatingCard')['cardNumber']), _s(v['ownerNameAr']), _s(v['departmentAr'])],
  // The number and date are the whole card; administration and owner are shown but not written from here, since they are the vehicle's identity, not its document.
  editable: const [
    DocEditField('operatingCard.cardNumber', 'رقم بطاقة التشغيل', 'Operating card number', mono: true),
    DocEditField('operatingCard.expiryDate', 'تاريخ الانتهاء', 'Expiry date', kind: 'date'),
  ],
);

final vehicleAuthorizationFamily = DocFamily(
  docKey: 'authorization',
  fileName: 'vehicle-authorizations',
  hideClear: true,
  authActions: true,
  arTitle: 'التفاويض', enTitle: 'Authorisations',
  icon: Icons.assignment_ind_outlined,
  fields: [
    DocField('اسم المفوَّض', 'Authorised person', (v) => _s(_sub(v, 'authorizedPerson')['name'])),
    DocField('رقم الإقامة', 'Iqama number', (v) => _s(_sub(v, 'authorizedPerson')['iqamaNumber']), mono: true),
    DocField('رقم التفويض', 'Authorisation number', (v) => _s(_sub(v, 'authorizedPerson')['authorizationNumber']), mono: true),
    DocField('تاريخ بداية التفويض', 'Start date', (v) => fmtDate(_sub(v, 'authorizedPerson')['startDate'])),
    DocField('تاريخ نهاية التفويض', 'End date', (v) => fmtDate(_sub(v, 'authorizedPerson')['expiryDate'])),
    // And the driver himself.
    // An authorization is a paper on a vehicle but is given to a person. Three things concern that person: this paper, his driver card and his breach-of-trust cover, and he does not drive with any one missing. The server gathers them by iqama number.
    DocField('بطاقة السائق', 'Driver card', (v) {
      final c = _sub(v, 'driverCard');
      if (c.isEmpty) return _s(_sub(v, 'authorizedPerson')['iqamaNumber']).isEmpty ? '' : 'لا بطاقة';
      final exp = _s(c['expiryDate']);
      return [_s(c['cardNumber']), if (exp.isNotEmpty) '⟵ $exp'].where((x) => x.isNotEmpty).join(' ');
    }, mono: true),
    DocField('خيانة الأمانة', 'Fidelity insurance', (v) {
      final c = _sub(v, 'driverCard');
      if (c.isEmpty) return '';
      return switch (_s(c['fidelityStatus'])) {
        'covered' => 'مشمول',
        'required' => 'مطلوب ضمُّه',
        _ => 'غير محدَّد',
      };
    }),
    // Iqama and driving licence expiry come from his HR profile.
    DocField('انتهاء الإقامة', 'Iqama expiry', (v) => _sub(v, 'personDocs').isEmpty ? '' : personDocValue(_sub(v, 'personDocs'), 'iqama').$1),
    DocField('انتهاء رخصة القيادة', 'Licence expiry', (v) => _sub(v, 'personDocs').isEmpty ? '' : personDocValue(_sub(v, 'personDocs'), 'license').$1),
  ],
  searchIn: (v) => [
    _s(v['plateNumber']), _s(_sub(v, 'authorizedPerson')['name']),
    _s(_sub(v, 'authorizedPerson')['iqamaNumber']), _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
    _s(_sub(v, 'driverCard')['cardNumber']),
  ],
  // The full authorization paper: who, under which iqama and number, and from when to when. A name with no authorization number or period proves nothing about the driver's standing.
  editable: const [
    DocEditField('authorizedPerson.name', 'اسم المفوَّض', 'Authorised person'),
    DocEditField('authorizedPerson.iqamaNumber', 'رقم الإقامة', 'Iqama number', mono: true, personInfo: true),
    // Job title is a list, not a free field: 'heavy transport driver' on 57 vehicles and 'delivery rep' on 23, and a free field turns those into twenty titles.
    DocEditField('authorizedPerson.jobTitleAr', 'المسمّى الوظيفي لقائد المركبة', 'Driver job title',
        lookup: 'vehicle_job_title'),
    DocEditField('authorizedPerson.authorizationNumber', 'رقم التفويض', 'Authorisation number', mono: true),
    DocEditField('authorizedPerson.startDate', 'تاريخ بداية التفويض', 'Start date', kind: 'date'),
    DocEditField('authorizedPerson.expiryDate', 'تاريخ نهاية التفويض', 'End date', kind: 'date'),
  ],
);

final vehicleFuelCardFamily = DocFamily(
  // A fuel chip has no expiry date, so no status column and no renew button.
  docKey: null,
  fileName: 'vehicle-fuel-cards',
  arTitle: 'بترو اب — شرائح الوقود', enTitle: 'Petro App Cards',
  icon: Icons.local_gas_station_outlined,
  // Chip presence is its number, not any filled field: ten vehicles have a chip status but no chip, and they used to vanish from the add list.
  keyField: 'fuelCard.cardNumber',
  fields: [
    // Who drives the vehicle and his iqama number: fuel review asks 'who fuelled', not 'which vehicle', and the answer used to be on another screen.
    DocField('اسم القائد / المفوَّض', 'Driver / authorised', (v) => _s(_sub(v, 'authorizedPerson')['name'])),
    DocField('رقم الإقامة', 'Iqama number', (v) => _s(_sub(v, 'authorizedPerson')['iqamaNumber']), mono: true),
    DocField('شريحة بترو اب', 'Petro App chip', (v) => _s(_sub(v, 'fuelCard')['cardNumber']), mono: true),
    // The plate on the invoice is written in another format and is the only key to match an invoice line to the vehicle, so this is not a duplicate of the plate.
    DocField('رقم اللوحة في فاتورة بترو اب', 'Plate on invoice', (v) => _s(_sub(v, 'fuelCard')['plateOnInvoiceAr'])),
    DocField('حالة الشريحة', 'Chip status', (v) => _s(_sub(v, 'fuelCard')['statusAr'])),
    DocField('نوع الاستهلاك', 'Consumption type', (v) => _s(_sub(v, 'fuelCard')['consumptionTypeAr'])),
    DocField('حد الاستهلاك', 'Consumption limit', (v) {
      final fc = _sub(v, 'fuelCard');
      if (fc['limitStatus'] == 'open') return tr('مفتوح — بلا سقف', 'Open — no ceiling');
      return fc['limitSar'] != null ? money(fc['limitSar']) : '';
    }),
  ],
  searchIn: (v) => [
    _s(v['plateNumber']), _s(_sub(v, 'fuelCard')['cardNumber']), _s(_sub(v, 'fuelCard')['plateOnInvoiceAr']),
    _s(_sub(v, 'authorizedPerson')['name']), _s(_sub(v, 'authorizedPerson')['iqamaNumber']),
  ],
  // 'Open' is a flag, not a number: zero in the cap field means 'spending forbidden' and blank means 'unknown', both the opposite of the intent. So the flag is a switch that writes open.
  editable: const [
    DocEditField('fuelCard.cardNumber', 'رقم شريحة بترو اب', 'Petro App chip number', mono: true),
    DocEditField('fuelCard.plateOnInvoiceAr', 'رقم اللوحة في فاتورة بترو اب', 'Plate on Petro App invoice'),
    DocEditField('fuelCard.provider', 'المزوّد', 'Provider'),
    DocEditField('fuelCard.statusAr', 'حالة الشريحة', 'Chip status', lookup: 'vehicle_fuel_card_status'),
    DocEditField('fuelCard.consumptionTypeAr', 'نوع الاستهلاك', 'Consumption type', lookup: 'vehicle_consumption_type'),
    DocEditField('fuelCard.limitSar', 'حد الاستهلاك (ر.س)', 'Consumption limit (SAR)', kind: 'number'),
    DocEditField('fuelCard.limitStatus', 'مفتوح — بلا سقف صرف', 'Open — no spending ceiling', kind: 'flag', on: 'open'),
  ],
  chips: [
    const DocChip('', 'الكل', 'All', T.navy),
    DocChip('has', 'لها شريحة', 'Has a chip', T.success, (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty),
    // 'No chip' is a work list, not an inventory.
    // A vehicle marked 'not required' has no chip and no work on it: it is not ours or does not draw from our account. Counting it under 'no chip' inflates the number with rows from which nothing can be opened.
    DocChip('none', 'بلا شريحة — مطلوبة', 'No chip — needed', T.danger,
        (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isEmpty
            && !ReqToggle._off(_s(_sub(v, 'fuelCard')['statusCode']))),
    DocChip('notReq', 'غير مطلوبة', 'Not required', T.inkFaint,
        (v) => ReqToggle._off(_s(_sub(v, 'fuelCard')['statusCode']))),
    DocChip('open', 'بلا سقف استهلاك', 'No ceiling', T.orange, (v) => _sub(v, 'fuelCard')['limitStatus'] == 'open'),
    DocChip('noInvoicePlate', 'بلا لوحة على الفاتورة', 'No plate on invoice', T.violet,
        (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty && _s(_sub(v, 'fuelCard')['plateOnInvoiceAr']).isEmpty),
  ],
);

final vehicleGpsFamily = DocFamily(
  docKey: 'gps',
  fileName: 'vehicle-gps',
  arTitle: 'أجهزة التتبّع GPS', enTitle: 'GPS Devices',
  icon: Icons.satellite_alt_outlined,
  fields: [
    DocField('جهاز GPS', 'GPS device', (v) => _s(_sub(v, 'gps')['deviceModel'])),
    // Device status differs from subscription status: a stolen device can have a valid subscription.
    DocField('حالة جهاز GPS', 'Device status', (v) => _s(_sub(v, 'gps')['deviceStatusAr'])),
    DocField('شركة الـGPS', 'GPS provider', (v) => _s(_sub(v, 'gps')['provider'])),
    DocField('سريال GPS', 'GPS serial', (v) => _s(_sub(v, 'gps')['serialImei']), mono: true),
    DocField('تاريخ انتهاء الـGPS', 'Subscription expiry', (v) => fmtDate(_sub(v, 'gps')['expiryDate'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'gps')['serialImei']), _s(_sub(v, 'gps')['deviceModel']), _s(_sub(v, 'gps')['provider'])],
  // Device status is a field independent of the subscription date: a stolen device with a valid subscription is a real state, and deriving one from the other would lose it.
  editable: const [
    DocEditField('gps.deviceModel', 'جهاز GPS', 'GPS device', lookup: 'vehicle_gps_device'),
    DocEditField('gps.deviceStatusAr', 'حالة جهاز GPS', 'Device status', lookup: 'vehicle_gps_device_status'),
    DocEditField('gps.provider', 'شركة الـGPS', 'GPS provider', lookup: 'vehicle_gps_provider'),
    DocEditField('gps.serialImei', 'سريال GPS', 'GPS serial', mono: true),
    DocEditField('gps.simNumber', 'رقم الشريحة', 'SIM number', mono: true),
    DocEditField('gps.expiryDate', 'تاريخ انتهاء الـGPS', 'Subscription expiry', kind: 'date'),
  ],
);

final vehicleLicenceFamily = DocFamily(
  docKey: 'vehicleLicense',
  fileName: 'vehicle-licenses',
  arTitle: 'رخص السير', enTitle: 'Vehicle Licences',
  icon: Icons.description_outlined,
  fields: [
    // The licence is printed in Hijri while the system computes in Gregorian; showing only one makes the employee compare what is in hand with the screen and they do not match.
    DocField('انتهاء رخصة السير (ميلادي)', 'Licence expiry (Gregorian)', (v) => fmtDate(_sub(v, 'vehicleLicense')['expiryDate'])),
    DocField('انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', (v) => _s(_sub(v, 'vehicleLicense')['expiryDateHijri']), mono: true),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'vehicleLicense')['expiryDateHijri'])],
  // Both dates are written together, not just one: entering one and leaving the other brings back the disagreement the two columns were added to remove.
  editable: const [
    DocEditField('vehicleLicense.expiryDate', 'انتهاء رخصة السير (ميلادي)', 'Licence expiry (Gregorian)', kind: 'date'),
    DocEditField('vehicleLicense.expiryDateHijri', 'انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', mono: true),
  ],
);

final vehicleInspectionFamily = DocFamily(
  docKey: 'inspection',
  fileName: 'vehicle-inspection',
  arTitle: 'الفحص الدوري', enTitle: 'Periodic Inspection',
  icon: Icons.fact_check_outlined,
  // No 'inspection status' line.
  // It was text reading 'passed' or 'not required', and the status badge at the top of the card says the same thing more currently: computed from the expiry date today, not written at the last import. Two lines saying one thing that diverge after the first renewal leave the reader unsure which to trust. The field itself remains and is written in the form.
  fields: [
    DocField('تاريخ انتهاء الفحص (ميلادي)', 'Inspection expiry (Gregorian)', (v) => fmtDate(_sub(v, 'inspection')['expiryDate'])),
    DocField('تاريخ انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', (v) => _s(_sub(v, 'inspection')['expiryDateHijri']), mono: true),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'inspection')['statusAr'])],
  // Inspection status is written as text as in the source file and not derived from the date: a trailer is not inspected at all, and its empty date is not a failure.
  editable: const [
    DocEditField('inspection.statusAr', 'حالة الفحص', 'Inspection status'),
    DocEditField('inspection.expiryDate', 'تاريخ انتهاء الفحص (ميلادي)', 'Inspection expiry (Gregorian)', kind: 'date'),
    DocEditField('inspection.expiryDateHijri', 'تاريخ انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', mono: true),
  ],
);

/// What is known about the iqama number's owner (birth date and mobile) shown under the field as the number is typed. Read from person-lookup (HR, the light transport register and driver cards) and matched on the full number. Matches IqamaPersonInfo on web.
class IqamaPersonInfo extends StatefulWidget {
  final TextEditingController controller;
  const IqamaPersonInfo({super.key, required this.controller});
  @override
  State<IqamaPersonInfo> createState() => _IqamaPersonInfoState();
}

class _IqamaPersonInfoState extends State<IqamaPersonInfo> {
  Map<String, dynamic>? _p;
  String _state = '';
  String _id = '';
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _changed();
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

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
        final people = List.from((d is Map ? d['people'] : null) ?? const []);
        final hit = people.cast<Map>().where((x) => '${x['idNumber'] ?? ''}'.replaceAll(RegExp(r'\s+'), '') == id).toList();
        setState(() { _p = hit.isEmpty ? null : Map<String, dynamic>.from(hit.first); _state = hit.isEmpty ? 'missing' : ''; });
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
    final dob = '${p['dateOfBirth'] ?? ''}';
    final phone = '${p['phone'] ?? ''}'.isNotEmpty ? '${p['phone']}' : '${p['absherPhone'] ?? ''}';
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.success.withValues(alpha: 0.3))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${p['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        const SizedBox(height: 2),
        Text('${tr('تاريخ الميلاد', 'Date of birth')}: ${dob.length >= 10 ? dob.substring(0, 10).split('-').reversed.join('/') : tr('غير مسجَّل', 'not recorded')}', style: const TextStyle(fontSize: 12)),
        Text('${tr('الجوال', 'Mobile')}: ${phone.isEmpty ? tr('غير مسجَّل', 'not recorded') : phone}', style: const TextStyle(fontSize: 12)),
        // Iqama and driving licence expiry, in Gregorian; expired ones in red.
        for (final e in [('انتهاء الإقامة', 'Iqama expiry', '${p['iqamaExpiry'] ?? ''}'), ('انتهاء رخصة القيادة', 'Driving licence expiry', '${p['licenseExpiry'] ?? ''}')])
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
