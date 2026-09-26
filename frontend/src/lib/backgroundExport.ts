import api from '@/lib/api';

/**
 * التصديرُ الكبير: يُطلَب ثمّ يُنتظر جاهزًا.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * «كلُّ الكشوف» ستّةٌ وثلاثون ألفَ صفٍّ واثنان وعشرون ميجابايت، وبناؤه نصفُ
 * دقيقة. وكان الطلبُ يبقى مفتوحًا طوالَها: صفحةٌ لا تستجيب، وإن أُغلقت أو
 * تعثّرت الشبكةُ ضاع العملُ وأُعيد من أوّله.
 *
 * فيُسجَّل الطلبُ في الخادم ويُردّ فورًا، ويُبنى هناك، ويُسأل عنه كلَّ ثانيتين.
 * فإذا جهز نُزِّل. وإن أُغلقت الصفحةُ بقي الملفُّ في مكانه يومًا كاملًا، ووصل
 * صاحبَه إشعارٌ فيه رابطُه — فلا ينتظر أحدٌ أمام شاشةٍ ولا يضيع عملٌ بُني.
 */
export interface ExportJob {
  _id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  rows: number;
  fileName: string;
  size: number;
  error?: string;
}

export const downloadExportJob = async (job: ExportJob) => {
  const blob = await api.getBlob(`/api/exports/jobs/${job._id}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = job.fileName || 'export.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  // يُترك للمتصفّح ما يكفي لبدء الحفظ قبل سحب العنوان من تحته.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/**
 * يبدأ التصديرَ ويتابعه. `onQueued` تُنادى فورَ التسجيل (لتقول «جارٍ التجهيز»)،
 * و`onReady` حين يجهز. والمتابعةُ تتوقّف بعد عشر دقائق — الإشعارُ يبقى.
 */
export async function startBackgroundExport(
  kind: string,
  query: Record<string, string> = {},
  handlers: { onQueued?: (job: ExportJob) => void; onReady?: (job: ExportJob) => void; onFailed?: (msg: string) => void } = {},
): Promise<void> {
  const { job } = await api.post<{ job: ExportJob }>('/api/exports/jobs', { kind, query });
  handlers.onQueued?.(job);

  const deadline = Date.now() + 10 * 60 * 1000;
  const tick = async () => {
    if (Date.now() > deadline) return;
    try {
      const { job: cur } = await api.get<{ job: ExportJob }>(`/api/exports/jobs/${job._id}`);
      if (cur.status === 'done') {
        handlers.onReady?.(cur);
        await downloadExportJob(cur);
        return;
      }
      if (cur.status === 'failed') { handlers.onFailed?.(cur.error || 'failed'); return; }
    } catch { /* انقطاعٌ عابر: يُسأل مرّةً أخرى */ }
    setTimeout(tick, 2500);
  };
  setTimeout(tick, 2500);
}
