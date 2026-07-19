import { RESULTS_KEY, type SourceId, type SyncResults } from './types';

/** Filenames match what merge-format.js already reads, so downloads drop in as-is. */
export const RESULT_FILENAMES: Record<SourceId, string> = {
  catalog: 'descriptions.json',
  prereqs: 'prerequisites.json',
  timings: 'timings.json',
};

/** What the merge step produces — same name the Node pipeline wrote. */
export const FINAL_FILENAME = 'final-file1.json';

export async function readResults(): Promise<SyncResults | null> {
  const stored = await browser.storage.local.get(RESULTS_KEY);
  return (stored[RESULTS_KEY] as SyncResults) ?? null;
}

export async function clearResults() {
  await browser.storage.local.remove(RESULTS_KEY);
}

/** Triggers a browser download from the popup — no downloads permission needed. */
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
