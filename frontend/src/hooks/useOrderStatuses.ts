'use client';
/**
 * حالاتُ الشحنة كما هي مضبوطةٌ الآن — تقرؤها كلُّ شاشةٍ في القسم.
 *
 * التسميةُ واللونُ والترتيبُ ومَن مُستعمَلٌ منها تُضبط من إعدادات القسم، فلا
 * تُكتب في شاشةٍ ثمّ تُنسى في أخرى. والمفاتيحُ نفسُها في الشيفرة — راجع
 * `backend/src/utils/shipmentOrderStatuses`.
 *
 * وتبدأ من القائمة المكتوبة لا من فراغ: الشاشةُ تُرسَم كاملةً من أوّل إطار،
 * ثمّ يصحّحها الخادمُ إن كانت تسميةٌ قد غُيّرت.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { FALLBACK_STATUS_VOCAB, type StatusVocab } from '@/lib/shipmentOrders';

export function useOrderStatuses(includeInactive = false) {
  const [statuses, setStatuses] = useState<StatusVocab[]>(FALLBACK_STATUS_VOCAB);

  const load = useCallback(() => {
    api.get<{ statuses: StatusVocab[] }>(`/api/shipment-orders/statuses${includeInactive ? '?all=1' : ''}`)
      .then((d) => { if (d?.statuses?.length) setStatuses(d.statuses); })
      .catch(() => {});
  }, [includeInactive]);

  useEffect(() => { load(); }, [load]);
  // تُعدَّل من صفحة الإعدادات، فتصل هنا في اللحظة نفسِها بلا إعادة تحميل.
  useSocket('lookup:changed', useCallback((p: any) => {
    if (!p?.type || p.type === 'so_status') load();
  }, [load]));

  return statuses;
}
