import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../nav/sections.dart';
import '../nav/home_insights.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The app shell: burger drawer with EVERY section the signed-in user can
/// open (same gating as the web sidebar), and an animated dashboard home.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _hasTeam = false;
  int _openTasks = 0;
  int _pendingApprovals = 0;
  int _myLeaves = 0;
  double _leaveAvailable = 0;
  bool _statsLoading = true;

  HomeInsight? _insight;
  Map<String, dynamic> _insightData = {};
  bool _insightLoading = true;

  @override
  void initState() {
    super.initState();
    Live.instance.connect();
    _loadStats();
    Live.instance.on('admintasks:updated', _loadStats);
    Live.instance.on('hr:leave', _loadStats);
    // النظرة الحية للقسم تُحدَّث على حدث القسم نفسه.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final i = homeInsightFor(context.read<AuthProvider>());
      if (i != null && i.liveEvent.isNotEmpty) Live.instance.on(i.liveEvent, _loadInsight);
    });
  }

  @override
  void dispose() {
    Live.instance.off('admintasks:updated', _loadStats);
    Live.instance.off('hr:leave', _loadStats);
    if (_insight != null && _insight!.liveEvent.isNotEmpty) Live.instance.off(_insight!.liveEvent, _loadInsight);
    super.dispose();
  }

  Future<void> _loadInsight() async {
    final i = homeInsightFor(context.read<AuthProvider>());
    if (i == null) { if (mounted) setState(() { _insight = null; _insightLoading = false; }); return; }
    try {
      final d = await Api.instance.get(i.endpoint);
      if (!mounted) return;
      setState(() { _insight = i; _insightData = Map<String, dynamic>.from(d); _insightLoading = false; });
    } catch (_) {
      if (mounted) setState(() { _insight = i; _insightLoading = false; });
    }
  }

  num _dig(String path) {
    dynamic cur = _insightData;
    for (final p in path.split('.')) {
      if (cur is Map) { cur = cur[p]; } else { return 0; }
    }
    return cur is num ? cur : num.tryParse(cur?.toString() ?? '') ?? 0;
  }

  String _fmt(num n, bool money) {
    if (money) {
      final s = n.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
      return '$s ${tr('ر.س', 'SAR')}';
    }
    return n.toStringAsFixed(n.truncateToDouble() == n ? 0 : 1);
  }

  Future<void> _loadStats() async {
    _loadInsight();
    final auth = context.read<AuthProvider>();
    try {
      final results = await Future.wait([
        Api.instance.get('/api/hr/me/team').catchError((_) => {}),
        Api.instance.get('/api/hr/me/leaves').catchError((_) => {}),
        Api.instance.get('/api/hr/team/leaves').catchError((_) => {}),
        if (_canSeeBoard(auth)) Api.instance.get('/api/admin-tasks').catchError((_) => {}),
      ]);
      if (!mounted) return;
      final leaves = List<Map<String, dynamic>>.from(results[1]['leaves'] ?? []);
      final teamLeaves = List<Map<String, dynamic>>.from(results[2]['leaves'] ?? []);
      final tasks = results.length > 3 ? List<Map<String, dynamic>>.from(results[3]['tasks'] ?? []) : <Map<String, dynamic>>[];
      setState(() {
        _hasTeam = results[0]['hasTeam'] == true;
        _myLeaves = leaves.where((l) => l['status'] == 'pending_manager' || l['status'] == 'pending_hr').length;
        _leaveAvailable = ((results[1]['balance']?['available']) ?? 0).toDouble();
        _pendingApprovals = teamLeaves.where((l) => l['status'] == 'pending_manager').length;
        _openTasks = tasks.where((t) => t['status'] != 'done').length;
        _statsLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _statsLoading = false);
    }
  }

  bool _canSeeBoard(AuthProvider auth) =>
      const ['super_admin', 'admin', 'administrator', 'bd_manager', 'it_manager', 'it_specialist'].contains(auth.role) ||
      auth.canAccessSection('Administration');

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return tr('صباح النشاط', 'Good morning');
    if (h < 17) return tr('يوم موفق', 'Good afternoon');
    return tr('مساء الإنجاز', 'Good evening');
  }

  String _todayLabel() {
    final now = DateTime.now();
    const arDays = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const enDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const arMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final day = tr(arDays[now.weekday - 1], enDays[now.weekday - 1]);
    final month = tr(arMonths[now.month - 1], enMonths[now.month - 1]);
    return '$day، ${now.day} $month';
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final sections = sectionsFor(auth);
    final selfPages = selfServicePages(_hasTeam);

    return Scaffold(
      appBar: AppBar(
        title: Image.asset('assets/logo_white.png', height: 24),
        leading: Builder(
          builder: (c) => IconButton(
            icon: const Icon(Icons.menu_rounded, size: 26),
            onPressed: () => Scaffold.of(c).openDrawer(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Lang.instance.toggle(),
            child: Text(tr('EN', 'ع'),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
          ),
        ],
      ),
      drawer: const AppDrawer(),
      body: RefreshIndicator(
        onRefresh: _loadStats,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── الكارد الترحيبي: تدرج ليلي بلمسة برتقالي + زخارف دوائر ──
            FadeSlideIn(child: _HeroCard(auth: auth, greeting: _greeting(), today: _todayLabel())),
            const SizedBox(height: 16),

            // ── نظرة القسم الحية (مخصّصة حسب الدور) ──
            if (_insight != null) ...[
              FadeSlideIn(
                delayMs: 60,
                child: Row(children: [
                  Text(insightTitle(_insight!), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: T.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                    child: Row(children: [
                      Container(width: 6, height: 6, decoration: const BoxDecoration(color: T.success, shape: BoxShape.circle)),
                      const SizedBox(width: 5),
                      Text(tr('مباشر', 'Live'), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: T.success)),
                    ]),
                  ),
                ]),
              ),
              const SizedBox(height: 10),
              if (_insightLoading)
                const Row(children: [Expanded(child: Shimmer(height: 78)), SizedBox(width: 10), Expanded(child: Shimmer(height: 78))])
              else
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: 1.75,
                  children: _insight!.kpis.asMap().entries.map((e) {
                    final k = e.value;
                    return FadeSlideIn(
                      delayMs: 80 + e.key * 45,
                      child: AppCard(
                        topAccent: k.color,
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                          Row(children: [
                            Icon(k.icon, size: 16, color: k.color),
                            const SizedBox(width: 6),
                            Expanded(child: Text(tr(k.ar, k.en), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
                          ]),
                          const SizedBox(height: 6),
                          Text(_fmt(_dig(k.path), k.money), style: TextStyle(fontSize: k.money ? 15 : 20, fontWeight: FontWeight.w900, color: T.ink)),
                        ]),
                      ),
                    );
                  }).toList(),
                ),
              const SizedBox(height: 20),
            ],

            // ── مؤشراتي الشخصية ──
            if (_statsLoading)
              const Row(children: [
                Expanded(child: Shimmer(height: 92)), SizedBox(width: 10), Expanded(child: Shimmer(height: 92)),
              ])
            else
              Row(children: [
                if (_canSeeBoard(auth)) ...[
                  Expanded(child: FadeSlideIn(delayMs: 80, child: StatCard(label: tr('مهام مفتوحة', 'Open tasks'), value: _openTasks, color: T.violet, icon: Icons.view_kanban_outlined))),
                  const SizedBox(width: 10),
                ],
                Expanded(child: FadeSlideIn(delayMs: 140, child: StatCard(label: tr('رصيد إجازاتي', 'Leave balance'), value: _leaveAvailable, color: T.cyan, icon: Icons.beach_access_outlined))),
                const SizedBox(width: 10),
                Expanded(
                  child: FadeSlideIn(
                    delayMs: 200,
                    child: _hasTeam
                        ? StatCard(label: tr('موافقات منتظرة', 'Pending approvals'), value: _pendingApprovals, color: T.orange, icon: Icons.fact_check_outlined)
                        : StatCard(label: tr('طلباتي المعلقة', 'My pending'), value: _myLeaves, color: T.info, icon: Icons.hourglass_top_outlined),
                  ),
                ),
              ]),
            const SizedBox(height: 20),

            // Quick access — self service
            FadeSlideIn(
              delayMs: 240,
              child: Text(tr('الخدمة الذاتية', 'Self Service'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(height: 10),
            ...selfPages.asMap().entries.map((e) => FadeSlideIn(
                  delayMs: 280 + e.key * 60,
                  child: _NavTile(page: e.value, color: const [T.navy, T.cyan, T.success, T.orange][e.key % 4]),
                )),
            const SizedBox(height: 18),

            // Sections
            FadeSlideIn(
              delayMs: 380,
              child: Text(tr('الأقسام', 'Sections'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(height: 10),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.35,
              children: sections.asMap().entries.map((e) {
                final s = e.value;
                return FadeSlideIn(
                  delayMs: 420 + e.key * 45,
                  child: Pressable(
                    onTap: () => _openSection(context, s),
                    child: AppCard(
                      padding: const EdgeInsets.all(13),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: T.navy.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: Icon(s.icon, size: 21, color: T.navy),
                        ),
                        const Spacer(),
                        Text(s.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        Text(tr('${s.pages.length} صفحة', '${s.pages.length} pages'),
                            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ]),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _openSection(BuildContext context, AppSection s) {
    if (s.pages.length == 1) {
      Navigator.push(context, MaterialPageRoute(builder: s.pages.first.builder));
      return;
    }
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
            child: Row(children: [
              Icon(s.icon, color: T.navy),
              const SizedBox(width: 8),
              Text(s.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ]),
          ),
          ...s.pages.map((p) => ListTile(
                leading: Icon(p.icon, color: T.inkSoft),
                title: Text(p.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                trailing: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                onTap: () {
                  Navigator.pop(c);
                  Navigator.push(context, MaterialPageRoute(builder: p.builder));
                },
              )),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }
}

/// الكارد الترحيبي — تدرج من الكحلي الليلي إلى لمسة برتقالية، مع دوائر
/// زخرفية شفافة واسم اليوم والتاريخ.
class _HeroCard extends StatelessWidget {
  final AuthProvider auth;
  final String greeting;
  final String today;
  const _HeroCard({required this.auth, required this.greeting, required this.today});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [Color(0xFF0B2244), Color(0xFF16407A), Color(0xFF2B5EA7)],
        ),
        boxShadow: const [BoxShadow(color: Color(0x33122F5C), blurRadius: 22, offset: Offset(0, 10))],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(22),
        child: Stack(children: [
          // زخارف: دوائر شفافة + توهج برتقالي في الزاوية.
          Positioned(top: -46, left: -30, child: _circle(130, Colors.white.withValues(alpha: 0.05))),
          Positioned(bottom: -60, right: -20, child: _circle(150, T.orange.withValues(alpha: 0.14))),
          Positioned(top: 18, left: 26, child: _circle(14, T.orange.withValues(alpha: 0.55))),
          Positioned(bottom: 26, left: 70, child: _circle(8, Colors.white.withValues(alpha: 0.25))),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
                  ),
                  child: Text(today, style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w600)),
                ),
                const Spacer(),
                Container(
                  width: 46, height: 46,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [T.orange, Color(0xFFFF9A56)]),
                    borderRadius: BorderRadius.circular(15),
                    boxShadow: const [BoxShadow(color: Color(0x66F37121), blurRadius: 14, offset: Offset(0, 4))],
                  ),
                  child: Center(
                    child: Text(
                      auth.fullName.isNotEmpty ? auth.fullName.characters.first : '؟',
                      style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ]),
              const SizedBox(height: 16),
              Text('$greeting ✨', style: TextStyle(color: T.orange.withValues(alpha: 0.95), fontSize: 13.5, fontWeight: FontWeight.w700)),
              const SizedBox(height: 3),
              Text(auth.fullName, style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w800, height: 1.2)),
              const SizedBox(height: 4),
              Text(
                tr('يومك منظم من هنا — مهامك وطلباتك وأقسامك في مكان واحد.', 'Your day, organised — tasks, requests and sections in one place.'),
                style: TextStyle(color: Colors.white.withValues(alpha: 0.65), fontSize: 12.5),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _circle(double size, Color color) =>
      Container(width: size, height: size, decoration: BoxDecoration(shape: BoxShape.circle, color: color));
}

class _NavTile extends StatelessWidget {
  final AppPage page;
  final Color color;
  const _NavTile({required this.page, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: page.builder)),
        child: AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.11), borderRadius: BorderRadius.circular(12)),
              child: Icon(page.icon, size: 20, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(page.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
            Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
          ]),
        ),
      ),
    );
  }
}
