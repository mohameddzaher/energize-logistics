// Central config — ONE place to point the app at a different backend
// (e.g. a local dev server) without touching any other file.
class AppConfig {
  // Override for testing only: --dart-define=API_BASE=http://127.0.0.1:5055; without it the real server is used.
  static const String apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://api.energize-logistics.com');

  // Company visual identity: navy is the base and orange is the system accent.
  static const int navy = 0xFF12325C;
  static const int orange = 0xFFF37121;
}
