import type { SyncResults } from './types';

/**
 * Port of scripts-temp/merge-format.js, minus `fs`. Same output shape, so
 * final-file1.json from here is a drop-in replacement for the Node pipeline.
 */

export interface CatalogRecord {
  courseCode: string;
  courseTitle: string;
  faculty: string;
  semester: string;
  year: string;
  description: string;
}

export interface PrereqRecord {
  courseCode: string;
  prerequisites: unknown[];
}

export interface TimingRecord {
  courseCode: string;
  classCounts: number;
  classDetails: string[];
}

export interface MergedCourse {
  courseCode: string;
  courseTitle: string;
  faculty: string;
  classCounts: number;
  classDetails: string[];
  semester: string;
  year: string;
  description: string;
  prerequisites: unknown[];
}

export interface MergeStats {
  courses: number;
  withTimings: number;
  withPrereqs: number;
  withDescription: number;
  /** Codes present in timings but absent from the catalog — nothing to attach them to. */
  orphanTimings: string[];
}

export interface MergeOutput {
  /** [{ dateLastFetched, timeLastFetched }, ...courses] — the header row is index 0. */
  data: unknown[];
  stats: MergeStats;
}

/** "CS-1101-1" -> "CS-1101". Prerequisites are keyed without the section suffix. */
const normalizeCourseCode = (code: string) =>
  code.slice(0, code.lastIndexOf('-')) || code;

/** Timetable cells carry a trailing "[3]" occurrence count that isn't wanted. */
const cleanDetail = (d: string) =>
  typeof d === 'string' ? d.replace(/\s*\[\d+\]$/, '').trim() : d;

export function mergeResults(results: SyncResults): MergeOutput {
  const catalog = (results.catalog || []) as CatalogRecord[];
  const prereqs = (results.prereqs || []) as PrereqRecord[];
  const timings = (results.timings || []) as TimingRecord[];

  const timingsByCode = new Map(timings.map((t) => [t.courseCode, t]));
  const prereqsByCode = new Map(prereqs.map((p) => [p.courseCode, p.prerequisites]));

  const now = new Date();
  const header = {
    dateLastFetched: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long' }),
    timeLastFetched: now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };

  const stats: MergeStats = {
    courses: catalog.length,
    withTimings: 0,
    withPrereqs: 0,
    withDescription: 0,
    orphanTimings: [],
  };

  const courses: MergedCourse[] = catalog.map((item) => {
    const t = timingsByCode.get(item.courseCode);
    const rawDetails = t?.classDetails ?? [];
    const prerequisites = prereqsByCode.get(normalizeCourseCode(item.courseCode)) || [];

    if (t) stats.withTimings++;
    if (prerequisites.length) stats.withPrereqs++;
    if (item.description) stats.withDescription++;

    return {
      courseCode: item.courseCode,
      // Escaped here because downstream renders these into HTML attributes.
      courseTitle: (item.courseTitle || '')
        .replaceAll("'", '&#39;')
        .replaceAll('"', '&#34;'),
      faculty: item.faculty || '',
      // parseInt can yield NaN, which JSON.stringify silently turns into null.
      classCounts: t && Number.isFinite(t.classCounts) ? t.classCounts : 0,
      classDetails: rawDetails.length ? [rawDetails.map(cleanDetail).join(' ')] : [],
      semester: (item.semester || '').toLowerCase(),
      year: item.year ? String(item.year) : '',
      description: item.description || '',
      prerequisites,
    };
  });

  const catalogCodes = new Set(catalog.map((c) => c.courseCode));
  for (const t of timings) {
    if (!catalogCodes.has(t.courseCode)) stats.orphanTimings.push(t.courseCode);
  }

  return { data: [header, ...courses], stats };
}
