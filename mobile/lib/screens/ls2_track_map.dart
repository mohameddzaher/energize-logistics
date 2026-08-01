import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مسار المركبة على الخريطة — يرسم نقاط GPS (polyline) ليوم مختار على خريطة
/// OpenStreetMap المجانية. /api/ls2/vehicles/:unitId/track?from&to
class Ls2TrackMapScreen extends StatefulWidget {
  final int vehicleId; // unitId
  final String plate;
  const Ls2TrackMapScreen({super.key, required this.vehicleId, required this.plate});
  @override
  State<Ls2TrackMapScreen> createState() => _Ls2TrackMapScreenState();
}

class _Ls2TrackMapScreenState extends State<Ls2TrackMapScreen> {
  final _map = MapController();
  List<LatLng> _pts = [];
  int _count = 0;
  bool _loading = true;
  String? _error;
  DateTime _day = DateTime.now();

  @override
  void initState() { super.initState(); _load(); }

  String _fmt(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final ds = _fmt(_day);
      final d = await Api.instance.get('/api/ls2/vehicles/${widget.vehicleId}/track?from=$ds&to=$ds');
      final raw = List<Map<String, dynamic>>.from((d['points'] ?? []) as List);
      final pts = raw
          .where((p) => p['lat'] != null && p['lng'] != null)
          .map((p) => LatLng((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()))
          .toList();
      if (!mounted) return;
      setState(() { _pts = pts; _count = (d['count'] ?? pts.length) as int; _loading = false; });
      if (pts.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          try {
            _map.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(40)));
          } catch (_) {}
        });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _pickDay() async {
    final d = await showDatePicker(context: context, initialDate: _day, firstDate: DateTime(2022), lastDate: DateTime.now());
    if (d != null) { setState(() => _day = d); _load(); }
  }

  @override
  Widget build(BuildContext context) {
    final center = _pts.isNotEmpty ? _pts.first : const LatLng(24.7136, 46.6753); // الرياض افتراضيًا
    return AppScaffold(
      title: Text('${tr('مسار', 'Track')} ${widget.plate}'),
      actions: [
        IconButton(icon: const Icon(Icons.calendar_month_outlined), tooltip: tr('اختر اليوم', 'Pick day'), onPressed: _pickDay),
      ],
      body: Column(children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          color: T.navy.withValues(alpha: 0.05),
          child: Row(children: [
            const Icon(Icons.event, size: 15, color: T.navy),
            const SizedBox(width: 6),
            Text(_fmt(_day), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
            const Spacer(),
            if (!_loading && _error == null)
              Text('$_count ${tr('نقطة', 'points')}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          ]),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : Stack(children: [
                      FlutterMap(
                        mapController: _map,
                        options: MapOptions(initialCenter: center, initialZoom: 11),
                        children: [
                          TileLayer(
                            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName: 'com.energize.energizeMobile',
                          ),
                          if (_pts.length >= 2)
                            PolylineLayer(polylines: [
                              Polyline(points: _pts, strokeWidth: 4, color: T.navy),
                            ]),
                          MarkerLayer(markers: [
                            if (_pts.isNotEmpty)
                              Marker(point: _pts.first, width: 30, height: 30,
                                  child: const Icon(Icons.trip_origin, color: T.success, size: 22)),
                            if (_pts.length >= 2)
                              Marker(point: _pts.last, width: 34, height: 34,
                                  child: const Icon(Icons.location_on, color: T.danger, size: 30)),
                          ]),
                        ],
                      ),
                      if (_pts.isEmpty)
                        Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)]),
                            child: Text(tr('لا توجد نقاط GPS في هذا اليوم', 'No GPS points for this day'), style: const TextStyle(fontWeight: FontWeight.w600)),
                          ),
                        ),
                    ]),
        ),
      ]),
    );
  }
}
