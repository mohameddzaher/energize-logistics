import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api.dart';
import 'live.dart';

/// إشعارات التطبيق: يستمع لحدث `notification:new` من السيرفر (لأي مستخدم حسب
/// قسمه ودوره)، يزوّد عدّاد غير المقروء (شارة حمراء)، ويطلق إشعارًا محليًا بصوت
/// يظهر في مركز الإشعارات — كله مجاني (أندرويد بوش كامل، آيفون طالما التطبيق حي).
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
    // تهيئة الإشعارات المحلية + طلب الإذن (آيفون).
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: true, requestBadgePermission: true, requestSoundPermission: true,
    );
    try {
      await _plugin.initialize(const InitializationSettings(android: androidInit, iOS: iosInit));
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(_channel);
      await android?.requestNotificationsPermission(); // أندرويد 13+
      await _plugin
          .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
    } catch (_) {/* الإشعار المحلي غير متاح — نكمل بالشارة فقط */}

    // نستقبل الإشعار الحي من السوكت.
    Live.instance.onData('notification:new', _onNew);
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
    } catch (_) {/* تجاهل */}
  }

  /// عدد غير المقروء من السيرفر (عند الفتح/التحديث).
  Future<void> refreshCount() async {
    try {
      final d = await Api.instance.get('/api/notifications?unreadOnly=true&limit=100');
      final list = d is Map ? d['notifications'] : null;
      _unread = list is List ? list.length : 0;
      notifyListeners();
    } catch (_) {/* نبقى على القيمة الحالية */}
  }

  void clearBadge() {
    _unread = 0;
    notifyListeners();
  }

  // مزامنة العدّاد مع القيمة الرسمية من السيرفر (تُستدعى من شاشة الإشعارات).
  void setUnread(int n) {
    if (_unread == n) return;
    _unread = n;
    notifyListeners();
  }
}
