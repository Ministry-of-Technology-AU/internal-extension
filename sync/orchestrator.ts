import {
  RESULTS_KEY,
  RUN_KEY,
  SOURCE_IDS,
  type RunStatus,
  type ScraperProgress,
  type SourceId,
  type SourceState,
  type SyncResults,
  type SyncRun,
} from './types';
import { scrapeCatalog, scrapePrereqs, scrapeTimings, type ScrapeArgs, type ScrapeResult } from './scrapers';
import { semesterById } from './semesters';

const PAGES: Record<SourceId, string> = {
  catalog: 'https://ams.ashoka.edu.in/Contents/ContentManagement/ViewCourseCatalogue.aspx',
  prereqs: 'https://ams.ashoka.edu.in/Contents/CourseManagement/CoursePreRequisites_View.aspx',
  timings: 'https://ams.ashoka.edu.in/Contents/TimeTable/TimeTablePreferenceView.aspx',
};

const SCRAPERS: Record<SourceId, (args: ScrapeArgs) => Promise<ScrapeResult>> = {
  catalog: scrapeCatalog,
  prereqs: scrapePrereqs,
  timings: scrapeTimings,
};

const TAB_LOAD_TIMEOUT_MS = 45_000;
const SCRAPE_TIMEOUT_MS = 15 * 60_000;

/**
 * In-memory run state. Mirrored to storage.session on every mutation so a
 * service-worker restart mid-scrape does not lose the UI's view of progress.
 * (The scrape itself does not survive a restart — see cancel-on-orphan below.)
 */
let run: SyncRun | null = null;
let cancelled = false;
const warningsBySource: Partial<Record<SourceId, string[]>> = {};

const freshSource = (id: SourceId): SourceState => ({
  id,
  status: 'idle',
  message: 'Waiting…',
  done: 0,
  total: 0,
});

export function getRun(): SyncRun | null {
  return run;
}

async function persist() {
  await browser.storage.session.set({ [RUN_KEY]: run });
  // The popup is usually closed; a missing receiver is expected, not an error.
  browser.runtime.sendMessage({ type: 'sync:state', run }).catch(() => {});
}

export async function restore() {
  const stored = await browser.storage.session.get(RUN_KEY);
  const prev = stored[RUN_KEY] as SyncRun | undefined;
  if (!prev) return;
  if (prev.status === 'running') {
    // The worker restarted while a scrape was in flight. Injected scripts are
    // gone with it, so the run cannot be resumed — mark it plainly rather than
    // leaving a progress bar that will never move.
    for (const id of SOURCE_IDS) {
      const s = prev.sources[id];
      if (s.status !== 'done' && s.status !== 'failed') {
        s.status = 'failed';
        s.error = 'Interrupted — the extension was restarted mid-sync';
      }
    }
    prev.status = 'failed';
    prev.finishedAt = Date.now();
  }
  run = prev;
  await persist();
}

function update(id: SourceId, patch: Partial<SourceState>) {
  if (!run) return;
  Object.assign(run.sources[id], patch);
  void persist();
}

const lastLogged: Partial<Record<SourceId, number>> = {};

/** Relayed from the content script; the scrapers post these as they work. */
export function applyProgress(p: ScraperProgress) {
  if (!run || p.runId !== run.runId) return;

  const currentStatus = run.sources[p.source].status;
  if (currentStatus === 'done' || currentStatus === 'failed' || currentStatus === 'cancelled') {
    return; // Ignore late progress messages from content scripts
  }

  // One line per source per 5s — enough to see life in the worker console
  // without drowning it at one line per fetch.
  const now = Date.now();
  if (now - (lastLogged[p.source] ?? 0) > 5000) {
    lastLogged[p.source] = now;
    const s = run.sources[p.source];
    const done = p.done ?? s.done;
    const total = p.total ?? s.total;
    console.log(
      `[sync] ${p.source}: ${p.message || s.message}` + (total ? ` (${done}/${total})` : '')
    );
  }

  const patch: Partial<SourceState> = {};
  if (p.status) patch.status = p.status;
  if (p.message) patch.message = p.message;
  if (typeof p.done === 'number') patch.done = p.done;
  if (typeof p.total === 'number') patch.total = p.total;
  update(p.source, patch);
}

async function openTab(url: string): Promise<number> {
  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id!;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab did not finish loading in time'));
    }, TAB_LOAD_TIMEOUT_MS);

    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);

    // The tab may already be complete before the listener attached.
    browser.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  return tabId;
}

async function closeTab(tabId: number | undefined) {
  if (tabId == null) return;
  try {
    await browser.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
}

async function runSource(id: SourceId, args: ScrapeArgs): Promise<unknown[]> {
  update(id, { status: 'opening', message: 'Opening page…', startedAt: Date.now() });

  const tabId = await openTab(PAGES[id]);
  update(id, { tabId });
  if (cancelled) throw new Error('Cancelled');

  update(id, { status: 'preparing', message: 'Starting…' });

  const injection = browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: SCRAPERS[id],
    args: [args],
  } as any);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Scrape exceeded 15 minutes')), SCRAPE_TIMEOUT_MS)
  );

  const frames = (await Promise.race([injection, timeout])) as { result?: ScrapeResult }[];
  const result = frames?.[0]?.result;
  if (!result) throw new Error('Scraper returned nothing — was the page signed out?');

  if (result.warnings?.length) warningsBySource[id] = result.warnings;

  // Visible in the service worker console (chrome://extensions -> service worker).
  console.groupCollapsed(`[sync] ${id}: ${result.records.length} records`);
  console.log('sample', result.records.slice(0, 3));
  if (result.warnings?.length) console.warn('warnings', result.warnings);
  console.table(result.records.slice(0, 20));
  console.groupEnd();

  update(id, {
    status: 'done',
    message: result.records.length + ' records',
    count: result.records.length,
    done: result.records.length,
    total: result.records.length,
    finishedAt: Date.now(),
  });

  await closeTab(tabId);
  return result.records;
}

function summarise(): RunStatus {
  if (!run) return 'failed';
  const states = SOURCE_IDS.map((id) => run!.sources[id].status);
  if (cancelled) return 'cancelled';
  if (states.every((s) => s === 'done')) return 'done';
  if (states.every((s) => s === 'failed')) return 'failed';
  return 'partial';
}

async function storeResults(partial: Partial<SyncResults>) {
  if (!run) return;
  const existing = ((await browser.storage.local.get(RESULTS_KEY))[RESULTS_KEY] || {}) as SyncResults;
  const merged: SyncResults = {
    ...existing,
    ...partial,
    runId: run.runId,
    scheduleId: run.scheduleId,
    semesterLabel: run.semesterLabel,
  };
  await browser.storage.local.set({ [RESULTS_KEY]: merged });
}

export async function startSync(scheduleId: string) {
  if (run?.status === 'running') throw new Error('A sync is already running');

  const semester = semesterById(scheduleId);
  if (!semester) throw new Error('Unknown semester: ' + scheduleId);

  cancelled = false;
  for (const k of SOURCE_IDS) delete warningsBySource[k];

  run = {
    runId: String(Date.now()),
    scheduleId,
    semesterLabel: semester.label,
    status: 'running',
    startedAt: Date.now(),
    sources: {
      catalog: freshSource('catalog'),
      prereqs: freshSource('prereqs'),
      timings: freshSource('timings'),
    },
  };
  // Clear stale results from a previous run so the popup never shows partial
  // data from an old runId while the new one is still in flight.
  await browser.storage.local.remove(RESULTS_KEY);
  await persist();

  const args: ScrapeArgs = {
    runId: run.runId,
    scheduleId,
    term: semester.term,
    year: semester.year,
  };

  // All three run concurrently; one failing must not cancel the others, so each
  // is settled independently and its records stored as soon as it lands.
  const settled = await Promise.allSettled(
    SOURCE_IDS.map(async (id) => {
      try {
        const records = await runSource(id, args);
        await storeResults({ [id]: records });
        return records;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        update(id, {
          status: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? 'Cancelled' : 'Failed',
          error: message,
          finishedAt: Date.now(),
        });
        await closeTab(run?.sources[id].tabId);
        throw err;
      }
    })
  );

  run.status = summarise();
  run.finishedAt = Date.now();
  await persist();
  return settled;
}

export async function retrySource(id: SourceId) {
  if (!run) throw new Error('No run to retry');
  if (run.sources[id].status === 'scraping') throw new Error(id + ' is already running');

  const semester = semesterById(run.scheduleId);
  if (!semester) throw new Error('Unknown semester: ' + run.scheduleId);

  cancelled = false;
  run.status = 'running';
  run.finishedAt = undefined;
  run.sources[id] = freshSource(id);
  await persist();

  try {
    const records = await runSource(id, {
      runId: run.runId,
      scheduleId: run.scheduleId,
      term: semester.term,
      year: semester.year,
    });
    await storeResults({ [id]: records });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    update(id, { status: 'failed', message: 'Failed', error: message, finishedAt: Date.now() });
    await closeTab(run.sources[id].tabId);
  }

  run.status = summarise();
  run.finishedAt = Date.now();
  await persist();
}

export async function cancelSync() {
  if (!run || run.status !== 'running') return;
  cancelled = true;
  for (const id of SOURCE_IDS) {
    const s = run.sources[id];
    if (s.status !== 'done' && s.status !== 'failed') {
      await closeTab(s.tabId);
      Object.assign(s, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now() });
    }
  }
  run.status = 'cancelled';
  run.finishedAt = Date.now();
  await persist();
}

export function getWarnings() {
  return warningsBySource;
}
