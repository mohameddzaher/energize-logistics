// Layout-QA harness: renders EVERY page from sectionsFor(auth) (+ self-service
// + home) at several phone/tablet sizes, in Arabic (RTL) and English, and
// records every FlutterError (overflow, unbounded constraints, exceptions).
//
// Run (local QA backend only!):
//   flutter test integration_test/layout_test.dart -d <simulator-id> \
//     --dart-define=API_BASE=http://127.0.0.1:5055 \
//     --dart-define=QA_OUT=<host dir for results+shots>
// Optional: --dart-define=QA_SHARD=0 --dart-define=QA_SHARDS=3   (page sharding)
//           --dart-define=QA_ONLY=fleet          (substring of section key / page title)
//           --dart-define=QA_START=40            (resume from page index)
//           --dart-define=QA_SHOTS=false         (skip screenshots)
//           --dart-define=QA_EMAIL=... --dart-define=QA_PASSWORD=...
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:energize_mobile/config.dart';
import 'package:energize_mobile/nav/sections.dart';
import 'package:energize_mobile/screens/home.dart';
import 'package:energize_mobile/services/auth.dart';
import 'package:energize_mobile/services/lang.dart';
import 'package:energize_mobile/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';

const _outDefine = String.fromEnvironment('QA_OUT');
const _shard = int.fromEnvironment('QA_SHARD', defaultValue: 0);
const _shards = int.fromEnvironment('QA_SHARDS', defaultValue: 1);
const _start = int.fromEnvironment('QA_START', defaultValue: 0);
const _only = String.fromEnvironment('QA_ONLY');
const _shots = bool.fromEnvironment('QA_SHOTS', defaultValue: true);
const _email = String.fromEnvironment('QA_EMAIL', defaultValue: 'qa-admin@local.test');
const _password = String.fromEnvironment('QA_PASSWORD', defaultValue: 'QaTest@12345');
const _maxLoad = Duration(milliseconds: int.fromEnvironment('QA_MAX_LOAD_MS', defaultValue: 6000));

class Cfg {
  final double w, h, dpr, textScale;
  final bool ar;
  final bool shot;
  final bool search;
  const Cfg(this.w, this.h, this.ar, {this.dpr = 3, this.textScale = 1, this.shot = false, this.search = false})
      ;
  String get id => '${w.toInt()}x${h.toInt()}__${ar ? 'ar' : 'en'}${textScale != 1 ? '__ts$textScale' : ''}';
}

const _cfgs = <Cfg>[
  Cfg(320, 568, true, shot: true),
  Cfg(375, 667, true, shot: true),
  Cfg(390, 844, true, search: true),
  Cfg(430, 932, true),
  Cfg(820, 1180, true, dpr: 2, shot: true),
  Cfg(320, 568, false),
  Cfg(375, 667, false),
  Cfg(390, 844, false, search: true),
  Cfg(430, 932, false),
  Cfg(820, 1180, false, dpr: 2),
  Cfg(390, 844, true, textScale: 1.3),
];

// ── counting HTTP client: tells us whether the search box triggered a request ──
int apiRequests = 0;
DateTime lastRequestAt = DateTime.fromMillisecondsSinceEpoch(0);

class _CountingOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _CountingClient(super.createHttpClient(context));
}

class _CountingClient implements HttpClient {
  final HttpClient inner;
  _CountingClient(this.inner);
  void _count(Uri u) {
    if (AppConfig.apiBase.contains(u.authority) && u.path.startsWith('/api/')) {
      apiRequests++;
      lastRequestAt = DateTime.now();
    }
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) { _count(url); return inner.openUrl(method, url); }
  @override
  Future<HttpClientRequest> open(String method, String host, int port, String path) => inner.open(method, host, port, path);
  @override
  Future<HttpClientRequest> getUrl(Uri url) => openUrl('GET', url);
  @override
  Future<HttpClientRequest> postUrl(Uri url) => openUrl('POST', url);
  @override
  Future<HttpClientRequest> putUrl(Uri url) => openUrl('PUT', url);
  @override
  Future<HttpClientRequest> patchUrl(Uri url) => openUrl('PATCH', url);
  @override
  Future<HttpClientRequest> deleteUrl(Uri url) => openUrl('DELETE', url);
  @override
  Future<HttpClientRequest> headUrl(Uri url) => openUrl('HEAD', url);
  @override
  Future<HttpClientRequest> get(String h, int p, String path) => inner.get(h, p, path);
  @override
  Future<HttpClientRequest> post(String h, int p, String path) => inner.post(h, p, path);
  @override
  Future<HttpClientRequest> put(String h, int p, String path) => inner.put(h, p, path);
  @override
  Future<HttpClientRequest> patch(String h, int p, String path) => inner.patch(h, p, path);
  @override
  Future<HttpClientRequest> delete(String h, int p, String path) => inner.delete(h, p, path);
  @override
  Future<HttpClientRequest> head(String h, int p, String path) => inner.head(h, p, path);
  @override
  void close({bool force = false}) => inner.close(force: force);
  @override
  bool get autoUncompress => inner.autoUncompress;
  @override
  set autoUncompress(bool v) => inner.autoUncompress = v;
  @override
  Duration? get connectionTimeout => inner.connectionTimeout;
  @override
  set connectionTimeout(Duration? v) => inner.connectionTimeout = v;
  @override
  Duration get idleTimeout => inner.idleTimeout;
  @override
  set idleTimeout(Duration v) => inner.idleTimeout = v;
  @override
  int? get maxConnectionsPerHost => inner.maxConnectionsPerHost;
  @override
  set maxConnectionsPerHost(int? v) => inner.maxConnectionsPerHost = v;
  @override
  String? get userAgent => inner.userAgent;
  @override
  set userAgent(String? v) => inner.userAgent = v;
  @override
  void addCredentials(Uri url, String realm, HttpClientCredentials c) => inner.addCredentials(url, realm, c);
  @override
  void addProxyCredentials(String host, int port, String realm, HttpClientCredentials c) =>
      inner.addProxyCredentials(host, port, realm, c);
  @override
  set authenticate(Future<bool> Function(Uri url, String scheme, String? realm)? f) => inner.authenticate = f;
  @override
  set authenticateProxy(Future<bool> Function(String host, int port, String scheme, String? realm)? f) =>
      inner.authenticateProxy = f;
  @override
  set badCertificateCallback(bool Function(X509Certificate cert, String host, int port)? cb) =>
      inner.badCertificateCallback = cb;
  @override
  set connectionFactory(Future<ConnectionTask<Socket>> Function(Uri url, String? proxyHost, int? proxyPort)? f) =>
      inner.connectionFactory = f;
  @override
  set findProxy(String Function(Uri url)? f) => inner.findProxy = f;
  @override
  set keyLog(Function(String line)? cb) => inner.keyLog = cb;
}

// ── error capture ──────────────────────────────────────────────────────────
final _locRe = RegExp(r'(lib/[\w/]+\.dart):(\d+)(?::(\d+))?');
final _pkgRe = RegExp(r'package:energize_mobile/([\w/]+\.dart):(\d+)(?::(\d+))?');

String _kind(String text) {
  final t = text.toLowerCase();
  if (t.contains('overflowed by')) return 'overflow';
  if (t.contains('was not laid out') || t.contains('has no size') || t.contains('needs compositing bits')) return 'not_laid_out';
  if (t.contains('unbounded') || t.contains('infinite size') || t.contains('infinite width') || t.contains('infinite height') ||
      t.contains('forces an infinite')) {
    return 'unbounded';
  }
  if (t.contains('incorrect use of parentdatawidget')) return 'parent_data';
  if (t.contains('setstate() called after dispose') || t.contains('after dispose')) return 'set_state_after_dispose';
  if (t.contains('renderbox') || t.contains('constraints')) return 'layout_other';
  return 'exception';
}

Map<String, dynamic> _fromDetails(FlutterErrorDetails d) {
  String full;
  try {
    full = d.toString();
  } catch (_) {
    full = d.exceptionAsString();
  }
  final head = d.exceptionAsString().split('\n').first.trim();
  // "The relevant error-causing widget was: Row  Row:file:///…/lib/x.dart:1:2"
  String? widgetLoc;
  final rel = full.indexOf('relevant error-causing widget');
  if (rel >= 0) {
    final m = _locRe.firstMatch(full.substring(rel));
    if (m != null) widgetLoc = '${m.group(1)}:${m.group(2)}';
  }
  String? stackLoc;
  final st = d.stack?.toString() ?? '';
  final ms = _pkgRe.firstMatch(st);
  if (ms != null) stackLoc = 'lib/${ms.group(1)}:${ms.group(2)}';
  widgetLoc ??= stackLoc;
  String? widgetName;
  final wn = RegExp(r'relevant error-causing widget was:?\s*\n?\s*([A-Za-z_][\w<>]*)').firstMatch(full);
  if (wn != null) widgetName = wn.group(1);
  return {
    'kind': _kind('$head\n$full'),
    'message': head.length > 300 ? head.substring(0, 300) : head,
    'widget': widgetName,
    'loc': widgetLoc,
    'stackLoc': stackLoc,
    'library': d.library,
  };
}

Map<String, dynamic> _fromObject(Object e, StackTrace? s) {
  final head = e.toString().split('\n').first.trim();
  final m = _pkgRe.firstMatch(s?.toString() ?? '');
  final loc = m == null ? null : 'lib/${m.group(1)}:${m.group(2)}';
  return {
    'kind': _kind(e.toString()),
    'message': head.length > 300 ? head.substring(0, 300) : head,
    'widget': null,
    'loc': loc,
    'stackLoc': loc,
    'library': 'uncaught',
  };
}

String _safe(String s) => s.replaceAll(RegExp(r'[^A-Za-z0-9_\-]+'), '_').replaceAll(RegExp(r'_+'), '_');

class PageRef {
  final int index;
  final String section;
  final String sectionKey;
  final AppPage page;
  final String id;
  PageRef(this.index, this.section, this.sectionKey, this.page, this.id);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  HttpOverrides.global = _CountingOverrides();

  testWidgets('layout QA — every page × sizes × languages', (tester) async {
    // ── output dir: host path if writable (simulator), else documents ──
    Directory out;
    try {
      out = Directory(_outDefine.isNotEmpty ? _outDefine : 'x-not-set');
      if (_outDefine.isEmpty) throw 'no QA_OUT';
      await out.create(recursive: true);
      await File('${out.path}/.qa-probe').writeAsString('ok');
    } catch (_) {
      out = Directory('${(await getApplicationDocumentsDirectory()).path}/qa');
      await out.create(recursive: true);
    }
    final res = Directory('${out.path}/qa-results');
    await res.create(recursive: true);
    final jsonl = File('${res.path}/results_shard$_shard.jsonl');
    final progress = File('${res.path}/progress_shard$_shard.txt');
    debugPrint('QA_OUT_DIR=${out.path}');

    // ── real login through the app's AuthProvider ──
    final auth = AuthProvider();
    // parallel shards log in as the same user at once; the backend's login
    // save() then races (VersionError → 500), so retry with a staggered delay.
    for (var attempt = 0;; attempt++) {
      try {
        await auth.login(_email, _password);
        break;
      } catch (e) {
        if (attempt >= 6) rethrow;
        debugPrint('QA login retry ${attempt + 1}: $e');
        await Future<void>.delayed(Duration(milliseconds: 700 * (attempt + 1) + 300 * _shard));
      }
    }
    auth.loading = false;
    expect(auth.user, isNotNull);
    debugPrint('QA logged in as ${auth.user?['email']} role=${auth.role}');

    // ── enumerate pages ──
    final refs = <PageRef>[];
    final seen = <String>{};
    void add(String section, String key, AppPage p) {
      var id = '${_safe(key)}/${_safe(p.enTitle)}';
      var k = 2;
      while (seen.contains(id)) {
        id = '${_safe(key)}/${_safe(p.enTitle)}_${k++}';
      }
      seen.add(id);
      refs.add(PageRef(refs.length, section, key, p, id));
    }

    Lang.instance.ar = false;
    add('Home', 'Home', AppPage('الرئيسية', 'Home', Icons.home, (c) => const HomeScreen()));
    for (final p in selfServicePages(true)) {
      add('Self-service', 'Self-service', p);
    }
    for (final s in sectionsFor(auth)) {
      for (final p in s.pages) {
        add(s.enTitle, s.key, p);
      }
    }
    await File('${res.path}/pages_all.json').writeAsString(jsonEncode(
        refs.map((r) => {'index': r.index, 'id': r.id, 'section': r.section, 'ar': r.page.arTitle, 'en': r.page.enTitle, 'path': r.page.path}).toList()));
    final mine = refs.where((r) {
      if (r.index < _start) return false;
      if (r.index % _shards != _shard) return false;
      if (_only.isNotEmpty) {
        final hay = '${r.sectionKey} ${r.section} ${r.page.enTitle} ${r.id}'.toLowerCase();
        if (!_only.toLowerCase().split(',').any((q) => hay.contains(q.trim()))) return false;
      }
      return true;
    }).toList();
    debugPrint('QA total pages=${refs.length}, this shard=${mine.length}');

    // ── error sink ──
    final errors = <Map<String, dynamic>>[];
    final prevOnError = FlutterError.onError;
    final prevPlatform = ui.PlatformDispatcher.instance.onError;
    FlutterError.onError = (d) => errors.add(_fromDetails(d));
    ui.PlatformDispatcher.instance.onError = (e, s) {
      errors.add(_fromObject(e, s));
      return true;
    };
    void drainTester() {
      // exceptions the test zone caught (async errors in screens)
      Object? e;
      var guard = 0;
      while ((e = tester.takeException()) != null && guard++ < 20) {
        errors.add(_fromObject(e!, null));
      }
    }

    final boundaryKey = GlobalKey();

    Future<void> wait(Duration d) async {
      await Future<void>.delayed(d);
      await tester.pump();
    }

    // Finder traversal can hit a viewport mid-rebuild under the fully-live
    // frame policy (null check in _ViewportElement.debugVisitOnstageChildren);
    // treat that as "still busy" / "unknown" rather than aborting the run.
    bool busy() {
      try {
        return find.byType(CircularProgressIndicator).evaluate().isNotEmpty ||
            find.byType(LinearProgressIndicator).evaluate().isNotEmpty ||
            find.byType(RefreshProgressIndicator).evaluate().isNotEmpty;
      } catch (_) {
        return true;
      }
    }

    int countOf(Type t) {
      try {
        return find.byType(t).evaluate().length;
      } catch (_) {
        return -1;
      }
    }

    Future<int> settle() async {
      final t0 = DateTime.now();
      await wait(const Duration(milliseconds: 700));
      var calm = 0;
      while (DateTime.now().difference(t0) < _maxLoad) {
        await wait(const Duration(milliseconds: 300));
        final quietNet = DateTime.now().difference(lastRequestAt) > const Duration(milliseconds: 500);
        if (!busy() && quietNet) {
          if (++calm >= 2) break;
        } else {
          calm = 0;
        }
      }
      return DateTime.now().difference(t0).inMilliseconds;
    }

    Future<String?> shoot(PageRef r, Cfg c) async {
      try {
        final ctx = boundaryKey.currentContext;
        if (ctx == null) return null;
        final ro = ctx.findRenderObject() as RenderRepaintBoundary;
        final img = await ro.toImage(pixelRatio: c.w > 600 ? 1.0 : 1.5);
        final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
        img.dispose();
        if (bytes == null) return null;
        final rel = 'qa-shots/${r.id}__${c.w.toInt()}x${c.h.toInt()}__${c.ar ? 'ar' : 'en'}.png';
        final f = File('${out.path}/$rel');
        await f.parent.create(recursive: true);
        await f.writeAsBytes(bytes.buffer.asUint8List());
        return rel;
      } catch (e) {
        debugPrint('shot failed ${r.id}: $e');
        return null;
      }
    }

    Widget harness(PageRef r, Cfg c) {
      return ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            key: ValueKey('${r.id}|${c.id}'),
            title: 'Energize Logistics',
            debugShowCheckedModeBanner: false,
            locale: Locale(c.ar ? 'ar' : 'en'),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(c.textScale)),
              child: Directionality(
                textDirection: c.ar ? TextDirection.rtl : TextDirection.ltr,
                child: child!,
              ),
            ),
            theme: T.theme(),
            home: Builder(builder: (ctx) => r.page.builder(ctx)),
          ),
        ),
      );
    }

    Future<void> runCfg(PageRef r, Cfg c) async {
      Lang.instance.ar = c.ar;
      tester.view.devicePixelRatio = c.dpr;
      tester.view.physicalSize = Size(c.w * c.dpr, c.h * c.dpr);
      errors.clear();
      final sw = Stopwatch()..start();
      await tester.pumpWidget(harness(r, c));
      drainTester();
      final loadMs = await settle();
      drainTester();
      final stillLoading = busy();
      String? shot;
      if (_shots && c.shot) shot = await shoot(r, c);
      final pageErrors = List<Map<String, dynamic>>.from(errors);

      Map<String, dynamic>? searchRes;
      if (c.search) {
        errors.clear();
        final fields = find.byType(TextField);
        final n = countOf(TextField);
        if (n > 0) {
          final before = apiRequests;
          final textsBefore = countOf(Text);
          String? err;
          try {
            await tester.enterText(fields.first, c.ar ? 'مح' : 'qa');
            await wait(const Duration(milliseconds: 600));
            await settle();
          } catch (e) {
            err = e.toString().split('\n').first;
          }
          drainTester();
          searchRes = {
            'fields': n,
            'requests': apiRequests - before,
            'textWidgetsBefore': textsBefore,
            'textWidgetsAfter': countOf(Text),
            'enterError': err,
            'errors': List<Map<String, dynamic>>.from(errors),
          };
        } else {
          searchRes = {'fields': 0};
        }
      }
      sw.stop();
      final rec = {
        'index': r.index,
        'id': r.id,
        'section': r.section,
        'sectionKey': r.sectionKey,
        'titleAr': r.page.arTitle,
        'titleEn': r.page.enTitle,
        'cfg': c.id,
        'w': c.w,
        'h': c.h,
        'lang': c.ar ? 'ar' : 'en',
        'textScale': c.textScale,
        'loadMs': loadMs,
        'stillLoading': stillLoading,
        'ms': sw.elapsedMilliseconds,
        'errors': pageErrors,
        if (shot != null) 'shot': shot,
        if (searchRes != null) 'search': searchRes,
      };
      await jsonl.writeAsString('${jsonEncode(rec)}\n', mode: FileMode.append);
      debugPrint('QA ${r.index} ${r.id} ${c.id} errors=${pageErrors.length} ${sw.elapsedMilliseconds}ms');
      // unmount (dispose timers/sockets of the screen) before the next config
      await tester.pumpWidget(const SizedBox.shrink());
      drainTester();
    }

    try {
      for (final r in mine) {
        await progress.writeAsString('${r.index} ${r.id}\n', mode: FileMode.append);
        for (final c in _cfgs) {
          try {
            await runCfg(r, c);
          } catch (e, st) {
            // harness-level failure for this page/config: record and move on
            final rec = {
              'index': r.index, 'id': r.id, 'section': r.section, 'sectionKey': r.sectionKey,
              'titleAr': r.page.arTitle, 'titleEn': r.page.enTitle, 'cfg': c.id, 'w': c.w, 'h': c.h,
              'lang': c.ar ? 'ar' : 'en', 'textScale': c.textScale, 'loadMs': 0, 'stillLoading': false, 'ms': 0,
              'harnessError': e.toString().split('\n').first,
              'errors': [...errors, _fromObject(e, st)],
            };
            await jsonl.writeAsString('${jsonEncode(rec)}\n', mode: FileMode.append);
            debugPrint('QA ${r.index} ${r.id} ${c.id} HARNESS ERROR $e');
            try {
              await tester.pumpWidget(const SizedBox.shrink());
            } catch (_) {}
            drainTester();
          }
        }
      }
      await File('${res.path}/done_shard$_shard.txt').writeAsString('done ${mine.length}\n');
    } finally {
      FlutterError.onError = prevOnError;
      ui.PlatformDispatcher.instance.onError = prevPlatform;
      tester.view.reset();
    }
  }, timeout: Timeout.none);
}
