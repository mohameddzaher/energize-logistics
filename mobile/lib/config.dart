// Central config — ONE place to point the app at a different backend
// (e.g. a local dev server) without touching any other file.
class AppConfig {
  // يُغيَّر للاختبار وحدَه: --dart-define=API_BASE=http://127.0.0.1:5055 — وبدونه الخادمُ الحقيقيّ.
  static const String apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://api.energize-logistics.com');

  // هوية الشركة البصرية — الكحلي أساس والبرتقالي المميز للسيستم.
  static const int navy = 0xFF12325C;
  static const int orange = 0xFFF37121;
}
