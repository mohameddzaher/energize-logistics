import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/live.dart';
import '../ui/file_upload.dart';
import '../ui/leave_chain.dart';

/// موافقات الإجازات — ما ينتظر قرارَ هذا المستخدم الآن.
///
/// كانت تقرأ `/api/hr/team/leaves`: طلباتِ المرؤوسين وحدَها، فلا يرى مديرُ
/// الموارد ولا الحساباتُ ولا الإدارةُ العليا على الهاتف ما وصل محطّتَها.
/// وصارت تقرأ صندوقَ الوارد، والخادمُ يبني القائمةَ من محطّات القارئ نفسِه
/// (`utils/leaveChain.inboxFilter`) — فلا تُعرَض أزرارٌ تُردّ ٤٠٣.
///
/// وثالثُ الأزرار «استفسار» لا رفض: يعود الطلبُ إلى صاحبه ليردّ أو يعدّل، ثمّ
/// يبدأ من المدير المباشر من جديد.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  List<Map<String, dynamic>> _leaves = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/leaves/inbox');
      if (!mounted) return;
      setState(() {
        _leaves = List<Map<String, dynamic>>.from(d['leaves'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> l, String decision) async {
    final note = TextEditingController();
    // ورقةُ القرار: خطابُ الاعتماد أو سببُ الرفض حين يكون له سند. تعيش مع
    // الطلب فتُقرأ من ملفّ الموظّف بعد سنة، لا في محادثةٍ ضاعت.
    final files = <PickedFile>[];
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setSt) => AlertDialog(
        title: Text(switch (decision) {
          'approved' => tr('اعتماد الطلب', 'Approve request'),
          'info' => tr('استفسار / طلب تعديل', 'Ask / request change'),
          _ => tr('رفض الطلب', 'Reject request'),
        }),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          LeaveChainBar(leave: l),
          const SizedBox(height: 10),
          LeaveThread(leave: l),
          // سندُ الطلب يُقرأ قبل البتّ فيه.
          if ((l['attachments'] as List? ?? const []).isNotEmpty) ...[
            Text(tr('مرفقات الموظّف', 'Employee attachments'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ...List<Map<String, dynamic>>.from((l['attachments'] as List).map((e) => Map<String, dynamic>.from(e as Map))).map((a) => Row(children: [
              const Icon(Icons.description_outlined, size: 15, color: T.navy),
              const SizedBox(width: 6),
              Expanded(child: Text('${a['title'] ?? a['fileName'] ?? ''}', style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.download_rounded, size: 16, color: T.navy),
                onPressed: () {
                  final u = (a['fileUrl'] ?? '').toString();
                  if (u.isEmpty) return;
                  launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
                },
              ),
            ])),
            const Divider(height: 16),
          ],
          TextField(
            controller: note,
            maxLines: 3,
            minLines: 2,
            onChanged: (_) => setSt(() {}),
            decoration: InputDecoration(
              labelText: decision == 'approved'
                  ? tr('ملاحظة (اختياري)', 'Note (optional)')
                  : tr('اكتب السبب — مطلوب', 'Write the reason — required'),
              hintText: decision == 'info'
                  ? tr('مثال: عليه سلفة ٥٠٠ ريال تُسدَّد قبل السفر — أرفق الإيصال.', 'e.g. settle the 500 SAR advance first — attach the receipt.')
                  : null,
              hintMaxLines: 2,
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: files.length >= 5 ? null : () async {
                final f = await pickFileAsDataUrl();
                if (f != null) setSt(() => files.add(f));
              },
              icon: const Icon(Icons.attach_file_rounded, size: 16),
              label: Text(tr('إرفاق ملفّ', 'Attach file')),
            ),
          ),
          ...files.asMap().entries.map((e) => Row(children: [
            Expanded(child: Text(e.value.fileName, style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close, size: 15, color: T.danger),
              onPressed: () => setSt(() => files.removeAt(e.key)),
            ),
          ])),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: switch (decision) {
                'approved' => const Color(0xFF059669),
                'info' => const Color(0xFFEA580C),
                _ => const Color(0xFFDC2626),
              },
            ),
            // الرفضُ بلا سببٍ والاستفسارُ بلا سؤالٍ يصلان الموظّفَ فارغَين.
            onPressed: decision != 'approved' && note.text.trim().isEmpty
                ? null
                : () => Navigator.pop(c, true),
            child: Text(switch (decision) {
              'approved' => tr('اعتماد', 'Approve'),
              'info' => tr('إرسال الاستفسار', 'Send question'),
              _ => tr('رفض', 'Reject'),
            }),
          ),
        ],
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {
        'decision': decision,
        'note': note.text,
        'files': files.map((f) => {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': f.fileName}).toList(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    // صندوقُ الوارد لا يحمل إلا ما ينتظر قرارًا، فكلُّه قابلٌ للبتّ. وكانت
    // القسمةُ على `pending_manager` وحدَها — فما بلغ الموارد أو الحسابات سقط.
    final pending = _leaves.where((l) => leaveIsActionable(l['status'])).toList();
    final past = _leaves.where((l) => !leaveIsActionable(l['status'])).toList();

    return AppScaffold(
      title: Text(tr('موافقات الإجازات', 'Leave Approvals')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 96), SizedBox(height: 10), Shimmer(height: 96), SizedBox(height: 10), Shimmer(height: 96),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: (pending.isEmpty && past.isEmpty)
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          EmptyState(icon: Icons.verified_outlined, title: tr('لا شيء ينتظر قرارك', 'Nothing awaits your decision')),
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                          children: [
                            ...pending.asMap().entries.map((e) => _card(e.value, actionable: true, i: e.key)),
                            if (past.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(tr('قرارات سابقة', 'Past decisions'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.inkSoft, fontSize: 13)),
                              const SizedBox(height: 8),
                              ...past.take(15).map((l) => _card(l, actionable: false)),
                            ],
                          ],
                        ),
                ),
    );
  }

  Widget _card(Map<String, dynamic> l, {required bool actionable, int i = 0}) {
    final emp = l['employee'] is Map
        ? '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim()
        : (l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '—');
    final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
    final badge = leaveStatusOf(l['status']);
    return FadeSlideIn(
      delayMs: (i * 20).clamp(0, 200),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          topAccent: actionable ? T.warn : null,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(emp, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                Chip2(tr(badge.$1, badge.$2), badge.$3),
              ]),
              const SizedBox(height: 4),
              Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                  style: const TextStyle(fontSize: 13, color: T.inkSoft)),
              if ((l['reason'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                ),
              const SizedBox(height: 8),
              LeaveChainBar(leave: l),
              if (actionable) ...[
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: T.success, minimumSize: const Size.fromHeight(42)),
                      onPressed: () => _decide(l, 'approved'),
                      icon: const Icon(Icons.check_rounded, size: 18),
                      label: Text(tr('اعتماد', 'Approve')),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: T.danger, minimumSize: const Size.fromHeight(42)),
                      onPressed: () => _decide(l, 'rejected'),
                      icon: const Icon(Icons.close_rounded, size: 18),
                      label: Text(tr('رفض', 'Reject')),
                    ),
                  ),
                ]),
                const SizedBox(height: 8),
                // ما ينقصه إيضاحٌ لا يُرفَض: يعود إلى صاحبه بسؤال.
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFEA580C),
                      side: const BorderSide(color: Color(0xFFFED7AA)),
                      minimumSize: const Size.fromHeight(42),
                    ),
                    onPressed: () => _decide(l, 'info'),
                    icon: const Icon(Icons.help_outline_rounded, size: 18),
                    label: Text(tr('استفسار / طلب تعديل', 'Ask / request change')),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
