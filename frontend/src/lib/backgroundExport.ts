import api from '@/lib/api';

/**
 * Large exports: requested, then waited on until ready.
 * The full statements export is large and takes about half a minute to build. Holding the request open froze the page, and a closed tab or network blip lost the work. Now the server registers the request and replies at once, builds it there, and the client polls every 2 seconds and downloads when ready. If the page is closed the file stays for a day and the owner gets a notification with its link.
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
  // Leave the browser enough time to start the save before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/** Starts the export and follows it. onQueued is called as soon as it is registered and onReady when it is ready. Polling stops after ten minutes; the notification remains. */
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
    } catch { /* Transient failure: ask again. */ }
    setTimeout(tick, 2500);
  };
  setTimeout(tick, 2500);
}
