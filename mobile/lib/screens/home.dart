import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/live.dart';
import 'tasks_board.dart';
import 'my_leaves.dart';
import 'my_requests.dart';
import 'approvals.dart';

/// The launcher: a role-aware grid — every user gets the self-service tiles,
/// the administration board appears only for whoever can open it on the web.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _hasTeam = false;

  static const _adminBoardRoles = {
    'super_admin', 'admin', 'administrator', 'bd_manager', 'it_manager', 'it_specialist',
  };

  @override
  void initState() {
    super.initState();
    Live.instance.connect();
    Api.instance.get('/api/hr/me/team').then((d) {
      if (mounted) setState(() => _hasTeam = d['hasTeam'] == true);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final showBoard = _adminBoardRoles.contains(auth.role) || auth.canAccessSection('Administration');

    final tiles = <_Tile>[
      if (showBoard)
        _Tile('لوحة المهام', 'الشؤون الإدارية', Icons.dashboard_customize_outlined,
            const Color(0xFF7C3AED), (c) => const TasksBoardScreen()),
      _Tile('إجازاتي', 'رصيدي وطلبات الإجازة', Icons.beach_access_outlined,
          const Color(0xFF0891B2), (c) => const MyLeavesScreen()),
      _Tile('طلباتي', 'طلبات وخطابات الموارد البشرية', Icons.description_outlined,
          const Color(0xFF059669), (c) => const MyRequestsScreen()),
      if (_hasTeam)
        _Tile('موافقات فريقي', 'طلبات الإجازة المنتظرة لقراري', Icons.fact_check_outlined,
            const Color(AppConfig.orange), (c) => const ApprovalsScreen()),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Energize Logistics'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'تسجيل الخروج',
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('تسجيل الخروج'),
                  content: const Text('هل تريد تسجيل الخروج من التطبيق؟'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
                    TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('خروج')),
                  ],
                ),
              );
              if (ok == true && context.mounted) {
                Live.instance.disconnect();
                await context.read<AuthProvider>().logout();
              }
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: const Color(AppConfig.navy),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: const Color(AppConfig.orange),
                  child: Text(
                    auth.fullName.isNotEmpty ? auth.fullName.characters.first : '؟',
                    style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('أهلًا، ${auth.fullName}',
                          style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
                      Text(auth.user?['email'] ?? '',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.65), fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.15,
            children: tiles.map((t) => _TileCard(tile: t)).toList(),
          ),
        ],
      ),
    );
  }
}

class _Tile {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final Widget Function(BuildContext) builder;
  _Tile(this.title, this.subtitle, this.icon, this.color, this.builder);
}

class _TileCard extends StatelessWidget {
  final _Tile tile;
  const _TileCard({required this.tile});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: tile.builder)),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: tile.color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(tile.icon, color: tile.color, size: 26),
            ),
            const Spacer(),
            Text(tile.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(tile.subtitle,
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                maxLines: 2, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }
}
