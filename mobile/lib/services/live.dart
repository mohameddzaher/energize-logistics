import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config.dart';
import 'api.dart';

/// One socket for the whole app — the exact events the web listens on
/// (admintasks:updated, hr:leave, …) so a phone and a laptop looking at the
/// same board stay in sync.
class Live {
  Live._();
  static final Live instance = Live._();
  io.Socket? _socket;
  final Map<String, List<void Function()>> _handlers = {};

  void connect() {
    if (_socket != null) return;
    _socket = io.io(
      AppConfig.apiBase,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': Api.instance.accessToken})
          .enableReconnection()
          .build(),
    );
    _socket!.onAny((event, data) {
      for (final h in _handlers[event] ?? const []) {
        h();
      }
    });
  }

  void on(String event, void Function() handler) {
    _handlers.putIfAbsent(event, () => []).add(handler);
  }

  void off(String event, void Function() handler) {
    _handlers[event]?.remove(handler);
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _handlers.clear();
  }
}
