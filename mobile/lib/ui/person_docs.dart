import 'package:flutter/material.dart';
import 'theme.dart';

/// Residency and driving-licence expiry in driver lists. The server computes both from the employee file (utils/personDocDates) and sends their state, with the worse of the two in `docsState` for the filter chip. Same as PersonDocDate on the web.
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

/// The value of one of them without a label: the date, colored by its state (and the state if it is a warning).
(String, Color) personDocValue(Map r, String which) {
  final date = _ymd(r[which == 'iqama' ? 'iqamaExpiry' : 'licenseExpiry']);
  final state = r[which == 'iqama' ? 'iqamaState' : 'licenseState'];
  if (date.isEmpty) return ('غير مسجَّلة', _color('missing'));
  final news = '$state' == 'expired' || '$state' == 'soon';
  return ('$date${news ? ' · ${personDocStateAr(state)}' : ''}', _color(state));
}

/// Residency and driving-licence chips for list cards.
List<(String, Color)> personDocChips(Map r) => [
      for (final (label, which) in [('الإقامة', 'iqama'), ('رخصة القيادة', 'license')])
        ('$label: ${personDocValue(r, which).$1}', personDocValue(r, which).$2),
    ];

/// For export and column filters: date and state of each.
String personDocDate(Map r, String which) => _ymd(r[which == 'iqama' ? 'iqamaExpiry' : 'licenseExpiry']);
String personDocState(Map r, String which) => personDocStateAr(r[which == 'iqama' ? 'iqamaState' : 'licenseState']);
