/**
 * فتحُ ملفّ PDF من الخادم أو طباعتُه مباشرةً — بلا أن يحجبه المتصفّح.
 *
 * ── لماذا ملفٌّ مستقلّ ──────────────────────────────────────────────────────
 * `window.open` بعد `await` يُحجَب: المتصفّحُ لا يعدّه استجابةً لضغطة، فيضيع
 * الملفُّ بلا أثرٍ عند كثيرين. فالنافذةُ تُفتح **لحظةَ الضغطة** فارغةً، ثمّ
 * يُكتب فيها الملفُّ حين يصل. وإن حُجبت مع ذلك نزل الملفُّ تنزيلًا.
 *
 * ── والطباعةُ بلا خطوةٍ وسطى ────────────────────────────────────────────────
 * من فتح الـPDF في لسانٍ جديدٍ لم يجد زرَّ الطابعة عنده (عارضُ الملفّات يُخفيه
 * أحيانًا، وعلى الهاتف ليس فيه). فزرُّ «طباعة» يحمّل الملفَّ نفسَه في إطارٍ
 * مخفيّ ويفتح حوارَ الطابعة عليه مباشرةً. والهواتفُ لا تطبع إطارًا فيه PDF،
 * فيُفتح لها الملفُّ في لسانٍ وطباعتُه من زرّ المشاركة فيه.
 */

const isMobile = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** نافذةٌ فارغةٌ تُفتح الآن — قبل أيّ انتظار — فلا يحجبها المتصفّح. */
function preopen(ar: boolean): Window | null {
  const w = window.open('', '_blank');
  if (w) {
    try {
      w.document.write(`<p style="font-family:Tahoma,sans-serif;padding:24px;color:#475569">${ar ? 'جارٍ إعداد الملف…' : 'Preparing the file…'}</p>`);
    } catch { /* نافذةٌ لا تقبل الكتابة — لا بأس */ }
  }
  return w;
}

/**
 * يفتح الملفَّ في لسانٍ جديد (أو ينزّله إن حُجب اللسان).
 * يُستدعى **مباشرةً من الضغطة** بالوعد نفسِه، لا بعد انتظاره.
 */
export async function openPdf(load: Promise<Blob>, fileName: string, ar: boolean) {
  const w = preopen(ar);
  try {
    const blob = await load;
    const url = URL.createObjectURL(blob);
    if (w && !w.closed) w.location.href = url;
    else download(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (e) {
    if (w && !w.closed) w.close();
    throw e;
  }
}

let frame: HTMLIFrameElement | null = null;

/** يفتح حوارَ الطابعة على الملفّ مباشرةً — وعلى الهاتف يفتح الملفّ للطباعة منه. */
export async function printPdf(load: Promise<Blob>, fileName: string, ar: boolean) {
  if (isMobile()) return openPdf(load, fileName, ar);

  const blob = await load;
  const url = URL.createObjectURL(blob);
  if (frame) { frame.remove(); frame = null; }
  const f = document.createElement('iframe');
  // مرسومٌ لا مخفيّ: عارضُ الـPDF في كروم لا يُحمَّل في إطارٍ `display:none`،
  // فلا يُطبع شيء. فإطارٌ بحجم صفرٍ في الركن.
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  f.src = url;
  frame = f;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } catch {
      // متصفّحٌ يرفض طباعةَ الإطار: يُفتح الملفّ نفسُه، والطباعةُ من عارضه.
      window.open(url, '_blank') || download(url, fileName);
    }
  };
  // عارضُ الـPDF يُكمل رسمَه بعد `load` بقليل؛ طباعتُه قبل ذلك تُخرج صفحةً بيضاء.
  f.onload = () => setTimeout(go, 300);
  document.body.appendChild(f);
  setTimeout(() => { URL.revokeObjectURL(url); if (frame === f) { f.remove(); frame = null; } }, 10 * 60 * 1000);
}
