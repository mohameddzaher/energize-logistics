import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config.dart';
import 'api.dart';

/// One socket for the whole app — the exact events the web listens on, so a
/// phone and a laptop looking at the same board stay in sync.
///
/// The access token expires every 15 minutes, so a reconnect with the old
/// token is silently rejected — the reason "realtime stopped working until I
/// refreshed". Fix: on ANY connect error, refresh the token through the api
/// client and reconnect with the fresh one.
class Live {
  Live._();
  static final Live instance = Live._();
  io.Socket? _socket;
  final Map<String, List<void Function()>> _handlers = {};
  // مستمعون يحتاجون حمولة الحدث (زي الإشعارات: العنوان والرسالة).
  final Map<String, List<void Function(dynamic)>> _dataHandlers = {};
  bool _refreshing = false;

  void connect() {
    if (_socket != null) return;
    _socket = io.io(
      AppConfig.apiBase,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': Api.instance.accessToken})
          .enableReconnection()
          .setReconnectionDelay(2000)
          .build(),
    );
    _socket!.onAny((event, data) {
      for (final h in List.of(_handlers[event] ?? const [])) {
        h();
      }
      for (final h in List.of(_dataHandlers[event] ?? const [])) {
        h(data);
      }
      // اشتراك بالبادئة: المفتاح 'b2c:*' يستقبل كل أحداث 'b2c:...'.
      for (final e in _handlers.entries) {
        if (e.key.endsWith(':*') && event.startsWith(e.key.substring(0, e.key.length - 1))) {
          for (final h in List.of(e.value)) {
            h();
          }
        }
      }
    });
    // قبل كل محاولة إعادة اتصال: حدِّث التوكن في المصافحة.
    _socket!.io.on('reconnect_attempt', (_) {
      _socket!.auth = {'token': Api.instance.accessToken};
    });
    _socket!.onConnectError((_) => _refreshAndRetry());
    _socket!.on('connect_error', (_) => _refreshAndRetry());
  }

  Future<void> _refreshAndRetry() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      // أي طلب عادي يمر بمسار التجديد التلقائي في العميل — يكفي لتحديث التوكن.
      await Api.instance.get('/api/auth/me');
      _socket?.auth = {'token': Api.instance.accessToken};
      Future.delayed(const Duration(seconds: 1), () => _socket?.connect());
    } catch (_) {/* سيُعاد تلقائيًا مع محاولة الاتصال القادمة */} finally {
      _refreshing = false;
    }
  }

  void on(String event, void Function() handler) {
    _handlers.putIfAbsent(event, () => []).add(handler);
  }

  void off(String event, void Function() handler) {
    _handlers[event]?.remove(handler);
  }

  void onData(String event, void Function(dynamic) handler) {
    _dataHandlers.putIfAbsent(event, () => []).add(handler);
  }

  void offData(String event, void Function(dynamic) handler) {
    _dataHandlers[event]?.remove(handler);
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _handlers.clear();
    _dataHandlers.clear();
  }
}
