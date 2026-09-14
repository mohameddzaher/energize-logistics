/**
 * journeyPlan — قراءةُ ورقة JP: «مَن يزور مَن في أيّ يوم، وماذا حدث».
 *
 * ── شكلُ الورقة ─────────────────────────────────────────────────────────────
 * الورقةُ مصفوفةٌ لا جدول: الصفُّ عميل، والأعمدةُ بعد الثاني عشر كتلٌ من خمسة
 * أعمدةٍ لكلّ يوم — `Plan · Request · Status · Collected · action`. وتاريخُ
 * الكتلة مكتوبٌ فوقها في الصفّ الرابع، واسمُ اليوم في الخامس.
 *
 *      … Region │ Plan Request Status Collected action │ Plan2 Request3 …
 *                     ↑ 2026-09-01                        ↑ 2026-09-02
 *
 * فتُقرأ كما تُقرأ بالعين: لكلّ عميلٍ لكلّ يومٍ خانةٌ واحدة، وما فيه شيءٌ منها
 * مهمّةٌ وقعت أو خُطِّط لها.
 *
 * ── ولماذا ملفٌّ على حدة ────────────────────────────────────────────────────
 * كان استيرادُ الدفتر يعُدّ صفوفَ JP ويطبع عددَها ثمّ لا يكتبها، وهو يمسح
 * `CollectionTask` قبل ذلك. فكلُّ إعادةِ استيرادٍ كانت تمحو تاريخَ الزيارات ولا
 * تُعيده: اثنتان وخمسون مهمّةً ذهبت، وإحدى وثمانون في الملفّ الجديد لم تدخل.
 * فصارت القراءةُ هنا، يستعملها الاستيرادُ الكامل والسكربتُ المفرد جميعًا.
 *
 * والتواريخُ أرقامٌ تسلسليّةٌ تُقرأ بحسابٍ صريحٍ لا بـ`cellDates` — راجع ذاكرةَ
 * «XLSX date epoch»: قراءتُها كتواريخَ تُنقص يومًا على هذا الجهاز.
 */
const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => (typeof v === 'number' ? v : (parseFloat(String(v || '').replace(/,/g, '')) || 0));

/** رقمٌ تسلسليٌّ من إكسل → `YYYY-MM-DD`. وما خرج عن المدى المعقول ليس تاريخًا. */
function serialToISO(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 20000 || v > 80000) return '';
  return new Date(XLS_EPOCH + Math.round(v) * 86400000).toISOString().slice(0, 10);
}

const FIRST_DAY_COL = 12;   // أوّلُ عمودٍ بعد بيانات العميل
const BLOCK = 5;            // Plan · Request · Status · Collected · action
const HEADER_ROW = 6;
const DATE_ROW = 4;

/**
 * @returns {{ tasks: Array, days: string[], rows: number, skipped: number }}
 *   tasks: صفٌّ لكلّ (عميل × يوم) فيه شيء.
 */
function parseJourneyPlan(sheetRows) {
  const dateRow = sheetRows[DATE_ROW] || [];
  const width = sheetRows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);

  const blocks = [];
  for (let c = FIRST_DAY_COL; c + BLOCK - 1 < width + BLOCK; c += BLOCK) {
    const iso = serialToISO(dateRow[c]);
    if (iso) blocks.push({ c, date: iso });
  }

  const tasks = [];
  let rows = 0; let skipped = 0;
  for (let i = HEADER_ROW + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (!r) continue;
    const code = S(r[0]);
    // صفُّ مجاميعَ أو صفٌّ فارغ — لا عميلَ فيه.
    if (!code || !/^[\dC]/i.test(code)) { if (r.some((v) => v != null && S(v) !== '')) skipped += 1; continue; }
    rows += 1;
    const partyName = S(r[1]);
    const officerName = S(r[3]);
    for (const b of blocks) {
      const planned = S(r[b.c]);
      const requestType = S(r[b.c + 1]);
      const status = S(r[b.c + 2]);
      const collected = N(r[b.c + 3]);
      const action = S(r[b.c + 4]);
      if (!planned && !requestType && !status && !collected && !action) continue;
      tasks.push({
        partyCode: code,
        partyName,
        officerName,
        date: b.date,
        requestType,
        // «x» في الورقة تعني أنّها كانت في الخطّة. وما كُتب له إجراءٌ أو تحصيلٌ
        // بلا «x» فقد وقع خارجَها — يُسجَّل ولا يُدّعى أنّه كان مخطَّطًا.
        planned: /^x$/i.test(planned),
        status,
        collected,
        action,
      });
    }
  }
  return { tasks, days: blocks.map((b) => b.date), rows, skipped };
}

module.exports = { parseJourneyPlan, serialToISO };
