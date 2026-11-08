/** Where a tire sitting on no truck and no trailer went last, from its recorded move. */
export function lastSeenText(s: any, ar: boolean): string {
  if (!s) return ar ? 'مركّبة بدون عربية ولا تيدر — لا توجد حركة مسجّلة' : 'Mounted on no vehicle or trailer — no recorded move';
  const day = s.date ? String(s.date).slice(0, 10) : '';
  if (s.trailerNumber) {
    const from = s.fromPlate ? (ar ? ` من ${s.fromPlate}` : ` from ${s.fromPlate}`) : '';
    const now = s.trailerOnPlate ? (ar ? ` — والتيدر الآن على ${s.trailerOnPlate}` : ` — the trailer is now on ${s.trailerOnPlate}`) : (ar ? ' — والتيدر واقف' : ' — the trailer is parked');
    return ar ? `آخر حركة: نزلت${from} مع تيدر ${s.trailerNumber} يوم ${day}${now}` : `Last move: left${from} with trailer ${s.trailerNumber} on ${day}${now}`;
  }
  return ar ? `آخر حركة: ${s.fromPlate ? `نزلت من ${s.fromPlate} ` : ''}يوم ${day}` : `Last move: ${s.fromPlate ? `left ${s.fromPlate} ` : ''}on ${day}`;
}
