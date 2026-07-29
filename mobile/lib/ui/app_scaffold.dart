import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../nav/sections.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
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
  // مشترك عبر فتحات الدرج → مايرجعش لفوق كل مرة، بيفضل على آخر مكان وصلت له.
  static final ScrollController _sc = ScrollController();

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
            controller: _sc,
            key: const PageStorageKey('drawer-sections'),
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
