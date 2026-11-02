import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../ui/export_sheet.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';

/// Duty start check register: review, not the check itself. `B2cDutyScreen` is the supervisor's screen (stand at the bike, photograph, save); this is its counterpart: who sent whom out, when, with which photo, and who was not checked today. The range is asked the way it is queried: "a day" and "a month" are the real questions. A month end is not one number (28, 29, 30, 31), so it is computed. The register is larger than a page: 147 riders means about three thousand checks a month, so it shows how many of how many are displayed and grows by a button, never truncating silently.
class B2cDutyRegisterScreen extends StatefulWidget {
  const B2cDutyRegisterScreen({super.key});
  @override
  State<B2cDutyRegisterScreen> createState() => _B2cDutyRegisterScreenState();
}

const _outcomes = <String, (String, String, Color)>{
  'started': ('بدأ الدوام', 'Started', T.success),
  'absent': ('لم يحضر', 'Absent', T.inkFaint),
  'blocked': ('مُنع من الخروج', 'Blocked', T.danger),
};

const _kinds = <String, (String, String)>{
  'rep': ('المندوب', 'Rider'),
  'vehicle': ('الدبّاب', 'Bike'),
  'box': ('البوكس', 'Box'),
  'ad': ('المحتوى الإعلاني', 'Ad content'),
};

String _dayKey(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class _B2cDutyRegisterScreenState extends State<B2cDutyRegisterScreen> {
  static const _page = 200;

  /// 'day' | 'month' | 'range': the range type; both bounds are computed from it.
  String _mode = 'day';
  String _from = _dayKey(DateTime.now());
  String _to = _dayKey(DateTime.now());
  String _supervisor = '';
  String _outcome = '';

  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _sups = [];
  Map<String, dynamic> _totals = {};
  List<Map<String, dynamic>> _missing = [];
  int _total = 0;
  int _pages = 1;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _loadSupervisors();
    _onLive = () => _load();
    Live.instance.on('b2c:duty', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('b2c:duty', _onLive);
    super.dispose();
  }

  void _pickDay(String d) { _mode = 'day'; _from = d; _to = d; _pages = 1; }

  /// First and last day of the month; day zero of the next month is the last day of this one.
  void _pickMonth(String m) {
    final parts = m.split('-');
    final y = int.tryParse(parts.first) ?? DateTime.now().year;
    final mo = int.tryParse(parts.length > 1 ? parts[1] : '') ?? DateTime.now().month;
    final last = DateTime(y, mo + 1, 0).day;
    _mode = 'month';
    _from = '$m-01';
    _to = '$m-${last.toString().padLeft(2, '0')}';
    _pages = 1;
  }

  Future<void> _loadSupervisors() async {
    try {
      final d = await Api.instance.get('/api/b2c/duty/supervisors');
      if (!mounted) return;
      setState(() => _sups = List<Map<String, dynamic>>.from(d['supervisors'] ?? []));
    } catch (_) { /* The filter stays "all". */ }
  }

  /// Day for "not checked": today if inside the range, else its last day, so a day not yet reached is never queried (the end of the selected month may be in the future).
  String get _missingDate {
    final today = _dayKey(DateTime.now());
    return _from.compareTo(today) <= 0 && today.compareTo(_to) <= 0 ? today : _to;
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final q = StringBuffer('from=$_from&to=$_to&limit=$_page');
      if (_supervisor.isNotEmpty) q.write('&supervisor=$_supervisor');
      if (_outcome.isNotEmpty) q.write('&outcome=$_outcome');
      final sup = _supervisor.isEmpty ? '' : '&supervisor=$_supervisor';

      // Pages are fetched together, not one after another: one wait instead of several.
      final pageCalls = [
        for (var i = 1; i <= _pages; i++) Api.instance.get('/api/b2c/duty?$q&page=$i'),
      ];
      final results = await Future.wait([
        Future.wait(pageCalls),
        Api.instance.get('/api/b2c/duty/analytics?from=$_from&to=$_to$sup')
            .catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/b2c/duty/missing?date=$_missingDate$sup')
            .catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final parts = results[0] as List;
      setState(() {
        _rows = [
          for (final p in parts) ...List<Map<String, dynamic>>.from((p as Map)['rows'] ?? []),
        ];
        _total = ((parts.isNotEmpty ? (parts.first as Map)['total'] : 0) ?? 0) as int;
        _totals = Map<String, dynamic>.from((results[1] as Map)['totals'] ?? {});
        _missing = List<Map<String, dynamic>>.from((results[2] as Map)['missing'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // Who checked and who is responsible are two things. Any supervisor can now check any rider, so "who did this check" differs from "who is responsible for this man"; one column mixed the two answers. Same read as the web: the record carries the rider from the light-transport register (`ltEmployee.name`) or, for old rows, from the riders register (`rep`).
  String _nameOf(Map<String, dynamic> r) {
    final lt = r['ltEmployee'];
    if (lt is Map && (lt['name'] ?? '').toString().isNotEmpty) return lt['name'].toString();
    final rep = r['rep'];
    if (rep is Map) {
      final ar = (rep['arabicName'] ?? '').toString();
      if (ar.isNotEmpty) return ar;
      final en = (rep['englishName'] ?? '').toString();
      if (en.isNotEmpty) return en;
    }
    // A moped check with no known rider is read by its plate.
    final plate = (r['vehiclePlate'] ?? '').toString();
    if (plate.isNotEmpty) return tr('دبّاب $plate', 'Bike $plate');
    return '—';
  }

  /// Responsible for the check: the check supervisor, not the operations one. The operations supervisor owns the whole day; this screen is for a single hour.
  String _ownerOf(Map<String, dynamic> r) {
    final lt = r['ltEmployee'];
    if (lt is Map) {
      final u = lt['dutySupervisorUser'];
      if (u is Map) return '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
      final n = (lt['dutySupervisorName'] ?? '').toString();
      if (n.isNotEmpty) return n;
    }
    final rep = r['rep'];
    if (rep is Map && rep['supervisor'] is Map) {
      final p = rep['supervisor'] as Map;
      return '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim();
    }
    return '';
  }

  /// The operations supervisor is shown beside it so the difference is visible.
  String _opsOf(Map<String, dynamic> r) {
    final lt = r['ltEmployee'];
    if (lt is Map) {
      final o = lt['supervisorUser'];
      if (o is Map) return '${o['firstName'] ?? ''} ${o['lastName'] ?? ''}'.trim();
      return (lt['supervisorName'] ?? '').toString();
    }
    return '';
  }

  /// Who reviews the check (sound / has a note), matching the server path: READ in routes/b2c.js.
  static const _reviewRoles = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'];

  String _when(dynamic v) {
    final d = v == null ? null : DateTime.tryParse('$v')?.toLocal();
    if (d == null) return '';
    String two(int x) => x.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  /// Management decision on the check: PATCH /api/b2c/duty/:id/review {verdict, note}.
  Future<void> _review(BuildContext sheet, Map<String, dynamic> r, String verdict, String note) async {
    try {
      await Api.instance.patch('/api/b2c/duty/${r['_id']}/review', {'verdict': verdict, 'note': note});
      if (sheet.mounted) Navigator.pop(sheet);
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Failed'))));
    }
  }

  Widget _details(BuildContext c, Map<String, dynamic> r, TextEditingController note) {
    final canReview = _reviewRoles.contains(c.read<AuthProvider>().role);
    final review = (r['review'] is Map) ? Map<String, dynamic>.from(r['review']) : <String, dynamic>{};
    final loc = r['location'] is Map ? r['location'] as Map : null;
    final by = review['by'] is Map ? review['by'] as Map : null;
    Widget kv(String k, String v, {bool danger = false}) => v.isEmpty ? const SizedBox.shrink() : Padding(
          padding: const EdgeInsets.only(bottom: 3),
          child: Text.rich(TextSpan(children: [
            TextSpan(text: '$k: ', style: const TextStyle(color: T.inkFaint)),
            TextSpan(text: v, style: TextStyle(fontWeight: FontWeight.w700, color: danger ? T.danger : T.ink)),
          ]), style: const TextStyle(fontSize: 12.5)),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      kv(tr('المركبة', 'Vehicle'), [r['vehicleType'], r['vehiclePlate']].where((x) => x != null && '$x'.isNotEmpty).join(' · ')),
      kv(tr('وقت التفقّد', 'Checked at'), _when(r['checkedAt'])),
      kv(tr('الفرع', 'Branch'), r['branch'] is Map ? '${r['branch']['name'] ?? ''}' : ''),
      if (r['hasDamage'] == true) kv(tr('التلف', 'Damage'), (r['damageNotes'] ?? '').toString().isEmpty ? tr('نعم', 'Yes') : '${r['damageNotes']}', danger: true),
      if (loc != null && loc['lat'] != null)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            onPressed: () => launchUrl(Uri.parse('https://maps.google.com/?q=${loc['lat']},${loc['lng']}'), mode: LaunchMode.externalApplication),
            icon: const Icon(Icons.place_outlined, size: 16),
            label: Text(tr('موقع المشرف وقت التفقّد', 'Supervisor location at check')),
          ),
        ),
      if (review['verdict'] != null)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Align(alignment: AlignmentDirectional.centerStart,
              child: review['verdict'] == 'flagged' ? Chip2(tr('عليها ملاحظة', 'Flagged'), T.danger) : Chip2(tr('سليم', 'OK'), T.success)),
        ),
      if (canReview) ...[
        const Divider(height: 18),
        TextField(controller: note, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة الإدارة', 'Management note'), isDense: true)),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: T.danger),
            onPressed: () => _review(c, r, 'flagged', note.text.trim()),
            icon: const Icon(Icons.flag_outlined, size: 16), label: Text(tr('تسجيل ملاحظة', 'Flag')),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.success),
            onPressed: () => _review(c, r, 'ok', note.text.trim()),
            icon: const Icon(Icons.check_circle_outline, size: 16), label: Text(tr('سليم', 'OK')),
          ),
        ]),
      ] else if ((review['note'] ?? '').toString().isNotEmpty)
        kv(tr('ملاحظة الإدارة', 'Management note'), '${review['note']}'),
      if (review['at'] != null)
        Text('${tr('راجعها', 'Reviewed by')} ${by?['firstName'] ?? ''} ${by?['lastName'] ?? ''} — ${_when(review['at'])}',
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]);
  }

  Future<void> _openPhotos(Map<String, dynamic> r) async {
    final photos = List<Map<String, dynamic>>.from(r['photos'] ?? []);
    final note = TextEditingController(text: (r['review'] is Map ? r['review']['note'] ?? '' : '').toString());
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.8,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Expanded(child: Text(_nameOf(r), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                Text('${photos.length} ${tr('صورة', 'photos')}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              ]),
            ),
            Expanded(
              child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                      itemCount: photos.length + 1,
                      itemBuilder: (c, i) {
                        // First: the check details and the management decision, like the web dialog.
                        if (i == 0) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              _details(c, r, note),
                              if (photos.isEmpty) Padding(padding: const EdgeInsets.only(top: 20), child: Center(child: Text(tr('لا صور', 'No photos'), style: const TextStyle(color: T.inkFaint)))),
                            ]),
                          );
                        }
                        final p = photos[i - 1];
                        final kind = _kinds[(p['kind'] ?? 'vehicle').toString()];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(kind == null ? '' : tr(kind.$1, kind.$2),
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                            const SizedBox(height: 4),
                            // The photo can be enlarged: the rider's face and the moped plate are unreadable in a small square, and they are the reason for the photo.
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: InteractiveViewer(
                                maxScale: 5,
                                child: Image.network(
                                  '${AppConfig.apiBase}${p['fileUrl']}',
                                  width: double.infinity, fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(
                                    height: 160, color: T.inkFaint.withValues(alpha: 0.1),
                                    child: const Icon(Icons.image_not_supported_outlined, color: T.inkFaint),
                                  ),
                                ),
                              ),
                            ),
                          ]),
                        );
                      },
                    ),
            ),
          ]),
        ),
      ),
    );
    note.dispose();
  }

  Widget _filters() {
    final inputStyle = Theme.of(context).textTheme.bodyMedium!.copyWith(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.ink);
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _mode,
              isDense: true,
              isExpanded: true,
              style: inputStyle,
              decoration: InputDecoration(labelText: tr('المدى', 'Period'), isDense: true),
              items: [
                DropdownMenuItem(value: 'day', child: Text(tr('يوم محدَّد', 'A single day'))),
                DropdownMenuItem(value: 'month', child: Text(tr('شهر محدَّد', 'A whole month'))),
                DropdownMenuItem(value: 'range', child: Text(tr('من — إلى', 'From — to'))),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() {
                  if (v == 'day') {
                    _pickDay(_to);
                  } else if (v == 'month') {
                    _pickMonth(_to.substring(0, 7));
                  } else {
                    _mode = 'range';
                  }
                });
                _load();
              },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              icon: const Icon(Icons.event, size: 16),
              label: Text(_from == _to ? _from : '$_from → $_to',
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
              onPressed: () async {
                if (_mode == 'month') {
                  // The filters have no month picker, so the last fourteen months are listed; the most reviewed month is yesterday's or this one.
                  final now = DateTime.now();
                  final chosen = await showModalBottomSheet<String>(
                    context: context,
                    builder: (c) => SafeArea(
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          for (var i = 0; i < 14; i++)
                            () {
                              final d = DateTime(now.year, now.month - i, 1);
                              final key = '${d.year}-${d.month.toString().padLeft(2, '0')}';
                              return ListTile(
                                dense: true,
                                title: Text(key, style: const TextStyle(fontWeight: FontWeight.w700)),
                                onTap: () => Navigator.pop(c, key),
                              );
                            }(),
                        ],
                      ),
                    ),
                  );
                  if (chosen != null) { setState(() => _pickMonth(chosen)); _load(); }
                  return;
                }
                final base = DateTime.tryParse(_mode == 'range' ? _from : _to) ?? DateTime.now();
                final v = await showDatePicker(
                  context: context, initialDate: base,
                  firstDate: DateTime(2025), lastDate: DateTime.now().add(const Duration(days: 1)),
                );
                if (v == null || !mounted) return;
                if (_mode == 'day') {
                  setState(() => _pickDay(_dayKey(v)));
                } else {
                  // In "from - to" the start is asked, then the end.
                  final v2 = await showDatePicker(
                    context: context, initialDate: v,
                    firstDate: v, lastDate: DateTime.now().add(const Duration(days: 1)),
                    helpText: tr('إلى', 'To'),
                  );
                  setState(() { _from = _dayKey(v); _to = _dayKey(v2 ?? v); _pages = 1; });
                }
                _load();
              },
            ),
          ),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _supervisor,
              isDense: true,
              isExpanded: true,
              style: inputStyle,
              decoration: InputDecoration(labelText: tr('المشرف', 'Supervisor'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                for (final s in _sups)
                  DropdownMenuItem(
                    value: (s['_id'] ?? '').toString(),
                    child: Text('${s['name'] ?? ''} (${s['reps'] ?? 0})', overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) { setState(() { _supervisor = v ?? ''; _pages = 1; }); _load(); },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _outcome,
              isDense: true,
              isExpanded: true,
              style: inputStyle,
              decoration: InputDecoration(labelText: tr('الحالة', 'Outcome'), isDense: true),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                for (final e in _outcomes.entries)
                  DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) { setState(() { _outcome = v ?? ''; _pages = 1; }); _load(); },
            ),
          ),
        ]),
        const SizedBox(height: 6),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: Wrap(spacing: 10, children: [
            TextButton(
              onPressed: () { setState(() { _pickDay(_dayKey(DateTime.now())); _supervisor = ''; _outcome = ''; }); _load(); },
              child: Text(tr('اليوم', 'Today'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            ),
            TextButton(
              onPressed: () { setState(() => _pickMonth(_dayKey(DateTime.now()).substring(0, 7))); _load(); },
              child: Text(tr('هذا الشهر', 'This month'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final meta = _outcomes[(r['outcome'] ?? '').toString()];
    final photos = List<Map<String, dynamic>>.from(r['photos'] ?? []);
    final owner = _ownerOf(r);
    final by = (r['supervisorName'] ?? '').toString();
    // A supervisor who checked someone else's rider is stated explicitly: the register is held against him.
    final onBehalf = owner.isNotEmpty && by.isNotEmpty && owner != by;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _openPhotos(r),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (photos.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(9),
                  child: Image.network(
                    '${AppConfig.apiBase}${photos.first['fileUrl']}',
                    width: 44, height: 44, fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(Icons.image_not_supported_outlined, size: 20, color: T.inkFaint),
                  ),
                )
              else
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(9)),
                  child: const Icon(Icons.no_photography_outlined, size: 18, color: T.inkFaint),
                ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_nameOf(r), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                  Text(
                    [
                      r['dateKey'],
                      if ((r['vehiclePlate'] ?? '').toString().isNotEmpty) r['vehiclePlate'],
                      if (by.isNotEmpty) '${tr('تفقّده', 'by')} $by',
                    ].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis,
                  ),
                ]),
              ),
              if (meta != null) Chip2(tr(meta.$1, meta.$2), meta.$3),
            ]),
            if (photos.isNotEmpty || onBehalf || r['review'] is Map) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final k in _kinds.entries)
                  if (photos.where((p) => (p['kind'] ?? 'vehicle').toString() == k.key).isNotEmpty)
                    Chip2('${tr(k.value.$1, k.value.$2)} ${photos.where((p) => (p['kind'] ?? 'vehicle').toString() == k.key).length}', T.navy),
                if (onBehalf) Chip2('${tr('عن', 'for')} $owner', T.violet),
                if (r['review'] is Map && r['review']['verdict'] == 'flagged') Chip2(tr('عليها ملاحظة', 'Flagged'), T.danger),
                if (r['review'] is Map && r['review']['verdict'] == 'ok') Chip2(tr('سليم', 'OK'), T.success),
                if (_opsOf(r).isNotEmpty) Chip2('${tr('تشغيليّه', 'ops')}: ${_opsOf(r)}', T.cyan),
              ]),
            ],
            // A note is required when departure is blocked or the rider did not show, since it is the reason for the decision.
            if ((r['notes'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text((r['notes']).toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ],
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final compliance = _totals['compliance'];
    return AppScaffold(
      title: Text(tr('سجل تفقّد الدوام', 'Duty register')),
      actions: [
        // Register export with the web columns plus photo links per type.
        ExportButton(
          fileName: 'b2c-duty', sheetName: tr('تفقّد بداية الدوام', 'Duty checks'),
          columns: [
            ExportCol('اليوم', 'Day', (r) => r['dateKey']),
            ExportCol('المندوب', 'Rider', _nameOf),
            ExportCol('رقم الهوية', 'ID number', (r) => r['ltEmployee'] is Map ? (r['ltEmployee']['idNumber'] ?? '') : ''),
            ExportCol('المشرف الذي تفقّد', 'Checked by', (r) => r['supervisorName']),
            ExportCol('مشرف التفقد', 'Duty supervisor', _ownerOf),
            ExportCol('المشرف التشغيلي', 'Ops supervisor', _opsOf),
            ExportCol('الحالة', 'Outcome', (r) { final o = _outcomes['${r['outcome']}']; return o == null ? r['outcome'] : tr(o.$1, o.$2); }),
            ExportCol('الفرع', 'Branch', (r) => r['branch'] is Map ? (r['branch']['name'] ?? '') : ''),
            for (final k in _kinds.entries)
              ExportCol('صورة ${k.value.$1}', '${k.value.$2} photo', (r) => [
                    for (final p in List<Map<String, dynamic>>.from(r['photos'] ?? []))
                      if ((p['kind'] ?? 'vehicle').toString() == k.key) '${AppConfig.apiBase}${p['fileUrl']}',
                  ].join('\n')),
            ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
            ExportCol('وقت التفقّد', 'Checked at', (r) => _when(r['checkedAt'])),
          ],
          rows: () => _rows,
        ),
      ],
      body: _loading && _rows.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                    children: [
                      _filters(),
                      const SizedBox(height: 12),
                      StatGrid(
                        children: [
                          StatCard(
                            label: '${tr('نسبة الالتزام', 'Compliance')} %',
                            value: compliance is num ? compliance : 0,
                            color: compliance is num ? (compliance >= 95 ? T.success : compliance >= 80 ? T.warn : T.danger) : T.inkFaint,
                            icon: Icons.trending_up,
                          ),
                          StatCard(label: tr('بدأ الدوام', 'Started'), value: (_totals['started'] ?? 0) as num, color: T.success, icon: Icons.check_circle_outline),
                          StatCard(label: tr('لم يحضر', 'Absent'), value: (_totals['absent'] ?? 0) as num, color: T.inkFaint, icon: Icons.person_off_outlined),
                          StatCard(label: tr('مُنع من الخروج', 'Blocked'), value: (_totals['blocked'] ?? 0) as num, color: T.danger, icon: Icons.block),
                        ],
                      ),
                      const SizedBox(height: 14),
                      // Who was not checked on a given day: work waiting, not a number to read.
                      if (_missing.isNotEmpty) ...[
                        AppCard(
                          topAccent: T.warn,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${tr('لم يُتفقَّدوا في', 'Not checked on')} $_missingDate — ${_missing.length}',
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                            const SizedBox(height: 6),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              for (final m in _missing.take(30))
                                // Rows from this call use the riders register names (`arabicName`), not light-transport register names.
                                Chip2(((m['arabicName'] ?? m['englishName'] ?? m['name']) ?? '—').toString(), T.warn),
                              if (_missing.length > 30) Chip2('+${_missing.length - 30}', T.inkFaint),
                            ]),
                          ]),
                        ),
                        const SizedBox(height: 14),
                      ],
                      Row(children: [
                        Text(tr('السجلّ', 'Register'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(width: 6),
                        Text('($_total)', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      ]),
                      const SizedBox(height: 8),
                      if (_rows.isEmpty)
                        EmptyState(
                          icon: Icons.photo_camera_outlined,
                          title: tr('لا تفقّد في هذا المدى', 'No checks in this period'),
                          subtitle: tr('غيّر اليوم أو الشهر أو المشرف.', 'Change the day, month or supervisor.'),
                        )
                      else
                        ..._rows.map(_row),
                      // What was displayed of the range: the page is a limit, and silence about the rest would hide it.
                      if (_total > _rows.length) ...[
                        const SizedBox(height: 6),
                        Center(
                          child: OutlinedButton(
                            onPressed: _loading ? null : () { setState(() => _pages += 1); _load(); },
                            child: Text(
                              _loading
                                  ? tr('جارٍ…', 'Loading…')
                                  : '${tr('عرض المزيد', 'Show more')} — ${_rows.length}/$_total',
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }
}
