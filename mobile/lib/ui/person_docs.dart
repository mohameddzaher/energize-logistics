import 'package:flutter/material.dart';
import 'theme.dart';

/// ── انتهاءُ الإقامة ورخصةِ القيادة في قوائم السوّاق (٢٠٢٦/١٠/٢٧) ──────────────
/// يحسبهما الخادمُ من ملفّ الموظّف (utils/personDocDates) ويرسل معهما حالتَهما،
/// والأسوأَ منهما في `docsState` لشريحة التصفية. مثلُ PersonDocDate في الموقع.
const personDocStates = <(String, String, String)>[
  ('expired', 'منتهية', 'Expired'),
  ('soon', 'تنتهي خلال 30 يومًا', 'Expires within 30 days'),
  ('missing', 'غير مسجَّلة', 'Not recorded'),
  ('valid', 'سارية', 'Valid'),
];

String personDocStateAr(Object? s) =>
    personDocStates.firstWhere((x) => x.$1 == '$s', orElse: () => personDocStates[2]).$2;

String _ymd(Object? v) {
  final s = '${v ?? ''}';
  return RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(s) ? s.substring(0, 10) : '';
}

Color _color(Object? s) => switch ('$s') {
      'expired' => T.danger,
      'soon' => T.warn,
      'valid' => T.success,
      _ => T.inkFaint,
    };

/// قيمةُ واحدٍ منهما بلا عنوان: التاريخُ (وحالتُه إن كانت خبرًا) ملوَّنًا بها.
(String, Color) personDocValue(Map r, String which) {
  final date = _ymd(r[which == 'iqama' ? 'iqamaExpiry' : 'licenseExpiry']);
  final state = r[which == 'iqama' ? 'iqamaState' : 'licenseState'];
  if (date.isEmpty) return ('غير مسجَّلة', _color('missing'));
  final news = '$state' == 'expired' || '$state' == 'soon';
  return ('$date${news ? ' · ${personDocStateAr(state)}' : ''}', _color(state));
}

/// شريحتا «الإقامة» و«رخصة القيادة» لبطاقات القوائم.
List<(String, Color)> personDocChips(Map r) => [
      for (final (label, which) in [('الإقامة', 'iqama'), ('رخصة القيادة', 'license')])
        ('$label: ${personDocValue(r, which).$1}', personDocValue(r, which).$2),
    ];

/// للتصدير وفلاتر الأعمدة: التاريخ والحالة لكلٍّ منهما.
String personDocDate(Map r, String which) => _ymd(r[which == 'iqama' ? 'iqamaExpiry' : 'licenseExpiry']);
String personDocState(Map r, String which) => personDocStateAr(r[which == 'iqama' ? 'iqamaState' : 'licenseState']);
