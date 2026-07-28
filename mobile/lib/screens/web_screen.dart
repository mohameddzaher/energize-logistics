import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// Embedded browser for system pages that don't have a native screen yet —
/// EVERYTHING opens inside the app. First open asks for a sign-in once; the
/// web session then persists in the app's cookie store (same 7-day refresh
/// the browser gets).
class WebScreen extends StatefulWidget {
  final String title;
  final String path; // e.g. /system/hr/dashboard
  const WebScreen({super.key, required this.title, required this.path});

  @override
  State<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends State<WebScreen> {
  late final WebViewController _controller;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(T.canvas)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) { if (mounted) setState(() => _progress = p); },
      ))
      ..loadRequest(Uri.parse('https://energize-logistics.com${widget.path}'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: tr('تحديث', 'Reload'),
            onPressed: () => _controller.reload(),
          ),
        ],
        bottom: _progress < 100
            ? PreferredSize(
                preferredSize: const Size.fromHeight(3),
                child: LinearProgressIndicator(
                  value: _progress / 100,
                  minHeight: 3,
                  backgroundColor: Colors.white24,
                  valueColor: const AlwaysStoppedAnimation(T.orange),
                ),
              )
            : null,
      ),
      body: WebViewWidget(controller: _controller),
    );
  }
}
