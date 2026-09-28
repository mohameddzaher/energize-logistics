/**
 * طباعةُ ملفِّ PDF جاهزٍ على الطابعة المتّصلة بالجهاز — بلا تنزيلٍ ولا فتحِ ملفّ.
 *
 * ── ولماذا إطارٌ مخفيٌّ لا نافذةٌ جديدة ────────────────────────────────────
 * البوليصةُ تُرسَم في الخادم (Puppeteer) وتعود بايتاتٍ في `Blob`. والمستخدم
 * يريدها على الورق لا في مجلّد التنزيلات: فيُعطى الـBlob عنوانًا محلّيًّا
 * (`blob:` — من أصل الصفحة نفسِه، فلا مانعَ أصلٍ يمنع الطباعة)، ويُحمَّل في
 * إطارٍ لا يُرى، ويُنادى `print()` على نافذته فيفتح حوارُ الطابعة على الملفّ
 * وحدَه — لا على الصفحة ولا على قوائمها.
 *
 * ونافذةٌ جديدة (`window.open`) كانت أسهل، لكنّ حاجبَ النوافذ يحجبها بلا خبر
 * حين تُفتح بعد `await` — وكلُّ طباعةٍ هنا تلي رحلةً إلى الخادم.
 *
 * والإطارُ يبقى مركَّبًا حتى تُغلَق حوارُ الطباعة: نَزْعُه فورَ النداء يُلغي
 * الطبعةَ في بعض المتصفّحات لأنّ المصدرَ يزول تحت الحوار. فيُنزَع بعد مهلةٍ
 * واسعة، ويُبطَل العنوانُ معه كي لا تتراكم الملفّاتُ في الذاكرة.
 */
export function printPdfBlob(blob: Blob, { timeoutMs = 120000 }: { timeoutMs?: number } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let url = '';
    try { url = URL.createObjectURL(blob); } catch { resolve(false); return; }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    let settled = false;
    const cleanup = () => {
      setTimeout(() => {
        try { frame.remove(); } catch { /* نُزع سلفًا */ }
        try { URL.revokeObjectURL(url); } catch { /* أُبطل سلفًا */ }
      }, timeoutMs);
    };

    frame.onload = () => {
      if (settled) return;
      settled = true;
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        cleanup();
        resolve(true);
      } catch {
        // متصفّحٌ لا يطبع من إطار — يُفتح الملفُّ في تبويبٍ ليطبعه المستخدم.
        cleanup();
        try { window.open(url, '_blank'); resolve(true); } catch { resolve(false); }
      }
    };
    // لو لم يُطلَق `onload` أصلًا (قارئُ PDF معطَّل) لا يبقى النداءُ معلّقًا.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try { window.open(url, '_blank'); resolve(true); } catch { resolve(false); }
    }, 8000);

    frame.src = url;
    document.body.appendChild(frame);
  });
}
