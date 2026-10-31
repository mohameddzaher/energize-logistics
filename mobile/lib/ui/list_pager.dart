import 'package:flutter/material.dart';
import '../services/lang.dart';
import 'theme.dart';

const listPageSizes = [50, 100, 150, 200, 500];

/// Pagination bar above a server-paged list. Mirrors web TablePager; `compact` is the
/// prev/next pair kept under a long list.
class ListPager extends StatelessWidget {
  final int page, pages, pageSize, total;
  final ValueChanged<int> onPage;
  final ValueChanged<int>? onPageSize;
  final bool compact;
  const ListPager({super.key, required this.page, required this.pages, required this.pageSize, required this.total,
      required this.onPage, this.onPageSize, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final from = total == 0 ? 0 : (page - 1) * pageSize + 1;
    final to = (page * pageSize).clamp(0, total);
    final nav = Row(mainAxisSize: MainAxisSize.min, children: [
      IconButton(visualDensity: VisualDensity.compact, onPressed: page > 1 ? () => onPage(page - 1) : null,
          icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
      Text('$page / $pages', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
      IconButton(visualDensity: VisualDensity.compact, onPressed: page < pages ? () => onPage(page + 1) : null,
          icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
    ]);
    if (compact) return Align(alignment: AlignmentDirectional.centerEnd, child: nav);
    return Row(children: [
      Expanded(child: Text(tr('عرض $from-$to من $total', 'Showing $from-$to of $total'), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
      if (onPageSize != null)
        PopupMenuButton<int>(
          tooltip: tr('عدد الصفوف', 'Rows per page'),
          initialValue: pageSize,
          onSelected: onPageSize,
          itemBuilder: (_) => [for (final n in listPageSizes) PopupMenuItem(value: n, child: Text('$n'))],
          child: Padding(padding: const EdgeInsets.all(6), child: Text('${tr('عدد الصفوف', 'Rows')}: $pageSize ▾', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))),
        ),
      nav,
    ]);
  }
}
