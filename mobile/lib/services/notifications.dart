import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api.dart';
import 'live.dart';

/// App notifications: listens for `notification:new` (per user by section and role), feeds the unread badge counter and fires a local sound notification in the notification center. All free (full Android push; iPhone only while the app is alive).
class NotificationService extends ChangeNotifier with WidgetsBindingObserver {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();
  int _unread = 0;
  int get unread => _unread;
  bool _wired = false;

  static const _channel = AndroidNotificationChannel(
    'energize_default', 'Energize', description: 'إشعارات النظام', importance: Importance.high,
  );

  Future<void> init() async {
    if (_wired) return;
    _wired = true;
    // Initialize local notifications and request permission (iPhone).
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: true, requestBadgePermission: true, requestSoundPermission: true,
    );
    try {
      await _plugin.initialize(const InitializationSettings(android: androidInit, iOS: iosInit));
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(_channel);
      await android?.requestNotificationsPermission(); // Android 13+
      await _plugin
          .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
    } catch (_) {/* Local notification unavailable; continue with the badge only. */}

    // Receive the live notification from the socket.
    Live.instance.onData('notification:new', _onNew);
    // System action event (for system admin and section manager): the counter is refreshed from the server, which decides what concerns this user, with no sound per action.
    Live.instance.on('notification:activity', refreshCount);
    WidgetsBinding.instance.addObserver(this);
    refreshCount();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refreshCount();
  }

  void _onNew(dynamic data) {
    _unread += 1;
    notifyListeners();
    final m = data is Map ? data : const {};
    _show(
      (m['title'] ?? 'Energize').toString(),
      (m['message'] ?? '').toString(),
    );
  }

  Future<void> _show(String title, String body) async {
    try {
      final id = DateTime.now().millisecondsSinceEpoch ~/ 1000 % 2147483647;
      await _plugin.show(
        id, title, body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id, _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high, priority: Priority.high, playSound: true,
          ),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentBadge: true, presentSound: true),
        ),
      );
    } catch (_) {/* ignore */}
  }

  /// Unread count from the server (on open/refresh).
  Future<void> refreshCount() async {
    try {
      final d = await Api.instance.get('/api/notifications?unreadOnly=true&limit=100');
      final list = d is Map ? d['notifications'] : null;
      _unread = list is List ? list.length : 0;
      notifyListeners();
    } catch (_) {/* Keep the current value. */}
  }

  void clearBadge() {
    _unread = 0;
    notifyListeners();
  }

  // Sync the counter with the server's value (called from the notifications screen).
  void setUnread(int n) {
    if (_unread == n) return;
    _unread = n;
    notifyListeners();
  }
}
