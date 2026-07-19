// Functions in this file are serialized and injected into the MAIN world of an
// AMS page by chrome.scripting.executeScript. They therefore cannot reference
// anything outside their own body — no imports, no shared helpers. The
// duplication between them is deliberate and load-bearing.
//
// Every one of them is read-only: they call Get* page methods and read the DOM.
// Nothing here writes to AMS.

export interface ScrapeArgs {
  runId: string;
  scheduleId: string;
  term: string;
  year: number;
}

export interface ScrapeResult {
  records: unknown[];
  warnings: string[];
}

// ------------------------------------------------------------------ catalog

/**
 * Pulls the full course list for a schedule in one call (empty AcadProgSysGenId
 * returns every programme), then fetches one description per course.
 */
export async function scrapeCatalog(args: ScrapeArgs): Promise<ScrapeResult> {
  const { runId, scheduleId, term, year } = args;
  const CONCURRENCY = 8;
  const MAX_RETRIES = 3;
  const RETRY_BASE_MS = 400;

  const report = (p: Record<string, unknown>) =>
    window.postMessage({ __amsSync: true, runId, source: 'catalog', ...p }, '*');

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const origin = location.origin;

  async function post(method: string, xml: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      try {
        const res = await fetch(
          origin + '/Contents/ContentManagement/ViewCourseCatalogue.aspx/' + method,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Accept: 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ xml }),
          }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        return typeof json.d === 'string' ? json.d : '';
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  report({ status: 'scraping', message: 'Fetching course list…' });

  const listXml =
    '<tbl><tr>' +
    '<ScheduleSysGenId>' + scheduleId + '</ScheduleSysGenId>' +
    '<AcadProgSysGenId></AcadProgSysGenId>' +
    '<CCatSysGenId_Level1></CCatSysGenId_Level1>' +
    '</tr></tbl>';

  const raw = await post('GetListData', listXml);
  let rows: any[];
  try {
    rows = JSON.parse(raw).Data || [];
  } catch {
    throw new Error('GetListData returned an unparseable payload');
  }
  if (!rows.length) throw new Error('GetListData returned 0 courses for ' + scheduleId);

  console.log('[sync] catalog: ' + rows.length + ' courses returned', rows[0]);

  const warnings: string[] = [];
  const records = rows.map((r: any) => ({
    courseTitle: r.Title || '',
    courseCode: r.DisplayCode || '',
    credits: r.Credits == null ? '' : String(r.Credits),
    faculty: r.Faculty || '',
    tfEmail: r.TF || '',
    taEmail: r.UGTAGA || '',
    category: r.Category || '',
    semester: term,
    year: String(year),
    description: '',
    _ids: {
      scheduleId: r.ScheduleSysGenId,
      courseId: r.CourseSysGenId,
      lsNo: r.LSNo,
      hasCatalogue: r.isCatalogueExist === 1,
    },
  }));

  // Courses flagged isCatalogueExist === 0 have no description to fetch; asking
  // for one is a wasted round trip per course.
  const fetchable = records.filter((r) => r._ids.hasCatalogue);
  const skipped = records.length - fetchable.length;
  if (skipped) warnings.push(skipped + ' course(s) have no catalogue entry; description left blank');

  report({
    status: 'scraping',
    message: 'Fetching descriptions…',
    done: 0,
    total: fetchable.length,
  });

  let cursor = 0;
  let done = 0;
  const failures: string[] = [];

  const runners = Array.from(
    { length: Math.min(CONCURRENCY, fetchable.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= fetchable.length) return;
        const rec = fetchable[i];
        try {
          rec.description = await post(
            'GetDataCourseCatalog',
            '<tbl><tr>' +
              '<ScheduleSysGenId>' + rec._ids.scheduleId + '</ScheduleSysGenId>' +
              '<CourseSysGenId>' + rec._ids.courseId + '</CourseSysGenId>' +
              '<LSNo>' + rec._ids.lsNo + '</LSNo>' +
              '</tr></tbl>'
          );
        } catch (err) {
          failures.push(rec.courseCode);
        }
        done++;
        if (done % 10 === 0 || done === fetchable.length) {
          report({ done, total: fetchable.length });
        }
        if (done % 50 === 0) {
          console.log(
            '[sync] catalog ' + done + '/' + fetchable.length + ' — last: ' + rec.courseCode,
            String(rec.description).slice(0, 120)
          );
        }
      }
    }
  );
  await Promise.all(runners);

  if (failures.length) {
    warnings.push(failures.length + ' description fetch(es) failed: ' + failures.slice(0, 10).join(', '));
  }

  records.forEach((r: any) => delete r._ids);
  return { records, warnings };
}

// ------------------------------------------------------------------ prereqs

/**
 * Drives ddlSchedule + btnGet, waits for the list table, then fetches
 * prerequisites per course.
 */
export async function scrapePrereqs(args: ScrapeArgs): Promise<ScrapeResult> {
  const { runId, scheduleId } = args;
  const CONCURRENCY = 6;
  const MAX_RETRIES = 3;

  const report = (p: Record<string, unknown>) =>
    window.postMessage({ __amsSync: true, runId, source: 'prereqs', ...p }, '*');

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const $ = (window as any).jQuery;
  const rowsNow = () =>
    document.querySelectorAll('#tblListView tbody tr').length;

  async function waitFor(fn: () => boolean, timeoutMs: number, what: string) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (fn()) return;
      await sleep(250);
    }
    throw new Error('Timed out waiting for ' + what);
  }

  report({ status: 'preparing', message: 'Selecting semester…' });

  const ddl = document.getElementById('ddlSchedule') as HTMLSelectElement | null;
  if (!ddl) throw new Error('ddlSchedule not found — page layout changed?');
  if (!Array.from(ddl.options).some((o) => o.value === scheduleId)) {
    throw new Error('Schedule ' + scheduleId + ' is not offered on the prerequisites page');
  }

  const before = rowsNow();
  // select2 wraps this dropdown, so a plain .value assignment is invisible to
  // the page's handlers — go through jQuery's change event like a click would.
  if ($) $('#ddlSchedule').val(scheduleId).trigger('change');
  else {
    ddl.value = scheduleId;
    ddl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  report({ status: 'preparing', message: 'Loading course list…' });
  const btn = document.getElementById('btnGet') as HTMLButtonElement | null;
  if (!btn) throw new Error('btnGet not found — page layout changed?');
  btn.click();

  await waitFor(() => rowsNow() > 0 && rowsNow() !== before, 60000, 'the course list to load');
  // The table fills in a single append, but give the last batch a beat to land.
  await sleep(500);

  // The tablesorter pager hides rows rather than removing them, so a DOM read
  // already sees everything. Set "All" anyway so the count shown to a human
  // watching the tab matches what we scraped.
  const pagesize = document.querySelector('#tblListView select.pagesize') as HTMLSelectElement | null;
  if (pagesize && pagesize.value !== '100000') {
    pagesize.value = '100000';
    pagesize.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
  }

  const rowEls = Array.from(document.querySelectorAll('#tblListView tbody tr'));
  console.log('[sync] prereqs: ' + rowEls.length + ' rows in the course list');
  const items: { courseCode: string; courseTitle: string; courseId: string | null }[] = [];
  for (const row of rowEls) {
    const cols = row.querySelectorAll('td');
    if (cols.length < 4) continue;
    const link = cols[3].querySelector('a');
    items.push({
      courseCode: (cols[1].textContent || '').trim(),
      courseTitle: (cols[2].textContent || '').trim(),
      courseId: link ? link.getAttribute('CourseSysGenId') || link.getAttribute('coursesysgenid') : null,
    });
  }
  if (!items.length) throw new Error('Course list loaded but no readable rows');

  const withLink = items.filter((i) => i.courseId);
  report({
    status: 'scraping',
    message: 'Fetching prerequisites…',
    done: 0,
    total: withLink.length,
  });

  const byCode = new Map<string, unknown[]>();
  let cursor = 0;
  let done = 0;
  const failures: string[] = [];
  const origin = location.origin;

  const runners = Array.from({ length: Math.min(CONCURRENCY, withLink.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= withLink.length) return;
      const item = withLink[i];
      let ok = false;
      for (let attempt = 0; attempt <= MAX_RETRIES && !ok; attempt++) {
        if (attempt > 0) await sleep(400 * Math.pow(2, attempt - 1));
        try {
          const res = await fetch(
            origin + '/Contents/CourseManagement/CoursePreRequisites_View.aspx/GetCoursePrerequisites',
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
              },
              body: JSON.stringify({
                xml: '<tbl><tr><CourseSysGenId>' + item.courseId + '</CourseSysGenId></tr></tbl>',
              }),
            }
          );
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = await res.json();
          byCode.set(item.courseCode, JSON.parse(String(json.d).replace(/[\r\n]/g, '')));
          ok = true;
        } catch {
          /* retry */
        }
      }
      if (!ok) failures.push(item.courseCode);
      done++;
      if (done % 10 === 0 || done === withLink.length) report({ done, total: withLink.length });
      if (done % 50 === 0) {
        console.log(
          '[sync] prereqs ' + done + '/' + withLink.length + ' — last: ' + item.courseCode,
          byCode.get(item.courseCode)
        );
      }
    }
  });
  await Promise.all(runners);

  const warnings: string[] = [];
  if (failures.length) {
    warnings.push(failures.length + ' prerequisite fetch(es) failed: ' + failures.slice(0, 10).join(', '));
  }

  const records = items.map((i) => ({
    courseCode: i.courseCode,
    courseTitle: i.courseTitle,
    prerequisites: byCode.get(i.courseCode) || [],
  }));

  return { records, warnings };
}

// ------------------------------------------------------------------ timings

/**
 * Reads #tblLSCodeWisePreferenceData. The page populates it on load, so this
 * only touches the dropdown when the wanted schedule is not already showing.
 */
export async function scrapeTimings(args: ScrapeArgs): Promise<ScrapeResult> {
  const { runId, scheduleId, term, year } = args;

  const report = (p: Record<string, unknown>) =>
    window.postMessage({ __amsSync: true, runId, source: 'timings', ...p }, '*');

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const $ = (window as any).jQuery;
  const table = () => document.getElementById('tblLSCodeWisePreferenceData');
  const rowsNow = () => (table() ? table()!.querySelectorAll('tbody tr').length : 0);

  async function waitFor(fn: () => boolean, timeoutMs: number, what: string) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (fn()) return;
      await sleep(250);
    }
    throw new Error('Timed out waiting for ' + what);
  }

  const hid = document.getElementById('hidScheduleSysGenId') as HTMLInputElement | null;
  const alreadyLoaded = hid?.value === scheduleId && rowsNow() > 0;

  if (!alreadyLoaded) {
    report({ status: 'preparing', message: 'Selecting semester…' });
    const ddl = document.getElementById('ddlSchedule') as HTMLSelectElement | null;
    if (!ddl) throw new Error('ddlSchedule not found — page layout changed?');
    if (!Array.from(ddl.options).some((o) => o.value === scheduleId)) {
      throw new Error('Schedule ' + scheduleId + ' is not offered on the timings page');
    }

    const before = rowsNow();
    // ChangeSemester() reads ddlSchedule, syncs the hidden fields and clicks
    // btnGet, so triggering change is enough — no direct btnGet click needed.
    if ($) $('#ddlSchedule').val(scheduleId).trigger('change');
    else {
      ddl.value = scheduleId;
      ddl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    report({ status: 'preparing', message: 'Loading timetable…' });
    await waitFor(
      () => hid?.value === scheduleId && rowsNow() > 0 && rowsNow() !== before,
      60000,
      'the timetable to reload'
    );
    await sleep(500);
  }

  report({ status: 'scraping', message: 'Reading timetable…' });

  const el = table();
  if (!el) throw new Error('tblLSCodeWisePreferenceData not found');

  const rows = Array.from(el.querySelectorAll('tr:not(.tablesorter-headerRow)'));
  const records: unknown[] = [];
  const warnings: string[] = [];
  let short = 0;

  for (const row of rows) {
    const cols = row.querySelectorAll('td');
    if (cols.length < 10) {
      if (cols.length) short++;
      continue;
    }
    const timings = cols[9].innerHTML
      .split(/<br\s*\/?>/i)
      .map((d) => d.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    records.push({
      courseCode: (cols[2].textContent || '').trim(),
      courseTitle: (cols[3].textContent || '').trim(),
      faculty: (cols[4].textContent || '').trim(),
      classCounts: parseInt((cols[7].textContent || '').trim(), 10),
      classDetails: timings,
      semester: term,
      year,
    });
  }

  if (!records.length) throw new Error('Timetable table present but no readable rows');
  if (short) warnings.push(short + ' row(s) had fewer than 10 columns and were skipped');

  console.log('[sync] timings: ' + records.length + ' rows read', records.slice(0, 2));

  report({ done: records.length, total: records.length });
  return { records, warnings };
}
