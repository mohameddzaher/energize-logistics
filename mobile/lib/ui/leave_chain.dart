import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/lang.dart';
import 'theme.dart';

/// سلسلةُ موافقات الإجازة كما تُرى في التطبيق — توأمُ
/// `frontend/src/components/hr/LeaveChain.tsx`.
///
/// كانت الموافقةُ محطّتين وشارةً واحدة. فصارت أربعًا، وصار للطلب تاريخٌ لا
/// حالةٌ واحدة: مَن وافق ومتى، ومَن سأل وبمَ ردّ صاحبُه. وهو مكتوبٌ هنا مرّةً
/// لا في كلّ شاشةٍ تعرض طلبًا.

/// المحطّاتُ بترتيبها: المفتاح، والاسمان، وحقلُ قرارها في المستند.
const leaveStages = <({String key, String ar, String en, String decision})>[
  (key: 'manager', ar: 'المدير المباشر', en: 'Direct Manager', decision: 'managerDecision'),
  (key: 'hr', ar: 'الموارد البشرية', en: 'HR', decision: 'hrDecision'),
  (key: 'finance', ar: 'الحسابات', en: 'Finance', decision: 'financeDecision'),
  (key: 'executive', ar: 'الإدارة العليا', en: 'Executive', decision: 'executiveDecision'),
];

/// الحالةُ ← اسمُها ولونُها. تُقرأ عبر [leaveStatusOf] فلا تعود فارغةً أبدًا:
/// قراءةُ لونٍ من مفتاحٍ ناقصٍ تُسقط الشاشةَ لا الخانة.
const leaveStatusMeta = <String, (String, String, Color)>{
  'pending_manager': ('عند المدير المباشر', 'With manager', Color(0xFFD97706)),
  'pending_hr': ('عند الموارد البشرية', 'With HR', Color(0xFF2563EB)),
  'pending_finance': ('عند الحسابات', 'With Finance', Color(0xFF7C3AED)),
  'pending_executive': ('عند الإدارة العليا', 'With Executive', Color(0xFF4F46E5)),
  'info_requested': ('بانتظار ردّك', 'Needs your reply', Color(0xFFEA580C)),
  'approved': ('معتمدة', 'Approved', Color(0xFF059669)),
  'rejected': ('مرفوضة', 'Rejected', Color(0xFFDC2626)),
  'cancelled': ('ملغاة', 'Cancelled', Color(0xFF64748B)),
};

(String, String, Color) leaveStatusOf(Object? status) {
  final s = (status ?? '').toString();
  return leaveStatusMeta[s] ?? (s.isEmpty ? '—' : s, s.isEmpty ? '—' : s, T.inkFaint);
}

/// أهي محطّةٌ قائمةٌ يُبَتُّ فيها؟ (المنتهيةُ والمرتدّةُ إلى صاحبها ليست كذلك.)
bool leaveIsActionable(Object? status) => const [
      'pending_manager', 'pending_hr', 'pending_finance', 'pending_executive',
    ].contains((status ?? '').toString());

/// أمفتوحٌ الطلبُ بعد؟ — لعدّادات «معلَّق» وزرّ الإلغاء.
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

/// حالةُ محطّةٍ بعينها في هذا الطلب.
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

/// شريطةُ المحطّات الأربع — أين وقف الطلبُ ومَن وقّع.
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

/// حوارُ الطلب: سؤالُ محطّةٍ وردُّ صاحبه، بالأقدم أوّلًا.
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
