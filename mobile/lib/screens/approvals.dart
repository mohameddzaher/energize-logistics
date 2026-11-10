import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import '../services/live.dart';
import '../ui/file_upload.dart';
import '../ui/leave_chain.dart';

/// Leave approvals: what awaits this user's decision now. It used to read `/api/hr/team/leaves` (subordinates' requests only), so the HR manager, accounts and top management could not see on the phone what reached their stage. It now reads the inbox, and the server builds the list from the reader's own stages (`utils/leaveChain.inboxFilter`), so no button leads to a 403. The third button is "ask", not reject: the request returns to its owner to answer or amend, then restarts from the direct manager.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  // Stages are shown to process viewers only (seesLeaveProcess).
  bool get _full => seesLeaveProcess(context.read<AuthProvider>().user);
  List<Map<String, dynamic>> _leaves = [];
  String _q = ''; // Search by name, leave type or reason, like the web.
  final _searchCtl = TextEditingController(); // Text stays equal to _q after a live refresh.
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
    _searchCtl.dispose();
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
    // Decision sheet: approval letter or rejection reason when it has supporting grounds. It lives with the request, so it can be read from the employee file a year later, not in a lost chat.
    final files = <PickedFile>[];
    final askDeduct = decision == 'approved' && leaveNeedsDeduction(l);
    bool? deduct;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setSt) => AlertDialog(
        title: Text(switch (decision) {
          'approved' => tr('اعتماد الطلب', 'Approve request'),
          'info' => tr('استفسار / طلب تعديل', 'Ask / request change'),
          _ => tr('رفض الطلب', 'Reject request'),
        }),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          LeaveChainBar(leave: l, full: _full),
          const SizedBox(height: 10),
          LeaveThread(leave: l, full: _full),
          // The request's supporting grounds are read before deciding.
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
          if (askDeduct) ...[
            DeductionPicker(value: deduct, days: l['days'], onChanged: (v) => setSt(() => deduct = v)),
            const SizedBox(height: 10),
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
                  ? tr('مثال: عليه سلفة 500 ريال تُسدَّد قبل السفر — أرفق الإيصال.', 'e.g. settle the 500 SAR advance first — attach the receipt.')
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
            // A rejection without a reason or a question without text reaches the employee empty.
            onPressed: (decision != 'approved' && note.text.trim().isEmpty) || (askDeduct && deduct == null)
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
        if (askDeduct) 'deductBalance': deduct,
        'files': files.map((f) => {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': f.fileName}).toList(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(String? v) {
    final d = v != null ? DateTime.tryParse(v) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}${hijriDay(v).isEmpty ? '' : ' · ${hijriDay(v)} ${tr('هـ', 'AH')}'}';
  }

  @override
  Widget build(BuildContext context) {
    // The inbox holds only what awaits a decision, so every item is decidable. The split used to be on `pending_manager` alone, which dropped items that reached HR or accounts.
    final q = _q.trim().toLowerCase();
    bool hit(Map<String, dynamic> l) {
      if (q.isEmpty) return true;
      String n(dynamic p) => p is Map ? '${p['firstName'] ?? ''} ${p['lastName'] ?? ''} ${p['arabicName'] ?? ''}' : '';
      final t = l['leaveType'] is Map ? '${l['leaveType']['nameAr'] ?? ''} ${l['leaveType']['nameEn'] ?? ''}' : '';
      return '${n(l['employee'])} ${n(l['requester'])} $t ${l['reason'] ?? ''}'.toLowerCase().contains(q);
    }
    final shown = _leaves.where(hit).toList();
    final pending = shown.where((l) => leaveIsActionable(l['status'])).toList();
    final past = shown.where((l) => !leaveIsActionable(l['status'])).toList();

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
                  child: _leaves.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          EmptyState(icon: Icons.verified_outlined, title: tr('لا شيء ينتظر قرارك', 'Nothing awaits your decision')),
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
                          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                          children: [
                            SearchField(
                              controller: _searchCtl,
                              dense: true,
                              hint: tr('ابحث بالاسم أو نوع الإجازة أو السبب…', 'Search by name, leave type or reason…'),
                              onChanged: (v) => setState(() => _q = v),
                            ),
                            const SizedBox(height: 10),
                            if (q.isNotEmpty && shown.isEmpty)
                              Padding(padding: const EdgeInsets.symmetric(vertical: 30), child: Center(child: Text(tr('لا نتائج لهذا البحث', 'No matches'), style: const TextStyle(color: T.inkSoft)))),
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
    final badge = leaveStatusFor(l['status'], full: _full, canAct: actionable);
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
              Text('$type · ${tr('من', 'From')} ${_d(l['startDate'])} ${tr('إلى', 'to')} ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                  style: const TextStyle(fontSize: 13, color: T.inkSoft)),
              if ((l['reason'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                ),
              const SizedBox(height: 8),
              LeaveChainBar(leave: l, full: _full),
              const SizedBox(height: 4),
              LeaveDeductionBadge(leave: l, full: _full),
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
                // A request that lacks clarification is not rejected; it goes back to its owner with a question.
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
