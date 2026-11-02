import 'package:flutter/material.dart';
import 'theme.dart';

/// Tire states, mirror of config/tireStates.js on the server. Place is on one axis (`status`); grade (`condition`) describes the tire, not its place. The in-factory slot used to count by grade and under-renewal by status, two descriptions from two sources of one position, which got mixed. Under renewal differs from in factory: the first is a decision with the tire in the workshop's custody, the second a physical location outside the company. Merging them had the workshop promise a tire it did not hold.
class TireState {
  final String key;
  final String ar;
  final String en;

  /// Counts as in store?
  final bool inStore;
  final Color color;
  const TireState(this.key, this.ar, this.en, this.inStore, this.color);
}

/// Order here is the card order: a ladder from mounted to finished.
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

/// The slot a tire falls in: one definition for the counter, filter and badge.
String tireStateKey(Map<String, dynamic> t) {
  final s = (t['status'] ?? '').toString();
  if (s == 'mounted') return 'mounted';
  if (s == 'in_repair') return 'under_renewal'; // Old name
  if (s == 'retired') return 'scrap'; // Legacy
  if (const ['under_renewal', 'at_factory', 'scrap', 'damaged', 'sold'].contains(s)) return s;
  return (t['condition'] ?? 'used') == 'new' ? 'new' : 'used'; // spare
}

TireState tireStateOf(Map<String, dynamic> t) =>
    tireStates.firstWhere((x) => x.key == tireStateKey(t), orElse: () => tireStates[2]);

/// In store = everything we own that is not mounted. Scrapped and sold have left custody.
bool tireInStore(Map<String, dynamic> t) => tireStateOf(t).inStore;

/// Destinations when taking a tire off a truck: six, not four. Whoever removes it alone knows whether it is new on the shelf or used, and whether it is under renewal or went to the factory.
const tireDismountDestinations = <(String, String, String)>[
  ('new', 'الجديد (على الرفّ)', 'New (shelf)'),
  ('used', 'المستعمل (على الرفّ)', 'Used (shelf)'),
  ('under_renewal', 'تحت التجديد', 'Under renewal'),
  ('at_factory', 'في المصنع', 'At the factory'),
  ('scrap', 'السكراب', 'Scrap'),
  ('damaged', 'التالف', 'Damaged'),
];
