import { useEffect, useState } from 'react';
import { DEFAULT_SEMESTER_ID, SEMESTERS } from '@/sync/semesters';
import { downloadJson, readResults, FINAL_FILENAME, RESULT_FILENAMES } from '@/sync/results';
import { mergeResults } from '@/sync/merge';
import { SOURCE_IDS, SOURCE_LABELS, type SourceId, type SourceState, type SyncResults } from '@/sync/types';
import { useSyncRun } from './useSyncRun';
import { fetchStrapiData, updateStrapiData } from '@/utils/strapi';
import * as diff from 'diff';

const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const STATUS_TEXT: Record<SourceState['status'], string> = {
  idle: 'Waiting',
  opening: 'Opening',
  preparing: 'Preparing',
  scraping: 'Scraping',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function SourceRow({
  state,
  onRetry,
  busy,
}: {
  state: SourceState;
  onRetry: () => void;
  busy: boolean;
}) {
  const { status, total, done } = state;
  const active = status === 'opening' || status === 'preparing' || status === 'scraping';
  // Before a scraper knows its workload there is nothing honest to show as a
  // percentage, so it gets an indeterminate bar instead of a fake one.
  const indeterminate = active && total === 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className={`source-row source-row--${status}`}>
      <div className="source-row__head">
        <span className="source-row__name">{SOURCE_LABELS[state.id]}</span>
        <span className="source-row__status">
          {active && <span className="spinner" aria-hidden="true" />}
          {STATUS_TEXT[status]}
        </span>
      </div>

      <div className={`bar ${indeterminate ? 'bar--indeterminate' : ''}`}>
        <div className="bar__fill" style={{ width: indeterminate ? '100%' : `${pct}%` }} />
      </div>

      <div className="source-row__foot">
        <span className="source-row__msg" title={state.error || state.message}>
          {state.error || state.message}
          {total > 0 && active ? ` — ${done}/${total}` : ''}
        </span>
        {(status === 'failed' || status === 'cancelled') && (
          <button className="link-btn" onClick={onRetry} disabled={busy}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function ResultsPanel({ results }: { results: SyncResults }) {
  const present = SOURCE_IDS.filter((id) => Array.isArray(results[id]));
  const [raw, setRaw] = useState(false);
  const [diffStats, setDiffStats] = useState<{ added: number; removed: number } | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  if (!present.length) return null;

  // The catalog is the spine of the merge — without it there is no course list
  // to hang timings and prerequisites off, so merging is meaningless.
  const canMerge = Array.isArray(results.catalog);
  const merged = canMerge ? mergeResults(results) : null;

  const compareWithStrapi = async () => {
    if (!merged) return;
    try {
      setIsComparing(true);
      setSyncError(null);
      setSyncSuccess(false);
      setDiffStats(null);
      const remoteData = await fetchStrapiData();
      const localStr = JSON.stringify(merged.data, null, 2);
      const remoteStr = JSON.stringify(remoteData, null, 2);
      
      const changes = diff.diffLines(remoteStr, localStr);
      let added = 0;
      let removed = 0;
      changes.forEach((part) => {
        if (part.added) added += part.count || 0;
        if (part.removed) removed += part.count || 0;
      });
      setDiffStats({ added, removed });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsComparing(false);
    }
  };

  const approveSync = async () => {
    if (!merged) return;
    try {
      setIsSyncing(true);
      setSyncError(null);
      await updateStrapiData(merged.data);
      setSyncSuccess(true);
      setDiffStats(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  const downloadFinal = () => {
    if (!merged) return;
    console.log('[sync] merged ' + merged.stats.courses + ' courses', merged.stats);
    console.log('[sync] sample', merged.data.slice(1, 4));
    downloadJson(merged.data, FINAL_FILENAME);
  };

  const downloadAll = () => {
    for (const id of present) downloadJson(results[id], RESULT_FILENAMES[id]);
  };

  return (
    <div className="results">
      <div className="results__head">
        <span>Results — {results.semesterLabel}</span>
      </div>

      {merged ? (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button className="primary-btn" onClick={downloadFinal}>
              Download {FINAL_FILENAME}
            </button>
            <button className="primary-btn" onClick={compareWithStrapi} disabled={isComparing || isSyncing}>
              {isComparing ? 'Comparing...' : 'Strapi Sync'}
            </button>
          </div>
          
          {syncError && <p className="warning">Strapi Error: {syncError}</p>}
          {syncSuccess && <p className="summary summary--done" style={{marginTop: '4px'}}>Successfully synced to Strapi!</p>}
          
          {diffStats && (
            <div className="results__stats" style={{ padding: '8px', background: 'var(--color-bg-alt)', borderRadius: '4px', border: '1px solid var(--color-border)', marginBottom: '8px' }}>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Strapi Diff:</strong> {diffStats.added} lines added, {diffStats.removed} lines removed.
              </p>
              <button className="primary-btn" onClick={approveSync} disabled={isSyncing}>
                {isSyncing ? 'Syncing...' : 'Approve & Sync to Strapi'}
              </button>
            </div>
          )}
          <p className="results__stats">
            {merged.stats.courses} courses · {merged.stats.withTimings} with timings ·{' '}
            {merged.stats.withPrereqs} with prerequisites · {merged.stats.withDescription} with
            descriptions
          </p>
          {present.length < SOURCE_IDS.length && (
            <p className="warning">
              Merged from {present.length} of {SOURCE_IDS.length} sources — the missing ones are
              blank in the output.
            </p>
          )}
          {merged.stats.orphanTimings.length > 0 && (
            <p className="warning">
              {merged.stats.orphanTimings.length} timetable row(s) matched no catalog course and were
              dropped (e.g. {merged.stats.orphanTimings.slice(0, 3).join(', ')}).
            </p>
          )}
        </>
      ) : (
        <p className="warning">
          Course catalog missing — retry it above before the final file can be built.
        </p>
      )}

      <button className="link-btn results__toggle" onClick={() => setRaw((v) => !v)}>
        {raw ? 'Hide' : 'Show'} raw source files
      </button>

      {raw && (
        <button className="link-btn" onClick={downloadAll}>
          Download all {present.length}
        </button>
      )}

      {raw && present.map((id) => {
        const records = results[id] as unknown[];
        return (
          <div key={id} className="results__row">
            <span>
              {SOURCE_LABELS[id]} — <strong>{records.length}</strong> records
            </span>
            <button className="link-btn" onClick={() => downloadJson(records, RESULT_FILENAMES[id])}>
              {RESULT_FILENAMES[id]}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function SyncSemesterPlanner() {
  const { run, warnings, loaded, start, cancel, retry } = useSyncRun();
  const [scheduleId, setScheduleId] = useState(DEFAULT_SEMESTER_ID);
  const [results, setResults] = useState<SyncResults | null>(null);

  const running = run?.status === 'running';
  const selected = run && running ? run.scheduleId : scheduleId;

  // Re-read whenever a source finishes, so counts appear as each one lands
  // rather than only at the end of the whole run.
  const doneCount = run
    ? SOURCE_IDS.filter((id: SourceId) => run.sources[id].status === 'done').length
    : 0;

  useEffect(() => {
    readResults().then(setResults).catch(() => {});
  }, [doneCount, run?.runId, run?.status]);

  // Ticks only while running, so a finished run shows a frozen final duration.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = run ? (run.finishedAt ?? now) - run.startedAt : 0;

  if (!loaded) {
    return (
      <div className="tool-container">
        <h2>Sync Semester Planner</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="tool-container">
      <h2>Sync Semester Planner</h2>

      <div className="controls">
        <label htmlFor="semester">Semester</label>
        <select
          id="semester"
          value={selected}
          disabled={running}
          onChange={(e) => setScheduleId(e.target.value)}
        >
          {SEMESTERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        {running ? (
          <button className="primary-btn danger" onClick={() => cancel()}>
            Cancel
          </button>
        ) : (
          <button className="primary-btn" onClick={() => start(scheduleId)}>
            Sync Now
          </button>
        )}
      </div>

      {run && (
        <>
          <div className="runbar">
            <span>
              {running && <span className="spinner" aria-hidden="true" />}
              {doneCount} of {SOURCE_IDS.length} sources complete
            </span>
            <span className="runbar__time">{fmtElapsed(elapsed)}</span>
          </div>

          <div className="sources">
            {SOURCE_IDS.map((id) => (
              <SourceRow key={id} state={run.sources[id]} busy={running} onRetry={() => retry(id)} />
            ))}
          </div>

          {run.status !== 'running' && (
            <p className={`summary summary--${run.status}`}>
              {run.status === 'done' && `All three sources synced for ${run.semesterLabel}.`}
              {run.status === 'partial' &&
                `Some sources failed for ${run.semesterLabel}. Retry them individually above.`}
              {run.status === 'failed' && `Sync failed for ${run.semesterLabel}.`}
              {run.status === 'cancelled' && 'Sync cancelled.'}
            </p>
          )}

          {SOURCE_IDS.flatMap((id) =>
            (warnings[id] || []).map((w, i) => (
              <p key={`${id}-${i}`} className="warning">
                {SOURCE_LABELS[id]}: {w}
              </p>
            ))
          )}
        </>
      )}

      {results && results.runId === run?.runId && <ResultsPanel results={results} />}

      {running && (
        <p className="muted">
          Tabs open in the background. You can close this popup — the sync keeps running.
        </p>
      )}
    </div>
  );
}
