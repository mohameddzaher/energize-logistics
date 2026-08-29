import 'package:flutter/material.dart';
import 'theme.dart';

/// حالات فردة الكاوتش — صورةُ config/tireStates.js في الخادم.
///
/// المكانُ على محورٍ واحد (`status`)، والدرجة (`condition`) وصفٌ للفردة لا
/// لمكانها. وكانت خانة «في المصنع» تُعَدّ بالدرجة و«تحت التجديد» بالحالة —
/// وصفان لموضعٍ واحد من مصدرين، فاختلطا.
///
/// و«تحت التجديد» غير «في المصنع»: الأولى قرارٌ اتُّخذ والفردة في عهدة الورشة،
/// والثانية موضعٌ فعليّ خارج الشركة. ودمجُهما كان يجعل الورشة تعِد بفردةٍ ليست
/// عندها.
class TireState {
  final String key;
  final String ar;
  final String en;

  /// تُعَدّ ضمن «في المخزن»؟
  final bool inStore;
  final Color color;
  const TireState(this.key, this.ar, this.en, this.inStore, this.color);
}

/// الترتيب هنا هو ترتيب البطاقات: سُلَّمٌ من المركَّب إلى المنتهي.
const tireStates = <TireState>[
  TireState('mounted', 'مركّبة', 'Mounted', false, T.success),
  TireState('new', 'الجديد', 'New', true, T.info),
  TireState('used', 'المستعمل', 'Used', true, T.violet),
  TireState('under_renewal', 'تحت التجديد', 'Under renewal', true, T.warn),
  TireState('at_factory', 'في المصنع', 'At the factory', true, T.cyan),
  TireState('scrap', 'السكراب', 'Scrap', true, T.inkFaint),
  TireState('damaged', 'التالف', 'Damaged', false, T.danger),
  TireState('sold', 'المباع', 'Sold', false, T.inkSoft),
];

/// الخانةُ التي تقع فيها الفردة — تعريفٌ واحد للعدّاد والفلتر والشارة.
String tireStateKey(Map<String, dynamic> t) {
  final s = (t['status'] ?? '').toString();
  if (s == 'mounted') return 'mounted';
  if (s == 'in_repair') return 'under_renewal'; // الاسم القديم
  if (s == 'retired') return 'scrap'; // موروث
  if (const ['under_renewal', 'at_factory', 'scrap', 'damaged', 'sold'].contains(s)) return s;
  return (t['condition'] ?? 'used') == 'new' ? 'new' : 'used'; // spare
}

TireState tireStateOf(Map<String, dynamic> t) =>
    tireStates.firstWhere((x) => x.key == tireStateKey(t), orElse: () => tireStates[2]);

/// «في المخزن» = كلُّ ما هو عندنا وغيرُ مركَّب. والتالف والمباع خرجا من العهدة.
bool tireInStore(Map<String, dynamic> t) => tireStateOf(t).inStore;

/// وجهاتُ النزول من العربية — ستٌّ، لا أربع. ومَن يُنزل الفردة هو وحده من يعرف
/// أهي جديدةٌ على الرفّ أم مستعملة، وأتحت التجديد هي أم خرجت إلى المصنع.
const tireDismountDestinations = <(String, String, String)>[
  ('new', 'الجديد (على الرفّ)', 'New (shelf)'),
  ('used', 'المستعمل (على الرفّ)', 'Used (shelf)'),
  ('under_renewal', 'تحت التجديد', 'Under renewal'),
  ('at_factory', 'في المصنع', 'At the factory'),
  ('scrap', 'السكراب', 'Scrap'),
  ('damaged', 'التالف', 'Damaged'),
];
