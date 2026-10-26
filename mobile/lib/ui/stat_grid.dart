import 'package:flutter/material.dart';

/// A grid of KPI tiles whose rows grow with their content.
///
/// GridView forces a fixed tile height (aspect ratio), so a long label, a
/// narrow phone or a larger system text size overflows the tile. Here every
/// row is as tall as its tallest tile, tiles in a row share that height, and
/// the column count follows the available width (2 on phones, more on iPad).
class StatGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;
  final double minTileWidth;
  final int minColumns;
  final int maxColumns;
  const StatGrid({
    super.key,
    required this.children,
    this.spacing = 10,
    this.minTileWidth = 150,
    this.minColumns = 2,
    this.maxColumns = 4,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final w = c.maxWidth;
      var cols = ((w + spacing) / (minTileWidth + spacing)).floor();
      cols = cols.clamp(minColumns, maxColumns);
      if (cols > children.length && children.isNotEmpty) cols = children.length;
      final rows = <Widget>[];
      for (var i = 0; i < children.length; i += cols) {
        final cells = <Widget>[];
        for (var j = 0; j < cols; j++) {
          if (j > 0) cells.add(SizedBox(width: spacing));
          final k = i + j;
          cells.add(Expanded(child: k < children.length ? children[k] : const SizedBox.shrink()));
        }
        if (rows.isNotEmpty) rows.add(SizedBox(height: spacing));
        rows.add(IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: cells),
        ));
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: rows);
    });
  }
}
