import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/live_shot.dart';

/// تفقُّد بداية الدوام — شاشةُ المشرف على الهاتف.
///
/// وهي الأولى بالهاتف لا بالحاسوب: المشرفُ واقفٌ في المحطّة أمام الدرّاجة، لا
/// جالسٌ خلف مكتب. والصورةُ تُلتقَط من الكاميرا ولا تُرفَع من المعرض — راجع
/// `ui/live_shot.dart`.
class B2cDutyScreen extends StatefulWidget {
  const B2cDutyScreen({super.key});
  @override
  State<B2cDutyScreen> createState() => _B2cDutyScreenState();
}

const _outcomes = <String, (String, String, IconData, Color)>{
  'started': ('بدأ الدوام', 'Started', Icons.check_circle_outline, T.success),
  'absent': ('لم يحضر', 'Absent', Icons.person_off_outlined, T.inkFaint),
  'blocked': ('مُنع من الخروج', 'Blocked', Icons.block, T.danger),
};

/// صورُ الخروج الثلاث — كلُّ واحدةٍ تُلتقَط وحدَها وتُوسَم بنوعها.
const _kinds = <String, (String, String, IconData)>{
  'rep': ('صورة المندوب', 'Rider photo', Icons.person_outline),
  'vehicle': ('صورة الدبّاب', 'Bike photo', Icons.two_wheeler),
  'box': ('صورة البوكس', 'Box photo', Icons.inventory_2_outlined),
};

/// ورابعةٌ ليوم الخميس: لقطةُ الملصق الإعلانيّ على الدبّاب. ليست شرطًا لبدء
/// الدوام، وتقبل أكثرَ من صورة، ولا تظهر في غير يومها — والخادمُ يردّها كذلك.
const _adKind = 'ad';
const _adMeta = ('المحتوى الإعلاني', 'Ad content', Icons.campaign_outlined);
bool get _isThursday => DateTime.now().weekday == DateTime.thursday;

class _B2cDutyScreenState extends State<B2cDutyScreen> {
  List<Map<String, dynamic>> _reps = [];
  int _done = 0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('b2c:duty', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('b2c:duty', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/b2c/duty/my-reps');
      if (!mounted) return;
      setState(() {
        _reps = List<Map<String, dynamic>>.from(d['reps'] ?? []);
        _done = (d['done'] ?? 0) as int;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _open(Map<String, dynamic> rep) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CheckSheet(rep: rep),
    );
    if (saved == true) {
      _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tr('سُجّل التفقّد', 'Check recorded'))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _reps.where((r) => r['check'] == null).toList();
    final done = _reps.where((r) => r['check'] != null).toList();
    return AppScaffold(
      title: Text(tr('تفقّد بداية الدوام', 'Duty start check')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 76), SizedBox(height: 10), Shimmer(height: 76), SizedBox(height: 10), Shimmer(height: 76),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _reps.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 70),
                          EmptyState(
                            icon: Icons.groups_outlined,
                            title: tr('لا مندوبين مُسندين إليك', 'No riders assigned to you'),
                            subtitle: tr('تُسنَد المندوبون للمشرفين من صفحة المندوبين على الموقع.',
                                         'Riders are assigned to supervisors on the website.'),
                          ),
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                          children: [
                            Row(children: [
                              _stat(tr('مندوبوك', 'Riders'), _reps.length, T.navy),
                              const SizedBox(width: 8),
                              _stat(tr('تمّ', 'Done'), _done, T.success),
                              const SizedBox(width: 8),
                              _stat(tr('بقي', 'Left'), pending.length, pending.isEmpty ? T.inkFaint : T.warn),
                            ]),
                            const SizedBox(height: 14),
                            if (pending.isNotEmpty) ...[
                              _header(tr('بانتظار التفقّد', 'Awaiting check'), pending.length),
                              ...pending.map((r) => _row(r)),
                              const SizedBox(height: 12),
                            ],
                            if (done.isNotEmpty) ...[
                              _header(tr('تمّ اليوم', 'Done today'), done.length),
                              ...done.map((r) => _row(r)),
                            ],
                          ],
                        ),
                ),
    );
  }

  Widget _stat(String label, int v, Color c) => Expanded(
        child: AppCard(
          child: Column(children: [
            Text('$v', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: c)),
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          ]),
        ),
      );

  Widget _header(String s, int n) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text('$s ($n)', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.inkSoft)),
      );

  Widget _row(Map<String, dynamic> rep) {
    final check = rep['check'] as Map<String, dynamic>?;
    final meta = check != null ? _outcomes[check['outcome']] : null;
    final photos = check == null ? const [] : (check['photos'] as List? ?? const []);
    final name = (rep['arabicName'] ?? '').toString().isNotEmpty ? rep['arabicName'] : rep['englishName'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _open(rep),
        child: AppCard(
          topAccent: check == null ? T.warn : null,
          child: Row(children: [
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
                child: const Icon(Icons.schedule, size: 18, color: T.inkFaint),
              ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('$name', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  [rep['repId'], (rep['branch'] as Map?)?['name']].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ]),
            ),
            if (meta != null)
              Chip2(tr(meta.$1, meta.$2), meta.$4)
            else
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(color: T.orange, borderRadius: BorderRadius.circular(8)),
                child: Text(tr('تفقّد', 'Check'),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 11.5)),
              ),
          ]),
        ),
      ),
    );
  }
}

/// ورقةُ التفقّد: الحالةُ، ثمّ الصورةُ إن خرجت مركبة، ثمّ التفاصيل.
class _CheckSheet extends StatefulWidget {
  const _CheckSheet({required this.rep});
  final Map<String, dynamic> rep;
  @override
  State<_CheckSheet> createState() => _CheckSheetState();
}

class _CheckSheetState extends State<_CheckSheet> {
  String _outcome = 'started';
  final _shots = <(String, LiveShot)>[];
  final _notes = TextEditingController();
  final _plate = TextEditingController();
  String _vehicle = 'motorcycle';
  bool _saving = false;

  int _countOf(String kind) =>
      _shots.where((s) => s.$1 == kind).length +
      ((widget.rep['check'] as Map?)?['photos'] as List? ?? const [])
          .where((p) => '${(p as Map)['kind'] ?? 'vehicle'}' == kind).length;
  List<String> get _lacking => _kinds.keys.where((k) => _countOf(k) == 0).toList();
  /// الأنواعُ المعروضة اليوم: الثلاثةُ دائمًا، والإعلانيُّ يوم الخميس.
  Map<String, (String, String, IconData)> get _shownKinds =>
      _isThursday ? {..._kinds, _adKind: _adMeta} : _kinds;

  @override
  void initState() {
    super.initState();
    final c = widget.rep['check'] as Map<String, dynamic>?;
    if (c != null) {
      _outcome = '${c['outcome'] ?? 'started'}';
      _notes.text = '${c['notes'] ?? ''}';
      _plate.text = '${c['vehiclePlate'] ?? ''}';
      _vehicle = '${c['vehicleType'] ?? 'motorcycle'}';
    }
  }

  @override
  void dispose() {
    _notes.dispose(); _plate.dispose();
    super.dispose();
  }

  Future<void> _shoot(String kind) async {
    final s = await captureLivePhoto();
    if (s != null && mounted) setState(() => _shots.add((kind, s)));
  }

  Future<void> _save() async {
    final lacking = _lacking;
    if (_outcome == 'started' && lacking.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
        'ناقص: ${lacking.map((k) => _kinds[k]!.$1).join('، ')}',
        'Missing: ${lacking.map((k) => _kinds[k]!.$2).join(', ')}',
      ))));
      return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/b2c/duty', {
        'rep': widget.rep['_id'],
        'outcome': _outcome,
        'vehicleType': _vehicle,
        'vehiclePlate': _plate.text.trim(),
        'notes': _notes.text.trim(),
        'photos': _shots.map((s) => {
          'dataUrl': s.$2.dataUrl, 'fileName': s.$2.fileName, 'captureSource': 'camera', 'kind': s.$1,
        }).toList(),
      });
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
    final name = (widget.rep['arabicName'] ?? '').toString().isNotEmpty
        ? widget.rep['arabicName'] : widget.rep['englishName'];
    final already = ((widget.rep['check'] as Map?)?['photos'] as List? ?? const []).length;
    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.92),
      decoration: const BoxDecoration(
        color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Center(child: Container(width: 38, height: 4, decoration: BoxDecoration(
            color: T.inkFaint.withValues(alpha: 0.35), borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 12),
          Text('$name', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 12),

          Row(children: _outcomes.entries.map((e) {
            final on = _outcome == e.key;
            return Expanded(child: Padding(
              padding: const EdgeInsets.only(left: 3, right: 3),
              child: InkWell(
                onTap: () => setState(() => _outcome = e.key),
                borderRadius: BorderRadius.circular(9),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  decoration: BoxDecoration(
                    color: on ? e.value.$4.withValues(alpha: 0.13) : Colors.white,
                    border: Border.all(color: on ? e.value.$4 : const Color(0xFFE2E8F0)),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Column(children: [
                    Icon(e.value.$3, size: 17, color: on ? e.value.$4 : T.inkFaint),
                    const SizedBox(height: 3),
                    Text(tr(e.value.$1, e.value.$2),
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700,
                            color: on ? e.value.$4 : T.inkSoft)),
                  ]),
                ),
              ),
            ));
          }).toList()),
          const SizedBox(height: 14),

          if (_outcome == 'started') ...[
            ..._shownKinds.entries.map((k) {
              final mine = _shots.asMap().entries.where((e) => e.value.$1 == k.key).toList();
              final n = _countOf(k.key);
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: n > 0 ? T.success : T.orange,
                        minimumSize: const Size.fromHeight(44),
                      ),
                      onPressed: _saving || mine.length >= (k.key == _adKind ? 6 : 2) ? null : () => _shoot(k.key),
                      icon: Icon(n > 0 ? Icons.check_circle : k.value.$3, size: 19),
                      label: Text(tr('التقاط ${k.value.$1}', 'Capture ${k.value.$2}')),
                    ),
                  ),
                  if (mine.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Wrap(spacing: 8, runSpacing: 8, children: mine.map((e) => Stack(children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(9),
                        child: Image.memory(
                          Uri.parse(e.value.$2.dataUrl).data!.contentAsBytes(),
                          width: 74, height: 74, fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(top: -6, right: -6, child: IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.cancel, size: 19, color: T.danger),
                        onPressed: () => setState(() => _shots.removeAt(e.key)),
                      )),
                    ])).toList()),
                  ],
                ]),
              );
            }),
            if (already > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  tr('محفوظ سابقًا: $already صورة — الجديدة تُضاف ولا تستبدلها.',
                     '$already photo(s) already saved — new ones are added, not replaced.'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint),
                ),
              ),
          ] else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(9)),
              child: Text(tr('لا صورة مطلوبة — لم تخرج مركبة.', 'No photo needed — no vehicle went out.'),
                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ),

          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: _vehicle,
              decoration: InputDecoration(labelText: tr('نوع المركبة', 'Vehicle')),
              items: [
                DropdownMenuItem(value: 'motorcycle', child: Text(tr('دراجة نارية', 'Motorcycle'))),
                DropdownMenuItem(value: 'car', child: Text(tr('سيارة', 'Car'))),
                DropdownMenuItem(value: 'other', child: Text(tr('أخرى', 'Other'))),
              ],
              onChanged: (v) => setState(() => _vehicle = v ?? 'motorcycle'),
            )),
            const SizedBox(width: 8),
            Expanded(child: TextField(
              controller: _plate,
              decoration: InputDecoration(labelText: tr('اللوحة', 'Plate')),
            )),
          ]),
          const SizedBox(height: 8),
          const SizedBox(height: 8),
          TextField(controller: _notes, minLines: 2, maxLines: 3,
              decoration: InputDecoration(labelText: tr('ملاحظات (اختياري)', 'Notes (optional)'))),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: OutlinedButton(
              onPressed: _saving ? null : () => Navigator.pop(context, false),
              child: Text(tr('إلغاء', 'Cancel')),
            )),
            const SizedBox(width: 8),
            Expanded(flex: 2, child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.orange, minimumSize: const Size.fromHeight(46)),
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_rounded, size: 19),
              label: Text(tr('حفظ التفقّد', 'Save check')),
            )),
          ]),
        ]),
      ),
    );
  }
}
