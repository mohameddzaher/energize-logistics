'use client';
/**
 * Work-plan (JP) tasks linked to a transaction or party, read and added on its page.
 * Uses the shared JpTaskPanel, which adds a task in a window over the page, same as other sections.
 */
import JpTaskPanel from '@/components/jp/JpTaskPanel';

export default function ClearanceTasks({ kind, refId, ar }: { kind: 'clearance' | 'customer' | 'agent' | 'carrier'; refId: string; ar: boolean }) {
  return <JpTaskPanel section="customs" kind={kind} refId={refId} ar={ar} />;
}
