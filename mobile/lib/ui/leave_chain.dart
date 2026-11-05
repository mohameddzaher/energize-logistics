import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/lang.dart';
import 'theme.dart';

/// Leave approval chain as seen in the app, twin of frontend/src/components/hr/LeaveChain.tsx. Approval grew from two steps to four, and a request now has a history: who approved and when, who asked and how the owner replied. Defined once here, not per screen.

/// Steps in order: key, the two names, and the document field holding its decision.
const leaveStages = <({String key, String ar, String en, String decision})>[
  (key: 'manager', ar: 'المدير المباشر', en: 'Direct Manager', decision: 'managerDecision'),
  (key: 'finance', ar: 'الإدارة المالية', en: 'Finance', decision: 'financeDecision'),
  (key: 'hr', ar: 'الموارد البشرية', en: 'HR', decision: 'hrDecision'),
  (key: 'executive', ar: 'الإدارة العليا', en: 'Top Management', decision: 'executiveDecision'),
  (key: 'chairman', ar: 'رئيس مجلس الإدارة', en: 'Chairman', decision: 'chairmanDecision'),
];

/// Status to name and color. Read through [leaveStatusOf] so it is never empty: reading a color from a missing key crashes the screen.
const leaveStatusMeta = <String, (String, String, Color)>{
  'pending_manager': ('عند المدير المباشر', 'With manager', Color(0xFFD97706)),
  'pending_hr': ('عند الموارد البشرية', 'With HR', Color(0xFF2563EB)),
  'pending_finance': ('عند الإدارة المالية', 'With Finance', Color(0xFF7C3AED)),
  'pending_executive': ('عند الإدارة العليا', 'With Top Management', Color(0xFF4F46E5)),
  'pending_chairman': ('عند رئيس مجلس الإدارة', 'With the Chairman', Color(0xFFC026D3)),
  'info_requested': ('عند الموظف للرد', 'With the employee to reply', Color(0xFFEA580C)),
  'approved': ('معتمدة', 'Approved', Color(0xFF059669)),
  'rejected': ('مرفوضة', 'Rejected', Color(0xFFDC2626)),
  'cancelled': ('ملغاة', 'Cancelled', Color(0xFF64748B)),
};

/// The owner's own wording: on his own requests a returned request waits on him; every other reader sees where it is.
(String, String, Color) leaveStatusOwn(Object? status) =>
    (status ?? '').toString() == 'info_requested' ? ('بانتظار ردّك', 'Needs your reply', const Color(0xFFEA580C)) : leaveStatusOf(status);

/// Can this reader decide the request now? Mirrors backend utils/leaveChain canActAt, so no button is shown for a decision the server refuses.
bool canDecideLeave(Map<String, dynamic>? user, Map<String, dynamic> l, {required bool hrStaff}) {
  final st = (l['status'] ?? '').toString();
  if (!leaveIsActionable(st)) return false;
  final role = (user?['role'] ?? '').toString();
  if (const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(role)) return true;
  switch (st) {
    case 'pending_manager':
      final m = l['manager'];
      return '${m is Map ? m['_id'] : m}' == '${user?['_id']}';
    case 'pending_finance': return const ['cfo', 'accounting_manager', 'accountant'].contains(role);
    case 'pending_hr': return hrStaff;
    case 'pending_executive': return user?['isTopManagement'] == true;
    case 'pending_chairman': return user?['isChairman'] == true;
  }
  return false;
}

/// Why a request has no decision buttons: who holds it now, and the question asked when it was returned.
String leaveWaitNote(Map<String, dynamic> l) {
  final st = (l['status'] ?? '').toString();
  if (st == 'info_requested') {
    final thread = List<Map<String, dynamic>>.from((l['thread'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final q = thread.reversed.where((t) => t['kind'] == 'question').firstOrNull;
    final stage = leaveStages.where((s) => s.key == (q?['stage'] ?? '')).firstOrNull;
    final who = stage != null ? tr(stage.ar, stage.en) : '${q?['byName'] ?? ''}';
    final text = '${q?['text'] ?? ''}';
    return tr('أُعيد للموظف ليرد${who.isNotEmpty ? ' على استفسار $who' : ''}${text.isNotEmpty ? ': «$text»' : ''} — يعود للمسار بعد رده',
        'Returned to the employee${who.isNotEmpty ? ' with a question from $who' : ''}${text.isNotEmpty ? ': "$text"' : ''}; it re-enters the chain when they reply');
  }
  final stage = leaveStages.where((s) => 'pending_${s.key}' == st).firstOrNull;
  return stage == null ? '' : tr('بانتظار قرار ${stage.ar}', 'Waiting for ${stage.en}');
}

(String, String, Color) leaveStatusOf(Object? status) {
  final s = (status ?? '').toString();
  return leaveStatusMeta[s] ?? (s.isEmpty ? '—' : s, s.isEmpty ? '—' : s, T.inkFaint);
}

/// Is it a live step awaiting a decision? (Finished and returned-to-owner are not.)
bool leaveIsActionable(Object? status) => leaveStages.any((s) => 'pending_${s.key}' == (status ?? '').toString());

/// Editable by its owner until any stage has acted, as the server's leaveIsUntouched.
/// A department manager's own approval at the manager stage does not lock his request (backend leaveIsUntouched).
bool leaveIsUntouched(Map<String, dynamic> l) {
  String idOf(dynamic x) => '${x is Map ? x['_id'] : x ?? ''}';
  return leaveIsActionable(l['status']) && leaveStages.every((s) {
    final d = l[s.decision];
    if (d is! Map || d['at'] == null) return true;
    return s.key == 'manager' && idOf(d['by']) == idOf(l['requester']);
  });
}

/// Is the request still open? Used for the pending counters and the cancel button.
bool leaveIsOpen(Object? status) =>
    leaveIsActionable(status) || (status ?? '').toString() == 'info_requested';

String? _lastQuestionStage(Map<String, dynamic> l) {
  final thread = List<Map<String, dynamic>>.from(
      (l['thread'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
  for (final t in thread.reversed) {
    if (t['kind'] == 'question') return (t['stage'] ?? '').toString();
  }
  return null;
}

/// State of a specific step in this request.
String _stageState(Map<String, dynamic> l, String stage, String decisionField) {
  final d = l[decisionField];
  if (d is Map) {
    if (d['decision'] == 'rejected') return 'rejected';
    if (d['decision'] == 'approved') return 'done';
  }
  if (l['currentStage'] == stage) return 'current';
  if (l['status'] == 'info_requested' && _lastQuestionStage(l) == stage) return 'asked';
  if (l['status'] == 'approved') return 'done';
  return 'waiting';
}

/// Strip of the four steps: where the request stopped and who signed.
class LeaveChainBar extends StatelessWidget {
  const LeaveChainBar({super.key, required this.leave});
  final Map<String, dynamic> leave;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (var i = 0; i < leaveStages.length; i++)
          _chip(leaveStages[i], i, _stageState(leave, leaveStages[i].key, leaveStages[i].decision)),
      ],
    );
  }

  Widget _chip(({String key, String ar, String en, String decision}) s, int i, String state) {
    final (Color c, IconData? icon) = switch (state) {
      'done' => (T.success, Icons.check_rounded),
      'rejected' => (T.danger, Icons.close_rounded),
      'current' => (T.warn, Icons.schedule_rounded),
      'asked' => (const Color(0xFFEA580C), Icons.help_outline_rounded),
      _ => (T.inkFaint, null),
    };
    final d = leave[s.decision];
    final by = d is Map && d['by'] is Map
        ? '${d['by']['firstName'] ?? ''} ${d['by']['lastName'] ?? ''}'.trim()
        : '';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: c.withValues(alpha: 0.35)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 18, height: 18,
          decoration: BoxDecoration(color: c, shape: BoxShape.circle),
          alignment: Alignment.center,
          child: icon == null
              ? Text('${i + 1}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Colors.white))
              : Icon(icon, size: 11, color: Colors.white),
        ),
        const SizedBox(width: 6),
        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(tr(s.ar, s.en), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700)),
          if (by.isNotEmpty)
            Text(by, style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
        ]),
      ]),
    );
  }
}

/// Request dialogue: a step's question and its owner's reply, oldest first.
class LeaveThread extends StatelessWidget {
  const LeaveThread({super.key, required this.leave});
  final Map<String, dynamic> leave;

  @override
  Widget build(BuildContext context) {
    final thread = List<Map<String, dynamic>>.from(
        (leave['thread'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    if (thread.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(tr('المراسلات على الطلب', 'Request conversation'),
          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
      const SizedBox(height: 6),
      ...thread.map((t) {
        final question = t['kind'] == 'question';
        final stage = leaveStages.where((s) => s.key == t['stage']).firstOrNull;
        final who = question
            ? tr('${stage?.ar ?? 'مراجع'} — استفسار', '${stage?.en ?? 'Reviewer'} — asked')
            : tr('ردّ الموظف', 'Employee reply');
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: question ? const Color(0xFFFFF7ED) : const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: question ? const Color(0xFFFED7AA) : const Color(0xFFE2E8F0)),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$who · ${t['byName'] ?? ''}',
                style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
            const SizedBox(height: 3),
            Text('${t['text'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
            if ((t['attachment'] ?? '').toString().isNotEmpty)
              TextButton.icon(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
                onPressed: () {
                  final u = t['attachment'].toString();
                  launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'),
                      mode: LaunchMode.externalApplication);
                },
                icon: const Icon(Icons.attach_file_rounded, size: 14),
                label: Text('${t['attachmentName'] ?? tr('مرفق', 'attachment')}',
                    style: const TextStyle(fontSize: 11)),
              ),
          ]),
        );
      }),
    ]);
  }
}

/// HR's balance choice is needed when approving at the HR stage; the server refuses it otherwise (DEDUCTION_CHOICE_REQUIRED).
bool leaveNeedsDeduction(Map l) => l['status'] == 'pending_hr' || l['currentStage'] == 'hr';

/// Twin of backend utils/leaveBalance.leaveDeducts: HR's choice wins, else the leave type.
bool leaveDeducts(Map l) {
  final d = l['deductsBalance'];
  if (d is bool) return d;
  final t = l['leaveType'];
  return !(t is Map && t['affectsBalance'] == false);
}

/// Two options, none preselected: HR must press one.
class DeductionPicker extends StatelessWidget {
  const DeductionPicker({super.key, required this.value, required this.onChanged, this.days});
  final bool? value;
  final ValueChanged<bool> onChanged;
  final Object? days;

  @override
  Widget build(BuildContext context) {
    Widget opt(bool v, String label, Color c) => ChoiceChip(
          label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          selected: value == v,
          selectedColor: c.withValues(alpha: 0.18),
          onSelected: (_) => onChanged(v),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text(tr('رصيد الإجازات — مطلوب للموافقة', 'Leave balance — required to approve'),
          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 6, children: [
        opt(true, tr('تُخصم من الرصيد${days != null ? ' ($days يوم)' : ''}', 'Deduct${days != null ? ' ($days d)' : ''}'), T.warn),
        opt(false, tr('بدون خصم من الرصيد', 'Without deduction'), T.success),
      ]),
    ]);
  }
}

/// Badge: deducted or not (once decided or approved), and whether a manager filed it.
class LeaveDeductionBadge extends StatelessWidget {
  const LeaveDeductionBadge({super.key, required this.leave});
  final Map<String, dynamic> leave;

  @override
  Widget build(BuildContext context) {
    final decided = leave['deductsBalance'] is bool;
    final cut = leaveDeducts(leave);
    Widget chip(String text, Color c) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
          child: Text(text, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: c)),
        );
    return Wrap(spacing: 4, runSpacing: 4, children: [
      if (decided || leave['status'] == 'approved')
        chip(cut ? tr('تُخصم من الرصيد', 'Deducted') : tr('بدون خصم', 'No deduction'), cut ? T.warn : T.success),
      if (leave['filedByManager'] == true) chip(tr('قدّمها المدير', 'Filed by manager'), const Color(0xFF4F46E5)),
    ]);
  }
}


/// Leave days between two dates, both ends included; Friday (the weekly day off) is not counted unless [countFridays]. Same rule as backend utils/leaveBalance.leaveDays, which stores the figure.
int countLeaveDays(DateTime? start, DateTime? end, {bool countFridays = false}) {
  if (start == null || end == null) return 0;
  final a = DateTime.utc(start.year, start.month, start.day);
  final b = DateTime.utc(end.year, end.month, end.day);
  if (b.isBefore(a)) return 0;
  final span = b.difference(a).inDays + 1;
  if (countFridays) return span;
  var fridays = span ~/ 7;
  for (var i = 0; i < span % 7; i++) {
    if (a.add(Duration(days: i)).weekday == DateTime.friday) fridays++;
  }
  return span - fridays;
}

/// Fridays left out of the count, said beside it so a shorter figure is not read as a mistake.
String fridaysNote(DateTime? start, DateTime? end, {bool countFridays = false}) {
  if (countFridays) return '';
  final off = countLeaveDays(start, end, countFridays: true) - countLeaveDays(start, end);
  if (off <= 0) return '';
  return tr(off == 1 ? '(لا تُحسب جمعة واحدة — إجازة أسبوعية)' : '(لا تُحسب $off أيام جمعة — إجازة أسبوعية)', '($off Friday${off > 1 ? 's' : ''} not counted — weekly day off)');
}
