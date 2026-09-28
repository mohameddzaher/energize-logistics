import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// سكنُ النقل الخفيف — مطابقٌ لتبويب السكن في «إعدادات القسم» على الويب.
///
/// ── ولماذا غرفٌ لا رقمٌ واحد ────────────────────────────────────────────────
/// «السكنُ يأخذ كم موظّفًا؟» ليس سؤالًا واحدًا: غرفةُ المناديب تسع ثمانيةً وغرفةُ
/// المشرفين ثلاثة. فسعةُ السكن مجموعُ غرفه، ولكلّ غرفةٍ نوعُها.
///
/// والإشغالُ **محسوبٌ** من الموظّفين لا مكتوبًا باليد — رقمٌ يُحدَّث يدويًّا يصير
/// بعد أسبوعين رقمًا لا يُصدَّق، ويُسأل عنه من يقف عند الباب لا من يقرأ الشاشة.
///
/// والإسكانُ نفسُه يقع في أمر التشغيل (على الويب): هناك تُعرَف الغرفةُ ونوعُها
/// وسعتُها المتبقّية في لحظة الإسناد. وهذه الشاشةُ تقول «هل فيه مكان؟» — وهو
/// ما يُسأل من الهاتف وقوفًا.
class LightTransportHousingScreen extends StatefulWidget {
  const LightTransportHousingScreen({super.key});
  @override
  State<LightTransportHousingScreen> createState() => _LightTransportHousingScreenState();
}

String _s(Map<String, dynamic>? m, String k) => (m?[k] ?? '').toString().trim();
int _i(Map<String, dynamic>? m, String k) => int.tryParse((m?[k] ?? 0).toString()) ?? 0;

const _kindAr = {'rep': 'مناديب', 'admin': 'إداريون', 'any': 'للجميع'};
const _kindEn = {'rep': 'Reps', 'admin': 'Admin', 'any': 'Anyone'};

class _LightTransportHousingScreenState extends State<LightTransportHousingScreen> {
  List<dynamic> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('lt:*', _onLive);
  }

  void _onLive() { if (mounted) _load(); }

  @override
  void dispose() { Live.instance.off('lt:*', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/light-transport/housing') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() { _rows = (d['housing'] as List?) ?? const []; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final totalCap = _rows.fold<int>(0, (n, r) => n + _i((r as Map).cast<String, dynamic>(), 'totalCapacity'));
    final totalOcc = _rows.fold<int>(0, (n, r) => n + _i((r as Map).cast<String, dynamic>(), 'occupied'));
    return AppScaffold(
      title: Text(tr('السكن', 'Housing')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          EmptyState(icon: Icons.home_work_outlined, title: tr('لا سكن مسجَّل', 'No housing yet')),
                        ])
                      : ListView(padding: const EdgeInsets.all(14), children: [
                          AppCard(
                            child: Row(children: [
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontSize: 12, color: Colors.black54)),
                                Text('$totalOcc / $totalCap',
                                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                              ])),
                              Chip2(tr('متاح ${totalCap - totalOcc}', '${totalCap - totalOcc} free'),
                                  totalCap - totalOcc > 0 ? T.success : T.danger),
                            ]),
                          ),
                          const SizedBox(height: 10),
                          ..._rows.map((raw) {
                            final h = (raw as Map).cast<String, dynamic>();
                            final cap = _i(h, 'totalCapacity');
                            final occ = _i(h, 'occupied');
                            final full = cap > 0 && occ >= cap;
                            final rooms = (h['rooms'] as List?) ?? const [];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    const Icon(Icons.home_work_outlined, size: 18, color: Colors.black38),
                                    const SizedBox(width: 6),
                                    Expanded(child: Text(_s(h, 'name'),
                                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
                                    Chip2(full ? tr('مكتمل', 'Full') : tr('باقي ${_i(h, 'free')}', '${_i(h, 'free')} free'),
                                        full ? T.danger : T.success),
                                  ]),
                                  if (_s(h, 'cityAr').isNotEmpty)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 2),
                                      child: Text(_s(h, 'cityAr'),
                                          style: const TextStyle(fontSize: 11.5, color: Colors.black45)),
                                    ),
                                  const SizedBox(height: 8),
                                  Row(children: [
                                    Text('$occ', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                                    const SizedBox(width: 4),
                                    Text(tr('من $cap', 'of $cap'),
                                        style: const TextStyle(fontSize: 12.5, color: Colors.black38)),
                                  ]),
                                  const SizedBox(height: 6),
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(6),
                                    child: LinearProgressIndicator(
                                      value: cap > 0 ? (occ / cap).clamp(0, 1).toDouble() : 0,
                                      minHeight: 7,
                                      backgroundColor: T.line,
                                      valueColor: AlwaysStoppedAnimation(full ? T.danger : T.orange),
                                    ),
                                  ),
                                  if (rooms.isNotEmpty) ...[
                                    const SizedBox(height: 10),
                                    // الغرفةُ ونوعُها وإشغالُها — فلا يُقال «فيه مكان»
                                    // وليس فيه متّسعٌ لمشرف.
                                    ...rooms.map((rr) {
                                      final r = (rr as Map).cast<String, dynamic>();
                                      final rc = _i(r, 'capacity');
                                      final ro = _i(r, 'occupied');
                                      final rFull = rc > 0 && ro >= rc;
                                      final kind = _s(r, 'kind');
                                      return Padding(
                                        padding: const EdgeInsets.only(bottom: 5),
                                        child: Row(children: [
                                          Expanded(child: Text(_s(r, 'name'),
                                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                                          Chip2(tr(_kindAr[kind] ?? kind, _kindEn[kind] ?? kind),
                                              kind == 'rep' ? T.info : kind == 'admin' ? T.violet : T.inkFaint),
                                          const SizedBox(width: 6),
                                          Text('$ro/$rc',
                                              style: TextStyle(
                                                  fontSize: 12.5,
                                                  fontWeight: FontWeight.w800,
                                                  color: rFull ? T.danger : Colors.black87)),
                                        ]),
                                      );
                                    }),
                                  ] else
                                    Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(
                                        tr('بلا غرف مسجَّلة — تُستعمل السعة المكتوبة.',
                                           'No rooms recorded — the declared capacity is used.'),
                                        style: const TextStyle(fontSize: 11.5, color: Colors.black38),
                                      ),
                                    ),
                                ]),
                              ),
                            );
                          }),
                          const SizedBox(height: 8),
                          Text(
                            tr('الإسكان يقع في أمر التشغيل — هناك تُعرف الغرفة ونوعها وسعتها المتبقّية لحظة الإسناد.',
                               'Assignment happens in the operating order, where the room, its kind and its remaining capacity are known.'),
                            style: const TextStyle(fontSize: 11.5, color: Colors.black38, height: 1.5),
                          ),
                        ]),
                ),
    );
  }
}
