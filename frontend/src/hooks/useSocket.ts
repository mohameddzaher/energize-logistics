'use client';
import { useEffect, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/context/AuthContext';

/**
 * ── وأخبارُ التحديث لا تُعالَج والشاشةُ مطفأة ──────────────────────────────
 *
 * أخبارُ «تغيَّر شيءٌ فأعِد القراءة» تصل كلَّ ثوانٍ (مزامنةُ منصّة التشغيل).
 * والتبويبُ في الخلف أو الهاتفُ في الجيب كان يجلب الحمولةَ مع كلّ خبر: بياناتٌ
 * وبطّاريّةٌ تُستهلك في صفحةٍ لا يراها أحد. فتُؤجَّل: يُعلَّم أنّ ثَمّ تغييرًا،
 * ويُنفَّذ مرّةً واحدةً حين تعود الشاشة.
 *
 * وما ليس تحديثَ صفحةٍ — إشعارٌ أو رسالةُ محادثة — يمرّ كما هو: تلك أخبارٌ
 * يريدها المستخدم حتّى وهو في تبويبٍ آخر.
 */
const DEFERRABLE = /(:changed|:updated|:created|:deleted|:bulkImported|^workflow:|^ops:|^vreg:|^ls2:|^fleet:|^customs:|^collections:|^b2c:|^hr:|^finance:|^executive:)/;

export function useSocket(event: string, callback: (data: any) => void) {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const socket = getSocket();
    const deferrable = DEFERRABLE.test(event);
    let pending: any = null;

    const run = (data: any) => callback(data);
    const handler = (data: any) => {
      if (deferrable && typeof document !== 'undefined' && document.hidden) { pending = data ?? {}; return; }
      run(data);
    };
    const onVisible = () => {
      if (typeof document === 'undefined' || document.hidden || pending === null) return;
      const data = pending;
      pending = null;
      run(data);
    };

    socket.on(event, handler);
    if (deferrable && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    return () => {
      socket.off(event, handler);
      if (deferrable && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [event, callback, isAuthenticated]);
}

export function useRealTimeRefresh(events: string[], refetchFn: () => void) {
  const stableRefetch = useCallback(refetchFn, [refetchFn]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) return;

    events.forEach((event) => {
      socket.on(event, stableRefetch);
    });

    return () => {
      events.forEach((event) => {
        socket.off(event, stableRefetch);
      });
    };
  }, [events, stableRefetch]);
}
