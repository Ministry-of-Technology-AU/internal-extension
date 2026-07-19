export type SourceId = 'catalog' | 'prereqs' | 'timings';

export const SOURCE_IDS: SourceId[] = ['catalog', 'prereqs', 'timings'];

export const SOURCE_LABELS: Record<SourceId, string> = {
  catalog: 'Course catalog',
  prereqs: 'Prerequisites',
  timings: 'Timings',
};

export type SourceStatus =
  | 'idle'
  | 'opening'    // tab created, waiting for load
  | 'preparing'  // selecting semester / waiting for the page's table
  | 'scraping'   // pulling records
  | 'done'
  | 'failed'
  | 'cancelled';

export interface SourceState {
  id: SourceId;
  status: SourceStatus;
  /** Human-readable current step, shown under the progress bar. */
  message: string;
  /** Populated once the source knows how much work it has. */
  done: number;
  total: number;
  /** Records produced. Only set on success. */
  count?: number;
  error?: string;
  tabId?: number;
  startedAt?: number;
  finishedAt?: number;
}

export type RunStatus = 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export interface SyncRun {
  runId: string;
  scheduleId: string;
  semesterLabel: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  sources: Record<SourceId, SourceState>;
}

/** Result payloads, stored separately from run state because they are large. */
export interface SyncResults {
  runId: string;
  scheduleId: string;
  semesterLabel: string;
  catalog?: unknown[];
  prereqs?: unknown[];
  timings?: unknown[];
}

// ---------------------------------------------------------------- messages

export type PopupMessage =
  | { type: 'sync:start'; scheduleId: string }
  | { type: 'sync:cancel' }
  | { type: 'sync:retry'; source: SourceId }
  | { type: 'sync:getState' };

/** Emitted by injected scrapers via window.postMessage, relayed by the content script. */
export interface ScraperProgress {
  __amsSync: true;
  runId: string;
  source: SourceId;
  status?: SourceStatus;
  message?: string;
  done?: number;
  total?: number;
}

export type BackgroundMessage =
  | { type: 'sync:state'; run: SyncRun | null }
  | { type: 'sync:progress'; progress: ScraperProgress }
  | { type: 'sync:heartbeat' };

export const RUN_KEY = 'sync:run';
export const RESULTS_KEY = 'sync:results';
