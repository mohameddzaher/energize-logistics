import 'dart:async';
import 'package:flutter/material.dart';
import 'api.dart';
import 'live.dart';
import '../ui/theme.dart';

/// Counts beside page names (/api/nav-badges, path → count), shared by the drawer and the home section lists.
/// Refreshed on the events that change them, debounced, so a rejected or placed request moves the number at once.
class NavBadges extends ValueNotifier<Map<String, int>> {
  NavBadges._() : super(const {}) {
    for (final e in _events) {
      Live.instance.on(e, _soon);
    }
  }
  static final NavBadges instance = NavBadges._();
  static const _events = ['shipmentRequests:changed', 'sellingRequests:changed', 'customs:updated', 'hr:leave', 'hr:request'];
  Timer? _t;

  void _soon() {
    _t?.cancel();
    _t = Timer(const Duration(milliseconds: 1200), refresh);
  }

  Future<void> refresh() async {
    try {
      final d = await Api.instance.get('/api/nav-badges');
      if (d is Map) value = {for (final e in d.entries) '${e.key}': (e.value as num).toInt()};
    } catch (_) {/* counters are a hint; a failed read keeps the last ones */}
  }

  int of(String? path) => path == null ? 0 : (value[path] ?? 0);
}

/// The red count pill, or nothing at zero.
Widget? navBadgePill(int n) => n <= 0
    ? null
    : Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(color: T.danger, borderRadius: BorderRadius.circular(20)),
        child: Text(n > 99 ? '99+' : '$n', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
      );
