import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../nav/sections.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../screens/my_profile.dart';
import '../screens/admin_suite.dart' show NotificationsScreen;
import 'theme.dart';

/// The app-wide scaffold: EVERY screen gets the burger drawer (all sections)
/// beside the back button — no more going all the way home to switch pages.
class AppScaffold extends StatelessWidget {
  final Widget title;
  final Widget body;
  final List<Widget>? actions;
  final PreferredSizeWidget? appBarBottom;
  final Widget? floatingActionButton;
  const AppScaffold({
    super.key, required this.title, required this.body,
    this.actions, this.appBarBottom, this.floatingActionButton,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: title,
        bottom: appBarBottom,
        actions: [
          ...?actions,
          Builder(
            builder: (c) => IconButton(
              icon: const Icon(Icons.search_rounded),
              tooltip: tr('بحث', 'Search'),
              onPressed: () => showSearch(context: c, delegate: AppSearchDelegate(c.read<AuthProvider>())),
            ),
          ),
          Builder(
            builder: (c) => IconButton(
              icon: const Icon(Icons.menu_rounded),
              tooltip: tr('كل الأقسام', 'All sections'),
              onPressed: () => Scaffold.of(c).openEndDrawer(),
            ),
          ),
        ],
      ),
      endDrawer: const AppDrawer(),
      floatingActionButton: floatingActionButton,
      body: body,
      // شريط سفلي ثابت في كل الصفحات — الرئيسية/ملفي/الإشعارات/القائمة.
      bottomNavigationBar: const AppBottomNav(),
    );
  }
}

/// The persistent bottom bar shown on EVERY screen (via AppScaffold) so it never
/// disappears when you drill into a page. A soft press-animation on each item.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({super.key});

  // نفتح الوجهة مرة واحدة — لو إحنا عليها بالفعل مانكررهاش (تجنّب تكديس نسخ).
  void _openOnce(BuildContext context, String name, WidgetBuilder builder) {
    if (ModalRoute.of(context)?.settings.name == name) return;
    Navigator.push(context, MaterialPageRoute(settings: RouteSettings(name: name), builder: builder));
  }

  @override
  Widget build(BuildContext context) {
    Widget item(IconData icon, String label, VoidCallback onTap) => Expanded(
          child: _BounceTap(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(icon, size: 23, color: T.navy),
                const SizedBox(height: 3),
                Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: T.navy)),
              ]),
            ),
          ),
        );
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, -3))],
      ),
      child: SafeArea(
        top: false,
        child: Row(children: [
          item(Icons.home_rounded, tr('الرئيسية', 'Home'), () => Navigator.popUntil(context, (r) => r.isFirst)),
          item(Icons.account_circle_outlined, tr('ملفي', 'Profile'), () => _openOnce(context, 'profile', (_) => const MyProfileScreen())),
          item(Icons.notifications_outlined, tr('الإشعارات', 'Alerts'), () => _openOnce(context, 'alerts', (_) => const NotificationsScreen())),
          Builder(builder: (c) => item(Icons.menu_rounded, tr('القائمة', 'Menu'), () => Scaffold.of(c).openEndDrawer())),
        ]),
      ),
    );
  }
}

/// Global search from the top bar of every screen — flattens the user's allowed
/// sections + self-service pages and jumps straight to whatever they type.
class AppSearchDelegate extends SearchDelegate<void> {
  final AuthProvider auth;
  AppSearchDelegate(this.auth) : super(searchFieldLabel: tr('ابحث عن قسم أو صفحة…', 'Search sections & pages…'));

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه')
      .replaceAll('ؤ', 'و').replaceAll('ئ', 'ي').toLowerCase();

  List<(String, AppPage)> _matches() {
    final q = _fold(query.trim());
    final List<(String, AppPage)> out = [];
    for (final p in selfServicePages(true)) {
      if (q.isEmpty || _fold(p.title).contains(q)) out.add((tr('الخدمة الذاتية', 'Self Service'), p));
    }
    for (final s in sectionsFor(auth)) {
      final sectionHit = _fold(s.title).contains(q);
      for (final p in s.pages) {
        if (q.isEmpty || sectionHit || _fold(p.title).contains(q)) out.add((s.title, p));
      }
    }
    return out;
  }

  @override
  List<Widget> buildActions(BuildContext context) =>
      [if (query.isNotEmpty) IconButton(icon: const Icon(Icons.close), onPressed: () => query = '')];

  @override
  Widget buildLeading(BuildContext context) =>
      IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => close(context, null));

  @override
  Widget buildResults(BuildContext context) => _list(context);
  @override
  Widget buildSuggestions(BuildContext context) => _list(context);

  Widget _list(BuildContext context) {
    final matches = _matches();
    if (matches.isEmpty) {
      return Center(child: Text(tr('لا توجد نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)));
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 6),
      itemCount: matches.length,
      itemBuilder: (c, i) => ListTile(
        leading: Icon(matches[i].$2.icon, color: T.navy),
        title: Text(matches[i].$2.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        subtitle: Text(matches[i].$1, style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        onTap: () {
          // نلتقط الـ Navigator قبل close — بعدها context الخاص بشاشة البحث يبقى ميت.
          final nav = Navigator.of(context);
          final b = matches[i].$2.builder;
          close(context, null);
          nav.push(MaterialPageRoute(builder: b));
        },
      ),
    );
  }
}

/// A tap wrapper that gives a soft, springy scale-down while pressed — the
/// «jellyfish» feel across the bottom bar.
class _BounceTap extends StatefulWidget {
  final Widget child;
  final VoidCallback onTap;
  const _BounceTap({required this.child, required this.onTap});
  @override
  State<_BounceTap> createState() => _BounceTapState();
}

class _BounceTapState extends State<_BounceTap> {
  double _s = 1;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _s = 0.86),
      onTapUp: (_) { setState(() => _s = 1); widget.onTap(); },
      onTapCancel: () => setState(() => _s = 1),
      behavior: HitTestBehavior.opaque,
      child: AnimatedScale(
        scale: _s,
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOutBack,
        child: widget.child,
      ),
    );
  }
}

/// The global drawer: user header, self-service, every allowed section
/// expandable into its pages, language toggle, sign out. Usable from any
/// screen; navigating replaces the current page under the shell.
class AppDrawer extends StatefulWidget {
  const AppDrawer({super.key});
  @override
  State<AppDrawer> createState() => _AppDrawerState();
}

class _AppDrawerState extends State<AppDrawer> {
  String _q = '';

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه')
      .replaceAll('ؤ', 'و').replaceAll('ئ', 'ي').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final sections = sectionsFor(auth);
    final selfPages = selfServicePages(true); // موافقات فريقي تظهر؛ الشاشة نفسها تتحقق

    void go(WidgetBuilder b) {
      Navigator.pop(context); // اقفل الدرج
      Navigator.push(context, MaterialPageRoute(builder: b));
    }

    // نتائج البحث: كل الصفحات (خدمة ذاتية + كل الأقسام) المطابقة، مسطّحة.
    final q = _fold(_q.trim());
    final List<(String, AppPage)> matches = [];
    if (q.isNotEmpty) {
      for (final p in selfPages) {
        if (_fold(p.title).contains(q)) matches.add((tr('الخدمة الذاتية', 'Self Service'), p));
      }
      for (final s in sections) {
        if (_fold(s.title).contains(q)) { for (final p in s.pages) { matches.add((s.title, p)); } }
        else { for (final p in s.pages) { if (_fold(p.title).contains(q)) matches.add((s.title, p)); } }
      }
    }

    return Drawer(
      backgroundColor: Colors.white,
      child: Column(children: [
        Container(
          width: double.infinity,
          padding: EdgeInsets.fromLTRB(18, MediaQuery.of(context).padding.top + 16, 18, 16),
          decoration: const BoxDecoration(gradient: T.navyGradient),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Image.asset('assets/logo_white.png', height: 26),
            const SizedBox(height: 12),
            Text(auth.fullName, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800)),
            Text(auth.user?['email'] ?? '', style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11.5)),
          ]),
        ),
        // بحث سريع في كل الأقسام والصفحات
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
          child: TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: InputDecoration(
              isDense: true,
              hintText: tr('ابحث عن قسم أو صفحة…', 'Search sections & pages…'),
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: _q.isNotEmpty ? IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _q = '')) : null,
              contentPadding: const EdgeInsets.symmetric(vertical: 8),
            ),
          ),
        ),
        // نتائج البحث المسطّحة
        if (q.isNotEmpty)
          Expanded(
            child: matches.isEmpty
                ? Center(child: Text(tr('لا توجد نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    itemCount: matches.length,
                    itemBuilder: (c, i) => ListTile(
                      dense: true,
                      leading: Icon(matches[i].$2.icon, size: 20, color: T.navy),
                      title: Text(matches[i].$2.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                      subtitle: Text(matches[i].$1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      onTap: () => go(matches[i].$2.builder),
                    ),
                  ),
          )
        else
        Expanded(
          child: ListView(
            padding: const EdgeInsets.symmetric(vertical: 8),
            children: [
              ListTile(
                dense: true,
                leading: const Icon(Icons.home_outlined, size: 21, color: T.navy),
                title: Text(tr('الرئيسية', 'Home'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.popUntil(context, (r) => r.isFirst);
                },
              ),
              _label(tr('الخدمة الذاتية', 'Self Service')),
              ...selfPages.map((p) => ListTile(
                    dense: true,
                    leading: Icon(p.icon, size: 21, color: T.inkSoft),
                    title: Text(p.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    onTap: () => go(p.builder),
                  )),
              _label(tr('الأقسام', 'Sections')),
              ...sections.map((s) => ExpansionTile(
                    leading: Icon(s.icon, size: 21, color: T.navy),
                    title: Text(s.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                    shape: const Border(),
                    childrenPadding: EdgeInsetsDirectional.only(start: Lang.instance.ar ? 16 : 16),
                    children: s.pages
                        .map((p) => ListTile(
                              dense: true,
                              leading: Icon(p.icon, size: 19, color: T.inkFaint),
                              title: Text(p.title, style: const TextStyle(fontSize: 13.5)),
                              onTap: () => go(p.builder),
                            ))
                        .toList(),
                  )),
            ],
          ),
        ),
        const Divider(height: 1),
        ListTile(
          dense: true,
          leading: const Icon(Icons.language_rounded, color: T.navy),
          title: Text(tr('English', 'العربية'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          onTap: () { Navigator.pop(context); Lang.instance.toggle(); },
        ),
        ListTile(
          dense: true,
          leading: const Icon(Icons.logout_rounded, color: T.danger),
          title: Text(tr('تسجيل الخروج', 'Sign out'), style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700)),
          onTap: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: Text(tr('تسجيل الخروج', 'Sign out')),
                content: Text(tr('هل تريد تسجيل الخروج من التطبيق؟', 'Sign out of the app?')),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                  TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('خروج', 'Sign out'))),
                ],
              ),
            );
            if (ok == true && context.mounted) {
              Live.instance.disconnect();
              await context.read<AuthProvider>().logout();
              if (context.mounted) Navigator.popUntil(context, (r) => r.isFirst);
            }
          },
        ),
        SizedBox(height: MediaQuery.of(context).padding.bottom),
      ]),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 4),
        child: Text(text, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkFaint, letterSpacing: 0.3)),
      );
}
