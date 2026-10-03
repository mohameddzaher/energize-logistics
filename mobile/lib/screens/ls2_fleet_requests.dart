import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// طلبات الأسطول — «أحتاج هذه الشاحنةَ وصيانتُها متأخّرة».
///
/// نظيرةُ `/system/ls2/fleet-requests`: الطلبُ يُرفَع من إنشاء الحمولة في إدارة
/// الأسطول حين يمنعها الحارس، والقرارُ هنا — من يملك الصيانةَ هو من يأذن
/// بتأجيلها، ويُسجَّل اسمُه مع السبب. وموافقةٌ واحدةٌ لحمولةٍ واحدة.
class Ls2FleetRequestsScreen extends StatefulWidget {
  const Ls2FleetRequestsScreen({super.key});
  @override
  State<Ls2FleetRequestsScreen> createState() => _Ls2FleetRequestsScreenState();
}

const _decideRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'location_manager',
];

class _Ls2FleetRequestsScreenState extends State<Ls2FleetRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  String _status = 'pending';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:requests', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:requests', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/fleet-requests?status=$_status');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    final note = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(decision == 'approved' ? tr('موافقة', 'Approve') : tr('رفض', 'Refuse')),
        content: TextField(
          controller: note,
          maxLines: 3,
          autofocus: true,
          decoration: InputDecoration(labelText: tr('سببُ القرار', 'Decision note')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تسجيل', 'Record'))),
        ],
      ),
    );
    if (go != true) return;
    try {
      await Api.instance.post('/api/ls2/fleet-requests/${r['_id']}/decide', {
        'decision': decision, 'note': note.text.trim(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('سُجِّل القرار', 'Recorded'))));
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _fmt(dynamic v) {
    if (v == null) return '—';
    final d = DateTime.tryParse(v.toString());
    if (d == null) return '—';
    final l = d.toLocal();
    return '${l.year}/${l.month.toString().padLeft(2, '0')}/${l.day.toString().padLeft(2, '0')} '
        '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().role;
    final canDecide = _decideRoles.contains(role);

    return AppScaffold(
      title: Text(tr('طلبات الأسطول', 'Fleet Requests')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 130), SizedBox(height: 10), Shimmer(height: 130),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Row(children: [
                      for (final k in const [
                        ('pending', 'معلّقة', 'Pending', T.warn, Icons.hourglass_top_outlined),
                        ('approved', 'مُوافَق', 'Approved', T.success, Icons.check_circle_outline),
                        ('rejected', 'مرفوضة', 'Rejected', T.danger, Icons.block_outlined),
                      ])
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: StatCard(
                              label: tr(k.$2, k.$3),
                              value: (_summary[k.$1] ?? 0) as num,
                              color: k.$4,
                              icon: k.$5,
                            ),
                          ),
                        ),
                    ]),
                    const SizedBox(height: 10),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final f in const [('pending', 'المعلّقة', 'Pending'), ('approved', 'المُوافَق عليها', 'Approved'), ('rejected', 'المرفوضة', 'Rejected'), ('all', 'الكل', 'All')])
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _status == f.$1,
                              onSelected: (_) => setState(() { _status = f.$1; _loading = true; _load(); }),
                              label: Text(tr(f.$2, f.$3)),
                              labelStyle: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700,
                                color: _status == f.$1 ? Colors.white : T.navy,
                              ),
                              selectedColor: T.orange,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    if (_rows.isEmpty)
                      EmptyState(
                        icon: Icons.verified_outlined,
                        title: _status == 'pending'
                            ? tr('لا طلبَ معلّقًا', 'Nothing pending')
                            : tr('لا طلبات', 'No requests'),
                      ),
                    ..._rows.map((r) {
                      final st = (r['status'] ?? '').toString();
                      final accent = st == 'approved' ? T.success : st == 'rejected' ? T.danger : T.warn;
                      final km = r['kmToService'];
                      final load = (r['load'] as Map?) ?? const {};
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: AppCard(
                          topAccent: accent,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              const Icon(Icons.local_shipping_outlined, size: 17, color: T.inkSoft),
                              const SizedBox(width: 5),
                              Text((r['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                              const Spacer(),
                              Text(_fmt(r['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            ]),
                            const SizedBox(height: 6),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              Chip2(
                                '${(r['service'] ?? tr('صيانة دوريّة', 'Scheduled service'))}'
                                    '${km != null ? ' · ${(km as num).abs().round()} ${tr('كم', 'km')}' : ''}',
                                T.danger,
                                icon: Icons.warning_amber_rounded,
                              ),
                              if (r['odometerKm'] != null)
                                Chip2('${tr('العدّاد', 'Odo')} ${(r['odometerKm'] as num).round()}', T.inkSoft),
                            ]),
                            const SizedBox(height: 6),
                            Text(
                              '${r['requestedByName'] ?? '—'}: ${(r['reason'] ?? '').toString().isEmpty ? tr('بلا سبب مكتوب', 'no reason given') : r['reason']}',
                              style: const TextStyle(fontSize: 13),
                            ),
                            if ((load['toCity'] ?? '').toString().isNotEmpty || (load['customerName'] ?? '').toString().isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  '${tr('الحمولة', 'Load')}: ${[load['customerName'], [load['fromCity'], load['toCity']].where((x) => (x ?? '').toString().isNotEmpty).join(' ← '), load['loadDate']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ')}',
                                  style: const TextStyle(fontSize: 12, color: T.inkSoft),
                                ),
                              ),
                            if (st == 'pending' && canDecide) ...[
                              const SizedBox(height: 10),
                              Row(children: [
                                Expanded(
                                  child: FilledButton.icon(
                                    onPressed: () => _decide(r, 'approved'),
                                    icon: const Icon(Icons.check, size: 17),
                                    label: Text(tr('موافقة', 'Approve')),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: () => _decide(r, 'rejected'),
                                    icon: const Icon(Icons.close, size: 17),
                                    label: Text(tr('رفض', 'Refuse')),
                                  ),
                                ),
                              ]),
                            ] else if (st == 'pending') ...[
                              const SizedBox(height: 6),
                              Text(tr('بانتظار قرار مدير لوكيشن سوليوشن.', 'Awaiting the Location Solutions manager.'),
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.warn)),
                            ] else ...[
                              const SizedBox(height: 6),
                              Text(
                                '${st == 'approved' ? tr('وُوفق عليه', 'Approved') : tr('مرفوض', 'Rejected')} — ${r['decidedByName'] ?? '—'} · ${_fmt(r['decidedAt'])}',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: accent),
                              ),
                              if ((r['decisionNote'] ?? '').toString().isNotEmpty)
                                Text(r['decisionNote'].toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              if (st == 'approved')
                                Text(
                                  r['usedBy'] == null
                                      ? tr('لم تُستعمَل بعد — تصلح لحمولةٍ واحدة', 'not used yet — good for one load')
                                      : '${tr('استُعملت في حمولة', 'used on a load')} · ${_fmt(r['usedAt'])}',
                                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
                                ),
                            ],
                          ]),
                        ),
                      );
                    }),
                  ]),
                ),
    );
  }
}
